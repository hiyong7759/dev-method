/**
 * @why 요청의 진행(설계 → 구현 → 테스트 → 완료)과 "승인은 사용자만"이라는 약속이 고치다가 깨지지 않게 지킨다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelRequest, parseBrief, redesign, checkTest, addRequest, startDesign, submitDesign, approveDesign, rejectDesign, noteImpl, requestTest, approveTest, testProblem, setOrder, setScope, loadRequests, describeRequests } from '../src/request.js';
import { tempProject } from './helpers.js';
import fs from 'node:fs';
import path from 'node:path';
import { liveShotFile } from '../src/request.js';

const design = { understanding: '이해', approach: '방법', files: [{ path: 'a.ts', why: '시험' }] };

test('핵심 요약은 없으면 올릴 수 없고, 올리면 설계·테스트에 그대로 저장된다', () => {
  assert.throws(() => parseBrief(undefined, '설계'), /핵심 요약/);
  assert.throws(() => parseBrief(' | ', '테스트'), /핵심 요약/);
  assert.throws(() => parseBrief(['1', '2', '3', '4', '5'], '설계'), /4줄까지/);
  assert.deepEqual(parseBrief('줄1| 줄2 ', '테스트'), ['줄1', '줄2']);
  const { src } = tempProject();
  addRequest(src, { title: '요약 요청' });
  submitDesign(src, 1, { ...design, brief: ['정할 것'] }); approveDesign(src, 1);
  assert.deepEqual(loadRequests(src)[0].design?.brief, ['정할 것']);
  requestTest(src, 1, ['눌러서 본다']);
  assert.deepEqual(loadRequests(src)[0].test?.brief, ['눌러서 본다']);
});

test('요청은 설계 → 구현 → 테스트 → 완료로 흐른다', () => {
  const { src } = tempProject();
  const r = addRequest(src, { title: '첫 요청' });
  assert.equal(r.id, 1);
  assert.deepEqual([r.stage, r.step], ['design', 'queued']);
  assert.equal(describeRequests([r])[0].stepLabel, '접수');
  assert.equal(startDesign(src, 1).step, 'drafting');
  assert.throws(() => startDesign(src, 1), /시작 전이 아니다/);
  submitDesign(src, 1, design);
  assert.equal(loadRequests(src)[0].step, 'submitted');
  approveDesign(src, 1);
  assert.deepEqual([loadRequests(src)[0].stage, loadRequests(src)[0].step], ['impl', 'working']);
  noteImpl(src, 1, 'abc1234');
  assert.deepEqual(loadRequests(src)[0].commits, ['abc1234']);
  requestTest(src, 1);
  assert.equal(loadRequests(src)[0].step, 'requested');
  approveTest(src, 1, true);
  assert.deepEqual([loadRequests(src)[0].stage, loadRequests(src)[0].step], ['done', 'done']);
});

test('승인 대기가 아닐 때의 승인·반려는 거절한다', () => {
  const { src } = tempProject();
  addRequest(src, { title: 'a' });
  assert.throws(() => approveDesign(src, 1), /승인 대기/);
  assert.throws(() => approveTest(src, 1, false), /승인 대기/);
  assert.throws(() => noteImpl(src, 1, ''), /설계 승인이 먼저/);
  assert.throws(() => requestTest(src, 1), /테스트를 올릴 수 있는 단계가 아니다/);
});

test('반려는 이유가 있어야 하고, 설계가 다시 작성 중이 된다', () => {
  const { src } = tempProject();
  addRequest(src, { title: 'a' });
  submitDesign(src, 1, design);
  assert.throws(() => rejectDesign(src, 1, '  '), /이유/);
  rejectDesign(src, 1, '화면이 다르다');
  const r = loadRequests(src)[0];
  assert.deepEqual([r.stage, r.step, r.design?.rejected], ['design', 'revise', 1]);
  submitDesign(src, 1, design);
  assert.equal(loadRequests(src)[0].design?.rejected, 1, '다시 올려도 반려 횟수는 유지된다');
});

test('설계에는 이해한 내용이 있어야 하지만 설계 없음은 비어도 된다', () => {
  const { src } = tempProject();
  addRequest(src, { title: 'a' });
  assert.throws(() => submitDesign(src, 1, { files: [{ path: 'a.ts', why: '시험' }], approach: 'x' }), /understanding/);
  submitDesign(src, 1, { files: [{ path: 'a.ts', why: '시험' }], none: true });
  assert.equal(loadRequests(src)[0].design?.none, true);
});

test('테스트에서 문제가 있으면 같은 요청에서 고치는 중이 되고 다시 올릴 수 있다', () => {
  const { src } = tempProject();
  addRequest(src, { title: 'a' });
  submitDesign(src, 1, { files: [{ path: 'a.ts', why: '시험' }], none: true }); approveDesign(src, 1); requestTest(src, 1);
  assert.throws(() => testProblem(src, 1, ''), /한 줄/);
  testProblem(src, 1, '버튼이 안 눌린다');
  assert.deepEqual([loadRequests(src)[0].stage, loadRequests(src)[0].step], ['test', 'fix']);
  requestTest(src, 1);
  assert.equal(loadRequests(src)[0].step, 'requested');
});

test('겹치는 요청은 순서를 정하면 뒤 요청이 앞 요청이 끝나기를 기다린다', () => {
  const { src } = tempProject();
  addRequest(src, { title: 'a', screens: ['S'] });
  addRequest(src, { title: 'b', screens: ['S'] });
  const before = describeRequests(loadRequests(src));
  assert.equal(before[0].overlaps.length, 1);
  setOrder(src, 1, 2);
  submitDesign(src, 2, { files: [{ path: 'a.ts', why: '시험' }], none: true }); approveDesign(src, 2);
  const after = describeRequests(loadRequests(src));
  assert.deepEqual(after[1].waitingFor, [1]);
  assert.equal(after[1].stepLabel, '대기');
});

test('요청 번호는 이어서 붙고, 제목이 비면 거절한다', () => {
  const { src } = tempProject();
  assert.throws(() => addRequest(src, { title: ' ' }), /제목/);
  assert.equal(addRequest(src, { title: 'a' }).id, 1);
  assert.equal(addRequest(src, { title: 'b' }).id, 2);
});

/** 그림 대신 쓰는 아주 작은 파일 */
const png = (dir: string, name: string): string => { const f = path.join(dir, name); fs.writeFileSync(f, 'x'); return f; };

