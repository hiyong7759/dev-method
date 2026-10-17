// 설계서 보기의 메모 저장소(.spec/memos.json)와 에이전트용 명령.
// 존재 이유: 사용자의 한 줄 요청(컴포넌트·영역·빈 영역)을 위치와 함께 남기고, 에이전트가 읽고 답한 기록이 요청→응답→반영→확인으로 이어지게 하려고.
// 상태: pending(대기, 에이전트가 아직 모름) → answered(응답됨) → applied(반영됨) → confirmed(확인 완료, 사용자만)
// 에이전트는 사용자가 붙여 넣은 "처리 요청"을 받았을 때만 메모를 읽는다 (export가 만드는 글).
import fs from 'node:fs';
import path from 'node:path';
import { specDir, sh } from './status.mjs';

export const STATE_LABEL = { pending: '대기', answered: '응답됨', applied: '반영됨', confirmed: '확인 완료' };
const file = (scanRoot) => path.join(specDir(scanRoot), 'memos.json');
export const loadMemos = (scanRoot) => { try { return JSON.parse(fs.readFileSync(file(scanRoot), 'utf8')); } catch { return { memos: [] }; } };
const save = (scanRoot, store) => { fs.mkdirSync(specDir(scanRoot), { recursive: true }); fs.writeFileSync(file(scanRoot), JSON.stringify(store, null, 2) + '\n'); };

// target: { type: 'component'|'region'|'empty'|'screen', spec?, rect?, route?, nearest?, neighbors?, kind? }
export function addMemo(scanRoot, { screen, target, text, kind = '' }) {
  if (!text || !String(text).trim()) throw new Error('메모 내용이 비었다');
  const store = loadMemos(scanRoot);
  const id = (store.memos.reduce((m, x) => Math.max(m, x.id), 0)) + 1;
  const memo = { id, screen, target, kind, text: String(text).trim(), at: new Date().toISOString(), by: 'user', state: 'pending', copiedAt: null, commitAtWrite: sh('git rev-parse --short HEAD', scanRoot) };
  store.memos.push(memo);
  save(scanRoot, store);
  return memo;
}

function update(scanRoot, id, fn) {
  const store = loadMemos(scanRoot);
  const m = store.memos.find((x) => x.id === Number(id));
  if (!m) throw new Error(`메모 #${id}이 없다`);
  fn(m); save(scanRoot, store); return m;
}
export const markCopied = (scanRoot, ids) => ids.forEach((id) => update(scanRoot, id, (m) => { m.copiedAt = new Date().toISOString(); }));
export const confirmMemo = (scanRoot, id) => update(scanRoot, id, (m) => { if (m.state === 'pending') throw new Error('응답 전 메모는 확인 완료로 바꿀 수 없다'); m.state = 'confirmed'; m.confirmedAt = new Date().toISOString(); });
export const replyMemo = (scanRoot, id, { text, commit = '' }) => update(scanRoot, id, (m) => { m.reply = { text, at: new Date().toISOString(), commit }; if (m.state === 'pending') m.state = 'answered'; });
export const applyMemo = (scanRoot, id, { commit = '', change = '' }) => update(scanRoot, id, (m) => { m.state = 'applied'; m.applied = { at: new Date().toISOString(), commit, change }; });

const where = (m) => {
  const t = m.target || {};
  if (t.type === 'component') return `컴포넌트: ${t.title || t.spec}${t.file ? ` (${t.file})` : ''}`;
  if (t.type === 'region') return `화면 영역 ${t.rect ? `x ${t.rect.x} y ${t.rect.y} ${t.rect.w}×${t.rect.h}` : ''} · 가장 가까운 컴포넌트: ${t.nearest ? `${t.nearest.title}${t.nearest.file ? ` (${t.nearest.file})` : ''}` : '없음'}`;
  if (t.type === 'empty') return `빈 영역 ${t.rect ? `x ${t.rect.x} y ${t.rect.y} ${t.rect.w}×${t.rect.h}` : ''} · 위: ${t.neighbors?.above || '화면 맨 위 여백'} · 아래: ${t.neighbors?.below || '화면 끝까지 여백'}`;
  return '화면 전체';
};

// 에이전트에게 붙여 넣는 글. 전달 전(대기) 메모를 담는다. screen이 없으면 모든 화면
export function exportText(scanRoot, { screen, scriptDir }) {
  const src = scanRoot;
  const list = loadMemos(scanRoot).memos.filter((m) => m.state === 'pending' && (!screen || m.screen === screen));
  if (!list.length) return '';
  const lines = ['[설계서 보기 처리 요청] 아래 메모를 코드와 대조해 처리하세요. spec-view 스킬의 순서(rules/request.md)를 따릅니다.', ''];
  for (const m of list) {
    lines.push(`메모 #${m.id} · 화면 ${m.screen} · ${where(m)}${m.kind ? ` · ${m.kind}` : ''}`, `  "${m.text}"`);
    if (m.target?.route) lines.push(`  (열린 주소 ${m.target.route})`);
    if (m.target?.shot) lines.push(`  스크린샷: ${path.join(specDir(scanRoot), 'shots', m.target.shot)}`);
    lines.push('');
  }
  lines.push('처리 방법:', `  - 답: node ${scriptDir}/memo.mjs reply <번호> --text "코드에서 확인한 내용" [--commit <해시>] --src ${src}`, `  - 고친 뒤: node ${scriptDir}/memo.mjs applied <번호> --commit <해시> --change "바뀐 내용 한 줄" --src ${src}`, '  - 고친 뒤 "테스트 요청"으로 기록하고, 커밋에 "요청: 메모 #번호 — 요약"을 쓴다');
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pos = [], opts = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[++i]; else pos.push(argv[i]); }
  const [cmd, id] = pos;
  const scanRoot = path.resolve(opts.src || 'src');
  try {
    if (cmd === 'list') {
      for (const m of loadMemos(scanRoot).memos.filter((x) => !opts.screen || x.screen === opts.screen)) console.log(`#${m.id} [${STATE_LABEL[m.state]}] ${m.screen} · ${where(m)} — ${m.text}`);
    } else if (cmd === 'reply') { replyMemo(scanRoot, id, { text: opts.text || '', commit: opts.commit || '' }); console.log(`메모 #${id}: 응답됨`); }
    else if (cmd === 'applied') { applyMemo(scanRoot, id, { commit: opts.commit || '', change: opts.change || '' }); console.log(`메모 #${id}: 반영됨 (확인 완료는 사용자만 바꾼다)`); }
    else { console.log('사용: node memo.mjs list --src <소스 폴더> [--screen 이름]\n      node memo.mjs reply <번호> --text "…" [--commit 해시] --src <소스 폴더>\n      node memo.mjs applied <번호> --commit 해시 [--change "…"] --src <소스 폴더>'); process.exit(1); }
  } catch (e) { console.error(`오류: ${e.message}`); process.exit(1); }
}
