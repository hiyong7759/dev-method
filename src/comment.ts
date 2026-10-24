/**
 * @spec comments 화면 코멘트와 에이전트의 답
 * @why 사용자가 화면을 보다 생긴 궁금증이나 요청을, 어느 화면의 어느 부분인지 정확히 알려 에이전트에게 바로 물을 수 있어야 한다. 말로 설명하기 어려운 곳은 부품을 고르거나 화면을 캡처해서 보내고, 에이전트의 답은 같은 자리에 달린다.
 * @basis 코멘트는 이 컴퓨터의 작업 대화라서 .spec/comments.json에 두고 커밋하지 않는다. 일이 되는 것은 "요청으로 만들기"로 요청이 된다. 캡처는 .spec/comment-shots/에 둔다. 전달은 쌓아 두는 방식이라, 에이전트가 `comment list`로 읽어 간다.
 * @contract 파일 모양은 { items: Comment[] }이다. 사용자의 글은 설계서 보기 서버(middleware.ts)만 받고, 에이전트는 명령(list·show·reply·close)으로 답한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { specDir } from './project.js';
import { parseArgs, errorText } from './cli.js';
import { addRequest } from './request.js';
import type { Comment, CommentTarget } from './types.js';

const fileOf = (scanRoot: string): string => path.join(specDir(scanRoot), 'comments.json');
export const shotDir = (scanRoot: string): string => path.join(specDir(scanRoot), 'comment-shots');

/** 코멘트들을 읽는다. 없거나 깨졌으면 빈 목록 */
export function loadComments(scanRoot: string): Comment[] {
  try { return (JSON.parse(fs.readFileSync(fileOf(scanRoot), 'utf8')) as { items?: Comment[] }).items ?? []; } catch { return []; }
}
function save(scanRoot: string, items: Comment[]): void {
  fs.mkdirSync(path.dirname(fileOf(scanRoot)), { recursive: true });
  fs.writeFileSync(fileOf(scanRoot), JSON.stringify({ items }, null, 2) + '\n');
}
const find = (items: Comment[], id: number): Comment => { const c = items.find((x) => x.id === id); if (!c) throw new Error(`코멘트 #${id}를 찾지 못했다`); return c; };

/** 사용자가 코멘트를 남긴다(설계서 보기에서만 부른다). 캡처(data:image/png)가 있으면 파일로 저장한다 */
export function addComment(scanRoot: string, { target, text, shot }: { target: CommentTarget; text: string; shot?: string }): Comment {
  if (!text?.trim()) throw new Error('코멘트 글이 비었다');
  if (!target?.label) throw new Error('코멘트 대상이 없다');
  const items = loadComments(scanRoot);
  const id = items.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  let shotName = '';
  if (shot) {
    if (!shot.startsWith('data:image/png;base64,')) throw new Error('캡처 형식이 맞지 않는다');
    fs.mkdirSync(shotDir(scanRoot), { recursive: true });
    shotName = `c${id}.png`;
    fs.writeFileSync(path.join(shotDir(scanRoot), shotName), Buffer.from(shot.split(',')[1], 'base64'));
  }
  const now = new Date().toISOString();
  const c: Comment = { id, target, status: 'waiting', shot: shotName, at: now, thread: [{ who: 'user', text: text.trim(), at: now }] };
  items.push(c); save(scanRoot, items);
  return c;
}

/** 글을 덧붙인다. 사용자가 덧붙이면 다시 답을 기다리고, 에이전트가 덧붙이면 답함이 된다 */
export function replyComment(scanRoot: string, id: number, who: 'user' | 'agent', text: string, refs: string[] = []): Comment {
  if (!text?.trim()) throw new Error('글이 비었다');
  const items = loadComments(scanRoot), c = find(items, id);
  c.thread.push({ who, text: text.trim(), at: new Date().toISOString(), ...(refs.length ? { refs } : {}) });
  c.status = who === 'agent' ? 'answered' : 'waiting';
  save(scanRoot, items);
  return c;
}

/** 닫는다(끝난 이야기) */
export function closeComment(scanRoot: string, id: number): Comment {
  const items = loadComments(scanRoot), c = find(items, id);
  c.status = 'closed'; save(scanRoot, items);
  return c;
}