test('설계 화면의 현행 그림: 신규 화면은 없어도 되고, 손으로 올리면 경고 출처, 도구가 찍은 것은 도구 출처', () => {
  const { root, src } = tempProject();
  addRequest(src, { title: 'a' });
  const after = png(root, 'after.png');
  // 이미 있는 화면인데 현행 그림이 없으면 올릴 수 없다
  assert.throws(() => submitDesign(src, 1, { ...design, screens: [{ screen: '목록', after }] }), /현행 그림이 없다.*request shot/);
  // 신규 화면은 현행 없이 올린다
  let r = submitDesign(src, 1, { ...design, screens: [{ screen: '새 화면', after, isNew: true }] });
  assert.deepEqual([r.design!.screens[0].before, r.design!.screens[0].isNew, r.design!.screens[0].beforeSource], ['', true, undefined]);
  // 손으로 올린 현행 그림은 manual로 남는다
  r = submitDesign(src, 1, { ...design, screens: [{ screen: '목록', after, before: png(root, 'before.png') }] });
  assert.equal(r.design!.screens[0].beforeSource, 'manual');
  // 도구가 찍어 둔 현행 그림이 있으면 tool 출처와 시각이 붙는다
  const live = liveShotFile(src, 1, '목록');
  fs.mkdirSync(path.dirname(live), { recursive: true }); fs.writeFileSync(live, 'x'); fs.writeFileSync(live.replace(/\.png$/, '.json'), JSON.stringify({ capturedAt: '2026-10-24T09:00:00.000Z' }));
  r = submitDesign(src, 1, { ...design, screens: [{ screen: '목록', after, highlights: [{ l: 1, t: 2, w: 3, h: 4, label: '바뀐 곳' }] }] });
  assert.deepEqual([r.design!.screens[0].beforeSource, r.design!.screens[0].capturedAt, r.design!.screens[0].highlights?.[0].label], ['tool', '2026-10-24T09:00:00.000Z', '바뀐 곳']);
});

test('설계 글은 영역별 항목(points)으로 올릴 수 있다', () => {
  const { src } = tempProject();
  addRequest(src, { title: 'a' });
  const r = submitDesign(src, 1, { files: [{ path: 'a.ts', why: '시험' }], understanding: '요약', points: [{ area: '서버', title: '세션', text: '만든다' }] });
  assert.deepEqual(r.design!.points, [{ area: '서버', title: '세션', text: '만든다' }]);
});

