/**
 * @spec notify 담당 세션의 사건 알림
 * @why 사용자가 묻지 않아도 담당 세션의 중요한 일(시작·질문·막힘·설계 제출·테스트 올림·담당 종료)을 바로 알게 한다. 같은 사건을 (1) 서버가 iTerm2 창으로 열고 (2) 메인 세션이 Monitor로 받아 대화 중에 먼저 말하도록 두 곳에 내놓는다.
 * @contract 알릴 사건은 요청 기록의 started·asking·blocked·design-submitted·test-requested와, 담당 세션이 살아 있다가 사라진 것(session-ended)뿐이다(잡다한 기록은 알리지 않는다). 받는 쪽(consumer: terminal·watch)마다 어디까지 알렸는지를 .spec/notify-cursor.json(커밋하지 않음)에 적어 같은 사건을 두 번 알리지 않는다. 처음 보는 요청은 지금까지의 기록을 알리지 않고 그 시점부터 센다. 담당 종료는 읽기 전용 `claude agents --json`에 담당 세션이 한 번이라도 보인 뒤 사라졌을 때 한 번만 알린다(목록을 못 읽으면 알리지 않는다). 끝난·취소된 요청은 알리지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadRequests } from './request.js';
import { ownersOf } from './session.js';
import { agentsList } from './outbox.js';
import { projectRoot } from './project.js';
import { attachCommand, openSessionWindow, shortIdOf } from './terminal.js';
import { kst } from './kst.js';

/** 알릴 사건 기록 종류와 사용자가 할 일 */
const KINDS: Record<string, { label: string; todo: string }> = {
  started: { label: '시작', todo: '담당이 설계를 쓰기 시작했습니다' },
  asking: { label: '질문', todo: '사용자에게 묻고 있습니다. 답해 주세요' },
  blocked: { label: '막힘', todo: '막혔습니다. 확인해 주세요' },
  'design-submitted': { label: '설계 제출', todo: '설계를 승인하거나 반려해 주세요' },
  'test-requested': { label: '테스트 올림', todo: '테스트를 승인하거나 문제를 알려 주세요' },
};

/** 알릴 일 하나 */
export interface Notice {
  /** 요청 번호 */
  id: number;
  /** 사건이 생긴 때(ISO) */
  at: string;
  /** 사건 종류(요청 기록의 종류 또는 session-ended) */
  kind: string;
  /** 사람이 읽는 한 줄(무슨 일·사용자가 할 일·들어가는 명령) */
  text: string;
  /** 담당 세션 이름(창을 열 때 쓴다) */
  name: string;
}

interface Cursor { [consumer: string]: { [id: string]: string }; }
interface Alive { seen: string[]; ended: string[] }

const cursorFile = (root: string): string => path.join(root, '.spec', 'notify-cursor.json');
const aliveFile = (root: string): string => path.join(root, '.spec', 'notify-alive.json');
const readJson = <T>(file: string, fallback: T): T => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return fallback; } };
const writeJson = (file: string, v: unknown): void => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(v, null, 2) + '\n'); };

/** 한 줄 알림 글 */
const lineOf = (id: number, kind: string, extra: string, sid: string): string => `요청 #${id} ${KINDS[kind]?.label ?? '담당 종료'} — ${extra} · 들어가기: ${sid ? attachCommand(sid) : '(담당 세션 없음)'}`;

/** 담당 세션이 사라졌는지 살펴, 새로 사라진 요청 번호를 돌려준다(상태는 notify-alive.json) */
function endedSessions(root: string, openIds: number[]): number[] {
  const live = agentsList();
  if (!live) return [];
  const liveIds = new Set(live.map((a) => a.sessionId));
  const st = readJson<Record<string, Alive>>(aliveFile(root), {});
  const gone: number[] = [];
  for (const id of openIds) {
    const owners = ownersOf(root, id);
    if (!owners.length) continue;
    const a = st[id] ?? { seen: [], ended: [] };
    for (const sid of owners) {
      if (liveIds.has(sid)) { if (!a.seen.includes(sid)) a.seen.push(sid); a.ended = a.ended.filter((x) => x !== sid); }
      else if (a.seen.includes(sid) && !a.ended.includes(sid)) { a.ended.push(sid); gone.push(id); }
    }
    st[id] = a;
  }
  writeJson(aliveFile(root), st);
  return gone;
}

/** 이 받는 쪽이 아직 못 받은 새 알림을 모아 돌려주고 읽은 자리를 옮긴다 */
export function takeNotices(scanRoot: string, consumer: string): Notice[] {
  const root = projectRoot(scanRoot);
  const cur = readJson<Cursor>(cursorFile(root), {});
  const mine = cur[consumer] ?? {};
  const open = loadRequests(scanRoot).filter((r) => r.stage !== 'done' && r.stage !== 'cancelled');
  const out: Notice[] = [];
  const now = new Date().toISOString();
  for (const r of open) {
    const last = r.events[r.events.length - 1]?.at ?? now;
    if (mine[r.id] === undefined) { mine[r.id] = last; continue; }
    for (const e of r.events) {
      if (e.at > mine[r.id] && KINDS[e.kind]) {
        const k = KINDS[e.kind];
        out.push({ id: r.id, at: e.at, kind: e.kind, name: r.agent.name, text: lineOf(r.id, e.kind, `${k.todo} (${kst(e.at)})`, shortIdOf(root, r.id)) });
      }
    }
    mine[r.id] = last;
  }
  const gone = endedSessions(root, open.map((r) => r.id));
  // 담당 종료는 받는 쪽마다 한 번씩 알려야 하므로, 새로 사라졌다고 본 번호를 이 받는 쪽 몫으로만 준다
  const shared = readJson<Record<string, number[]>>(path.join(root, '.spec', 'notify-ended.json'), {});
  for (const id of gone) for (const c of ['terminal', 'watch']) shared[c] = [...new Set([...(shared[c] ?? []), id])];
  for (const id of shared[consumer] ?? []) {
    const r = open.find((x) => x.id === id);
    if (r) out.push({ id, at: now, kind: 'session-ended', name: r.agent.name, text: lineOf(id, 'session-ended', '담당 세션이 끝났습니다(이어 일하려면 요청 상세에서 다시 보내기)', shortIdOf(root, r.id)) });
  }
  shared[consumer] = [];
  writeJson(path.join(root, '.spec', 'notify-ended.json'), shared);
  cur[consumer] = mine;
  writeJson(cursorFile(root), cur);
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** 서버가 한 번 돌리는 일: 새 사건마다 그 요청의 담당 세션 창을 연다(요청마다 창 하나) */
export function openWindowsForNotices(scanRoot: string): string[] {
  const root = projectRoot(scanRoot);
  const seen = new Set<number>();
  const problems: string[] = [];
  for (const n of takeNotices(scanRoot, 'terminal')) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    const why = openSessionWindow(root, n.id, n.name);
    if (why) problems.push(`#${n.id}: ${why}`);
  }
  return problems;
}

/** `request watch`: 새 알림을 한 줄씩 내보내며 기다린다(메인 세션이 Monitor로 돌린다). --once면 지금 있는 것만 내보내고 끝난다 */
export async function watch(scanRoot: string, o: { once?: boolean; timeoutMs?: number }): Promise<void> {
  const end = Date.now() + (o.timeoutMs ?? 55 * 60_000);
  for (;;) {
    for (const n of takeNotices(scanRoot, 'watch')) console.log(n.text);
    if (o.once || Date.now() > end) return;
    await new Promise((ok) => setTimeout(ok, 3000));
  }
}
