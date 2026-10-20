/**
 * @spec requests 변경 요청 저장
 * @why 현재를 바꾸는 모든 일을 "요청" 하나의 흐름(설계 → 구현 → 테스트 → 완료)으로 모아, 언제 왜 어떻게 바뀌었는지 한곳에서 따라가게 한다. 요청 하나가 파일 하나(.spec/requests/<번호>.json)라서 여러 PC에서 git으로 나눠 써도 서로 다른 요청은 부딪치지 않는다.
 * @basis 모든 변경이 같은 요청 흐름을 거친다 (사용자 결정)
 * @contract 요청 파일의 모양(types.ts의 Request)을 바꾸면 model.ts의 요청 목록과 viewer/manage-*.ts의 관리 화면도 함께 고친다. 에이전트는 이 모듈의 명령(add, design, impl, test, fixed, found, agent, list)으로만 요청을 움직이고, 승인·반려·순서 정하기는 사용자 화면(middleware.ts)만 한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { specDir } from './status.js';
import { parseArgs, csv, errorText } from './cli.js';
import { addReport } from './report.js';
import type { Actor, DesignChange, DesignScreen, Request, RequestDesign, RequestSource, RequestStage, RequestView } from './types.js';

/** 화면에 보이는 단계 이름. 사람이 읽는 말이라 여기서만 정한다 */
export const STAGE_LABEL: Record<RequestStage, string> = { design: '설계', impl: '구현', test: '테스트', done: '완료', cancelled: '취소' };

/** 단계 안 상태의 화면용 이름과 누구 차례인지. 이 표가 목록의 "내 차례 / 에이전트 차례"를 나누는 근거다 */
export const STEP: Record<string, { label: string; turn: Actor | null }> = {
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
  /** 맡은 세션의 이름 */
  agent?: string;
  /** user(사용자 요청) 또는 report(에이전트가 올린 리포트에서 등록) */
  source?: string;
}

