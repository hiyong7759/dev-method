/**
 * @spec reconcile 담당·메신저 중복 점검과 정리(마지막 안전장치)
 * @why 담당 세션이 요청마다 둘 이상 뜨거나 메신저가 둘 이상 뜨면 같은 일을 겹쳐 하고 브랜치·워크트리가 겹쳐 생긴다. 이 파일은 앞의 세 겹(못 만들게 / 담당이 원본인지 확인 / 원본이 아니면 브랜치·커밋·상태 변경 거절)이 뚫렸을 때만 일하는 마지막 점검이다. 평소에는 아무것도 하지 않는다.
 * @contract 서버의 1분 점검이 부른다. 요청마다 "그 요청 담당 이름으로 떠 있는 세션 + 담당 기록"을 모아 둘 이상이면 한 세션만 남긴다. 남길 쪽은 ① 워크트리 경로·브랜치(세션 작업 기록의 worktreePath·worktreeBranch)가 있는 세션 ② 서버가 만든 원본 표시가 있는 세션 ③ 가장 최근에 시작한 세션 순서로 고른다. 나머지는 `claude stop`으로 멈추고 담당 기록에서 지우며, 멈추는 쪽에 남은 워크트리·브랜치는 요청 기록에 경로·브랜치를 적어 사라지지 않게 한다. 메신저는 가장 먼저 시작한 하나만 남긴다. 담당·메신저 이름이 아닌 세션(메인 에이전트 등)은 건드리지 않는다. 정리했을 때만 wake.log와 요청의 최근 기록에 남기고, 세션 목록을 못 읽으면 아무것도 하지 않는다. 판단(planReconcile)은 순수 함수라 가짜 목록으로 시험한다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readConfig } from './config.js';
import { agentsList, messengerName } from './outbox.js';
import type { AgentInfo } from './outbox.js';
import { projectRoot } from './project.js';
import { noteCleanup } from './request.js';
import { adoptOwner, loadOwners, logFile, ownerName } from './session.js';
import type { OwnerEntry } from './session.js';

/** 세션의 워크트리 정보(없으면 null) */
export interface WorktreeRef {
  /** 워크트리 폴더 경로 */
  path: string;
  /** 그 워크트리의 브랜치 */
  branch: string;
}

/** 한 요청의 정리 계획 */
export interface OwnerPlan {
  /** 요청 번호 */
  request: number;
  /** 남길 세션 번호 */
  keep: string;
  /** 멈출 세션들(떠 있는 것만 멈출 수 있고, 기록에만 있는 번호는 기록만 지운다) */
  stop: { sessionId: string; id?: string }[];
  /** 멈추는 쪽에 남은 워크트리·브랜치(남기는 쪽 요청 기록에 적는다) */
  leftover: { sessionId: string; path: string; branch: string }[];
}

/** 점검 입력 */
export interface ReconcileInput {
  /** 지금 떠 있는 세션 목록 */
  agents: AgentInfo[];
  /** 담당 기록 */
  owners: Record<string, OwnerEntry>;
  /** 세션의 워크트리 정보(없으면 null) */
  worktreeOf: (sid: string) => WorktreeRef | null;
  /** 요청 담당의 세션 이름 */
  nameOf: (request: number) => string;
  /** 메신저 세션 이름 */
  messenger: string;
}

