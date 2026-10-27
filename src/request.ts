/**
 * @spec requests 변경 요청 저장
 * @why 현재를 바꾸는 모든 일을 "요청" 하나의 흐름(설계 → 구현 → 테스트 → 완료)으로 모아, 언제 왜 어떻게 바뀌었는지 한곳에서 따라가게 한다. 요청 하나가 파일 하나(.spec/requests/<번호>.json)라서 여러 PC에서 git으로 나눠 써도 서로 다른 요청은 부딪치지 않는다.
 * @basis 모든 변경이 같은 요청 흐름을 거친다 (사용자 결정)
 * @contract 새 요청은 접수 절차(rules/intake.md)를 거쳐 합칠 요청을 먼저 찾는다: `similar`는 후보를 보이기만 하고, `merge`는 사용자 말 인용이 있어야 접수·설계 작성 중인 요청끼리 합친다. 요청 파일의 모양(types.ts의 Request)을 바꾸면 model.ts의 요청 목록과 viewer/manage-*.ts의 관리 화면도 함께 고친다. 설계는 건드릴 파일(files)이 있어야 올라가고, 승인되면 그 목록이 요청에 남아 commit-msg가 범위 밖 커밋을 막는다. 담당 세션은 막히면 blocked, 사용자에게 물을 때 ask로 그 사실을 요청 상태에 남기고(막힘은 다음 에이전트 기록이, 질문은 사용자의 다음 기록이 풀어 준다) 화면이 요청 목록·상세·내 차례에 띄운다. 에이전트는 이 모듈의 명령(add, design, impl, test, fixed, found, also, blocked, ask, agent, list)으로만 요청을 움직이고, 승인·반려·순서 정하기는 사용자 화면(middleware.ts)이 하고, 대화로 결정했을 때는 사용자 말 인용을 붙인 approve-*·reject-design·test-problem이 같은 기록과 담당 세션 전달을 한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { specDir, projectRoot } from './project.js';
import { parseArgs, csv, errorText } from './cli.js';
import { addReport } from './report.js';
import { restartForTest, seedProblem, syncRequest } from './testdata.js';
import { extractSpecs } from './extract.js';
import { buildScenarios } from './scenarios.js';
import type { Actor, DesignChange, DesignPoint, DesignScreen, Delivery, Request, RequestDesign, RequestSource, RequestStage, RequestView } from './types.js';

/** 화면에 보이는 단계 이름. 사람이 읽는 말이라 여기서만 정한다 */
export const STAGE_LABEL: Record<RequestStage, string> = { design: '설계', impl: '구현', test: '테스트', done: '완료', cancelled: '취소' };

/** 단계 안 상태의 화면용 이름과 누구 차례인지. 이 표가 목록의 "내 차례 / 에이전트 차례"를 나누는 근거다 */
export const STEP: Record<string, { label: string; turn: Actor | null }> = {
  'design:queued': { label: '접수', turn: null },
  'design:drafting': { label: '설계 작성 중', turn: 'agent' },
  'design:submitted': { label: '설계 승인 대기', turn: 'user' },
  'design:revise': { label: '설계 다시 작성 중', turn: 'agent' },
  'impl:working': { label: '구현 중', turn: 'agent' },
  'impl:waiting': { label: '대기', turn: 'agent' },
  'test:requested': { label: '테스트 승인 대기', turn: 'user' },
  'test:fix': { label: '고치는 중', turn: 'agent' },
  'done:done': { label: '완료', turn: null },
  'cancelled:cancelled': { label: '취소', turn: null },
};

/** 요청 파일이 모이는 폴더 */
const dir = (scanRoot: string): string => path.join(specDir(scanRoot), 'requests');
/** 요청 하나의 파일 위치 */
const fileOf = (scanRoot: string, id: number): string => path.join(dir(scanRoot), `${id}.json`);

/** 저장된 요청을 번호 순으로 읽는다. 깨진 파일은 목록 전체를 막지 않도록 건너뛴다 */
export function loadRequests(scanRoot: string): Request[] {
  let names: string[] = [];
  try { names = fs.readdirSync(dir(scanRoot)).filter((n) => /^\d+\.json$/.test(n)); } catch { return []; }
  const list: Request[] = [];
  for (const n of names) {
    try { list.push(JSON.parse(fs.readFileSync(path.join(dir(scanRoot), n), 'utf8')) as Request); } catch { /* 깨진 파일은 건너뜀 */ }
  }
  return list.sort((a, b) => a.id - b.id);
}

/** 요청 하나를 자기 파일에 쓴다 */
function save(scanRoot: string, req: Request): void {
  fs.mkdirSync(dir(scanRoot), { recursive: true });
  fs.writeFileSync(fileOf(scanRoot, req.id), JSON.stringify(req, null, 2) + '\n');
}

/** addRequest가 받는 값 */
export interface NewRequest {
  /** 무엇을 바꾸는 요청인지 한 줄 */
  title: string;
  /** 사용자가 한 말 그대로 */
  origin?: string;
  /** 어디로 들어왔나(대화 등) */
  channel?: string;
  /** 건드리는 화면 이름들 */
  screens?: string[];
  /** 건드리는 정보 이름들 */
  infos?: string[];
  /** 건드리는 사용 시나리오 이름들 */
  scenarios?: string[];
  /** 이번 요청이 바꾸는 단계들("시나리오#단계") */
  steps?: string[];
  /** 바꾸지 않고 영향만 확인하는 시나리오들 */
  impactOnly?: string[];
  /** 이어지는 기존 요청 번호(설계가 올라간 요청에는 합칠 수 없을 때) */
  relatedTo?: number;
  /** 맡은 세션의 이름 */
  agent?: string;
  /** user(사용자 요청) 또는 report(에이전트가 올린 리포트에서 등록) */
  source?: string;
  /** 화면도 시나리오도 없는 요청의 "테스트 없음" 이유 */
  noTest?: string;
  /** 등록할 때 정리해 사용자가 확인한 상세 내용 */
  detail?: string;
  /** 처리 방식: direct(바로 작업) 또는 design(정식 설계) */
  mode?: string;
  /** 처리 방식을 그렇게 구분한 이유 */
  reason?: string;
}

/** 에이전트가 요청을 만든다. 제목은 "한 줄 요약 (세부)"로 받는다(요청 목록 핵심만 보기가 괄호 앞까지만 보인다). 바로 작업이면 접수를 거치지 않고 설계 없음 승인으로 기록해 곧바로 구현 단계로 둔다 */
export function addRequest(scanRoot: string, { title, origin = '', channel = '대화', screens = [], infos = [], scenarios = [], steps = [], impactOnly = [], agent = '', source = 'user', relatedTo, noTest, detail = '', mode = '', reason = '' }: NewRequest): Request {
  if (!title?.trim()) throw new Error('요청 제목이 비었다');
  if (source !== 'user' && source !== 'report') throw new Error('출처는 user(사용자 요청)나 report(에이전트가 올린 리포트)만 가능하다');
  if (mode && mode !== 'direct' && mode !== 'design') throw new Error('처리 방식(mode)은 direct(바로 작업)나 design(정식 설계)만 가능하다');
  if (mode && !detail.trim()) throw new Error('처리 방식을 정하려면 사용자가 확인한 상세 내용(detail)이 있어야 한다');
  if (mode === 'direct' && (screens.length || infos.length)) throw new Error('바로 작업은 화면·정보가 바뀌지 않는 고장 수리만 쓴다(rules/approval.md). 화면·정보를 건드리면 정식 설계로 등록한다');
  if (mode === 'direct' && !reason.trim()) throw new Error('바로 작업으로 구분한 이유(reason)를 적어야 한다');
  const id = loadRequests(scanRoot).reduce((m, r) => Math.max(m, r.id), 0) + 1;
  const now = new Date().toISOString();
  const req: Request = {
    id, title: title.trim(), source: source as RequestSource, origin: { text: origin.trim(), channel, at: now },
    scope: { screens, infos, scenarios, steps, impactOnly }, agent: { name: agent },
    ...(relatedTo ? { relatedTo } : {}),
    ...(noTest?.trim() ? { noTest: noTest.trim() } : {}),
    ...(mode ? { detail: { text: detail.trim(), confirmedAt: now, mode: mode as 'direct' | 'design', reason: reason.trim() } } : {}),
    stage: 'design', step: 'queued',
    events: [{ at: now, by: 'agent', kind: 'created', note: relatedTo ? `요청 등록(#${relatedTo}과 이어짐)` : '요청 등록' }],
  };
  if (mode === 'direct') {
    // 사용자가 상세 내용과 함께 바로 작업을 확인했으므로 설계 없음 승인으로 본다
    req.design = { understanding: '', approach: '', changes: [], screens: [], none: true, rejected: 0 };
    move(req, 'impl', 'working');
    req.events.push({ at: now, by: 'user', kind: 'design-approved', note: '바로 작업으로 등록(설계 없음 승인으로 봄)' });
  }
  save(scanRoot, req);
  return req;
}

