/**
 * @spec glossary 우리가 만든 용어를 모아 두는 용어집 저장
 * @why 이 도구와 일하는 방식에서 우리가 만든 말(설계 승인, 겹침 등)만 모아, 화면에서 점선이 그어진 말에 마우스를 올리면 같은 설명이 나오게 한다. 일반 개발 용어는 넣지 않는다.
 * @basis 용어는 에이전트가 테스트 요청 때와 주기 점검 때 관리한다(glossary add). 사람은 보기만 한다.
 * @contract 파일 모양은 GlossaryTerm[]이다(.spec/glossary.json). 화면(viewer/terms.ts)이 이 목록으로 글 속 용어를 찾아 표시한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { specDir } from './status.js';
import { parseArgs, csv, errorText } from './cli.js';
import type { GlossaryTerm } from './types.js';

const fileOf = (scanRoot: string): string => path.join(specDir(scanRoot), 'glossary.json');

/** 용어집을 읽는다. 없거나 깨졌으면 빈 목록 */
export function loadGlossary(scanRoot: string): GlossaryTerm[] {
  try { return JSON.parse(fs.readFileSync(fileOf(scanRoot), 'utf8')) as GlossaryTerm[]; } catch { return []; }
}

/** 용어를 더하거나(같은 이름이면 설명을 바꾼다) 한다 */
export function setTerm(scanRoot: string, t: GlossaryTerm): GlossaryTerm {
  if (!t.term?.trim() || !t.meaning?.trim()) throw new Error('용어와 설명이 모두 있어야 한다');
  const list = loadGlossary(scanRoot).filter((x) => x.term !== t.term.trim());
  const rec = { term: t.term.trim(), meaning: t.meaning.trim(), uses: t.uses ?? [] };
  list.push(rec);
  fs.mkdirSync(path.dirname(fileOf(scanRoot)), { recursive: true });
  fs.writeFileSync(fileOf(scanRoot), JSON.stringify(list, null, 2) + '\n');
  return rec;
}

/** 명령: glossary add / list */
export async function main(argv: string[]): Promise<number | undefined> {
  const { pos, opts } = parseArgs(argv);
  const scanRoot = path.resolve(opts.src || 'src');
  try {
    if (pos[0] === 'add') { const t = setTerm(scanRoot, { term: opts.term, meaning: opts.meaning, uses: csv(opts.uses) }); console.log(`용어 "${t.term}" 저장`); }
    else if (pos[0] === 'list') { for (const t of loadGlossary(scanRoot)) console.log(`${t.term} — ${t.meaning}`); }
    else { console.log('사용: node <스킬 폴더>/spec.mjs glossary add --term "설계 승인" --meaning "쉬운 설명" [--uses 요청 상세,설계 단계] --src <소스 폴더>\n      node <스킬 폴더>/spec.mjs glossary list --src <소스 폴더>'); return 1; }
  } catch (e) { console.error(`오류: ${errorText(e)}`); return 1; }
  return undefined;
}