test('합칠 후보를 찾고, 인용이 있을 때만 접수·설계 작성 중인 요청끼리 합친다', async () => {
  const { similarRequests, mergeRequests } = await import('../src/request.js');
  const { src } = tempProject();
  addRequest(src, { title: '목록 색', screens: ['목록'] });
  addRequest(src, { title: '작은 일 하나' });
  addRequest(src, { title: '작은 일 둘' });
  // 같은 화면을 건드리는 새 요구와, 범위 없는 작은 일끼리가 후보가 된다
  assert.deepEqual(similarRequests(src, { screens: ['목록'] }).map((c) => c.id), [1]);
  assert.deepEqual(similarRequests(src, {}).map((c) => c.id), [2, 3]);
  assert.throws(() => mergeRequests(src, 2, { text: '새 요구' }), /--quote/);
  const r = mergeRequests(src, 2, { text: '새 요구', quote: '이거 합쳐서 처리하자' });
  assert.match(r.origin.text, /\(2\).*새 요구/);
  assert.equal(r.mergedFrom?.length, 1);
  // 이미 접수된 두 요청 합치기: 없어지는 쪽은 합침으로 닫히고 범위가 합쳐진다
  const m = mergeRequests(src, 2, { from: 3, quote: '둘을 하나로 합치자' });
  assert.match(m.title, /작은 일 둘/);
  const closed = loadRequests(src).find((x) => x.id === 3)!;
  assert.equal(closed.mergedInto, 2);
  assert.equal(describeRequests([closed])[0].stepLabel, '#2에 합침');
  // 설계가 올라간 요청에는 합칠 수 없다
  startDesign(src, 1); submitDesign(src, 1, design);
  assert.throws(() => mergeRequests(src, 1, { text: 'x', quote: '이거 합쳐서 처리하자' }), /합칠 수 없다/);
  assert.equal(addRequest(src, { title: '이어짐', relatedTo: 1 }).relatedTo, 1);
});

test('화면이 있는 요청은 시나리오가 있어야 테스트를 올리고, 없음 승인도 못 한다', () => {
  const { src } = tempProject();
  addRequest(src, { title: '화면 요청', screens: ['요청 상세'] });
  startDesign(src, 1); submitDesign(src, 1, design); approveDesign(src, 1);
  assert.throws(() => requestTest(src, 1), /시나리오가 없어 테스트를 올릴 수 없다/);
  setScope(src, 1, { scenarios: ['시나리오 하나'] });
  requestTest(src, 1);
  assert.throws(() => approveTest(src, 1, true), /테스트 없음/);
  approveTest(src, 1, false);
});

test('화면이 없는 요청은 등록할 때 적은 테스트 없음 이유가 요청에 남는다', () => {
  const { src } = tempProject();
  assert.equal(addRequest(src, { title: '글자 고침', noTest: '화면이 안 바뀌는 문구 수정' }).noTest, '화면이 안 바뀌는 문구 수정');
  startDesign(src, 1); submitDesign(src, 1, { files: [{ path: 'a.ts', why: '시험' }], none: true }); approveDesign(src, 1); requestTest(src, 1);
  approveTest(src, 1, true);
});

test('바로 작업: 접수 없이 설계 없음 승인으로 구현 단계가 되고, 화면·정보가 있으면 등록되지 않는다', () => {
  const { src } = tempProject();
  assert.throws(() => addRequest(src, { title: '수리', detail: '단추가 안 눌림', mode: 'direct', reason: '고장 수리', screens: ['요청 상세'] }), /화면·정보가 바뀌지 않는 고장 수리만/);
  assert.throws(() => addRequest(src, { title: '수리', mode: 'direct', reason: '고장 수리' }), /상세 내용/);
  const r = addRequest(src, { title: '수리', detail: '단추가 안 눌림', mode: 'direct', reason: '고장 수리' });
  assert.deepEqual([r.stage, r.step, r.design?.none], ['impl', 'working', true]);
  assert.equal(r.events.at(-1)?.kind, 'design-approved');
  assert.equal(r.detail?.mode, 'direct');
});

test('테스트 올리기: finish가 실패했거나 기록이 없거나 그 뒤 소스가 바뀌면 거절한다', () => {
  const { root, src } = tempProject();
  addRequest(src, { title: '수리', detail: '단추가 안 눌림', mode: 'direct', reason: '고장 수리', noTest: '화면이 안 바뀜' });
  const f = path.join(root, '.spec', 'finish.json');
  fs.writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), ok: false }));
  assert.throws(() => requestTest(src, 1), /실패했다/);
  fs.rmSync(f);
  assert.throws(() => requestTest(src, 1), /기록이 없다/);
  fs.writeFileSync(f, JSON.stringify({ at: new Date(Date.now() - 60_000).toISOString(), ok: true }));
  fs.writeFileSync(path.join(src, 'a.ts'), 'x');
  assert.throws(() => requestTest(src, 1), /소스가 바뀌었다/);
});

