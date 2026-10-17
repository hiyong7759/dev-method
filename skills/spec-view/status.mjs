// 화면 상태와 승인 기록을 프로젝트의 .spec/status.json에 남기고, 소스가 바뀌었는지 계산한다.
// 존재 이유: 승인을 말이 아니라 기록으로 남기고, 승인한 뒤 소스가 바뀌면 사람이 기억하지 않아도 "승인 후 변경됨"이 되게 하려고.
// 상태: dev(개발 중) → test-requested(테스트 요청) → needs-fix(수정 필요) | approved(승인됨) → approved-changed(승인 후 변경됨, 계산)
// 에이전트가 쓸 수 있는 것은 dev, test-requested뿐이다. approved와 needs-fix는 사용자가 설계서 보기(브라우저)에서만 남긴다.
// 변경 감지 범위: 화면 파일과 거기서 상대 경로로 import하는 파일(재귀)의 내용 해시. 도메인 타입처럼 import로 닿는 파일의 변경도 포함된다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { extractSpecs } from './extract.mjs';

export const AGENT_STATES = ['dev', 'test-requested'];
export const USER_STATES = ['approved', 'needs-fix'];
export const LABEL = { dev: '개발 중', 'test-requested': '테스트 요청', 'needs-fix': '수정 필요', approved: '승인됨', 'approved-changed': '승인 후 변경됨' };

const sh = (cmd, cwd) => { try { return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
export const projectRoot = (scanRoot) => sh('git rev-parse --show-toplevel', scanRoot) || path.dirname(scanRoot);
const storeFile = (scanRoot) => path.join(projectRoot(scanRoot), '.spec', 'status.json');

function resolveImport(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, ...['.ts', '.tsx', '.js', '.jsx', '.mjs'].map((e) => base + e), ...['.ts', '.tsx', '.js'].map((e) => path.join(base, 'index' + e))]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

export function screenFiles(entry) {
  const seen = new Set();
  const visit = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    let text; try { text = fs.readFileSync(f, 'utf8'); } catch { return; }
    for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const r = resolveImport(f, m[1]);
      if (r && !r.includes('node_modules')) visit(r);
    }
  };
  visit(entry);
  return [...seen].sort();
}

const hashOf = (files) => {
  const h = crypto.createHash('sha1');
  for (const f of files) { h.update(f); try { h.update(fs.readFileSync(f)); } catch {} }
  return h.digest('hex').slice(0, 12);
};

const load = (scanRoot) => { try { return JSON.parse(fs.readFileSync(storeFile(scanRoot), 'utf8')); } catch { return { screens: {} }; } };

// 현재 화면의 상태. 기록이 없으면 dev. approved인데 해시가 다르면 approved-changed
export function currentStatus(scanRoot, out = extractSpecs(scanRoot)) {
  if (!out.screen) return null;
  const rec = load(scanRoot).screens[out.screen.name];
  const files = screenFiles(path.join(scanRoot, out.screen.file));
  const hash = hashOf(files);
  if (!rec) return { screen: out.screen.name, status: 'dev', label: LABEL.dev, files: files.length };
  const changed = rec.hash !== hash;
  const status = rec.status === 'approved' && changed ? 'approved-changed' : rec.status;
  return { screen: out.screen.name, status, label: LABEL[status], by: rec.by, at: rec.at, commit: rec.commit, note: rec.note || '', changedSinceRecord: changed, files: files.length };
}

export function setStatus(scanRoot, status, { by, note = '' }) {
  if (by === 'agent' && !AGENT_STATES.includes(status)) throw new Error(`에이전트는 ${AGENT_STATES.join(', ')}만 남길 수 있다. ${status}는 사용자가 설계서 보기에서만 남긴다`);
  if (by === 'user' && !USER_STATES.includes(status)) throw new Error(`사용자 기록은 ${USER_STATES.join(', ')}만 가능하다`);
  const out = extractSpecs(scanRoot);
  if (!out.screen) throw new Error('@screen이 없어 화면 이름을 알 수 없다');
  const name = out.screen.name;
  const files = screenFiles(path.join(scanRoot, out.screen.file));
  const store = load(scanRoot);
  const prev = store.screens[name] || { history: [] };
  const rec = { status, by, at: new Date().toISOString(), commit: sh('git rev-parse --short HEAD', scanRoot), dirty: !!sh('git status --porcelain', scanRoot), hash: hashOf(files), note };
  store.screens[name] = { ...rec, history: [...(prev.history || []), { status, by, at: rec.at, commit: rec.commit, note }] };
  const file = storeFile(scanRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2) + '\n');
  return currentStatus(scanRoot, out);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, a] = process.argv.slice(2).filter((x) => !x.startsWith('--'));
  const opt = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const scanRoot = path.resolve(opt('--src') || 'src');
  try {
    if (cmd === 'set') {
      const r = setStatus(scanRoot, a, { by: 'agent', note: opt('--note') || '' });
      console.log(`${r.screen}: ${r.label} (기록: .spec/status.json, 커밋 ${r.commit}${r.changedSinceRecord ? '' : ''})`);
    } else if (cmd === 'list') {
      const r = currentStatus(scanRoot);
      console.log(r ? `${r.screen}: ${r.label}${r.note ? ` — ${r.note}` : ''}` : '@screen 없음');
    } else { console.log('사용: node status.mjs set <dev|test-requested> --src <소스 폴더> [--note 한 줄]\n      node status.mjs list --src <소스 폴더>\n(approved·needs-fix는 설계서 보기에서 사용자만 남긴다)'); process.exit(1); }
  } catch (e) { console.error(`오류: ${e.message}`); process.exit(1); }
}