/** 점검 계획: 순수 함수 */
export function planReconcile(input: ReconcileInput): { owners: OwnerPlan[]; messengerStop: AgentInfo[] } {
  const bg = input.agents.filter((a) => a.kind === 'background' || a.kind === undefined);
  const plans: OwnerPlan[] = [];
  const requests = new Set(Object.values(input.owners).map((v) => v.request));
  for (const id of requests) {
    const name = input.nameOf(id);
    const byId = new Map<string, { sessionId: string; id?: string; startedAt: number }>();
    for (const a of bg) if (a.sessionId && (a.name === name || input.owners[a.sessionId]?.request === id)) byId.set(a.sessionId, { sessionId: a.sessionId, id: a.id, startedAt: a.startedAt ?? 0 });
    // 떠 있는 세션이 둘 이상일 때만 어긋난 것이다(떠 있지 않은 옛 기록만 여럿인 것은 건드리지 않는다)
    if (byId.size < 2) continue;
    for (const [sid, v] of Object.entries(input.owners)) if (v.request === id && !byId.has(sid)) byId.set(sid, { sessionId: sid, startedAt: Date.parse(v.starting ?? v.seen) || 0 });
    if (byId.size < 2) continue;
    const all = [...byId.values()];
    const score = (c: { sessionId: string; startedAt: number }): number[] => [input.worktreeOf(c.sessionId) ? 1 : 0, input.owners[c.sessionId]?.origin ? 1 : 0, c.startedAt];
    all.sort((a, b) => { const x = score(a), y = score(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; });
    const [keep, ...rest] = all;
    plans.push({
      request: id, keep: keep.sessionId, stop: rest.map((r) => ({ sessionId: r.sessionId, id: r.id })),
      leftover: rest.flatMap((r) => { const w = input.worktreeOf(r.sessionId); return w && !(input.worktreeOf(keep.sessionId)?.path === w.path) ? [{ sessionId: r.sessionId, ...w }] : []; }),
    });
  }
  const messengers = bg.filter((a) => a.name === input.messenger).sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  return { owners: plans, messengerStop: messengers.slice(1) };
}

/** 세션 작업 기록에서 워크트리 정보를 읽는다 */
export function worktreeOfSession(sid: string): WorktreeRef | null {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'jobs', sid.slice(0, 8), 'state.json'), 'utf8')) as { worktreePath?: string; worktreeBranch?: string };
    return s.worktreePath && s.worktreeBranch ? { path: s.worktreePath, branch: s.worktreeBranch } : null;
  } catch { return null; }
}

/** 점검을 하고 정리한다. 정리한 건수를 돌려준다(설정 wake가 꺼져 있거나 시험용 서버거나 세션 목록을 못 읽으면 0) */
export function reconcile(scanRoot: string): number {
  try {
    const root = projectRoot(scanRoot);
    if (process.env.SPEC_TEST_DIR || !readConfig(root).wake) return 0;
    const agents = agentsList();
    if (!agents) return 0;
    const plan = planReconcile({ agents, owners: loadOwners(root), worktreeOf: worktreeOfSession, nameOf: (id) => ownerName(root, id), messenger: messengerName(root) });
    const log = (t: string): void => { fs.appendFileSync(logFile(root), `${new Date().toISOString()} ${t}\n`); };
    const stopSession = (s: { id?: string; sessionId?: string }): void => { if (s.id) spawnSync('claude', ['stop', s.id], { encoding: 'utf8', timeout: 15_000 }); };
    let n = 0;
    for (const p of plan.owners) {
      for (const s of p.stop) stopSession(s);
      adoptOwner(root, p.request, p.keep);
      const left = p.leftover.map((l) => `${l.path} (${l.branch})`).join(', ');
      const text = `요청 #${p.request}의 담당이 둘 이상이라 ${p.keep.slice(0, 8)}만 남기고 ${p.stop.map((s) => s.sessionId.slice(0, 8)).join(', ')}을 멈춤${left ? ` · 멈춘 쪽에 남은 워크트리·브랜치: ${left}(지우지 않았으니 이어받아 쓰거나 합치기 전에 정리)` : ''}`;
      log(`안전망 정리: ${text}`);
      try { noteCleanup(scanRoot, p.request, text); } catch { /* 기록 실패가 정리를 되돌리지 않는다 */ }
      n++;
    }
    for (const m of plan.messengerStop) { stopSession(m); log(`안전망 정리: 메신저가 둘 이상이라 ${m.sessionId?.slice(0, 8)}을 멈춤`); n++; }
    return n;
  } catch { return 0; }
}
