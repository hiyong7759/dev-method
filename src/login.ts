/**
 * @spec login-helper 테스트 계정 설정 읽기
 * @why 로그인이 있어야 화면이 열리는 앱은, 브라우저로 확인하는 에이전트가 로그인 화면에서 막힌다. 테스트 계정을 이 컴퓨터에만 두고, 끝낼 때 확인(finish)이 그 계정을 확인 에이전트에게 넘긴다.
 * @basis 계정은 커밋하지 않는 프로젝트의 .spec/local.json에 둔다. 로그인 화면의 입력칸은 앱마다 다르므로 선택자는 선택 사항이다. 로그인은 도구가 아니라 ego-browser로 화면을 보는 에이전트가 한다.
 * @contract 파일이 없거나 깨졌으면 빈 설정. 비밀번호는 로그나 보고에 쓰지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { LocalSettings } from './types.js';

/** 프로젝트의 .spec/local.json (이 컴퓨터에만 둔다) */
export const localFile = (project: string): string => path.join(project, '.spec', 'local.json');

/** 이 컴퓨터에만 두는 설정을 읽는다. 없거나 깨졌으면 빈 설정 */
export function readLocal(project: string): LocalSettings {
  try { return JSON.parse(fs.readFileSync(localFile(project), 'utf8')) as LocalSettings; } catch { return {}; }
}
