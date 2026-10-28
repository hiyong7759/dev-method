/**
 * @spec design-map 시안과 소스 중 무엇이 최신인지 알려 주기
 * @why 시안(Claude Design 캔버스)과 구현된 화면이 따로 바뀌면 나중에 어느 쪽이 최종인지 알 수 없다. 시안 판마다 "구현과 같음 / 소스가 더 최신 / 아직 구현 전 / 대조 안 됨"을 한눈에 말해 주어, 사람도 에이전트도 같은 표로 최신을 가린다.
 * @basis 시안 판과 대응하는 소스 파일을 .spec/design-map.json에 적어 둔다. "구현과 같음"은 그 판을 소스에 맞춰 둔 시점의 커밋(syncedAt)을 적은 것이고, 그 뒤로 대응 소스가 커밋으로 바뀌었으면 "소스가 더 최신"이다. 시안 판 제목 앞에도 같은 표시를 붙인다.
 * @contract 명령: status(표 보기), sync <판>(지금 소스와 같다고 기록), differs <판>(대조해 다르다고 기록), draft <판> --request N(아직 구현 전인 시안), later <판> "글"(나중에 데이터가 생기면 확인할 것 기록), check(커밋 때 경고만 내고 막지 않는다), pin <판>(구현과 같은 판을 확정해 못 박는다. 그 뒤 대응 소스가 바뀔 때만 다시 비교한다), retire <판> --reason 이유(폐기: 판을 대응표에서 빼고 번호·이유·날짜 한 줄만 폐기 기록에 남긴다). 대응 소스가 없는 판(참고용)은 "참고"로 둔다.
 * @basis 판의 생애: 새로 나옴(draft·unchecked) → 한 번 비교 → 확정(pinned) / 구현과 다름(differs) / 폐기(retired). 폐기 기준: ① 구현이 끝나 소스 주석이 현행 설계가 된 판 ② 다른 판이 대신하는 판 ③ 대응 소스도 요청도 없고 확정하지 않은 참고용 판. 실제로 지우는 것은 사용자가 판마다 확인한 뒤에만 한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from './cli.js';
import type { DesignView } from './types.js';

/** 시안 판 하나의 기록 */
export interface Board {
  /** 캔버스 안의 파일 이름 */
  board: string;
  /** 캔버스에서 보이는 번호 */
  no: string;
  /** 판 이름 */
  title: string;
  /** 대응하는 소스 파일들(프로젝트 루트 기준). 없으면 참고용 */
  files: string[];
  /** 이 판이 보여 주는 프로젝트 화면 이름들(화면 설계서 패널에 시안 상태를 띄우는 데 쓴다) */
  screens?: string[];
  /** confirmed: 구현과 맞춰 둠, differs: 대조해 보니 다른 곳이 있어 verifyLater에 적어 둠, draft: 아직 구현 전 시안, unchecked: 아직 대조 안 함 */
  state: 'confirmed' | 'draft' | 'unchecked' | 'differs';
  /** draft일 때 구현할 요청 번호 */
  request?: number;
  /** 소스에 맞춰 둔 시점의 커밋(짧은 해시) */
  syncedAt?: string;
  /** 맞춰 둔 날(YYYY-MM-DD) */
  syncedOn?: string;
  /** 데이터가 생기면 시안과 다시 대조할 것들 */
  verifyLater?: string[];
  /** 확정해 못 박은 판(구현과 같음을 확인한 뒤 pin). 대응 소스가 바뀌기 전까지 다시 보지 않는다 */
  pinned?: boolean;
}
/**
 * 폐기한 판의 기록(판 본체는 대응표에서 뺀다)
 * @why 판을 지운 뒤에도 무엇을 왜 지웠는지 남겨, 같은 시안을 다시 만들거나 "그 판은 어디 갔나" 헤매지 않게 한다.
 */
export interface Retired {
  /** 지운 판의 번호 */
  no: string;
  /** 지운 판의 이름 */
  title: string;
  /** 지운 이유 */
  reason: string;
  /** 지운 날(YYYY-MM-DD) */
  on: string;
}
interface DesignMap { boards: Board[]; retired?: Retired[] }

/** 판의 최신 여부 표시: 한 글자 기호 + 말 */
export interface Freshness {
  /** 한눈에 보는 기호 */
  mark: '✓' | '△' | '≠' | '◇' | '?' | '·';
  /** 기호 옆에 붙는 설명 */
  text: string;
  /** 기호 이름 뒤에 붙는 짧은 덧말(맞춘 커밋·날짜, 몇 번 바뀜, 요청 번호). 없으면 빈 글 */
  detail: string;
  /** 시안이나 소스를 손봐야 하는 상태인가(커밋 때 알림 대상) */
  stale: boolean;
}