/** 이 코멘트를 요청으로 만든다. 코멘트의 첫 글이 요청의 "사용자가 한 말"이 된다 */
export function commentToRequest(scanRoot: string, id: number, title: string): { comment: Comment; request: number } {
  const items = loadComments(scanRoot), c = find(items, id);
  if (c.request) throw new Error(`이미 요청 #${c.request}로 만들었다`);
  const t = c.target;
  const req = addRequest(scanRoot, { title: title.trim() || c.thread[0].text.slice(0, 60), origin: `${c.thread[0].text} (코멘트 #${id} · ${t.label})`, channel: '코멘트', screens: t.screen ? [t.screen] : [], infos: t.info ? [t.info] : [], source: 'user' });
  c.request = req.id; c.status = 'closed'; save(scanRoot, items);
  return { comment: c, request: req.id };
}

/** 코멘트 한 건을 에이전트가 같은 모양으로 읽도록 풀어 쓴다 */
export function describeComment(c: Comment): string {
  const t = c.target;
  const out = [`코멘트 #${c.id} · ${{ waiting: '답 기다림', answered: '답함', closed: '닫힘' }[c.status]}${c.request ? ` · 요청 #${c.request}로 만듦` : ''}`, `대상: ${t.label}${t.kind === 'region' ? ' (화면에서 그려 지정한 영역)' : ''}`];
  if (t.screen) out.push(`화면: ${t.screen}`);
  if (t.part) out.push(`부품: ${t.part}${t.src ? ` · 소스 ${t.src}` : ''}`);
  if (t.step) out.push(`테스트 경로: 요청 #${t.testOf ?? ''} ${t.step}`);
  if (t.info) out.push(`정보: ${t.info}`);
  if (t.no) out.push(`리포트: #${t.no}  (자세히: report show ${t.no})`);
  if (t.view) out.push(`설계서 보기 주소: ${t.view}`);
  if (t.rect) out.push(`영역: x ${Math.round(t.rect.x)}, y ${Math.round(t.rect.y)}, 폭 ${Math.round(t.rect.w)}, 높이 ${Math.round(t.rect.h)}`);
  if (c.shot) out.push(`캡처: .spec/comment-shots/${c.shot}`);
  out.push('', ...c.thread.map((m) => `${m.who === 'user' ? '사용자' : '에이전트'} ${m.at.slice(0, 16).replace('T', ' ')}: ${m.text}${m.refs?.length ? `  [확인함: ${m.refs.join(', ')}]` : ''}`));
  return out.join('\n');
}

/** 명령: comment list [--all] / show <번호> / reply <번호> --text "…" [--refs 파일:줄,…] / close <번호> */
export async function main(argv: string[]): Promise<number | undefined> {
  const { pos, opts, flags } = parseArgs(argv, ['all']);
  const scanRoot = path.resolve(opts.src || 'src');
  try {
    if (pos[0] === 'list') {
      const items = loadComments(scanRoot).filter((c) => flags.has('all') || c.status === 'waiting');
      if (!items.length) console.log(flags.has('all') ? '코멘트가 없다' : '답을 기다리는 코멘트가 없다');
      for (const c of items) console.log(`#${c.id} [${{ waiting: '답 기다림', answered: '답함', closed: '닫힘' }[c.status]}] ${c.target.label} — ${c.thread[0].text.slice(0, 60)}`);
    } else if (pos[0] === 'show') {
      console.log(describeComment(find(loadComments(scanRoot), Number((pos[1] ?? '').replace('#', '')))));
    } else if (pos[0] === 'reply') {
      const c = replyComment(scanRoot, Number((pos[1] ?? '').replace('#', '')), 'agent', opts.text ?? '', opts.refs ? opts.refs.split(',').map((x) => x.trim()).filter(Boolean) : []);
      console.log(`코멘트 #${c.id}: 답함 (설계서 보기의 코멘트 창에 같은 자리에 보인다)`);
    } else if (pos[0] === 'close') {
      console.log(`코멘트 #${closeComment(scanRoot, Number((pos[1] ?? '').replace('#', ''))).id}: 닫음`);
    } else {
      console.error('사용: comment list [--all] --src <소스 폴더> | show <번호> | reply <번호> --text "답" [--refs 파일:줄,…] | close <번호>');
      return 1;
    }
  } catch (e) { console.error(`오류: ${errorText(e)}`); return 1; }
  return undefined;
}
