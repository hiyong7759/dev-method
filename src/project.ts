/**
 * @spec project-paths 프로젝트 루트와 .spec 폴더 위치
 * @why 도구가 저장하는 모든 파일(요청·리포트·용어집·설정)은 프로젝트의 .spec 폴더에 모인다. 소스 폴더가 어디에 있든 같은 곳을 찾도록 한 자리에서 정한다.
 * @contract 프로젝트 루트는 git 저장소 맨 위(없으면 소스 폴더의 바로 위)다. git 명령이 실패해도 도구가 멈추지 않는다.
 */
import path from 'node:path';
import { execSync } from 'node:child_process';

/** 명령을 실행해 출력 글을 돌려준다. 실패하면 빈 글(git이 없는 곳에서도 도구가 멈추지 않게) */
const sh = (cmd: string, cwd: string): string => {
  try { return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; }
};

const rootCache = new Map<string, string>();
/** 소스 폴더가 속한 프로젝트 루트(git 저장소 맨 위, 없으면 소스 폴더의 바로 위) */
export const projectRoot = (scanRoot: string): string => {
  const hit = rootCache.get(scanRoot);
  if (hit) return hit;
  const root = sh('git rev-parse --show-toplevel', scanRoot) || path.dirname(scanRoot);
  rootCache.set(scanRoot, root);
  return root;
};
/** 테스트용 서버로 띄웠을 때 요청·리포트 등 저장 파일을 두는 저장소 밖 자리(없으면 운영 .spec). `testdata serve`가 환경변수로 넘긴다 */
export const testServerDir = (): string => process.env.SPEC_TEST_DIR ?? '';
/** 도구가 저장하는 파일을 모아 두는 프로젝트의 .spec 폴더. 테스트용 서버면 저장소 밖 테스트 자리의 .spec이라 운영 요청을 건드리지 않는다 */
export const specDir = (scanRoot: string): string => path.join(testServerDir() || projectRoot(scanRoot), '.spec');
