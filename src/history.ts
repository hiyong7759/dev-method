/**
 * @spec screen-history 화면의 변경 이력
 * @why 이력을 따로 쓰지 않고 커밋 메시지(결정·기각 포함)를 유일한 원본으로 둔다. 그 화면의 소스 파일을 바꾼 git 커밋에서 제목, 요청, 결정, 기각, 원인을 읽고, 승인 기록과 합쳐 시간 순으로 보인다.
 * @contract 커밋 메시지의 "요청:", "결정:", "기각:", "원인:" 줄(docs/commit-message.md)을 읽는다. 줄 모양을 바꾸면 이 파일도 함께 고친다.
 */
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { projectRoot } from './project.js';
import type { HistoryItem, HistoryPlace, ModelInfo, Request, ScreenTag, Spec, UntrackedCommit } from './types.js';

/** 커밋 메시지를 쪼개는 구분 글자 */
const SEP = '\x1e', FIELD = '\x1f';

/** 파일 하나에서 바뀐 덩어리 하나 */
interface FileHunk { range: [number, number]; removed: string[]; added: string[] }

/** 커밋이 바꾼 곳(새 파일 기준 줄 범위)과 바뀐 내용(지운 줄·새 줄)을 파일별로 읽는다 */
function changedHunks(root: string, hash: string, relFiles: string[]): Record<string, FileHunk[]> {
  const out: Record<string, FileHunk[]> = {};
  let raw = '';
  try { raw = execFileSync('git', ['show', '--unified=0', '--no-color', '--format=', hash, '--', ...relFiles], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 24 }).toString(); } catch { return out; }
  let file: string | null = null;
  let cur: FileHunk | null = null;
  for (const l of raw.split('\n')) {
    const f = l.match(/^\+\+\+ b\/(.+)$/);
    if (f) { file = f[1]; out[file] = out[file] || []; cur = null; continue; }
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h && file) {
      const start = Number(h[1]), n = h[2] === undefined ? 1 : Number(h[2]);
      cur = { range: [start, n === 0 ? start : start + n - 1], removed: [], added: [] };
      out[file].push(cur);
      continue;
    }
    if (!cur || l.startsWith('---') || l.startsWith('+++')) continue;
    if (l.startsWith('+')) cur.added.push(l.slice(1)); else if (l.startsWith('-')) cur.removed.push(l.slice(1));
  }
  return out;
}

/** 파일 안의 표시 줄(요소, 화면, 정보·필드 정의) */
interface Mark { file: string; line: number }
interface SpecMark extends Mark { id: string | null; title?: string }
interface InfoMark extends Mark { info: string; prop: string | null }

/** 구역: 표시 줄부터 다음 표시 줄 앞까지가 그것의 자리. 바뀐 줄 범위와 겹치는 표시들을 돌려준다 */
function owners<T extends Mark>(marks: T[], file: string, a: number, b: number): T[] {
  const list = marks.filter((m) => m.file === file).sort((x, y) => x.line - y.line);
  return list.filter((m, i) => { const end = i + 1 < list.length ? list[i + 1].line - 1 : Infinity; return a <= end && b >= m.line; });
}

/** screenHistory가 더 자세히 읽을 때 쓰는 모델 조각. 없으면 커밋 제목과 요청 줄만 읽는다 */
export interface HistoryContext {
  /** 화면 요소들(바뀐 줄이 어느 요소의 자리인지 가르는 기준) */
  specs?: Spec[];
  /** 화면들의 표시 줄(화면 주석의 자리) */
  screens?: Mark[];
  /** 정보들(바뀐 줄이 어느 정보와 필드의 자리인지 가르는 기준) */
  infos?: ModelInfo[];
}

