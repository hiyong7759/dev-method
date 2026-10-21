/**
 * @why 시험마다 쓰고 버리는 프로젝트 폴더를 만든다. 진짜 프로젝트의 .spec을 건드리지 않게, 임시 git 저장소 안에 src 폴더와 설정 파일을 둔다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** 임시 프로젝트를 만들고 { 루트, 소스 폴더 }를 돌려준다 */
export function tempProject(config: Record<string, unknown> = {}): { root: string; src: string } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'spec-test-')));
  execFileSync('git', ['init', '-q'], { cwd: root });
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, '.spec'));
  fs.writeFileSync(path.join(root, '.spec', 'config.json'), JSON.stringify({ src: 'src', ...config }));
  return { root, src: path.join(root, 'src') };
}