/** 요청 하나를 번호로 읽는다 */
function loadOne(scanRoot: string, id: number): Request {
  const r = loadRequests(scanRoot).find((x) => x.id === id);
  if (!r) throw new Error(`요청 #${id}을 찾지 못했다`);
  return r;
}
/** 진행 기록 한 줄을 더하고 저장한다 */
function record(scanRoot: string, r: Request, by: Actor, kind: string, note: string, quote?: string): Request {
  r.events.push({ at: new Date().toISOString(), by, kind, note, ...(quote ? { quote } : {}) });
  save(scanRoot, r);
  // 테스트 데이터 서버의 복사본이 낡지 않게 요청이 바뀔 때마다 그 요청을 복사본에 맞춘다(테스트 서버 자신 안에서는 하지 않는다: 복사본 위의 기록을 운영 것으로 덮지 않도록). 테스트 자리가 없거나 쓸 수 없어도 요청 기록은 막지 않는다
  if (!process.env.SPEC_TEST_DIR) { try { syncRequest(projectRoot(scanRoot), r.id); } catch { /* 복사본만 낡을 뿐 */ } }
  return r;
}
/** 단계를 옮긴다 */
const move = (r: Request, stage: RequestStage, step: string): void => { r.stage = stage; r.step = step; };

/** 요청이 끝났거나 취소됐는가(겹침·대기 계산에서 빠진다) */
const ended = (r: Request): boolean => r.stage === 'done' || r.stage === 'cancelled';

/** 합칠 수 있는 요청인가: 접수, 설계 작성 중(설계가 승인 대기에 올라가면 사용자가 본 설계를 몰래 바꾸지 않도록 합치지 않는다) */
const mergeable = (r: Request): boolean => r.stage === 'design' && (r.step === 'queued' || r.step === 'drafting');

/** 화면 쪽에 보여 줄 모양으로: 이름표, 누구 차례인지, 진행 중인 다른 요청과 겹치는 곳, 기다릴 요청을 붙인다.
 *  componentsOf는 요청이 건드리는 시나리오의 단계 자리(컴포넌트)를 돌려주는 함수(model.ts가 시나리오에서 계산해 준다) */
export function describeRequests(list: Request[], componentsOf: (r: Request) => string[] = () => [], deliveryOf: (r: Request) => Delivery | null = () => null): RequestView[] {
  return list.map((r) => {
    const delivery = deliveryOf(r);
    const waitingFor = (r.waitFor ?? []).filter((id) => { const o = list.find((x) => x.id === id); return !!o && !ended(o); });
    const base = STEP[`${r.stage}:${r.step}`] ?? { label: r.step, turn: null };
    const meta = r.stage === 'impl' && waitingFor.length ? STEP['impl:waiting'] : base;
    const mine = componentsOf(r);
    const overlaps = ended(r) ? [] : list.filter((o) => o.id !== r.id && !ended(o)).map((o) => {
      const theirs = componentsOf(o);
      return {
        id: o.id, title: o.title,
        screens: o.scope.screens.filter((s) => r.scope.screens.includes(s)),
        infos: o.scope.infos.filter((i) => r.scope.infos.includes(i)),
        components: theirs.filter((c) => mine.includes(c)),
      };
    }).filter((o) => o.screens.length || o.infos.length || o.components.length);
    // 에이전트 차례 글은 전달 기록으로 나눈다: 담당 세션이 읽기 전에는 일하는 것처럼 보이지 않게 한다
    const notRead = meta.turn === 'agent' && !!delivery && (delivery.state === 'sending' || delivery.state === 'hook-wait' || delivery.state === 'failed');
    const stalled = meta.turn === 'agent' && delivery?.state === 'stalled';
    const stepLabel = r.mergedInto ? `#${r.mergedInto}에 합침` : stalled ? `${meta.label} · 멈춘 듯함` : notRead ? (delivery!.state === 'failed' ? '전달 안 됨' : delivery!.kind === 'started' ? '시작 전달 중' : '결정 전달 중') : meta.label;
    return { ...r, ...(delivery ? { delivery } : {}), ...(ended(r) ? {} : openNotes(r)), stageLabel: STAGE_LABEL[r.stage], stepLabel, turn: meta.turn, overlaps, waitingFor, cost: { start: 0, wake: 0, inputTokens: 0, outputTokens: 0, usd: 0 }, redesigns: r.events.filter((e) => e.kind === 'redesigned').length };
  });
}

// ── 에이전트가 하는 일 ──────────────────────────────────

/** 설계 파일(--file)이 가진 모양. 그림 파일은 .spec/shots로 복사한다 */
export interface DesignInput {
  /** 핵심 요약 문장들(1~4줄). `request design`(명령)에서는 필수 */
  brief?: string[];
  /** 이렇게 이해했다(짧은 한 줄 요약) */
  understanding?: string;
  /** 이렇게 이해한 것을 영역별로 나눈 항목들 */
  points?: DesignPoint[];
  /** 이렇게 처리하겠다("설계 없음" 요청에서만 보인다) */
  approach?: string;
  /** 정보 변경들 */
  changes?: DesignChange[];
  /** 화면 디자인들. after·before는 그림 파일 경로(없으면 빈 글) */
  screens?: { screen: string; after?: string; before?: string; link?: string; note?: string; counts?: { add?: number; change?: number; remove?: number }; isNew?: boolean; highlights?: { l: number; t: number; w: number; h: number; label: string }[] }[];
  /** 이미 있는 데이터와 되돌리기 */
  data?: { existing: string; rollback: string; real: string };
  /** 정보도 화면도 안 바뀌어 "설계 없음"으로 올린다 */
  none?: boolean;
  /** 이 설계가 건드릴 파일과 이유(필수. "설계 없음"에도 필요하다). 승인되면 구현 커밋은 이 안에서만 가능하다 */
  files?: { path: string; why?: string }[];
}

/** 그림 파일을 .spec/shots로 복사하고 파일 이름을 돌려준다(없으면 빈 글) */
function copyShot(scanRoot: string, file: string | undefined, name: string): string {
  if (!file) return '';
  if (!fs.existsSync(file)) throw new Error(`그림 파일을 찾지 못했다: ${file}`);
  const dest = path.join(specDir(scanRoot), 'shots');
  fs.mkdirSync(dest, { recursive: true });
  const out = `${name}${path.extname(file) || '.png'}`;
  fs.copyFileSync(file, path.join(dest, out));
  return out;
}

/** `request shot`이 운영 화면을 찍어 둔 그림과 기록 위치 */
export const liveShotFile = (scanRoot: string, id: number, screen: string): string => path.join(specDir(scanRoot), 'live-shots', String(id), `${screen.replace(/[^\p{L}\p{N}]+/gu, '_')}.png`);

