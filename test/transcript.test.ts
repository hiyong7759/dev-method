/**
 * @why 요청 #92의 약속을 지킨다: 담당이 워크트리로 들어가 대화 기록이 다른 프로젝트 폴더로 옮겨져도 도구가 그 실제 파일을 찾아, 이어 띄우기·메시지 보내기가 같은 이름의 새 담당을 만들지 않는다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { transcriptOf } from '../src/session.js';

const SID = '201b45a4-aaaa-bbbb-cccc-111122223333';

function withHome(fn: (home: string) => void): void {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-home-'));
  const old = process.env.HOME;
  process.env.HOME = home;
  try { fn(home); } finally { process.env.HOME = old; fs.rmSync(home, { recursive: true, force: true }); }
}
const put = (file: string): string => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '{}\n'); return file; };

test('작업 정보(linkScanPath)가 있으면 워크트리로 옮겨진 실제 기록 파일을 돌려준다', () => withHome((home) => {
  const moved = put(path.join(home, '.claude', 'projects', '-x--claude-worktrees-req-92', `${SID}.jsonl`));
  put(path.join(home, '.claude', 'jobs', '201b45a4', 'state.json'));
  fs.writeFileSync(path.join(home, '.claude', 'jobs', '201b45a4', 'state.json'), JSON.stringify({ linkScanPath: moved }));
  assert.equal(transcriptOf('/somewhere/else', SID), moved);
}));

test('작업 정보가 없어도 projects 아래 모든 폴더에서 찾고, 어디에도 없으면 프로젝트 이름으로 짐작한 자리를 준다', () => withHome((home) => {
  const moved = put(path.join(home, '.claude', 'projects', '-other', `${SID}.jsonl`));
  assert.equal(transcriptOf('/somewhere/else', SID), moved);
  fs.rmSync(moved);
  assert.equal(transcriptOf('/somewhere/else', SID), path.join(home, '.claude', 'projects', '-somewhere-else', `${SID}.jsonl`));
}));