const mapFile = (root: string): string => path.join(root, '.spec', 'design-map.json');
export function readMap(root: string): DesignMap { try { return JSON.parse(fs.readFileSync(mapFile(root), 'utf8')) as DesignMap; } catch { return { boards: [] }; } }
const writeMap = (root: string, m: DesignMap): void => fs.writeFileSync(mapFile(root), JSON.stringify(m, null, 2) + '\n');
const git = (root: string, args: string[]): string => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();

/** 지금 HEAD 커밋(git을 부르지 않고 .git 파일에서 읽는다). 못 읽으면 빈 글 */
function headSha(root: string): string {
  try {
    const head = fs.readFileSync(path.join(root, '.git', 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return head;
    const ref = head.slice(5);
    try { return fs.readFileSync(path.join(root, '.git', ref), 'utf8').trim(); } catch { /* 묶음 기록(packed-refs)에 있을 수 있다 */ }
    const packed = fs.readFileSync(path.join(root, '.git', 'packed-refs'), 'utf8').split('\n').find((l) => l.endsWith(` ${ref}`));
    return packed ? packed.split(' ')[0] : '';
  } catch { return ''; }
}

/** 비교 결과 기억: 커밋(HEAD)이 같으면 같은 판·시점·대응 소스의 결과도 같다. 시안이 새로 생기거나(시점·파일이 다름) 새 커밋이 생길 때(HEAD가 다름)만 다시 비교한다 */
const sinceCache = new Map<string, number>();

/** 그 시점 뒤로 대응 소스를 바꾼 커밋 수 */
function commitsSince(root: string, b: Board): number {
  if (!b.syncedAt || !b.files.length) return 0;
  const head = headSha(root);
  const key = `${root}|${head}|${b.syncedAt}|${b.files.join(',')}`;
  const hit = head ? sinceCache.get(key) : undefined;
  if (hit !== undefined) return hit;
  const out = git(root, ['rev-list', `${b.syncedAt}..HEAD`, '--', ...b.files]);
  const n = out ? out.split('\n').length : 0;
  if (head) { if (sinceCache.size > 500) sinceCache.clear(); sinceCache.set(key, n); }
  return n;
}

/** 판 하나가 지금 최신인지 말해 준다 */
export function freshness(root: string, b: Board): Freshness {
  const later = b.verifyLater?.length ? ` · 데이터가 생기면 확인할 것 ${b.verifyLater.length}건` : '';
  if (b.state === 'draft') return { mark: '◇', text: `시안 — 아직 구현 전${b.request ? ` (요청 #${b.request})` : ''}`, detail: b.request ? `요청 #${b.request}` : '', stale: false };
  if (!b.files.length) return { mark: '·', text: '참고용 — 대응하는 소스 없음', detail: '', stale: false };
  if (b.state === 'differs') return { mark: '≠', text: `대조해 보니 다른 곳이 있다${later} (설계 시안 또는 소스를 맞춘다)`, detail: '', stale: true };
  if (b.state === 'unchecked' || !b.syncedAt) return { mark: '?', text: '대조 안 됨 — 소스와 같은지 확인하지 않았다', detail: '', stale: true };
  const n = commitsSince(root, b);
  if (n && b.pinned) return { mark: '△', text: `확정한 뒤 소스가 ${n}번 바뀜 — 다시 비교한다`, detail: `확정 뒤 ${n}번 바뀜`, stale: true };
  if (n) return { mark: '△', text: `소스가 더 최신 — ${b.syncedAt} 뒤로 ${n}번 바뀜, 시안을 갱신한다`, detail: `${b.syncedAt} 뒤로 ${n}번 바뀜`, stale: true };
  if (b.pinned) return { mark: '✓', text: `확정 — 못 박음 (커밋 ${b.syncedAt} · ${b.syncedOn ?? ''})${later}`, detail: `확정 · 커밋 ${b.syncedAt} · ${(b.syncedOn ?? '').slice(5).replace('-', '/')}`, stale: false };
  return { mark: '✓', text: `구현과 같음 (커밋 ${b.syncedAt} · ${b.syncedOn ?? ''})${later}`, detail: `커밋 ${b.syncedAt} · ${(b.syncedOn ?? '').slice(5).replace('-', '/')}`, stale: false };
}

/** 설계서 보기에 보일 판 목록(모델에 담긴다) */
export function designViews(root: string): DesignView[] {
  const m = readMap(root);
  const live = m.boards.map((b): DesignView => { const f = freshness(root, b); return { no: b.no, title: b.title, mark: f.mark, detail: f.detail, stale: f.stale, state: b.state, pinned: !!b.pinned && !f.stale, screens: b.screens ?? [], verifyLater: b.verifyLater ?? [] }; });
  const gone = (m.retired ?? []).map((r): DesignView => ({ no: r.no, title: r.title, mark: '·', detail: `폐기 ${r.on.slice(5).replace('-', '/')} · ${r.reason}`, stale: false, state: 'retired', pinned: false, screens: [], verifyLater: [] }));
  return [...live, ...gone];
}

/** 명령: design status | sync <판> | pin <판> | retire <판> --reason 이유 | draft <판> --request N | later <판> "글" | check [프로젝트] */
export async function main(argv: string[]): Promise<number | undefined> {
  const { pos, opts } = parseArgs(argv, []);
  const [sub, a, b] = pos;
  const root = path.resolve(opts.project || '.');
  const map = readMap(root);
  const find = (name: string | undefined): Board | undefined => map.boards.find((x) => x.board === name || x.board === `${name}.dc.html` || x.no === name);
  if (sub === 'status' || sub === 'check' || !sub) {
    const stale = map.boards.map((x) => ({ x, f: freshness(root, x) }));
    if (sub === 'check') {
      for (const { x, f } of stale) if (f.stale) console.error(`[spec-view] 시안 ${x.no} ${x.title}: ${f.mark} ${f.text}`);
      return 0;
    }
    if (!map.boards.length) { console.log('.spec/design-map.json이 없다 — 시안 판과 소스의 대응표가 필요하다'); return 0; }
    for (const { x, f } of stale) console.log(`${f.mark} ${x.no.padEnd(4)} ${x.title} — ${f.text}${x.verifyLater?.length ? '\n' + x.verifyLater.map((v) => `       · 나중에 확인: ${v}`).join('\n') : ''}`);
    console.log('\n✓ 구현과 같음   △ 소스가 더 최신(시안 갱신)   ≠ 대조해 보니 다름   ◇ 아직 구현 전   ? 대조 안 됨   · 참고용');
    return 0;
  }
  const bd = find(a);
  if (!bd) { console.error(`판 "${a}"을 대응표에서 찾지 못했다. 이름(예: Detail-Design)이나 번호를 쓴다`); return 1; }
  if (sub === 'sync') {
    const dirty = bd.files.filter((f) => git(root, ['status', '--porcelain', '--', f]));
    if (dirty.length) { console.error(`아직 커밋하지 않은 소스가 있다: ${dirty.join(', ')} — 커밋한 뒤 맞춘다`); return 1; }
    bd.state = 'confirmed'; bd.syncedAt = git(root, ['rev-parse', '--short', 'HEAD']); bd.syncedOn = new Date().toISOString().slice(0, 10); delete bd.request;
  } else if (sub === 'pin') {
    if (bd.state !== 'confirmed' || !bd.syncedAt) { console.error('구현과 같다고 확인한 판만 확정한다. 먼저 sync로 맞춘다'); return 1; }
    bd.pinned = true;
  } else if (sub === 'retire') {
    if (!opts.reason) { console.error('--reason 폐기 이유가 필요하다'); return 1; }
    map.boards = map.boards.filter((x) => x !== bd);
    map.retired = [...(map.retired ?? []), { no: bd.no, title: bd.title, reason: String(opts.reason), on: new Date().toISOString().slice(0, 10) }];
    writeMap(root, map);
    console.log(`${bd.no} ${bd.title}: 폐기 기록에 남겼다(캔버스의 판 파일은 Artifact 도구로 따로 지운다)`);
    return 0;
  } else if (sub === 'differs') {
    bd.state = 'differs'; delete bd.pinned;
  } else if (sub === 'draft') {
    if (!opts.request) { console.error('--request 번호가 필요하다'); return 1; }
    bd.state = 'draft'; bd.request = Number(opts.request);
  } else if (sub === 'later') {
    if (!b) { console.error('나중에 확인할 글이 필요하다'); return 1; }
    bd.verifyLater = [...(bd.verifyLater ?? []), b];
  } else { console.error('사용: design status | sync <판> | pin <판> | retire <판> --reason 이유 | differs <판> | draft <판> --request N | later <판> "글" | check'); return 1; }
  writeMap(root, map);
  console.log(`${bd.no} ${bd.title}: ${((f) => `${f.mark} ${f.text}`)(freshness(root, bd))}`);
  return 0;
}