/** 화면 하나의 현행 그림을 정한다: 신규 화면이면 없음, 손으로 올린 파일이 있으면 그것(경고 대상), 아니면 도구가 운영 화면에서 찍어 둔 것. 어느 쪽도 없으면 올릴 수 없다 */
function resolveBefore(scanRoot: string, id: number, i: number, s: NonNullable<DesignInput['screens']>[number], prefix: string): Pick<DesignScreen, 'before' | 'beforeSource' | 'capturedAt' | 'isNew'> {
  if (s.isNew) return { before: '', isNew: true };
  const name = `${prefix}${i + 1}-before`;
  if (s.before) return { before: copyShot(scanRoot, s.before, name), beforeSource: 'manual' };
  const live = liveShotFile(scanRoot, id, s.screen);
  if (fs.existsSync(live)) {
    let capturedAt = '';
    try { capturedAt = (JSON.parse(fs.readFileSync(live.replace(/\.png$/, '.json'), 'utf8')) as { capturedAt?: string }).capturedAt ?? ''; } catch { /* 기록이 없으면 시각만 비움 */ }
    return { before: copyShot(scanRoot, live, name), beforeSource: 'tool', capturedAt };
  }
  throw new Error(`화면 "${s.screen}"의 현행 그림이 없다. 이미 있는 화면이면 \`request shot --id ${id} --screen "${s.screen}" --url 주소\`로 운영 화면을 먼저 찍고, 설계서 보기에 없는 새 화면이면 isNew: true로 올린다`);
}

/** 시작 전(접수) 요청의 설계를 시작한다. 우선순위를 정해(할 일을 정할 때) 이 요청을 하기로 한 뒤에 부른다 */
export function startDesign(scanRoot: string, id: number): Request {
  const r = loadOne(scanRoot, id);
  if (r.stage !== 'design' || r.step !== 'queued') throw new Error(`요청 #${id}은 시작 전이 아니다(지금: ${STAGE_LABEL[r.stage]} · ${STEP[`${r.stage}:${r.step}`]?.label ?? r.step})`);
  move(r, 'design', 'drafting');
  return record(scanRoot, r, 'agent', 'started', '설계를 시작함(우선순위를 정해 시작)');
}

/** 핵심 요약 입력을 문장 1~4줄로 다듬는다. 없으면 올리지 못하게 한다(명령에서 쓴다: 목록의 핵심만 보기가 이 문장을 그대로 보이므로 에이전트가 꼭 적어야 한다) */
export function parseBrief(raw: unknown, what: string): string[] {
  const lines = (Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split('|') : []).map((s) => String(s).trim()).filter(Boolean);
  if (!lines.length) throw new Error(`${what}에 핵심 요약(brief)을 적어야 한다. 사용자가 판단하기 쉽게 문장 1~4줄로 정리한다(영역·단계 이름만 늘어놓지 않는다)`);
  if (lines.length > 4) throw new Error(`핵심 요약(brief)은 4줄까지다(지금 ${lines.length}줄). 가장 중요한 것만 남긴다`);
  return lines;
}

/** 에이전트가 설계 결과를 올린다 → 사용자 승인 대기 */
export function submitDesign(scanRoot: string, id: number, d: DesignInput): Request {
  const r = loadOne(scanRoot, id);
  if (r.stage !== 'design') throw new Error(`요청 #${id}은 설계 단계가 아니다(지금: ${STAGE_LABEL[r.stage]})`);
  const none = !!d.none;
  if (!none && !d.understanding?.trim()) throw new Error('이렇게 이해했다(understanding)를 적어야 한다');
  // 건드릴 파일이 없는 설계는 올리지 않는다: 승인한 범위 밖 파일을 커밋하는 일을 commit-msg가 이 목록으로 막는다
  const files = (d.files ?? []).map((f) => ({ path: (f.path ?? '').trim(), why: (f.why ?? '').trim() })).filter((f) => f.path);
  if (!files.length) throw new Error('이 설계가 건드릴 파일(files: [{path, why}] 또는 --files 경로1,경로2)을 적어야 한다. 정보·화면이 안 바뀌는 "설계 없음"에도 필요하다');
  const prev = r.design?.rejected ?? 0;
  // 설계 변경으로 새 판이 되면 그림 이름에 판 번호를 붙여, 이전 판의 그림을 덮어쓰지 않는다
  const version = (r.designVersions?.length ?? 0) + 1;
  const prefix = version === 1 ? `r${id}-d` : `r${id}-v${version}-d`;
  const screens: DesignScreen[] = (d.screens ?? []).map((s, i) => ({
    screen: s.screen, after: copyShot(scanRoot, s.after, `${prefix}${i + 1}-after`), ...resolveBefore(scanRoot, id, i, s, prefix), link: s.link ?? '', note: s.note ?? '', counts: { add: s.counts?.add ?? 0, change: s.counts?.change ?? 0, remove: s.counts?.remove ?? 0 },
    ...(s.highlights?.length ? { highlights: s.highlights } : {}),
  }));
  const design: RequestDesign = { understanding: d.understanding?.trim() ?? '', ...(d.points?.length ? { points: d.points } : {}), approach: d.approach?.trim() ?? '', changes: d.changes ?? [], screens, data: d.data, none, rejected: prev, files, ...(d.brief?.length ? { brief: d.brief } : {}) };
  r.design = design;
  r.scope.screens = [...new Set([...r.scope.screens, ...screens.map((s) => s.screen)])];
  r.scope.infos = [...new Set([...r.scope.infos, ...design.changes.map((c) => c.info)])];
  move(r, 'design', 'submitted');
  return record(scanRoot, r, 'agent', 'design-submitted', none ? '설계 없음으로 올림' : `설계 제출 (정보 변경 ${design.changes.length}건 · 화면 변경 ${screens.length}건)`);
}

