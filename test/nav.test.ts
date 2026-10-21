/**
 * @why 코드의 화면 이동을 읽어 @to 선언과 맞추는 검사가, 주소 뒤에 ?질문=값이 붙어도 맞는 화면으로 연결하는지(엉뚱한 화면으로 잇거나 못 찾지 않는지) 지킨다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { detectNav } from '../src/nav.js';
import { tempTsProject } from './helpers.js';

const screen = (name: string, route: string, to = ''): string => `/**\n * @screen ${name}\n * @route ${route}\n * @why 시험용\n${to ? ` * @to ${to}\n` : ''} */\n`;

test('주소 뒤의 ?질문=값을 떼고 화면을 맞춘다(/board/write?x=1 은 /board/:id 가 아니라 /board/write)', () => {
  const { root, src } = tempTsProject();
  fs.writeFileSync(path.join(src, 'list.tsx'), screen('목록', '/board', '글쓰기 | 쓰기 단추를 누른다') + `export const List = (nav: (p: string) => void): void => nav('/x');\nexport const go = (navigate: (p: string) => void): void => navigate("/board/write?bbs=1");\n`);
  fs.writeFileSync(path.join(src, 'write.tsx'), screen('글쓰기', '/board/write'));
  fs.writeFileSync(path.join(src, 'detail.tsx'), screen('상세', '/board/:id'));
  const r = detectNav(src, root);
  assert.deepEqual(r.edges.map((e) => `${e.from}→${e.to}`), ['목록→글쓰기']);
  assert.deepEqual(r.warnings, []);
});

test('선언은 했는데 코드에서 이동을 못 찾으면 경고한다', () => {
  const { root, src } = tempTsProject();
  fs.writeFileSync(path.join(src, 'a.tsx'), screen('가', '/a', '나 | 누른다') + 'export const a = 1;\n');
  fs.writeFileSync(path.join(src, 'b.tsx'), screen('나', '/b'));
  assert.match(detectNav(src, root).warnings.join('\n'), /가의 @to 나: 코드에서 이동을 찾지 못했다/);
});

test('여러 화면이 함께 쓰는 파일의 이동은 한 번만 경고하고, 그중 한 화면이라도 선언하면 맞는 것으로 본다', () => {
  const { root, src } = tempTsProject();
  fs.writeFileSync(path.join(src, 'shared.tsx'), `export const go = (navigate: (p: string) => void): void => navigate("/request");\n`);
  for (const [name, route] of [['가', '/a'], ['나', '/b'], ['다', '/c']]) {
    fs.writeFileSync(path.join(src, `${name}.tsx`), screen(name, route) + `import { go } from './shared';\nexport const ${name === '가' ? 'a' : name === '나' ? 'b' : 'c'} = go;\n`);
  }
  fs.writeFileSync(path.join(src, 'request.tsx'), screen('신청', '/request'));
  const first = detectNav(src, root).warnings;
  assert.equal(first.length, 1, '화면 셋이어도 경고는 한 번');
  assert.match(first[0], /가·나·다 → 신청/);
  // 가 화면이 선언하면 묶음이 맞는 것으로 되고 경고가 사라진다
  fs.writeFileSync(path.join(src, '가.tsx'), screen('가', '/a', '신청 | 신청 단추를 누른다') + `import { go } from './shared';\nexport const a = go;\n`);
  assert.deepEqual(detectNav(src, root).warnings, []);
});

test('삼항식의 두 갈래와 location 대입·assign 이동도 읽는다', () => {
  const { root, src } = tempTsProject();
  fs.writeFileSync(path.join(src, 'a.tsx'), screen('가', '/a', '나 | 단추\n * @to 다 | 단추\n * @to 라 | 단추') + `export const a = (navigate: (p: string) => void, ok: boolean): void => { navigate(ok ? '/b?x=1' : '/c'); window.location.href = '/d'; };\n`);
  fs.writeFileSync(path.join(src, 'b.tsx'), screen('나', '/b'));
  fs.writeFileSync(path.join(src, 'c.tsx'), screen('다', '/c'));
  fs.writeFileSync(path.join(src, 'd.tsx'), screen('라', '/d'));
  const r = detectNav(src, root);
  assert.deepEqual(r.edges.map((e) => `${e.from}→${e.to}`).sort(), ['가→나', '가→다', '가→라']);
  assert.deepEqual(r.warnings, []);
});
