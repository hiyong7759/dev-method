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
