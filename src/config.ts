/**
 * @spec project-config 프로젝트 설정 읽기
 * @why 소스 폴더, 앱 주소, 포트 같은 프로젝트마다 다른 값을 명령마다 따로 읽지 않고 한 곳에서 같은 방식으로 읽는다.
 * @contract 설정 파일이 없거나 깨졌으면 빈 설정으로 본다(도구가 멈추지 않게). 모양은 types.ts의 ProjectConfig다.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ProjectConfig } from './types.js';

/** 프로젝트의 .spec/config.json 위치 */
export const configFile = (project: string): string => path.join(project, '.spec', 'config.json');

/** 프로젝트 설정을 읽는다. 없거나 깨졌으면 빈 설정 */
export function readConfig(project: string): ProjectConfig {
  try { return JSON.parse(fs.readFileSync(configFile(project), 'utf8')) as ProjectConfig; } catch { return {}; }
}