/** 그 화면의 소스 파일을 바꾼 커밋을 최신순으로 돌려준다 */
export function screenHistory(scanRoot: string, sc: ScreenTag, ctx: HistoryContext = {}): HistoryItem[] {
  const root = projectRoot(scanRoot);
  const files = sc.files.map((f) => path.relative(root, path.join(scanRoot, f)));
  let raw = '';
  try { raw = execFileSync('git', ['log', `--format=${SEP}%h${FIELD}%aI${FIELD}%an${FIELD}%s${FIELD}%b`, '--name-only', '--', ...files], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 24 }).toString(); } catch { /* git 없음 */ }
  const items: HistoryItem[] = [];
  const specMarks: SpecMark[] = [
    ...(ctx.specs || []).map((x) => ({ file: x.file, line: x.line, id: x.id as string | null, title: x.title })),
    ...(ctx.screens || []).map((x) => ({ file: x.file, line: x.line, id: null })),
  ];
  // 정보: 정의 줄은 그 한 줄만, 필드는 (앞 필드 다음 줄 ~ 자기 줄)이라 필드 바로 위 설명 주석도 그 필드의 자리다
  const infoMarks: InfoMark[] = (ctx.infos || []).flatMap((i) => [
    { file: i.fileSrc, line: i.line, info: i.name, prop: null },
    ...i.props.map((p, k) => ({ file: i.fileSrc, line: k === 0 ? i.line + 1 : i.props[k - 1].line + 1, info: i.name, prop: p.name })),
  ]);
  for (const chunk of raw.split(SEP).filter(Boolean)) {
    const [hash, at, author, subject, rest = ''] = chunk.split(FIELD);
    const body = rest.split('\n');
    const fileList = body.filter((l) => /^[\w.\/-]+\.\w+$/.test(l.trim()) && !l.includes(':')).map((l) => l.trim());
    const msg = body.filter((l) => /^(요청|결정|기각|원인|검증|수정|한계|다음)\s*:/.test(l));
    const field = (k: string): string[] => msg.filter((l) => l.startsWith(k)).map((l) => l.replace(/^[^:]+:\s*/, ''));
    const fix = /^fix(\(|:)/.test(subject);
    // 이 커밋이 실제로 고친 곳: 화면 요소·정보 필드·그 밖(스타일·설정 등)으로 나눠 곳마다 바뀐 내용을 묶는다
    const lines = ctx.specs ? changedHunks(root, hash, files) : {};
    const touchedSpecs = new Set<string>();
    const touchedInfos = new Map<string, Set<string>>();
    const places = new Map<string, HistoryPlace>();
    const clip = (arr: string[]): string[] => arr.slice(0, 8).map((x) => (x.length > 140 ? `${x.slice(0, 140)}…` : x));
    for (const [rf, hunks] of Object.entries(lines)) {
      const sf = path.relative(scanRoot, path.join(root, rf));
      for (const hk of hunks) {
        const [a, b] = hk.range;
        const sps = owners(specMarks, sf, a, b).filter((m) => m.id);
        const ins = owners(infoMarks, sf, a, b);
        sps.forEach((m) => { if (m.id) touchedSpecs.add(m.id); });
        ins.forEach((m) => { const cur = touchedInfos.get(m.info) || new Set<string>(); if (m.prop) cur.add(m.prop); touchedInfos.set(m.info, cur); });
        const sp = sps[0], inf = ins[0];
        const own: Pick<HistoryPlace, 'kind' | 'key' | 'title' | 'id' | 'info' | 'prop'> = sp
          ? { kind: 'spec', key: `spec:${sp.id}`, id: sp.id ?? undefined, title: sp.title ?? '' }
          : inf
            ? { kind: 'info', key: `info:${inf.info}.${inf.prop || ''}`, info: inf.info, prop: inf.prop, title: inf.prop ? `${inf.info}.${inf.prop}` : inf.info }
            : { kind: 'other', key: `other:${sf}`, title: path.basename(sf) };
        const pl = places.get(own.key) || { ...own, file: sf, line: a, added: 0, removed: 0, hunks: [] };
        pl.added += hk.added.length; pl.removed += hk.removed.length;
        if (pl.hunks.length < 4) pl.hunks.push({ line: a, removed: clip(hk.removed), added: clip(hk.added) });
        places.set(own.key, pl);
      }
    }
    const mine = fileList.filter((f) => files.includes(f));
    items.push({
      type: 'commit', kind: fix ? '오류 수정' : '변경', hash, at, author,
      title: subject.replace(/^\w+(\([^)]*\))?:\s*/, '').replace(/^"|"$/g, ''),
      request: field('요청')[0] || '', decisions: field('결정'), rejections: field('기각'), cause: field('원인')[0] || '', files: mine.length || undefined,
      fileList: mine.map((f) => path.relative(scanRoot, path.join(root, f))),
      places: [...places.values()].slice(0, 12), touchedSpecs: [...touchedSpecs], touchedInfos: [...touchedInfos].map(([name, f]) => ({ name, fields: [...f] })),
    });
  }
  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return items;
}

/** 마지막으로 읽은 결과(저장소의 HEAD가 그대로면 다시 읽지 않는다) */
const untrackedCache = new Map<string, { head: string; since: string; known: string; list: UntrackedCommit[] }>();

/** 요청 번호 없이 남은 커밋: 첫 요청이 생긴 뒤의 커밋 중 메시지에 "요청 #번호"가 없고 어느 요청의 커밋으로도 적히지 않은 것(병합·되돌리기는 뺀다) */
export function untrackedCommits(scanRoot: string, requests: Request[]): UntrackedCommit[] {
  if (!requests.length) return [];
  const root = projectRoot(scanRoot);
  const since = requests.reduce((m, r) => (r.origin.at < m ? r.origin.at : m), requests[0].origin.at);
  const known = new Set(requests.flatMap((r) => r.commits ?? []));
  let head = '';
  try { head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return []; }
  const key = [...known].sort().join(',');
  const hit = untrackedCache.get(root);
  if (hit && hit.head === head && hit.since === since && hit.known === key) return hit.list;
  let raw = '';
  try { raw = execFileSync('git', ['log', `--since=${since}`, `--format=${SEP}%h${FIELD}%aI${FIELD}%an${FIELD}%s${FIELD}%b`], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 24 }).toString(); } catch { return []; }
  const list: UntrackedCommit[] = [];
  for (const chunk of raw.split(SEP).filter(Boolean)) {
    const [hash, at, author, subject, body = ''] = chunk.split(FIELD);
    if (/^(Merge|Revert)\b/.test(subject) || /^revert[:(]/i.test(subject)) continue;
    if (/요청\s*[:#]?\s*#\d+/.test(`${subject}\n${body}`) || known.has(hash)) continue;
    list.push({ hash, at, author, title: subject.replace(/^\w+(\([^)]*\))?:\s*/, '') });
  }
  untrackedCache.set(root, { head, since, known: key, list });
  return list;
}
