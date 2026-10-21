/**
 * @why 필드를 쓰는 곳을 잘못 읽으면(읽기를 쓰기로 세는 등) 멀쩡한 필드가 "쓰는 곳 없음"으로 올라와 사용자의 확인 필요가 늘어난다. 자주 나오는 코드 모양마다 읽기·쓰기가 맞게 세어지는지 지킨다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { analyzeTs } from '../src/analyze-ts.js';
import { tempProject } from './helpers.js';

/** 임시 프로젝트에 소스 파일들을 쓰고 분석해 "정보.필드 → 상태"를 돌려준다 */
function statusOf(files: Record<string, string>): Record<string, string> {
  const { root, src } = tempProject();
  fs.symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'es2022', module: 'esnext', moduleResolution: 'bundler', noEmit: true }, include: ['src'] }));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(src, name), text);
  const out: Record<string, string> = {};
  for (const i of analyzeTs(root).infos) for (const p of i.props) out[`${i.name}.${p.name}`] = p.status;
  return out;
}

const TYPES = `
/** 가로세로 */ export interface Opts { /** 가로 */ w: number; /** 세로 */ h: number }
/** 한 줄 */ export interface Row { /** 이름 */ label: string; /** 색 */ tone: string }
/** 안 쓰는 것 */ export interface Dead { /** 안 씀 */ unused: string; /** 씀 */ used: string }
/** 동물 */ export interface Cat { /** 종류 */ kind: 'cat'; /** 소리 */ meow: string }
/** 동물 */ export interface Dog { /** 종류 */ kind: 'dog'; /** 소리 */ bark: string }
/** 한 마리 */ export type Pet = Cat | Dog;
`;

test('함수 인자 구조 분해로 꺼내 쓴 필드는 읽은 것이다', () => {
  const s = statusOf({ 'types.ts': TYPES, 'use.ts': `import type { Opts } from './types'; export const size = ({ w, h }: Opts): number => w * h; export const mk = (): Opts => ({ w: 1, h: 2 });` });
  assert.equal(s['Opts.w'], 'rw'); assert.equal(s['Opts.h'], 'rw');
});

test('const { a } = 값 으로 꺼내 쓴 필드는 읽은 것이다', () => {
  const s = statusOf({ 'types.ts': TYPES, 'use.ts': `import type { Row } from './types'; export const f = (r: Row): string => { const { label, tone } = r; return label + tone; }; export const mk = (): Row => ({ label: 'a', tone: 'b' });` });
  assert.equal(s['Row.label'], 'rw'); assert.equal(s['Row.tone'], 'rw');
});

test('합집합 타입은 좁혀 읽은 쪽 필드를 읽은 것으로 센다', () => {
  const s = statusOf({ 'types.ts': TYPES, 'use.ts': `import type { Pet } from './types'; export const say = (p: Pet): string => (p.kind === 'cat' ? p.meow : p.bark); export const mk = (): Pet[] => [{ kind: 'cat', meow: 'm' }, { kind: 'dog', bark: 'b' }];` });
  assert.equal(s['Cat.meow'], 'rw'); assert.equal(s['Dog.bark'], 'rw');
});

test('정말 어디에서도 안 쓰는 필드는 none이고, 읽기만·쓰기만도 구분한다', () => {
  const s = statusOf({ 'types.ts': TYPES, 'use.ts': `import type { Dead, Row } from './types'; export const d = (x: Dead): string => x.used; export const w = (): Row => ({ label: 'a', tone: 'b' });` });
  assert.equal(s['Dead.unused'], 'none');
  assert.equal(s['Dead.used'], 'read-only');
  assert.equal(s['Row.label'], 'write-only');
});
