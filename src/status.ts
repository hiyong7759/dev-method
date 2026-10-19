/**
 * @spec status-store 화면 상태와 승인 기록
 * @why 승인을 말이 아니라 기록으로 남기고, 승인한 뒤 소스가 바뀌면 사람이 기억하지 않아도 "승인 후 변경됨"이 되게 한다.
 * @basis 변경 감지 범위는 화면 파일과 거기서 상대 경로로 import하는 파일(재귀)의 내용 해시다. 도메인 타입처럼 import로 닿는 파일의 변경도 포함된다.
 * @contract 상태는 dev(개발 중) → test-requested(테스트 요청) → needs-fix(수정 필요) | approved(승인됨) → approved-changed(승인 후 변경됨, 기록하지 않고 계산)로 흐른다. 에이전트가 남길 수 있는 것은 dev, test-requested뿐이고, approved와 needs-fix는 사용자가 설계서 보기(브라우저)에서만 남긴다. 기록 파일(.spec/status.json) 모양을 바꾸면 model.ts와 viewer/가 함께 바뀌어야 한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { extractSpecs } from './extract.js';
import { screenFiles, hashOf } from './files.js';
import { parseArgs, errorText } from './cli.js';
import type { Actor, Extracted, RecordedStatus, ScreenStatus, ScreenTag, StatusName, StatusRecord } from './types.js';

/** 에이전트가 남길 수 있는 상태 */
export const AGENT_STATES: readonly RecordedStatus[] = ['dev', 'test-requested'];
/** 사용자가 남길 수 있는 상태(dev는 승인 취소) */
export const USER_STATES: readonly RecordedStatus[] = ['approved', 'needs-fix', 'dev'];
/** 화면에 쓰는 상태 이름 */
export const LABEL: Record<StatusName, string> = { dev: '개발 중', 'test-requested': '테스트 요청', 'needs-fix': '수정 필요', approved: '승인됨', 'approved-changed': '승인 후 변경됨' };

/** 명령을 실행해 출력 글을 돌려준다. 실패하면 빈 글(git이 없는 곳에서도 도구가 멈추지 않게) */
export const sh = (cmd: string, cwd: string): string => {
  try { return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; }
};

const rootCache = new Map<string, string>();
/** 소스 폴더가 속한 프로젝트 루트(git 저장소 맨 위, 없으면 소스 폴더의 바로 위) */
export const projectRoot = (scanRoot: string): string => {
  const hit = rootCache.get(scanRoot);
  if (hit) return hit;
  const root = sh('git rev-parse --show-toplevel', scanRoot) || path.dirname(scanRoot);
  rootCache.set(scanRoot, root);
  return root;
};
/** 도구가 저장하는 파일을 모아 두는 프로젝트의 .spec 폴더 */
export const specDir = (scanRoot: string): string => path.join(projectRoot(scanRoot), '.spec');

/** .spec/status.json 전체: 화면 이름별 기록 */
interface Store { screens: Record<string, StatusRecord> }
const storeFile = (scanRoot: string): string => path.join(specDir(scanRoot), 'status.json');
const load = (scanRoot: string): Store => {
  try { return JSON.parse(fs.readFileSync(storeFile(scanRoot), 'utf8')) as Store; } catch { return { screens: {} }; }
};
const save = (scanRoot: string, store: Store): void => {
  fs.mkdirSync(specDir(scanRoot), { recursive: true });
  fs.writeFileSync(storeFile(scanRoot), JSON.stringify(store, null, 2) + '\n');
};

/** 이름으로 화면을 고른다. 이름이 없고 화면이 하나뿐이면 그 화면 */
function pick(out: Extracted, name: string | undefined): ScreenTag {
  const sc = name ? out.screens.find((s) => s.name === name) : (out.screens.length === 1 ? out.screens[0] : undefined);
  if (!sc) throw new Error(name ? `화면 "${name}"이 없다` : `화면이 여러 개다. --screen <이름>으로 고른다 (${out.screens.map((s) => s.name).join(', ')})`);
  return sc;
}

/** 아직 아무 기록이 없는 화면에 확인 목록 체크 같은 것을 처음 남길 때 쓰는 빈 기록 */
const blankRecord = (): StatusRecord => ({ status: 'dev', by: 'agent', at: '', commit: '', dirty: false, hash: '', note: '', shot: '', checks: {}, history: [] });

