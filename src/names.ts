/**
 * @spec names 정보·필드의 언어별 이름 읽기
 * @why 정보 흐름이 영어 이름 중심이라 읽기 어렵다. 한국어 이름을 앞에 두고 영어를 괄호에 붙여 보이려면 언어별 이름을 어딘가 두어야 한다.
 * @basis 이름은 에이전트가 채우고(원문 설명이 출발점) 사용자가 이상한 곳만 고친다. 사용자 언어가 늘면 같은 파일에 언어 코드만 더한다.
 * @contract 파일 모양은 { "ko": { infos: {...}, props: {...} } }이다(.spec/names.json). 없거나 깨졌으면 빈 값이다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { specDir } from './project.js';
import type { InfoNames } from './types.js';

/** 언어별 이름을 읽는다. 없거나 깨졌으면 빈 값 */
export function loadNames(scanRoot: string): Record<string, InfoNames> {
  try { return JSON.parse(fs.readFileSync(path.join(specDir(scanRoot), 'names.json'), 'utf8')) as Record<string, InfoNames>; } catch { return {}; }
}
