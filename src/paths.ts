// 도구의 소스·스킬·화면 파일이 어디 있는지 한곳에서 정한다.
// 존재 이유: 여러 파일이 서로의 위치를 따로 계산하면 폴더를 옮길 때 곳곳이 깨지므로, 위치 계산을 이 파일 하나에 모은다.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(SRC_DIR, '..');
export const VIEWER_DIR = path.join(SRC_DIR, 'viewer');
// 에이전트와 커밋 검사가 도구를 부르는 입구(skills/spec-view/spec.mjs). 도구 안에서 다른 명령을 부를 때도 이것을 쓴다
export const SKILL_DIR = path.join(ROOT_DIR, 'skills', 'spec-view');
export const LAUNCHER = path.join(SKILL_DIR, 'spec.mjs');