/** 에이전트가 요청을 만든다 */
export function addRequest(scanRoot: string, { title, origin = '', channel = '대화', screens = [], infos = [], scenarios = [], steps = [], impactOnly = [], agent = '', source = 'user' }: NewRequest): Request {
  if (!title?.trim()) throw new Error('요청 제목이 비었다');
  if (source !== 'user' && source !== 'report') throw new Error('출처는 user(사용자 요청)나 report(에이전트가 올린 리포트)만 가능하다');
  const id = loadRequests(scanRoot).reduce((m, r) => Math.max(m, r.id), 0) + 1;
  const now = new Date().toISOString();
  const req: Request = {
    id, title: title.trim(), source: source as RequestSource, origin: { text: origin.trim(), channel, at: now },
    scope: { screens, infos, scenarios, steps, impactOnly }, agent: { name: agent },
    stage: 'design', step: 'drafting',
    events: [{ at: now, by: 'agent', kind: 'created', note: '요청 등록' }],
  };
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
function record(scanRoot: string, r: Request, by: Actor, kind: string, note: string): Request {
  r.events.push({ at: new Date().toISOString(), by, kind, note });
  save(scanRoot, r);
  return r;
}
/** 단계를 옮긴다 */
const move = (r: Request, stage: RequestStage, step: string): void => { r.stage = stage; r.step = step; };

/** 요청이 끝났거나 취소됐는가(겹침·대기 계산에서 빠진다) */
const ended = (r: Request): boolean => r.stage === 'done' || r.stage === 'cancelled';

/** 화면 쪽에 보여 줄 모양으로: 이름표, 누구 차례인지, 진행 중인 다른 요청과 겹치는 곳, 기다릴 요청을 붙인다.
 *  componentsOf는 요청이 건드리는 시나리오의 단계 자리(컴포넌트)를 돌려주는 함수(model.ts가 시나리오에서 계산해 준다) */
export function describeRequests(list: Request[], componentsOf: (r: Request) => string[] = () => []): RequestView[] {
  return list.map((r) => {
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
    return { ...r, stageLabel: STAGE_LABEL[r.stage], stepLabel: meta.label, turn: meta.turn, overlaps, waitingFor };
  });
}

// ── 에이전트가 하는 일 ──────────────────────────────────

/** 설계 파일(--file)이 가진 모양. 그림 파일은 .spec/shots로 복사한다 */
export interface DesignInput {
  /** 이렇게 이해했다 */
  understanding?: string;
  /** 이렇게 처리하겠다 */
  approach?: string;
  /** 정보 변경들 */
  changes?: DesignChange[];
  /** 화면 디자인들. after·before는 그림 파일 경로(없으면 빈 글) */
  screens?: { screen: string; after?: string; before?: string; link?: string; note?: string; counts?: { add?: number; change?: number; remove?: number } }[];
  /** 이미 있는 데이터와 되돌리기 */
  data?: { existing: string; rollback: string; real: string };
  /** 정보도 화면도 안 바뀌어 "설계 없음"으로 올린다 */
  none?: boolean;
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

/** 에이전트가 설계 결과를 올린다 → 사용자 승인 대기 */
export function submitDesign(scanRoot: string, id: number, d: DesignInput): Request {
  const r = loadOne(scanRoot, id);
  if (r.stage !== 'design') throw new Error(`요청 #${id}은 설계 단계가 아니다(지금: ${STAGE_LABEL[r.stage]})`);
  const none = !!d.none;
  if (!none && !d.understanding?.trim()) throw new Error('이렇게 이해했다(understanding)를 적어야 한다');
  const prev = r.design?.rejected ?? 0;
  const screens: DesignScreen[] = (d.screens ?? []).map((s, i) => ({
    screen: s.screen, after: copyShot(scanRoot, s.after, `r${id}-d${i + 1}-after`), before: copyShot(scanRoot, s.before, `r${id}-d${i + 1}-before`), link: s.link ?? '', note: s.note ?? '', counts: { add: s.counts?.add ?? 0, change: s.counts?.change ?? 0, remove: s.counts?.remove ?? 0 },
  }));
  const design: RequestDesign = { understanding: d.understanding?.trim() ?? '', approach: d.approach?.trim() ?? '', changes: d.changes ?? [], screens, data: d.data, none, rejected: prev };
  r.design = design;
  r.scope.screens = [...new Set([...r.scope.screens, ...screens.map((s) => s.screen)])];
  r.scope.infos = [...new Set([...r.scope.infos, ...design.changes.map((c) => c.info)])];
  move(r, 'design', 'submitted');
  return record(scanRoot, r, 'agent', 'design-submitted', none ? '설계 없음으로 올림' : `설계 제출 (정보 변경 ${design.changes.length}건 · 화면 변경 ${screens.length}건)`);
}

/** 에이전트가 구현을 시작했거나 커밋을 남겼음을 적는다 */
export function noteImpl(scanRoot: string, id: number, commit: string): Request {
  const r = loadOne(scanRoot, id);
  if (r.stage !== 'impl' && r.stage !== 'test') throw new Error(`요청 #${id}은 구현할 수 있는 단계가 아니다(지금: ${STAGE_LABEL[r.stage]}). 설계 승인이 먼저다`);
  if (commit) r.commits = [...new Set([...(r.commits ?? []), commit])];
  if (r.stage === 'impl') move(r, 'impl', 'working');
  return record(scanRoot, r, 'agent', 'impl', commit ? `구현 커밋 ${commit}` : '구현 시작');
}

/** 에이전트가 구현을 끝내고 테스트를 올린다(고친 뒤 다시 올릴 때도 같다) → 사용자 확인 대기 */
export function requestTest(scanRoot: string, id: number): Request {
  const r = loadOne(scanRoot, id);
  if (r.stage !== 'impl' && r.stage !== 'test') throw new Error(`요청 #${id}은 테스트를 올릴 수 있는 단계가 아니다(지금: ${STAGE_LABEL[r.stage]})`);
  const again = r.stage === 'test';
  move(r, 'test', 'requested');
  r.test = r.test ?? { checks: {}, found: [], none: false };
  return record(scanRoot, r, 'agent', 'test-requested', again ? '고친 뒤 테스트 다시 요청' : '구현을 마치고 테스트 요청');
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

/** 요청 번호 없이 남은 커밋을 사용자가 요청으로 기록한다: 이미 끝난 요청 하나가 되어 그 커밋이 연결된다 */
export function recordUntracked(scanRoot: string, hash: string, title: string): Request {
  if (!hash || !title?.trim()) throw new Error('커밋과 제목이 필요하다');
  const r = addRequest(scanRoot, { title, origin: '요청 번호 없이 커밋된 변경을 나중에 요청으로 기록함', channel: '요청 없는 변경', source: 'report' });
  r.commits = [hash];
  move(r, 'done', 'done');
  return record(scanRoot, r, 'user', 'recorded', `커밋 ${hash}을 요청으로 기록함`);
}

// ── 사용자가 하는 일 (설계서 보기 화면에서만) ─────────────

/** 설계 승인(설계 없음 포함) → 구현 */
export function approveDesign(scanRoot: string, id: number): Request {
  const r = loadOne(scanRoot, id);
  if (r.stage !== 'design' || r.step !== 'submitted') throw new Error('승인 대기 중인 설계가 아니다');
  move(r, 'impl', 'working');
  return record(scanRoot, r, 'user', 'design-approved', r.design?.none ? '설계 없음 승인' : '설계 승인');
}
/** 설계 반려(이유 한 줄) → 에이전트가 다시 작성 */
export function rejectDesign(scanRoot: string, id: number, note: string): Request {
  const r = loadOne(scanRoot, id);
  if (r.stage !== 'design' || r.step !== 'submitted') throw new Error('승인 대기 중인 설계가 아니다');
  if (!note?.trim()) throw new Error('반려 이유를 한 줄 적어야 한다');
  if (r.design) r.design.rejected += 1;
  move(r, 'design', 'revise');
  return record(scanRoot, r, 'user', 'design-rejected', `설계 반려: ${note.trim()}`);
}
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
export function approveTest(scanRoot: string, id: number, none: boolean): Request {
  const r = loadOne(scanRoot, id);
  if (r.stage !== 'test' || r.step !== 'requested') throw new Error('승인 대기 중인 테스트가 아니다');
  r.test = r.test ?? { checks: {}, found: [], none: false };
  r.test.none = none;
  move(r, 'done', 'done');
  return record(scanRoot, r, 'user', 'test-approved', none ? '테스트 없음 승인' : '테스트 승인');
}
/** 테스트에서 문제 발견(이유 한 줄) → 에이전트가 같은 요청에서 고친다 */
export function testProblem(scanRoot: string, id: number, note: string): Request {
  const r = loadOne(scanRoot, id);
  if (r.stage !== 'test' || r.step !== 'requested') throw new Error('승인 대기 중인 테스트가 아니다');
  if (!note?.trim()) throw new Error('무엇이 문제인지 한 줄 적어야 한다');
  move(r, 'test', 'fix');
  return record(scanRoot, r, 'user', 'test-problem', `문제 있음: ${note.trim()}`);
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
      const r = addRequest(scanRoot, { title: opts.title, origin: opts.origin, channel: opts.channel, screens: csv(opts.screens), infos: csv(opts.infos), scenarios: csv(opts.scenarios), steps: csv(opts.steps), impactOnly: csv(opts.impact), agent: opts.agent, source: opts.source });
      console.log(`요청 #${r.id}: 등록 (설계서 보기 "관리"에서 보인다)`);
    } else if (pos[0] === 'list') {
      for (const r of describeRequests(loadRequests(scanRoot))) console.log(`#${r.id} [${r.stageLabel} · ${r.stepLabel}] ${r.title}`);
    } else if (pos[0] === 'design') {
      const input = opts.file ? JSON.parse(fs.readFileSync(opts.file, 'utf8')) as DesignInput : {};
      const r = submitDesign(scanRoot, id, { ...input, none: input.none || opts.none === 'true' });
      console.log(`요청 #${r.id}: 설계를 올렸다. 사용자가 승인하거나 반려할 때까지 구현하지 않는다`);
    } else if (pos[0] === 'impl') {
      const r = noteImpl(scanRoot, id, opts.commit || ''); console.log(`요청 #${r.id}: 구현 기록`);
    } else if (pos[0] === 'test') {
      const r = requestTest(scanRoot, id); console.log(`요청 #${r.id}: 테스트를 올렸다. 사용자가 승인하거나 문제를 알릴 때까지 기다린다`);
    } else if (pos[0] === 'found') {
      const r = foundOutside(scanRoot, id, opts.text); console.log(`요청 #${r.id}: 범위 밖 발견을 리포트로도 올렸다`);
    } else if (pos[0] === 'agent') {
      const r = setAgent(scanRoot, id, opts.name); console.log(`요청 #${r.id}: 맡은 에이전트 ${r.agent.name}`);
    } else {
      console.log(['사용: node <스킬 폴더>/spec.mjs request <명령> --src <소스 폴더> …',
        '  add --title "…" [--origin "사용자가 한 말"] [--channel 대화] [--screens 화면1,화면2] [--infos 정보1] [--scenarios 시나리오1] [--steps "시나리오#단계,…"] [--impact 영향만 볼 시나리오] [--agent 세션이름]',
        '  design --id N --file 설계.json   (또는 --none true: 정보도 화면도 안 바뀌어 "설계 없음"으로 올림)',
        '  impl --id N [--commit 해시]      (설계 승인 뒤에만)',
        '  test --id N                      (구현을 마치고 테스트를 올림. 고친 뒤 다시 올릴 때도 같다)',
        '  found --id N --text "범위 밖에서 발견한 것"',
        '  agent --id N --name 세션이름',
        '  list'].join('\n'));
      return 1;
    }
  } catch (e) { console.error(`오류: ${errorText(e)}`); return 1; }
  return undefined;
}