/** 구현 기록으로 받을 커밋이 설계 승인보다 뒤인지 확인한다. 승인 전에 만든 커밋이 "승인받고 구현했다"처럼 섞이지 않게 한다. git에서 시각을 못 읽으면 막지 않는다 */
function assertAfterApproval(scanRoot: string, r: Request, commit: string): void {
  const approved = [...r.events].reverse().find((e) => e.kind === 'design-approved');
  if (!approved) return;
  let at = '';
  try { at = execFileSync('git', ['log', '-1', '--format=%cI', commit], { cwd: projectRoot(scanRoot), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return; }
  if (at && Date.parse(at) < Date.parse(approved.at)) throw new Error(`커밋 ${commit}은 설계 승인(${approved.at})보다 앞선 ${at}에 만들어져 구현 기록으로 받지 않는다. 승인 전에 소스를 먼저 고친 것이므로 이유와 함께 사용자에게 알린다`);
}

/** 가장 최근 "끝낼 때 확인(finish)"이 통과했고 그 뒤 소스가 바뀌지 않았는지 본다. 문제가 있으면 이유 글을, 없으면 빈 글을 돌려준다 */
function finishProblem(scanRoot: string): string {
  let rec: { at: string; ok: boolean } | null = null;
  try { rec = JSON.parse(fs.readFileSync(path.join(specDir(scanRoot), 'finish.json'), 'utf8')) as { at: string; ok: boolean }; } catch { /* 기록 없음 */ }
  if (!rec) return '끝낼 때 확인(finish)을 돌린 기록이 없다. finish를 돌려 통과한 뒤에 올린다';
  if (!rec.ok) return `가장 최근 끝낼 때 확인(finish, ${rec.at})이 실패했다. 고친 뒤 다시 돌려 통과해야 한다`;
  const since = Date.parse(rec.at);
  const newer = (d: string): string => {
    for (const n of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, n.name);
      if (n.isDirectory()) { if (n.name === 'node_modules' || n.name.startsWith('.')) continue; const hit = newer(f); if (hit) return hit; } else if (fs.statSync(f).mtimeMs > since) return f;
    }
    return '';
  };
  const hit = newer(scanRoot);
  return hit ? `끝낼 때 확인(finish, ${rec.at}) 뒤에 소스가 바뀌었다(${path.relative(projectRoot(scanRoot), hit)}). finish를 다시 돌려 통과해야 한다` : '';
}

/** 커밋 자리에 HEAD·브랜치 이름처럼 해시가 아닌 이름이 오면 지금 가리키는 실제 짧은 해시로 바꾼다(글자 그대로 적으면 나중에 어느 커밋인지 알 수 없다). 해시처럼 생겼으면 그대로 둔다 */
function shortCommit(scanRoot: string, commit: string): string {
  const c = commit.trim();
  if (!c || /^[0-9a-f]{3,40}$/i.test(c)) return c;
  try {
    const h = execFileSync('git', ['rev-parse', '--short', c], { cwd: projectRoot(scanRoot), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || c;
    // 아직 커밋하기 전에 HEAD를 주면 직전 커밋이 적히므로, 무엇으로 적었는지 알려 잘못 적었으면 해시로 다시 적게 한다
    console.warn(`"${c}"는 지금 가리키는 커밋 ${h}로 적었다. 이번 구현 커밋이 아직 없다면 커밋한 뒤 그 해시로 다시 적는다`);
    return h;
  } catch { throw new Error(`커밋 "${c}"을 git에서 찾지 못했다. 커밋 해시(짧은 것도 됨)나 HEAD를 준다`); }
}

/** 에이전트가 구현을 시작했거나 커밋을 남겼음을 적는다 */
export function noteImpl(scanRoot: string, id: number, commitArg: string): Request {
  const r = loadOne(scanRoot, id);
  const commit = shortCommit(scanRoot, commitArg);
  if (r.stage !== 'impl' && r.stage !== 'test') throw new Error(`요청 #${id}은 구현할 수 있는 단계가 아니다(지금: ${STAGE_LABEL[r.stage]}). 설계 승인이 먼저다`);
  if (commit) assertAfterApproval(scanRoot, r, commit);
  if (commit) r.commits = [...new Set([...(r.commits ?? []), commit])];
  if (r.stage === 'impl') move(r, 'impl', 'working');
  return record(scanRoot, r, 'agent', 'impl', commit ? `구현 커밋 ${commit}` : '구현 시작');
}

/** 에이전트가 구현을 끝내고 테스트를 올린다(고친 뒤 다시 올릴 때도 같다) → 사용자 확인 대기 */
export function requestTest(scanRoot: string, id: number, brief?: string[]): Request {
  const r = loadOne(scanRoot, id);
  if (r.stage !== 'impl' && r.stage !== 'test') throw new Error(`요청 #${id}은 테스트를 올릴 수 있는 단계가 아니다(지금: ${STAGE_LABEL[r.stage]})`);
  if (r.scope.screens.length && !(r.scope.scenarios ?? []).length) throw new Error(`요청 #${id}은 범위에 화면(${r.scope.screens.join(', ')})이 있는데 사용 시나리오가 없어 테스트를 올릴 수 없다. 시나리오를 소스(@does)에 올리고 \`request scope --id ${id} --scenarios …\`로 범위에 연결한다`);
  const bad = finishProblem(scanRoot);
  if (bad) throw new Error(`요청 #${id}의 테스트를 올릴 수 없다: ${bad}`);
  // 테스트 환경이 설정된 프로젝트는 시나리오마다 정상 경우를 화면에서 먼저 확인했어야 한다
  const noData = seedProblem(scanRoot, r);
  if (noData) throw new Error(`요청 #${id}의 테스트를 올릴 수 없다: ${noData}`);
  const again = r.stage === 'test';
  move(r, 'test', 'requested');
  r.test = r.test ?? { checks: {}, found: [], none: false };
  if (brief?.length) r.test.brief = brief;
  // 설계가 바뀐 뒤 다시 올릴 때: 제목과 확인 기준이 그대로인 단계의 체크는 두고, 바뀌었거나 없어진 단계의 체크는 푼다
  const sigs = stepSigs(scanRoot, r);
  if (sigs) {
    if (r.test.sigs) for (const k of Object.keys(r.test.checks)) if (sigs[k] !== r.test.sigs[k]) delete r.test.checks[k];
    r.test.sigs = sigs;
  }
  return record(scanRoot, r, 'agent', 'test-requested', again ? '고친 뒤 테스트 다시 요청' : '구현을 마치고 테스트 요청');
}

/** 범위의 시나리오 단계마다 내용 서명(제목+확인 기준): "시나리오#단계" → 서명. 소스를 읽지 못하면 null */
function stepSigs(scanRoot: string, r: Request): Record<string, string> | null {
  try {
    const names = new Set(r.scope.scenarios ?? []);
    const out: Record<string, string> = {};
    for (const sc of buildScenarios(extractSpecs(scanRoot))) if (names.has(sc.name)) for (const st of sc.steps) out[`${sc.name}#${st.id}`] = `${st.title}|${st.check}`;
    return out;
  } catch { return null; }
}

/** 구현하다 막혀서 같은 세션에서 함께 고친 일을 요청에 남긴다(구현·테스트 단계에서만, 크기는 사용자가 보고 판단한다) */
export function addAlsoFixed(scanRoot: string, id: number, o: { text: string; where?: string; commit?: string }): Request {
  if (!o.text?.trim()) throw new Error('함께 고친 내용(--text)이 비었다');
  const r = loadOne(scanRoot, id);
  if (r.stage !== 'impl' && r.stage !== 'test') throw new Error(`요청 #${id}은 함께 고친 것을 남길 단계가 아니다(지금: ${STAGE_LABEL[r.stage]}). 구현 중에 막혔을 때만 남긴다`);
  r.alsoFixed = [...(r.alsoFixed ?? []), { at: new Date().toISOString(), text: o.text.trim(), where: (o.where ?? '').trim(), commit: (o.commit ?? '').trim() }];
  return record(scanRoot, r, 'agent', 'also-fixed', `함께 고침: ${o.text.trim()}`);
}

/** 요청의 범위에 사용 시나리오(와 바뀌는 단계)를 연결한다. 이미 있는 것에 더한다 */
export function setScope(scanRoot: string, id: number, o: { scenarios?: string[]; steps?: string[]; impactOnly?: string[] }): Request {
  const r = loadOne(scanRoot, id);
  const add = (a: string[] | undefined, b: string[] | undefined): string[] => [...new Set([...(a ?? []), ...(b ?? [])])];
  r.scope.scenarios = add(r.scope.scenarios, o.scenarios); r.scope.steps = add(r.scope.steps, o.steps); r.scope.impactOnly = add(r.scope.impactOnly, o.impactOnly);
  return record(scanRoot, r, 'agent', 'scope', `범위에 시나리오 연결: ${[...(o.scenarios ?? []), ...(o.impactOnly ?? []).map((n) => `${n}(영향만)`)].join(', ')}`);
}

/** 테스트하다 범위 밖에서 발견한 것을 요청에 적고 리포트로도 올린다 */
export function foundOutside(scanRoot: string, id: number, text: string): Request {
  if (!text?.trim()) throw new Error('발견한 내용이 비었다');
  const r = loadOne(scanRoot, id);
  const rep = addReport(scanRoot, { title: text.trim(), from: `#${id} 테스트 중`, outOfScope: true });
  r.test = r.test ?? { checks: {}, found: [], none: false };
  r.test.found.push({ text: text.trim(), reportId: rep.id });
  return record(scanRoot, r, 'agent', 'found', `범위 밖 발견: ${text.trim()}`);
}

/** 담당 에이전트 세션 이름을 적는다 */
export function setAgent(scanRoot: string, id: number, name: string): Request {
  const r = loadOne(scanRoot, id);
  r.agent.name = name.trim();
  return record(scanRoot, r, 'agent', 'agent', `맡은 에이전트: ${name.trim()}`);
}

/** 담당 세션을 새로 만들었음을 진행 기록에 적는다 */
export function noteSessionStarted(scanRoot: string, id: number, sid: string): Request {
  return record(scanRoot, loadOne(scanRoot, id), 'agent', 'session-started', `담당 세션을 새로 만듦(${sid.slice(0, 8)})`);
}

/** 시작한 담당 세션이 끝내 담당을 등록하지 못했다고 진행 기록에 남긴다(사용자가 알아채고 `request session`으로 다시 만들 수 있게) */
export function noteSessionFailed(scanRoot: string, id: number, sid: string): Request {
  return record(scanRoot, loadOne(scanRoot, id), 'agent', 'session-failed', `담당 세션 시작이 끝나지 않음(${sid.slice(0, 8)}). 화면의 시작을 다시 누르거나 request session --id ${id}로 다시 만든다`);
}

/** 요청 번호 없이 남은 커밋을 사용자가 요청으로 기록한다: 이미 끝난 요청 하나가 되어 그 커밋이 연결된다 */
export function recordUntracked(scanRoot: string, hash: string, title: string): Request {
  if (!hash || !title?.trim()) throw new Error('커밋과 제목이 필요하다');
  const r = addRequest(scanRoot, { title, origin: '요청 번호 없이 커밋된 변경을 나중에 요청으로 기록함', channel: '요청 없는 변경', source: 'report' });
  r.commits = [hash];
  move(r, 'done', 'done');
  return record(scanRoot, r, 'user', 'recorded', `커밋 ${hash}을 요청으로 기록함`);
}

/** 담당 세션이 막혔음을 남긴다(허용 목록 밖 명령 등으로 검증 없이 끝날 뻔한 일을 사용자가 알게). 다음 에이전트 기록이 생기면 풀린다 */
export function noteBlocked(scanRoot: string, id: number, note: string): Request {
  const r = loadOne(scanRoot, id);
  if (ended(r)) throw new Error(`요청 #${id}은 이미 끝났다`);
  if (!note?.trim()) throw new Error('막힌 명령과 이유(--note)를 적어야 한다');
  return record(scanRoot, r, 'agent', 'blocked', `막힘: ${note.trim()}`);
}

/** 담당 세션이 사용자에게 묻고 있는 말을 남긴다(대화 안에만 있으면 사용자가 알 길이 없다). 사용자의 다음 기록이 생기면 사라진다 */
export function noteAsking(scanRoot: string, id: number, text: string): Request {
  const r = loadOne(scanRoot, id);
  if (ended(r)) throw new Error(`요청 #${id}은 이미 끝났다`);
  if (!text?.trim()) throw new Error('사용자에게 묻는 말(--text)을 적어야 한다');
  return record(scanRoot, r, 'agent', 'asking', `질문: ${text.trim()}`);
}

/** 막힘·질문이 지금도 살아 있는지: 막힘은 그 뒤 다른 에이전트 기록이 없을 때, 질문은 그 뒤 사용자 기록이 없을 때만 */
export function openNotes(r: Request): { blocked?: { at: string; note: string }; asking?: { at: string; text: string } } {
  const ev = r.events;
  const lastOf = (kind: string): number => ev.map((e, i) => (e.kind === kind ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
  const b = lastOf('blocked'), a = lastOf('asking');
  const strip = (n: string, p: string): string => n.replace(p, '');
  return {
    ...(b >= 0 && !ev.slice(b + 1).some((e) => e.by === 'agent') ? { blocked: { at: ev[b].at, note: strip(ev[b].note, '막힘: ') } } : {}),
    ...(a >= 0 && !ev.slice(a + 1).some((e) => e.by === 'user') ? { asking: { at: ev[a].at, text: strip(ev[a].note, '질문: ') } } : {}),
  };
}

// ── 사용자가 하는 일 (설계서 보기 화면에서만) ─────────────

/** 설계 승인(설계 없음 포함) → 구현 */
export function approveDesign(scanRoot: string, id: number, quote?: string): Request {
  const r = loadOne(scanRoot, id);
  if (r.stage !== 'design' || r.step !== 'submitted') throw new Error('승인 대기 중인 설계가 아니다');
  move(r, 'impl', 'working');
  // 승인된 설계의 파일 목록을 요청에 남긴다(옛 설계는 목록이 없어 범위 검사를 하지 않는다)
  if (r.design?.files?.length) r.files = r.design.files;
  return record(scanRoot, r, 'user', 'design-approved', `${r.design?.none ? '설계 없음 승인' : '설계 승인'}${quote ? ' (대화에서 한 승인을 인용해 기록함)' : ''}`, quote);
}
/** 설계 반려(이유 한 줄) → 에이전트가 다시 작성 */
export function rejectDesign(scanRoot: string, id: number, note: string, quote?: string): Request {
  const r = loadOne(scanRoot, id);
  if (r.stage !== 'design' || r.step !== 'submitted') throw new Error('승인 대기 중인 설계가 아니다');
  if (!note?.trim()) throw new Error('반려 이유를 한 줄 적어야 한다');
  if (r.design) r.design.rejected += 1;
  move(r, 'design', 'revise');
  return record(scanRoot, r, 'user', 'design-rejected', `설계 반려: ${note.trim()}${quote ? ' (대화에서 한 반려를 인용해 기록함)' : ''}`, quote);
}
/** 구현·테스트 중 설계 변경이 필요할 때(틀렸든, 바꾸고 싶든, 요구가 바뀌거나 늘었든) 요청을 설계 단계로 돌린다. 설계가 바뀌면 테스트는 의미가 없어서 설계 변경을 먼저 처리한다: 테스트는 멈추고 새 설계가 승인되기 전에는 소스 커밋이 막힌다.
 *  사용자는 허락 없이 누른다. 에이전트는 사용자가 요구한 경우에만 하므로 사용자가 한 말(quote)을 그대로 적어야 한다. 이전 설계와 그림은 지우지 않고 남긴다 */
export function redesign(scanRoot: string, id: number, by: Actor, reason: string, quote?: string): Request {
  const r = loadOne(scanRoot, id);
  if (r.stage !== 'impl' && r.stage !== 'test') throw new Error(`요청 #${id}은 설계 변경을 시작할 단계가 아니다(지금: ${STAGE_LABEL[r.stage]}). 설계 단계의 요청은 그대로 설계를 고쳐 올린다`);
  if (!reason?.trim()) throw new Error('변경사항을 적어야 한다');
  if (by === 'agent' && (quote ?? '').trim().length < 2) throw new Error('--quote에 사용자가 설계 변경을 요구하며 대화에서 한 말을 그대로 적어야 한다(사용자가 요구하지 않았다면 에이전트는 설계를 바꾸지 않는다)');
  const from = STAGE_LABEL[r.stage];
  if (r.design) r.designVersions = [...(r.designVersions ?? []), { design: r.design, replacedAt: new Date().toISOString(), by, reason: reason.trim(), ...approvedAtOf(r) }];
  move(r, 'design', 'revise');
  return record(scanRoot, r, by, 'redesigned', `설계 변경(${from} 중): ${reason.trim()}`, quote?.trim() || undefined);
}
/** 가장 최근 설계 승인 시각(없으면 빈 객체) */
const approvedAtOf = (r: Request): { approvedAt?: string } => { const e = [...r.events].reverse().find((x) => x.kind === 'design-approved'); return e ? { approvedAt: e.at } : {}; };
/** 테스트 확인표의 한 칸을 체크한다 */
export function checkTest(scanRoot: string, id: number, key: string, done: boolean): Request {
  const r = loadOne(scanRoot, id);
  if (r.stage !== 'test') throw new Error('테스트 단계가 아니다');
  r.test = r.test ?? { checks: {}, found: [], none: false };
  r.test.checks[key] = done;
  save(scanRoot, r);
  return r;
}
/** 테스트 승인(테스트 없음 포함) → 완료 */
export function approveTest(scanRoot: string, id: number, none: boolean, quote?: string): Request {
  const r = loadOne(scanRoot, id);
  if (r.stage !== 'test' || r.step !== 'requested') throw new Error('승인 대기 중인 테스트가 아니다');
  if (none && r.scope.screens.length) throw new Error('범위에 화면이 있는 요청은 "테스트 없음"으로 승인할 수 없다. 시나리오가 있어야 한다');
  r.test = r.test ?? { checks: {}, found: [], none: false };
  r.test.none = none;
  move(r, 'done', 'done');
  return record(scanRoot, r, 'user', 'test-approved', `${none ? '테스트 없음 승인' : '테스트 승인'}${quote ? ' (대화에서 한 승인을 인용해 기록함)' : ''}`, quote);
}
/** 테스트에서 문제 발견(이유 한 줄) → 에이전트가 같은 요청에서 고친다 */
export function testProblem(scanRoot: string, id: number, note: string, quote?: string): Request {
  const r = loadOne(scanRoot, id);
  if (r.stage !== 'test' || r.step !== 'requested') throw new Error('승인 대기 중인 테스트가 아니다');
  if (!note?.trim()) throw new Error('무엇이 문제인지 한 줄 적어야 한다');
  move(r, 'test', 'fix');
  return record(scanRoot, r, 'user', 'test-problem', `테스트 반려: ${note.trim()}${quote ? ' (대화에서 한 반려를 인용해 기록함)' : ''}`, quote);
}
/** 합칠 후보 하나: 어느 요청이고 왜 후보인지 */
export interface MergeCandidate {
  /** 후보 요청 번호 */
  id: number;
  /** 후보 요청 제목 */
  title: string;
  /** 왜 후보인지(겹치는 화면·정보, 또는 둘 다 작은 일) */
  why: string[];
}

/** 새 요구(또는 이미 접수된 요청끼리)와 합칠 만한 요청을 찾는다. 후보를 보이기만 하고 합치지 않는다.
 *  기준: (1) 같은 화면·정보·시나리오를 건드린다, (2) 둘 다 범위를 적지 않은 작은 일(설계 없음으로 끝날 것). 겹침이 큰 것부터 */
export function similarRequests(scanRoot: string, probe: { screens?: string[]; infos?: string[]; scenarios?: string[] }): MergeCandidate[] {
  const scopeOf = (s: { screens?: string[]; infos?: string[]; scenarios?: string[] }): string[] => [...(s.screens ?? []).map((x) => `화면 ${x}`), ...(s.infos ?? []).map((x) => `정보 ${x}`), ...(s.scenarios ?? []).map((x) => `시나리오 ${x}`)];
  const mine = scopeOf(probe);
  return loadRequests(scanRoot).filter(mergeable).map((r) => {
    const theirs = scopeOf(r.scope);
    const shared = theirs.filter((x) => mine.includes(x));
    const why = shared.length ? [`같이 건드림: ${shared.join(', ')}`] : !mine.length && !theirs.length ? ['둘 다 범위를 적지 않은 작은 일(설계 없음으로 끝날 것)'] : [];
    return { id: r.id, title: r.title, why, size: shared.length };
  }).filter((c) => c.why.length).sort((a, b) => b.size - a.size).map(({ id, title, why }) => ({ id, title, why }));
}

/** 합치기. `text`는 남는 요청에 덧붙일 새 요구, `from`은 이 요청에 합쳐 닫을 이미 접수된 요청. 사용자 말 인용이 있어야 한다 */
export function mergeRequests(scanRoot: string, into: number, o: { text?: string; from?: number; quote?: string }): Request {
  const quote = (o.quote ?? '').trim();
  if (quote.length < 2) throw new Error('--quote에 사용자가 합치기로 정하며 한 말을 그대로 적어야 한다(사용자가 합치기로 정하지 않았다면 이 명령을 쓰지 않는다)');
  const r = loadOne(scanRoot, into);
  if (!mergeable(r)) throw new Error(`요청 #${into}은 합칠 수 없다(지금: ${STAGE_LABEL[r.stage]} · ${STEP[`${r.stage}:${r.step}`]?.label ?? r.step}). 접수나 설계 작성 중인 요청만 합친다. 새 요청으로 접수하고 --related ${into}로 이어 둔다`);
  const now = new Date().toISOString();
  let text = (o.text ?? '').trim();
  let from: Request | undefined;
  if (o.from !== undefined) {
    if (o.from === into) throw new Error('같은 요청끼리는 합칠 수 없다');
    from = loadOne(scanRoot, o.from);
    if (!mergeable(from)) throw new Error(`요청 #${from.id}은 합칠 수 없다(접수나 설계 작성 중인 요청만 합친다)`);
    text = from.origin.text || from.title;
  }
  if (!text) throw new Error('합칠 요구(--text) 또는 합칠 요청(--from)이 필요하다');
  const day = now.slice(0, 10);
  const n = (r.mergedFrom?.length ?? 0) + 2;
  r.origin.text = `${r.origin.text}\n(${n}) ${day} 합침${from ? ` (#${from.id})` : ''}: ${text}`;
  r.mergedFrom = [...(r.mergedFrom ?? []), { at: now, text, quote, ...(from ? { from: from.id } : {}) }];
  if (from) {
    r.title = `${r.title} / ${from.title}`;
    r.scope = {
      screens: [...new Set([...r.scope.screens, ...from.scope.screens])], infos: [...new Set([...r.scope.infos, ...from.scope.infos])],
      scenarios: [...new Set([...(r.scope.scenarios ?? []), ...(from.scope.scenarios ?? [])])], steps: [...new Set([...(r.scope.steps ?? []), ...(from.scope.steps ?? [])])],
      impactOnly: [...new Set([...(r.scope.impactOnly ?? []), ...(from.scope.impactOnly ?? [])])],
    };
    from.mergedInto = into;
    move(from, 'cancelled', 'cancelled');
    record(scanRoot, from, 'user', 'merged-into', `#${into}에 합침`, quote);
  }
  return record(scanRoot, r, 'user', 'merged', from ? `요청 #${from.id}을 이 요청에 합침` : '새 요구를 이 요청에 합침', quote);
}

/** 겹치는 두 요청의 순서: first를 먼저 끝내고 other는 그 뒤에 시작한다 */
export function setOrder(scanRoot: string, first: number, other: number): Request {
  loadOne(scanRoot, first);
  const r = loadOne(scanRoot, other);
  r.waitFor = [...new Set([...(r.waitFor ?? []), first])];
  return record(scanRoot, r, 'user', 'order', `#${first}을 먼저 끝낸 뒤 시작하도록 정함`);
}

/** 명령: request add / list / design / impl / test / found / agent */
export async function main(argv: string[]): Promise<number | undefined> {
  const { pos, opts } = parseArgs(argv);
  const scanRoot = path.resolve(opts.src || 'src');
  const id = Number(opts.id);
  try {
    if (pos[0] === 'add') {
      if (!csv(opts.screens).length && !csv(opts.scenarios).length && !opts['no-test']?.trim()) throw new Error('화면(--screens)도 시나리오(--scenarios)도 없는 요청은 `--no-test "이유"`로 테스트가 왜 필요 없는지 적어야 등록된다');
      const r = addRequest(scanRoot, { title: opts.title, origin: opts.origin, channel: opts.channel, screens: csv(opts.screens), infos: csv(opts.infos), scenarios: csv(opts.scenarios), steps: csv(opts.steps), impactOnly: csv(opts.impact), agent: opts.agent, source: opts.source, relatedTo: opts.related ? Number(opts.related) : undefined, noTest: opts['no-test'], detail: opts.detail, mode: opts.mode, reason: opts.reason });
      console.log(r.detail?.mode === 'direct' ? `요청 #${r.id}: 바로 작업으로 등록 (설계 없음 승인으로 기록, 구현 단계. 담당 세션은 만들지 않으니 이 세션이 이어서 고친다)` : `요청 #${r.id}: 등록 (설계서 보기 "관리"에서 보인다)`);
    } else if (pos[0] === 'similar') {
      // 새 요청을 등록하기 전에 합칠 후보를 본다(--all이면 이미 접수된 요청끼리 합칠 것도 함께)
      const found = similarRequests(scanRoot, { screens: csv(opts.screens), infos: csv(opts.infos), scenarios: csv(opts.scenarios) });
      console.log(found.length ? found.map((c) => `#${c.id} ${c.title}\n   ${c.why.join(' / ')}`).join('\n') : '합칠 후보 없음');
      if (opts.all === 'true') {
        const open = loadRequests(scanRoot).filter(mergeable);
        const pairs = open.flatMap((a, i) => open.slice(i + 1).map((b) => ({ a, b, c: similarRequests(scanRoot, a.scope).find((x) => x.id === b.id) }))).filter((p) => p.c);
        console.log(pairs.length ? `\n이미 접수된 요청끼리:\n${pairs.map((p) => `#${p.a.id} + #${p.b.id}: ${p.c!.why.join(' / ')}`).join('\n')}` : '\n이미 접수된 요청끼리 합칠 후보 없음');
      }
    } else if (pos[0] === 'merge') {
      const r = mergeRequests(scanRoot, Number(opts.into), { text: opts.text, from: opts.from ? Number(opts.from) : undefined, quote: opts.quote });
      console.log(`요청 #${r.id}: 합쳤다${opts.from ? `(#${opts.from}은 #${r.id}에 합침으로 닫음)` : ''}`);
    } else if (pos[0] === 'list') {
      for (const r of describeRequests(loadRequests(scanRoot))) console.log(`#${r.id} [${r.stageLabel} · ${r.stepLabel}] ${r.title}`);
    } else if (pos[0] === 'start') {
      const { request: r, row } = (await import('./wake.js')).startRequest(scanRoot, id);
      console.log(`요청 #${r.id}: 설계를 시작한다${row ? ` · 시작 글을 상자에 적었다(줄 ${row.seq}, 메신저 세션이 담당에게 보낸다)` : ''}`);
    } else if (pos[0] === 'design') {
      const input = opts.file ? JSON.parse(fs.readFileSync(opts.file, 'utf8')) as DesignInput : {};
      const brief = parseBrief(input.brief ?? opts.brief, '설계');
      const r = submitDesign(scanRoot, id, { ...input, brief, none: input.none || opts.none === 'true', ...(opts.files ? { files: csv(opts.files).map((p) => ({ path: p })) } : {}) });
      console.log(`요청 #${r.id}: 설계를 올렸다. 사용자가 승인하거나 반려할 때까지 구현하지 않는다`);
    } else if (pos[0] === 'session') {
      // 시작은 했는데 담당 세션이 안 만들어진 요청(옛 기록 등)의 시작 글을 상자에 다시 적는다(프로세스는 띄우지 않는다. 메신저가 만든다)
      const r = loadRequests(scanRoot).find((x) => x.id === id);
      if (!r) throw new Error(`요청 #${id}을 찾지 못했다`);
      const row = (await import('./outbox.js')).requeueOutbox(scanRoot, id) ?? (await import('./outbox.js')).enqueueOutbox(scanRoot, id, 'start');
      console.log(row ? `요청 #${id}: 시작 글을 상자에 다시 적었다(줄 ${row.seq}, 메신저가 담당 세션을 만들어 보낸다)` : `요청 #${id}: 적지 않았다(설정 wake가 꺼져 있거나 담당이 이미 일하는 중이다. 이유는 .spec/wake.log)`);
    } else if (pos[0] === 'wake') {
      // 사용자 결정이 담당 세션에 전달되지 않았을 때 마지막 결정 줄을 대기로 되돌린다(프로세스는 띄우지 않는다)
      const row = (await import('./outbox.js')).requeueOutbox(scanRoot, id);
      console.log(row ? `요청 #${id}: 마지막 결정을 다시 보내도록 상자 줄 ${row.seq}을 대기로 돌렸다(메신저가 보낸다)` : `요청 #${id}: 되돌릴 줄이 없다(설정 wake가 꺼져 있다)`);
    } else if (pos[0] === 'ack') {
      // 담당 세션이 결정·시작 글을 받았다고 응답한다. 사용자 화면의 "읽음"은 이 명령으로만 찍힌다
      (await import('./delivery.js')).markRead(scanRoot, id);
      console.log(`요청 #${id}: 받았음을 남겼다(화면에 읽음으로 보인다)`);
    } else if (pos[0] === 'outbox') {
      // 메신저 세션이 쓴다: wait(대기 줄이 생길 때까지 토큰 없이 기다림) / list / show --row N / done --row N --via send|bg-resume|bg-new / fail --row N --reason "이유"
      const ob = await import('./outbox.js');
      const sub = pos[1], seq = Number(opts.row);
      if (sub === 'wait') { const s = await ob.waitPending(scanRoot, Number(opts.timeout || 600) * 1000); console.log(s.length ? `대기 줄: ${s.join(', ')}` : '대기 줄 없음'); }
      else if (sub === 'list') { for (const r of ob.loadOutbox(scanRoot).slice(-20)) console.log(`줄 ${r.seq} #${r.request} ${r.kind === 'start' ? '시작' : '결정'} ${r.state}${r.reason ? ` · ${r.reason}` : ''}`); }
      else if (sub === 'show') console.log(JSON.stringify(ob.showRow(scanRoot, seq), null, 2));
      else if (sub === 'done') { const r = ob.doneRow(scanRoot, seq, opts.via as 'send' | 'bg-resume' | 'bg-new'); console.log(`줄 ${r.seq}: 보냄(${r.via})`); }
      else if (sub === 'fail') { const r = ob.failRow(scanRoot, seq, opts.reason ?? '이유 없음'); console.log(`줄 ${r.seq}: 못 보냄(${r.reason}) — 화면에 전달 안 됨으로 보인다`); }
      else throw new Error('사용: request outbox wait|list|show --row N|done --row N --via 길|fail --row N --reason 이유');
    } else if (pos[0] === 'shot') {
      const { captureLive } = await import('./shot.js');
      const r = await captureLive(scanRoot, id, opts.screen, { url: opts.url, selector: opts.selector });
      console.log(`요청 #${id}: 화면 "${opts.screen}"의 현행을 운영 화면에서 찍었다(${r.capturedAt}, ${r.url})`);
    } else if (pos[0] === 'impl') {
      const r = noteImpl(scanRoot, id, opts.commit || ''); console.log(`요청 #${r.id}: 구현 기록`);
    } else if (pos[0] === 'test') {
      // 테스트를 올리기 전에는 늘 서버를 새 코드로 다시 띄우고, 새 코드로 안 떠 있으면 올리지 않는다(이 절차를 건너뛰는 길은 없다)
      const brief = parseBrief(opts.brief, '테스트 요청(--brief "줄1|줄2")');
      const bad = await restartForTest(scanRoot);
      if (bad) throw new Error(`요청 #${id}의 테스트를 올릴 수 없다: 서버가 새 코드로 안 떠 있다: ${bad}`);
      const r = requestTest(scanRoot, id, brief); console.log(`요청 #${r.id}: 테스트를 올렸다. 사용자가 승인하거나 문제를 알릴 때까지 기다린다`);
    } else if (pos[0] === 'redesign') {
      const r = redesign(scanRoot, id, 'agent', opts.reason ?? '', opts.quote); console.log(`요청 #${r.id}: 설계 변경을 시작했다(사용자 요구를 인용해 기록). 설계를 고쳐 request design --id ${r.id}로 다시 올리고 사용자 승인을 받는다(이미 한 커밋과 이전 설계는 남는다)`);
    } else if (pos[0] === 'scope') {
      const r = setScope(scanRoot, id, { scenarios: csv(opts.scenarios), steps: csv(opts.steps), impactOnly: csv(opts.impact) }); console.log(`요청 #${r.id}: 범위에 시나리오를 연결했다`);
    } else if (pos[0] === 'also') {
      const r = addAlsoFixed(scanRoot, id, { text: opts.text, where: opts.where, commit: opts.commit }); console.log(`요청 #${r.id}: 함께 고친 것 ${r.alsoFixed!.length}건째를 남겼다`);
    } else if (pos[0] === 'blocked') {
      const r = noteBlocked(scanRoot, id, opts.note); console.log(`요청 #${r.id}: 막혔다는 사실을 남겼다(요청 목록·상세에 '막힘'으로 보인다). 다음 기록을 남기면 풀린다`);
    } else if (pos[0] === 'ask') {
      const r = noteAsking(scanRoot, id, opts.text); console.log(`요청 #${r.id}: 사용자에게 묻는 말을 남겼다(요청 목록·상세와 내 차례에 '질문 중'으로 보인다). 사용자의 답이 오면 사라진다`);
    } else if (pos[0] === 'found') {
      const r = foundOutside(scanRoot, id, opts.text); console.log(`요청 #${r.id}: 범위 밖 발견을 리포트로도 올렸다`);
    } else if (['approve-design', 'approve-test', 'reject-design', 'test-problem'].includes(pos[0])) {
      // 사용자가 대화에서 결정했을 때만 쓴다. 그때 한 말을 그대로 --quote에 적어야 하고, 인용이 없으면 기록하지 않는다. 화면에서 결정한 것과 똑같이 담당 세션에도 전달한다
      const quote = (opts.quote ?? '').trim();
      if (quote.length < 2) throw new Error('--quote에 사용자가 대화에서 결정하며 한 말을 그대로 적어야 한다(사용자가 결정하지 않았다면 이 명령을 쓰지 않는다)');
      const r = pos[0] === 'approve-design' ? approveDesign(scanRoot, id, quote)
        : pos[0] === 'approve-test' ? approveTest(scanRoot, id, opts.none === 'true', quote)
        : pos[0] === 'reject-design' ? rejectDesign(scanRoot, id, opts.note ?? '', quote)
        : testProblem(scanRoot, id, opts.note ?? '', quote);
      const row = (await import('./outbox.js')).enqueueOutbox(scanRoot, id);
      console.log(`요청 #${r.id}: ${r.events[r.events.length - 1].note}을(를) 인용과 함께 기록했다 → ${r.stage}${row ? ` (담당 세션에 보낼 글을 상자에 적었다: 줄 ${row.seq})` : ''}`);
    } else if (pos[0] === 'agent') {
      const r = setAgent(scanRoot, id, opts.name); console.log(`요청 #${r.id}: 맡은 에이전트 ${r.agent.name}`);
    } else {
      console.log(['사용: node <스킬 폴더>/spec.mjs request <명령> --src <소스 폴더> …',
        '  add --title "…" [--origin "사용자가 한 말"] [--channel 대화] [--screens 화면1,화면2] [--infos 정보1] [--scenarios 시나리오1] [--steps "시나리오#단계,…"] [--impact 영향만 볼 시나리오] [--agent 세션이름] [--related 이어지는 요청 번호] [--no-test "테스트 없음 이유"] [--detail "사용자가 확인한 상세 내용" --mode direct|design --reason "구분 이유"]   (direct=바로 작업: 화면·정보가 안 바뀌는 고장 수리만, 설계 없음 승인으로 기록해 곧바로 구현. 화면도 시나리오도 없으면 --no-test가 있어야 등록된다)',
        '  similar [--screens …] [--infos …] [--scenarios …] [--all true]   (새 요청을 등록하기 전에 합칠 후보를 본다. 보이기만 한다)',
        '  merge --into 남는번호 (--text "새 요구" | --from 없어질번호) --quote "사용자가 한 말"   (접수·설계 작성 중인 요청끼리만. 인용이 없으면 못 한다)',
        '  start --id N                     (시작 전 요청의 설계를 시작. 할 일을 정할 때 우선순위를 정한 뒤에만)',
        '  wake --id N                      (사용자 결정이 담당 세션에 전달되지 않았을 때 마지막 결정 줄을 상자에서 대기로 되돌린다. 보내는 것은 메신저)',
        '  session --id N                   (시작은 했는데 담당 세션이 안 만들어진 요청의 시작 글을 상자에 다시 적는다. 설정 wake가 켜져 있어야 한다)',
        '  ack --id N                       (담당 세션이 결정·시작 글을 받았다고 응답한다. 사용자 화면의 "읽음"은 이 명령으로만 찍힌다)',
        '  outbox wait|list|show --row N|done --row N --via send|bg-resume|bg-new|fail --row N --reason "이유"   (메신저 세션 전용: 상자의 글을 담당 세션에 보내고 결과를 남긴다)',
        '  shot --id N --screen 화면이름 --url 주소 [--selector css]   (바꾸기 전 운영 화면을 손대지 않고 그대로 찍어 현행 그림으로 저장. 설계를 올릴 때 이 그림이 현행으로 붙는다)',
        '  design --id N --file 설계.json [--files 경로1,경로2]   (설계 JSON에 files: [{path, why}]로 건드릴 파일을 적는다(필수). 또는 --none true: 정보도 화면도 안 바뀌어 "설계 없음"으로 올림. 이미 있는 화면은 현행 그림이 필요하고, 새 화면은 isNew: true)',
        '  impl --id N [--commit 해시]      (설계 승인 뒤에만)',
        '  redesign --id N --quote "사용자가 한 말" --reason "변경사항"   (구현·테스트 중 사용자가 설계 변경을 요구했을 때만 설계 단계로 돌린다. 인용이 없으면 못 한다. 이전 설계는 남고, 고친 설계는 다시 승인받는다)',
        '  test --id N                      (구현을 마치고 테스트를 올림. 고친 뒤 다시 올릴 때도 같다)',
        '  scope --id N [--scenarios 시나리오1,…] [--steps "시나리오#단계,…"] [--impact 영향만 볼 시나리오]   (범위에 시나리오를 연결. 화면이 있는 요청은 시나리오가 있어야 test를 올릴 수 있다)',
        '  also --id N --text "막혔던 일과 고친 일" [--where 화면이나 파일] [--commit 해시]   (구현하다 막혀서 같은 세션에서 함께 고친 일을 남긴다. 구현·테스트 단계에서만. 화면 모양·정보·사용 흐름이 바뀌는 일이면 남기지 말고 멈춰서 설계로 간다)',
        '  blocked --id N --note "막힌 명령과 이유"   (허용 목록 밖 명령 등으로 막혔을 때. 요청 목록·상세에 붉은 막힘으로 보이고, 다음 에이전트 기록이 생기면 풀린다)',
        '  ask --id N --text "사용자에게 묻는 말"   (사용자에게 허락·결정을 물을 때. 요청 목록·상세와 내 차례에 질문 중으로 보이고, 사용자의 다음 기록이 생기면 사라진다)',
        '  found --id N --text "범위 밖에서 발견한 것"',
        '  approve-design --id N --quote "사용자가 한 말"   (사용자가 대화에서 설계를 승인했을 때만. 인용이 없으면 못 한다)',
        '  approve-test --id N --quote "사용자가 한 말" [--none true]   (사용자가 대화에서 테스트를 승인했을 때만)',
        '  reject-design --id N --note "반려 이유" --quote "사용자가 한 말"   (사용자가 대화에서 설계를 반려했을 때만)',
        '  test-problem --id N --note "문제" --quote "사용자가 한 말"   (사용자가 대화에서 테스트 문제를 알렸을 때만)',
        '  agent --id N --name 세션이름',
        '  list'].join('\n'));
      return 1;
    }
  } catch (e) { console.error(`오류: ${errorText(e)}`); return 1; }
  return undefined;
}
