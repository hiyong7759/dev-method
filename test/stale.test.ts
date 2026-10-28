/**
 * @why 요청 #82의 약속을 지킨다: 서버가 뜬 뒤 도구 소스가 바뀌면 옛 코드로 알아보고, 새 코드로 응답하는지 코드 표로 가리며, 테스트를 올리기 전 서버를 새 코드로 다시 띄운다(요청 #87부터 서버는 담당 세션을 깨우지 않으므로 끊긴 깨움 이어 보내기는 없다).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { LAUNCHER } from '../src/paths.js';
import { restartForTest } from '../src/testdata.js';
import { newCodeProblem, serverStamp, srcStamp, staleServer } from '../src/stale.js';
import { tempProject } from './helpers.js';

test('서버가 뜬 뒤 도구 소스가 바뀌면 옛 코드로 알아본다', () => {
  assert.equal(staleServer(), false, '아직 바뀌지 않았으면 옛 코드가 아니다');
  const file = path.resolve('src', 'stale.ts');
  const old = fs.statSync(file);
  try {
    fs.utimesSync(file, new Date(Date.now() + 3600_000), new Date(Date.now() + 3600_000));
    assert.equal(staleServer(), true);
    assert.notEqual(srcStamp(), serverStamp);
  } finally { fs.utimesSync(file, old.atime, old.mtime); }
});

/** 모델 한 줄만 돌려주는 가짜 서버를 띄워 주소를 돌려준다 */
async function fake(model: Record<string, unknown>): Promise<{ base: string; close: () => void }> {
  const s = http.createServer((_, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(model)); });
  await new Promise<void>((r) => s.listen(0, r));
  return { base: `http://localhost:${(s.address() as { port: number }).port}`, close: () => s.close() };
}

test('테스트를 올리기 전 확인은 코드 표가 지금 소스와 같은 서버만 새 코드로 인정한다', async () => {
  const cases: [Record<string, unknown>, RegExp | ''][] = [[{ serverStamp: srcStamp() }, ''], [{ serverStamp: '1' }, /소스가 서버가 뜬 뒤 바뀌었다/], [{ screens: [] }, /코드 표가 없는 서버/]];
  for (const [model, want] of cases) {
    const s = await fake(model);
    try {
      const got = await newCodeProblem(s.base);
      if (want === '') assert.equal(got, ''); else assert.match(got, want);
    } finally { s.close(); }
  }
  assert.match(await newCodeProblem('http://localhost:1'), /응답하지 않는다/);
});

test('테스트를 올리기 전 절차는 새 코드로 떠 있어도 늘 서버를 끄고 다시 띄우고, 새 코드로 응답함을 확인한다', async () => {
  const p = tempProject({ app: null, port: 5977 });
  const pidOf = (): string => { try { return execFileSync('lsof', ['-ti', 'tcp:5977', '-sTCP:LISTEN'], { encoding: 'utf8' }).trim(); } catch { return ''; } };
  try {
    assert.equal(await restartForTest(p.src), '', '꺼져 있던 서버를 띄워 새 코드로 확인한다');
    assert.equal(await newCodeProblem('http://localhost:5977'), '');
    const before = pidOf();
    assert.ok(before);
    assert.equal(await restartForTest(p.src), '');
    assert.notEqual(pidOf(), before, '새 코드로 떠 있어도 다시 띄운다(무조건)');
    assert.equal(await newCodeProblem('http://localhost:5977'), '');
  } finally { execFileSync(process.execPath, [LAUNCHER, 'open', p.root, '--stop'], { stdio: 'ignore' }); }
});

test('설계서 보기를 쓰지 않는 프로젝트(설정 파일 없음)는 다시 띄울 서버가 없어 막지 않는다', async () => {
  const p = tempProject();
  fs.rmSync(path.join(p.root, '.spec', 'config.json'));
  assert.equal(await restartForTest(p.src), '');
});
