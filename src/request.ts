/**
 * @spec requests 변경 요청 저장
 * @why 현재를 바꾸는 모든 일을 "요청" 하나의 흐름(설계 → 구현 → 테스트 → 완료)으로 모아, 언제 왜 어떻게 바뀌었는지 한곳에서 따라가게 한다. 요청 하나가 파일 하나(.spec/requests/<번호>.json)라서 여러 PC에서 git으로 나눠 써도 서로 다른 요청은 부딪치지 않는다.
 * @basis 모든 변경이 같은 요청 흐름을 거친다 (사용자 결정)
 * @contract 요청 파일의 모양(types.ts의 Request)을 바꾸면 model.ts의 요청 목록과 viewer/manage.ts의 관리 화면도 함께 고친다. 에이전트는 이 모듈의 명령(add, list)으로만 요청을 만든다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { specDir } from './status.js';
import { parseArgs, csv, errorText } from './cli.js';
import type { Actor, Request, RequestSource, RequestStage, RequestView } from './types.js';

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
  /** 맡은 세션의 이름 */
  agent?: string;
  /** user(사용자 요청) 또는 report(에이전트가 올린 리포트에서 등록) */
  source?: string;
}

/** 에이전트가 요청을 만든다 */
export function addRequest(scanRoot: string, { title, origin = '', channel = '대화', screens = [], infos = [], agent = '', source = 'user' }: NewRequest): Request {
  if (!title?.trim()) throw new Error('요청 제목이 비었다');
  if (source !== 'user' && source !== 'report') throw new Error('출처는 user(사용자 요청)나 report(에이전트가 올린 리포트)만 가능하다');
  const id = loadRequests(scanRoot).reduce((m, r) => Math.max(m, r.id), 0) + 1;
  const now = new Date().toISOString();
  const req: Request = {
    id, title: title.trim(), source: source as RequestSource, origin: { text: origin.trim(), channel, at: now },
    scope: { screens, infos }, agent: { name: agent },
    stage: 'design', step: 'drafting',
    events: [{ at: now, by: 'agent', kind: 'created', note: '요청 등록' }],
  };
  save(scanRoot, req);
  return req;
}

/** 화면 쪽에 보여 줄 모양으로: 이름표, 누구 차례인지, 진행 중인 다른 요청과 겹치는 곳을 붙인다 */
export function describeRequests(list: Request[]): RequestView[] {
  const active = (r: Request): boolean => r.stage !== 'done' && r.stage !== 'cancelled';
  return list.map((r) => {
    const meta = STEP[`${r.stage}:${r.step}`] ?? { label: r.step, turn: null };
    const overlaps = !active(r) ? [] : list.filter((o) => o.id !== r.id && active(o)).map((o) => ({
      id: o.id, title: o.title,
      screens: o.scope.screens.filter((s) => r.scope.screens.includes(s)),
      infos: o.scope.infos.filter((i) => r.scope.infos.includes(i)),
    })).filter((o) => o.screens.length || o.infos.length);
    return { ...r, stageLabel: STAGE_LABEL[r.stage], stepLabel: meta.label, turn: meta.turn, overlaps };
  });
}

/** 명령: request add / list */
export async function main(argv: string[]): Promise<number | undefined> {
  const { pos, opts } = parseArgs(argv);
  const scanRoot = path.resolve(opts.src || 'src');
  try {
    if (pos[0] === 'add') {
      const r = addRequest(scanRoot, { title: opts.title, origin: opts.origin, channel: opts.channel, screens: csv(opts.screens), infos: csv(opts.infos), agent: opts.agent, source: opts.source });
      console.log(`요청 #${r.id}: 등록 (설계서 보기 "관리"에서 보인다)`);
    } else if (pos[0] === 'list') {
      for (const r of describeRequests(loadRequests(scanRoot))) console.log(`#${r.id} [${r.stageLabel} · ${r.stepLabel}] ${r.title}`);
    } else {
      console.log('사용: node <스킬 폴더>/spec.mjs request add --title "…" [--origin "사용자가 한 말"] [--channel 대화] [--screens 화면1,화면2] [--infos 정보1] [--agent 세션이름] --src <소스 폴더>\n      node <스킬 폴더>/spec.mjs request list --src <소스 폴더>');
      return 1;
    }
  } catch (e) { console.error(`오류: ${errorText(e)}`); return 1; }
  return undefined;
}
