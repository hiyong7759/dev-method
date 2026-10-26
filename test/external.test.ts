/**
 * @why 코드 밖(다른 도구)이 읽는 필드를 `@external`로 선언하는 약속이 깨지면, 멀쩡한 필드가 "쓰지 않는 필드"로 의심받거나 낡은 선언이 남는다. 선언이 인식되는 경계(빈 설명·이미 쓰는 필드·줄 중간 언급)를 지킨다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { analyzeTs, main } from '../src/analyze-ts.js';
import { tempProject } from './helpers.js';

/** 소스 파일들을 쓴 임시 프로젝트를 분석하고 analyze-ts --check를 돌려 (종료 코드, 출력 줄들, 필드별 선언 설명)을 돌려준다 */
async function checkOf(files: Record<string, string>): Promise<{ code: number | undefined; lines: string[]; external: Record<string, string> }> {
  const { root, src } = tempProject();
  fs.symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'es2022', module: 'esnext', moduleResolution: 'bundler', noEmit: true }, include: ['src'] }));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(src, name), text);
  const external: Record<string, string> = {};
  for (const i of analyzeTs(root).infos) for (const p of i.props) external[`${i.name}.${p.name}`] = p.external;
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]): void => { lines.push(a.join(' ')); };
  let code: number | undefined;
  try { code = await main([root, '--check']); } finally { console.log = orig; }
  return { code, lines, external };
}

const conf = (doc: string): string => `/** 설정 */ export interface Conf {\n  /** ${doc} */\n  v: string;\n}`;

test('@external을 단 필드는 바깥이 읽는 것으로 잡히고 경고가 없다', async () => {
  const r = await checkOf({ 'types.ts': conf('바깥 값\n   * @external 배포 도구가 읽는다') });
  assert.equal(r.external['Conf.v'], '배포 도구가 읽는다');
  assert.equal(r.code, 0);
});

test('설명이 빈 @external은 경고가 난다', async () => {
  const r = await checkOf({ 'types.ts': conf('바깥 값\n   * @external') });
  assert.equal(r.external['Conf.v'], '(설명 없음)');
  assert.equal(r.code, 1);
  assert.ok(r.lines.some((l) => l.includes('Conf.v') && l.includes('설명이 없다')));
});

test('이미 코드가 쓰는 필드의 @external은 낡은 선언이라 경고가 난다', async () => {
  const r = await checkOf({
    'types.ts': conf('값\n   * @external 누군가 읽는다'),
    'use.ts': `import type { Conf } from './types'; export const get = (c: Conf): string => c.v; export const mk = (): Conf => ({ v: 'a' });`,
  });
  assert.equal(r.code, 1);
  assert.ok(r.lines.some((l) => l.includes('Conf.v') && l.includes('이미 쓰고 있어')));
});

test('줄 맨 앞이 아닌 @external 언급은 선언으로 치지 않는다', async () => {
  const r = await checkOf({ 'types.ts': conf('값. 문서에서 @external 이라는 말을 설명할 때만 쓴다') });
  assert.equal(r.external['Conf.v'], '');
});