test('대화로 한 반려·문제 알림은 사용자 말 인용이 기록에 남는다', () => {
  const { src } = tempProject();
  addRequest(src, { title: '수리', screens: ['a'] });
  startDesign(src, 1);
  submitDesign(src, 1, { files: [{ path: 'a.ts', why: '시험' }], none: true });
  const r = rejectDesign(src, 1, '다시 써라', '이건 반려할게요');
  const last = r.events[r.events.length - 1];
  assert.equal(last.kind, 'design-rejected');
  assert.equal(last.quote, '이건 반려할게요');
  assert.match(last.note, /대화에서 한 반려/);
});

test('설계 변경: 사용자는 변경사항만 적으면 되고, 에이전트는 사용자 말을 인용해야 하며, 이전 설계는 남는다', () => {
  const { src } = tempProject();
  addRequest(src, { title: '요청' });
  startDesign(src, 1); submitDesign(src, 1, { ...design, understanding: '처음 이해' }); approveDesign(src, 1); requestTest(src, 1);
  assert.throws(() => redesign(src, 1, 'user', ''), /변경사항을 적어야/);
  assert.throws(() => redesign(src, 1, 'agent', '제멋대로 바꿈'), /--quote/);
  assert.throws(() => redesign(src, 1, 'agent', '바꿈', '아'), /--quote/);
  const r = redesign(src, 1, 'user', '확인 기준을 바꾼다');
  assert.deepEqual([r.stage, r.step], ['design', 'revise']);
  assert.equal(r.events.at(-1)?.note, '설계 변경(테스트 중): 확인 기준을 바꾼다');
  assert.equal(r.designVersions?.length, 1);
  assert.equal(r.designVersions?.[0].design.understanding, '처음 이해');
  assert.ok(r.designVersions?.[0].approvedAt);
  assert.throws(() => redesign(src, 1, 'user', '또'), /설계 변경을 시작할 단계가 아니다/);
  // 새 설계가 승인된 뒤 구현·테스트 중에 에이전트가 사용자 요구를 인용해 다시 설계 변경을 시작할 수 있고, 인용은 기록에 남는다
  submitDesign(src, 1, { ...design, understanding: '바뀐 이해' }); approveDesign(src, 1);
  const r2 = redesign(src, 1, 'agent', '요구가 늘었다', '이것도 추가해줘');
  assert.equal(r2.events.at(-1)?.quote, '이것도 추가해줘');
  assert.deepEqual(r2.designVersions?.map((v) => v.design.understanding), ['처음 이해', '바뀐 이해']);
});

test('설계 변경 뒤 테스트를 다시 올리면 내용이 바뀐 단계의 체크만 풀린다', () => {
  const { src } = tempProject();
  const write = (second: string): void => fs.writeFileSync(path.join(src, 'a.ts'), `/**\n * @screen 화면A\n * @route /a\n * @does 첫째를 한다 | 첫째 결과 | 시나리오X#1\n * @does 둘째를 한다 | ${second} | 시나리오X#2\n */\nexport const a = 1;\n`);
  write('둘째 결과');
  addRequest(src, { title: '요청', screens: ['화면A'], scenarios: ['시나리오X'] });
  startDesign(src, 1); submitDesign(src, 1, design); approveDesign(src, 1); requestTest(src, 1);
  checkTest(src, 1, '시나리오X#1', true); checkTest(src, 1, '시나리오X#2', true);
  testProblem(src, 1, '문제');
  write('바뀐 결과'); requestTest(src, 1);
  const checks = loadRequests(src)[0].test?.checks ?? {};
  assert.equal(checks['시나리오X#1'], true);
  assert.equal(checks['시나리오X#2'], undefined);
});

test('취소는 사용자가 한 말과 이유가 있어야 하고, 끝나거나 취소된 요청은 다시 취소하지 못한다', () => {
  const { src } = tempProject();
  addRequest(src, { title: '시험용' });
  assert.throws(() => cancelRequest(src, 1, '시험용이라', ''), /--quote/);
  assert.throws(() => cancelRequest(src, 1, '', '지워'), /취소 이유/);
  const r = cancelRequest(src, 1, '시험용이라', '지워');
  assert.equal(r.stage, 'cancelled');
  assert.equal(r.events[r.events.length - 1].kind, 'cancelled');
  assert.equal(r.events[r.events.length - 1].quote, '지워');
  assert.throws(() => cancelRequest(src, 1, '또', '지워'), /이미 취소/);
  assert.equal(loadRequests(src).find((x) => x.id === 1)?.stage, 'cancelled', '요청 파일은 이력으로 남는다');
});
