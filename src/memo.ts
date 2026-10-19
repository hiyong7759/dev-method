/**
 * @spec memo-store 메모 저장소와 에이전트용 명령
 * @why 사용자의 한 줄 요청(컴포넌트·영역·빈 영역)을 위치와 함께 남기고, 에이전트가 읽고 답한 기록이 요청 → 응답 → 반영 → 확인으로 이어지게 한다.
 * @contract 메모는 pending(대기, 에이전트가 아직 모름) → answered(응답됨) → applied(반영됨) → confirmed(확인 완료, 사용자만)로 흐른다. 에이전트는 사용자가 붙여 넣은 "처리 요청"(exportText가 만드는 글)을 받았을 때만 메모를 읽는다. 기록 파일(.spec/memos.json) 모양을 바꾸면 model.ts와 viewer/가 함께 바뀌어야 한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { specDir, sh } from './status.js';
import { parseArgs, errorText } from './cli.js';
import type { Memo, MemoState, MemoTarget } from './types.js';

/** 메모 진행 상태의 화면용 이름 */
export const STATE_LABEL: Record<MemoState, string> = { pending: '대기', answered: '응답됨', applied: '반영됨', confirmed: '확인 완료' };

/** .spec/memos.json 전체 */
interface Store { memos: Memo[] }
const file = (scanRoot: string): string => path.join(specDir(scanRoot), 'memos.json');
/** 저장된 메모를 모두 읽는다 */
export const loadMemos = (scanRoot: string): Store => {
  try { return JSON.parse(fs.readFileSync(file(scanRoot), 'utf8')) as Store; } catch { return { memos: [] }; }
};
const save = (scanRoot: string, store: Store): void => {
  fs.mkdirSync(specDir(scanRoot), { recursive: true });
  fs.writeFileSync(file(scanRoot), JSON.stringify(store, null, 2) + '\n');
};

/** 사용자가 설계서 보기에서 남긴 메모를 저장한다 */
export function addMemo(scanRoot: string, { screen, target, text, kind = '' }: { screen: string; target: MemoTarget; text: string; kind?: string }): Memo {
  if (!text || !String(text).trim()) throw new Error('메모 내용이 비었다');
  const store = loadMemos(scanRoot);
  const id = store.memos.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  const memo: Memo = { id, screen, target, kind, text: String(text).trim(), at: new Date().toISOString(), by: 'user', state: 'pending', copiedAt: null, commitAtWrite: sh('git rev-parse --short HEAD', scanRoot) };
  store.memos.push(memo);
  save(scanRoot, store);
  return memo;
}

/** 메모 하나를 찾아 고치고 저장한다 */
function update(scanRoot: string, id: number | string, fn: (m: Memo) => void): Memo {
  const store = loadMemos(scanRoot);
  const m = store.memos.find((x) => x.id === Number(id));
  if (!m) throw new Error(`메모 #${id}이 없다`);
  fn(m);
  save(scanRoot, store);
  return m;
}
/** 에이전트에게 전달하려고 복사한 메모에 복사한 시각을 남긴다 */
export const markCopied = (scanRoot: string, ids: number[]): void => ids.forEach((id) => { update(scanRoot, id, (m) => { m.copiedAt = new Date().toISOString(); }); });
/** 사용자가 "확인 완료"로 바꾼다. 응답 전 메모는 바꿀 수 없다 */
export const confirmMemo = (scanRoot: string, id: number | string): Memo => update(scanRoot, id, (m) => {
  if (m.state === 'pending') throw new Error('응답 전 메모는 확인 완료로 바꿀 수 없다');
  m.state = 'confirmed'; m.confirmedAt = new Date().toISOString();
});
/** 에이전트가 코드와 대조한 답을 남긴다 */
export const replyMemo = (scanRoot: string, id: number | string, { text, commit = '' }: { text: string; commit?: string }): Memo => update(scanRoot, id, (m) => {
  m.reply = { text, at: new Date().toISOString(), commit };
  if (m.state === 'pending') m.state = 'answered';
});
/** 에이전트가 고친 뒤 반영 기록을 남긴다 */
export const applyMemo = (scanRoot: string, id: number | string, { commit = '', change = '' }: { commit?: string; change?: string }): Memo => update(scanRoot, id, (m) => {
  m.state = 'applied'; m.applied = { at: new Date().toISOString(), commit, change };
});

