/**
 * @why 기존 프로젝트를 들일 때 경고 수백 개가 모든 커밋을 막지 않도록 한 "기준선" 방식이, 새 경고는 막고 기준선 안의 경고는 봐 주는지(줄 번호가 밀려도) 지킨다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { main, warningKey } from '../src/precommit.js';
import { tempTsProject } from './helpers.js';

/** 검사를 돌리되 출력은 잡아서 { 종료 코드, 출력 }으로 돌려준다 */
async function run(root: string, ...args: string[]): Promise<{ code: number | undefined; out: string }> {
  const lines: string[] = [];
  const log = console.log, err = console.error;
  console.log = (...a: unknown[]) => { lines.push(a.join(' ')); }; console.error = console.log;
  try { return { code: await main([root, ...args]), out: lines.join('\n') }; } finally { console.log = log; console.error = err; }
}
/** 필드에 존재 이유가 없는 정보 하나(경고가 생긴다) */
const SCREEN = '/**\n * @screen 첫 화면\n * @route /\n * @why 시험용 화면\n */\nexport const Page = (): string => \'\';\n';
const types = (fields: string[]): string => `/** 정보 */\nexport interface Info {\n${fields.map((f) => `  ${f}: string;`).join('\n')}\n}\nexport const use = (i: Info): string => ${fields.map((f) => `i.${f}`).join(' + ') || "''"};\n`;

test('줄 번호만 뺀 글로 경고를 센다', () => {
  assert.equal(warningKey('경고: Info.a에 존재 이유가 없다 (src/t.ts:12)'), '경고: Info.a에 존재 이유가 없다 (src/t.ts)');
  assert.equal(warningKey('경고: 정보를 하나도 읽지 못했다'), '경고: 정보를 하나도 읽지 못했다');
});

test('기준선이 없으면 경고가 하나라도 있을 때 막는다', async () => {
  const { root, src } = tempTsProject();
  fs.writeFileSync(path.join(src, 'page.ts'), SCREEN); fs.writeFileSync(path.join(src, 't.ts'), types(['a']));
  const r = await run(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /--baseline/, '기준선으로 저장하는 길을 안내한다');
});

test('기준선을 저장하면 그 경고는 통과하고, 늘어난 경고는 막는다', async () => {
  const { root, src } = tempTsProject();
  fs.writeFileSync(path.join(src, 'page.ts'), SCREEN); fs.writeFileSync(path.join(src, 't.ts'), types(['a']));
  assert.equal((await run(root, '--baseline')).code, 0);
  assert.ok(fs.existsSync(path.join(root, '.spec', 'baseline.json')));
  const same = await run(root);
  assert.equal(same.code, 0); assert.match(same.out, /기준선에 있는 경고 1건/);
  fs.writeFileSync(path.join(src, 'page.ts'), SCREEN); fs.writeFileSync(path.join(src, 't.ts'), types(['a', 'b']));
  const more = await run(root);
  assert.equal(more.code, 1); assert.match(more.out, /Info\.b/); assert.doesNotMatch(more.out, /Info\.a에/);
});

test('코드가 밀려 줄 번호가 바뀌어도 같은 경고로 본다', async () => {
  const { root, src } = tempTsProject();
  fs.writeFileSync(path.join(src, 'page.ts'), SCREEN); fs.writeFileSync(path.join(src, 't.ts'), types(['a']));
  await run(root, '--baseline');
  fs.writeFileSync(path.join(src, 'page.ts'), SCREEN); fs.writeFileSync(path.join(src, 't.ts'), '// 위에 줄이 늘었다\n// 하나 더\n' + types(['a']));
  assert.equal((await run(root)).code, 0);
});

test('경고가 없는 프로젝트는 기준선 없이 통과한다', async () => {
  const { root, src } = tempTsProject();
  fs.writeFileSync(path.join(src, 'page.ts'), SCREEN);
  fs.writeFileSync(path.join(src, 't.ts'), '/** 정보 */\nexport interface Info {\n  /** 이름 */\n  a: string;\n}\nexport const use = (i: Info): string => i.a;\n');
  assert.equal((await run(root)).code, 0);
});
