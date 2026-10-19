/**
 * @spec requests 변경 요청 저장
 * @why 현재를 바꾸는 모든 일을 "요청" 하나의 흐름(설계 → 구현 → 테스트 → 완료)으로 모아, 언제 왜 어떻게 바뀌었는지 한곳에서 따라가게 한다. 요청 하나가 파일 하나(.spec/requests/<번호>.json)라서 여러 PC에서 git으로 나눠 써도 서로 다른 요청은 부딪치지 않는다.
 * @basis 모든 변경이 같은 요청 흐름을 거친다 (사용자 결정)
 * @contract 요청 파일의 모양(id, stage, step, scope, events)을 바꾸면 model.mjs의 요청 목록과 viewer/manage.js의 관리 화면도 함께 고친다. 에이전트는 이 모듈의 명령(add, list)으로만 요청을 만든다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { specDir } from './status.mjs';

// 화면에 보이는 단계 이름. 사람이 읽는 말이라 여기서만 정한다
export const STAGE_LABEL = { design: '설계', impl: '구현', test: '테스트', done: '완료', cancelled: '취소' };
// 단계 안의 상태와 이름. 누가 움직일 차례인지도 함께 둬서, 목록이 "내 차례"와 "에이전트 차례"를 나누는 근거가 된다.
// turn은 지금 누구 차례인지(user = 사용자가 승인·확인할 차례, agent = 에이전트가 할 차례)
export const STEP = {
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

// 요청 파일이 모이는 폴더와 요청 하나의 파일 위치
const dir = (scanRoot) => path.join(specDir(scanRoot), 'requests');
const fileOf = (scanRoot, id) => path.join(dir(scanRoot), `${id}.json`);

// 저장된 요청을 번호 순으로 읽는다. 깨진 파일은 목록 전체를 막지 않도록 건너뛴다
export function loadRequests(scanRoot) {
  let names = [];
  try { names = fs.readdirSync(dir(scanRoot)).filter((n) => /^\d+\.json$/.test(n)); } catch { return []; }
  const list = [];
  for (const n of names) { try { list.push(JSON.parse(fs.readFileSync(path.join(dir(scanRoot), n), 'utf8'))); } catch { /* 깨진 파일은 건너뜀 */ } }
  return list.sort((a, b) => a.id - b.id);
}
// 요청 하나를 자기 파일에 쓴다
const save = (scanRoot, req) => { fs.mkdirSync(dir(scanRoot), { recursive: true }); fs.writeFileSync(fileOf(scanRoot, req.id), JSON.stringify(req, null, 2) + '\n'); };

// 에이전트가 요청을 만든다. origin = 사용자가 한 말 그대로, channel = 어디로 들어왔나(대화 등), source = user | report(에이전트가 올린 리포트에서 등록)
export function addRequest(scanRoot, { title, origin = '', channel = '대화', screens = [], infos = [], agent = '', source = 'user' }) {
  if (!title?.trim()) throw new Error('요청 제목이 비었다');
  if (!['user', 'report'].includes(source)) throw new Error('출처는 user(사용자 요청)나 report(에이전트가 올린 리포트)만 가능하다');
  const id = loadRequests(scanRoot).reduce((m, r) => Math.max(m, r.id), 0) + 1;
  const now = new Date().toISOString();
  const req = {
    id, title: title.trim(), source, origin: { text: String(origin).trim(), channel, at: now },
    scope: { screens, infos }, agent: { name: agent },
    stage: 'design', step: 'drafting',
    events: [{ at: now, by: 'agent', kind: 'created', note: '요청 등록' }],
  };
  save(scanRoot, req);
  return req;
}

// 화면 쪽에 보여 줄 모양: 라벨, 누구 차례, 겹치는 요청
export function describeRequests(list) {
  const active = (r) => !['done', 'cancelled'].includes(r.stage);
  return list.map((r) => {
    const meta = STEP[`${r.stage}:${r.step}`] || { label: r.step, turn: null };
    const overlaps = !active(r) ? [] : list.filter((o) => o.id !== r.id && active(o)).map((o) => ({
      id: o.id, title: o.title,
      screens: o.scope.screens.filter((s) => r.scope.screens.includes(s)),
      infos: o.scope.infos.filter((i) => r.scope.infos.includes(i)),
    })).filter((o) => o.screens.length || o.infos.length);
    return { ...r, stageLabel: STAGE_LABEL[r.stage], stepLabel: meta.label, turn: meta.turn, overlaps };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pos = [], opts = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[++i]; else pos.push(argv[i]); }
  const scanRoot = path.resolve(opts.src || 'src');
  const csv = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
  try {
    if (pos[0] === 'add') { const r = addRequest(scanRoot, { title: opts.title, origin: opts.origin, channel: opts.channel, screens: csv(opts.screens), infos: csv(opts.infos), agent: opts.agent, source: opts.source }); console.log(`요청 #${r.id}: 등록 (설계서 보기 "관리"에서 보인다)`); }
    else if (pos[0] === 'list') { for (const r of describeRequests(loadRequests(scanRoot))) console.log(`#${r.id} [${r.stageLabel} · ${r.stepLabel}] ${r.title}`); }
    else { console.log('사용: node request.mjs add --title "…" [--origin "사용자가 한 말"] [--channel 대화] [--screens 화면1,화면2] [--infos 정보1] [--agent 세션이름] --src <소스 폴더>\n      node request.mjs list --src <소스 폴더>'); process.exit(1); }
  } catch (e) { console.error(`오류: ${e.message}`); process.exit(1); }
}
