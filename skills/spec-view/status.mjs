// 화면 상태와 승인 기록을 프로젝트의 .spec/status.json에 남기고, 소스가 바뀌었는지 계산한다.
// 존재 이유: 승인을 말이 아니라 기록으로 남기고, 승인한 뒤 소스가 바뀌면 사람이 기억하지 않아도 "승인 후 변경됨"이 되게 하려고.
// 상태: dev(개발 중) → test-requested(테스트 요청) → needs-fix(수정 필요) | approved(승인됨) → approved-changed(승인 후 변경됨, 계산)
// 에이전트가 쓸 수 있는 것은 dev, test-requested뿐이다. approved와 needs-fix는 사용자가 설계서 보기(브라우저)에서만 남긴다.
// 변경 감지 범위: 화면 파일과 거기서 상대 경로로 import하는 파일(재귀)의 내용 해시. 도메인 타입처럼 import로 닿는 파일의 변경도 포함된다.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { extractSpecs } from './extract.mjs';
import { screenFiles, hashOf } from './files.mjs';

export const AGENT_STATES = ['dev', 'test-requested'];
export const USER_STATES = ['approved', 'needs-fix', 'dev']; // dev = 승인 취소
export const LABEL = { dev: '개발 중', 'test-requested': '테스트 요청', 'needs-fix': '수정 필요', approved: '승인됨', 'approved-changed': '승인 후 변경됨' };

export const sh = (cmd, cwd) => { try { return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
const rootCache = new Map();
export const projectRoot = (scanRoot) => { if (!rootCache.has(scanRoot)) rootCache.set(scanRoot, sh('git rev-parse --show-toplevel', scanRoot) || path.dirname(scanRoot)); return rootCache.get(scanRoot); };
export const specDir = (scanRoot) => path.join(projectRoot(scanRoot), '.spec');
const storeFile = (scanRoot) => path.join(specDir(scanRoot), 'status.json');

const load = (scanRoot) => { try { return JSON.parse(fs.readFileSync(storeFile(scanRoot), 'utf8')); } catch { return { screens: {} }; } };
const save = (scanRoot, store) => { fs.mkdirSync(specDir(scanRoot), { recursive: true }); fs.writeFileSync(storeFile(scanRoot), JSON.stringify(store, null, 2) + '\n'); };
const pick = (out, name) => {
  const sc = name ? out.screens.find((s) => s.name === name) : (out.screens.length === 1 ? out.screens[0] : null);
  if (!sc) throw new Error(name ? `화면 "${name}"이 없다` : `화면이 여러 개다. --screen <이름>으로 고른다 (${out.screens.map((s) => s.name).join(', ')})`);
  return sc;
};

// 화면 하나의 현재 상태. 기록이 없으면 dev. approved인데 해시가 다르면 approved-changed
export function screenStatus(scanRoot, sc, store = load(scanRoot)) {
  const rec = store.screens[sc.name];
  const files = sc.files.map((f) => path.join(scanRoot, f));
  const hash = hashOf(files);
  const checks = rec?.checks || {};
  if (!rec) return { screen: sc.name, status: 'dev', label: LABEL.dev, files: files.length, checks };
  const changed = rec.hash !== hash;
  const status = rec.status === 'approved' && changed ? 'approved-changed' : rec.status;
  return { screen: sc.name, status, label: LABEL[status], by: rec.by, at: rec.at, commit: rec.commit, note: rec.note || '', changedSinceRecord: changed, files: files.length, checks, history: rec.history || [] };
}
export const allStatus = (scanRoot, out = extractSpecs(scanRoot)) => { const st = load(scanRoot); return Object.fromEntries(out.screens.map((sc) => [sc.name, screenStatus(scanRoot, sc, st)])); };

export function setStatus(scanRoot, name, status, { by, note = '' }) {
  if (by === 'agent' && !AGENT_STATES.includes(status)) throw new Error(`에이전트는 ${AGENT_STATES.join(', ')}만 남길 수 있다. ${status}는 사용자가 설계서 보기에서만 남긴다`);
  if (by === 'user' && !USER_STATES.includes(status)) throw new Error(`사용자 기록은 ${USER_STATES.join(', ')}만 가능하다`);
  const out = extractSpecs(scanRoot);
  const sc = pick(out, name);
  const files = sc.files.map((f) => path.join(scanRoot, f));
  const store = load(scanRoot);
  const prev = store.screens[sc.name] || { history: [] };
  const rec = { status, by, at: new Date().toISOString(), commit: sh('git rev-parse --short HEAD', scanRoot), dirty: !!sh('git status --porcelain', scanRoot), hash: hashOf(files), note };
  store.screens[sc.name] = { ...rec, checks: status === 'test-requested' ? {} : (prev.checks || {}), history: [...(prev.history || []), { status, by, at: rec.at, commit: rec.commit, note }] };
  save(scanRoot, store);
  return screenStatus(scanRoot, sc);
}

// 확인 목록(@does) 체크 상태. 사용자가 설계서 보기에서 남긴다
export function setCheck(scanRoot, name, index, done) {
  const out = extractSpecs(scanRoot);
  const sc = pick(out, name);
  const store = load(scanRoot);
  const prev = store.screens[sc.name] || { status: 'dev', history: [] };
  store.screens[sc.name] = { ...prev, checks: { ...(prev.checks || {}), [index]: !!done } };
  save(scanRoot, store);
  return screenStatus(scanRoot, sc);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pos = [], opts = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[++i]; else pos.push(argv[i]); }
  const [cmd, a] = pos;
  const scanRoot = path.resolve(opts.src || 'src');
  try {
    if (cmd === 'set') {
      const r = setStatus(scanRoot, opts.screen, a, { by: 'agent', note: opts.note || '' });
      console.log(`${r.screen}: ${r.label} (기록: .spec/status.json, 커밋 ${r.commit})`);
    } else if (cmd === 'list') {
      for (const r of Object.values(allStatus(scanRoot))) console.log(`${r.screen}: ${r.label}${r.note ? ` — ${r.note}` : ''}`);
    } else { console.log('사용: node status.mjs set <dev|test-requested> --src <소스 폴더> [--screen <이름>] [--note 한 줄]\n      node status.mjs list --src <소스 폴더>\n(approved·needs-fix는 설계서 보기에서 사용자만 남긴다)'); process.exit(1); }
  } catch (e) { console.error(`오류: ${e.message}`); process.exit(1); }
}