/** 메모가 가리키는 곳을 사람이 읽는 한 줄로 */
function where(m: Memo): string {
  const t = m.target;
  const size = t.rect ? `x ${t.rect.x} y ${t.rect.y} ${t.rect.w}×${t.rect.h}` : '';
  if (t.type === 'component') return `컴포넌트: ${t.title || t.spec}${t.file ? ` (${t.file})` : ''}`;
  if (t.type === 'region') return `화면 영역 ${size} · 가장 가까운 컴포넌트: ${t.nearest ? `${t.nearest.title}${t.nearest.file ? ` (${t.nearest.file})` : ''}` : '없음'}`;
  if (t.type === 'empty') return `빈 영역 ${size} · 위: ${t.neighbors?.above || '화면 맨 위 여백'} · 아래: ${t.neighbors?.below || '화면 끝까지 여백'}`;
  return '화면 전체';
}

/** 에이전트에게 붙여 넣는 글. 전달 전(대기) 메모를 담는다. screen이 없으면 모든 화면 */
export function exportText(scanRoot: string, { screen, scriptDir }: { screen?: string; scriptDir: string }): string {
  const list = loadMemos(scanRoot).memos.filter((m) => m.state === 'pending' && (!screen || m.screen === screen));
  if (!list.length) return '';
  const lines = ['[설계서 보기 처리 요청] 아래 메모를 코드와 대조해 처리하세요. spec-view 스킬의 순서(rules/request.md)를 따릅니다.', ''];
  for (const m of list) {
    lines.push(`메모 #${m.id} · 화면 ${m.screen} · ${where(m)}${m.kind ? ` · ${m.kind}` : ''}`, `  "${m.text}"`);
    if (m.target.route) lines.push(`  (열린 주소 ${m.target.route})`);
    if (m.target.shot) lines.push(`  스크린샷: ${path.join(specDir(scanRoot), 'shots', m.target.shot)}`);
    lines.push('');
  }
  lines.push('처리 방법:',
    `  - 답: node ${scriptDir}/spec.mjs memo reply <번호> --text "코드에서 확인한 내용" [--commit <해시>] --src ${scanRoot}`,
    `  - 고친 뒤: node ${scriptDir}/spec.mjs memo applied <번호> --commit <해시> --change "바뀐 내용 한 줄" --src ${scanRoot}`,
    '  - 고친 뒤 "테스트 요청"으로 기록하고, 커밋에 "요청: 메모 #번호 — 요약"을 쓴다');
  return lines.join('\n');
}

/** 명령: memo list / reply / applied */
export async function main(argv: string[]): Promise<number | undefined> {
  const { pos, opts } = parseArgs(argv);
  const [cmd, id] = pos;
  const scanRoot = path.resolve(opts.src || 'src');
  try {
    if (cmd === 'list') {
      for (const m of loadMemos(scanRoot).memos.filter((x) => !opts.screen || x.screen === opts.screen)) console.log(`#${m.id} [${STATE_LABEL[m.state]}] ${m.screen} · ${where(m)} — ${m.text}`);
    } else if (cmd === 'reply') { replyMemo(scanRoot, id, { text: opts.text || '', commit: opts.commit || '' }); console.log(`메모 #${id}: 응답됨`); }
    else if (cmd === 'applied') { applyMemo(scanRoot, id, { commit: opts.commit || '', change: opts.change || '' }); console.log(`메모 #${id}: 반영됨 (확인 완료는 사용자만 바꾼다)`); }
    else {
      console.log('사용: node <스킬 폴더>/spec.mjs memo list --src <소스 폴더> [--screen 이름]\n      node <스킬 폴더>/spec.mjs memo reply <번호> --text "…" [--commit 해시] --src <소스 폴더>\n      node <스킬 폴더>/spec.mjs memo applied <번호> --commit 해시 [--change "…"] --src <소스 폴더>');
      return 1;
    }
  } catch (e) { console.error(`오류: ${errorText(e)}`); return 1; }
  return undefined;
}