/** 화면 하나의 현재 상태. 기록이 없으면 dev. approved인데 해시가 다르면 approved-changed */
export function screenStatus(scanRoot: string, sc: ScreenTag, store: Store = load(scanRoot)): ScreenStatus {
  const rec = store.screens[sc.name];
  const files = sc.files.map((f) => path.join(scanRoot, f));
  if (!rec) return { screen: sc.name, status: 'dev', label: LABEL.dev, files: files.length, checks: {}, by: '', at: '', commit: '', note: '', shot: '', changedSinceRecord: false, history: [] };
  const changed = rec.hash !== hashOf(files);
  const status: StatusName = rec.status === 'approved' && changed ? 'approved-changed' : rec.status;
  return {
    screen: sc.name, status, label: LABEL[status], by: rec.by, at: rec.at, commit: rec.commit, note: rec.note || '',
    changedSinceRecord: changed, shot: rec.shot || '', files: files.length, checks: rec.checks || {}, history: rec.history || [],
  };
}

/** 모든 화면의 현재 상태(화면 이름 → 상태) */
export function allStatus(scanRoot: string, out: Extracted = extractSpecs(scanRoot)): Record<string, ScreenStatus> {
  const st = load(scanRoot);
  return Object.fromEntries(out.screens.map((sc) => [sc.name, screenStatus(scanRoot, sc, st)]));
}

/** 상태를 기록한다. 에이전트는 dev와 test-requested만, 사용자는 approved·needs-fix·dev만 남길 수 있다 */
export function setStatus(scanRoot: string, name: string | undefined, status: string, { by, note = '', shot: shotIn = '' }: { by: Actor; note?: string; shot?: string }): ScreenStatus {
  const allowed = by === 'agent' ? AGENT_STATES : USER_STATES;
  if (!allowed.includes(status as RecordedStatus)) {
    throw new Error(by === 'agent' ? `에이전트는 ${AGENT_STATES.join(', ')}만 남길 수 있다. ${status}는 사용자가 설계서 보기에서만 남긴다` : `사용자 기록은 ${USER_STATES.join(', ')}만 가능하다`);
  }
  const next = status as RecordedStatus;
  let shot = shotIn;
  const out = extractSpecs(scanRoot);
  const sc = pick(out, name);
  const files = sc.files.map((f) => path.join(scanRoot, f));
  const store = load(scanRoot);
  const prev = store.screens[sc.name] ?? blankRecord();
  // finish가 통과하면서 저장한 이 화면의 스냅샷(변경 전·후 비교에 쓴다). 한 번 붙이면 지운다
  if (by === 'agent' && next === 'test-requested' && !shot) {
    const pf = path.join(specDir(scanRoot), 'pending-shots.json');
    try {
      const pend = JSON.parse(fs.readFileSync(pf, 'utf8')) as Record<string, string>;
      if (pend[sc.name]) { shot = pend[sc.name]; delete pend[sc.name]; fs.writeFileSync(pf, JSON.stringify(pend)); }
    } catch { /* 없음 */ }
  }
  const at = new Date().toISOString();
  const commit = sh('git rev-parse --short HEAD', scanRoot);
  store.screens[sc.name] = {
    status: next, by, at, commit, dirty: !!sh('git status --porcelain', scanRoot), hash: hashOf(files), note, shot,
    checks: next === 'test-requested' ? {} : prev.checks, history: [...prev.history, { status: next, by, at, commit, note, shot }],
  };
  save(scanRoot, store);
  return screenStatus(scanRoot, sc);
}

/** 확인 목록(@does) 한 항목의 체크 상태를 남긴다. 사용자가 설계서 보기에서 남긴다 */
export function setCheck(scanRoot: string, name: string, index: number, done: boolean): ScreenStatus {
  const out = extractSpecs(scanRoot);
  const sc = pick(out, name);
  const store = load(scanRoot);
  const prev = store.screens[sc.name] ?? blankRecord();
  store.screens[sc.name] = { ...prev, checks: { ...prev.checks, [index]: !!done } };
  save(scanRoot, store);
  return screenStatus(scanRoot, sc);
}

/** 명령: status set <dev|test-requested> / status list */
export async function main(argv: string[]): Promise<number | undefined> {
  const { pos, opts } = parseArgs(argv);
  const [cmd, a] = pos;
  const scanRoot = path.resolve(opts.src || 'src');
  try {
    if (cmd === 'set') {
      const r = setStatus(scanRoot, opts.screen, a, { by: 'agent', note: opts.note || '' });
      console.log(`${r.screen}: ${r.label} (기록: .spec/status.json, 커밋 ${r.commit})`);
    } else if (cmd === 'list') {
      for (const r of Object.values(allStatus(scanRoot))) console.log(`${r.screen}: ${r.label}${r.note ? ` — ${r.note}` : ''}`);
    } else {
      console.log('사용: node <스킬 폴더>/spec.mjs status set <dev|test-requested> --src <소스 폴더> [--screen <이름>] [--note 한 줄]\n      node <스킬 폴더>/spec.mjs status list --src <소스 폴더>\n(approved·needs-fix는 설계서 보기에서 사용자만 남긴다)');
      return 1;
    }
  } catch (e) { console.error(`오류: ${errorText(e)}`); return 1; }
  return undefined;
}
