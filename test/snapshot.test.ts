/**
 * @why 요청 #107의 약속을 지킨다: 계산은 상태가 바뀐 순간에만 배경에서 하고, 아무것도 안 바뀌면 서버 계산이 0번이며, 화면 요청은 계산하지 않고 만들어 둔 결과만 돌려준다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildCount, latestModelJson, startSnapshot, stopSnapshot, versionsOf, onChange } from '../src/snapshot.js';
import { addRequest } from '../src/request.js';
import { tempProject } from './helpers.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** 계산이 끝나 조용해질 때까지 기다린다(이 시간 안에 횟수가 안 변하면 조용하다) */
async function settle(src: string): Promise<number> {
  let last = -1;
  for (let i = 0; i < 40; i++) { const n = buildCount(src); if (n === last) return n; last = n; await sleep(400); }
  return last;
}

test('아무것도 안 바뀌는 동안 서버 계산은 0번이고, 바뀌면 알리고 계산한다', async () => {
  const { src } = tempProject();
  startSnapshot(src);
  try {
    await latestModelJson(src);
    // 다른 시험이 도구 소스 파일을 만지는 때(tool 트리거)와 겹칠 수 있어, 조용한 구간이 한 번도 안 나올 때만 실패로 본다(주기로 도는 계산이면 끝내 조용해지지 않는다)
    let quiet = 0, calm = false;
    for (let i = 0; i < 5 && !calm; i++) { quiet = await settle(src); await sleep(2500); calm = buildCount(src) === quiet; }
    assert.ok(calm, '바뀐 것이 없는데 계산이 계속 돌았다');
    // 요청 기록이 쓰이면(트리거) 배경에서 계산하고 알린다
    const before = versionsOf(src).model;
    const told = new Promise<void>((ok) => { const off = onChange(src, () => { off(); ok(); }); });
    addRequest(src, { title: '트리거 시험' });
    await Promise.race([told, sleep(5000)]);
    assert.ok(buildCount(src) > quiet, '요청 기록이 쓰였는데 계산하지 않았다');
    assert.ok(versionsOf(src).model > before);
    assert.match(await latestModelJson(src), /트리거 시험/);
    const after = await settle(src);
    await sleep(1500);
    assert.equal(buildCount(src), after, '계산이 끝난 뒤 스스로 다시 돌고 있다');
  } finally { stopSnapshot(src); }
});

test('소스 파일이 바뀌면 그때 계산하고, 요청을 아무리 읽어도 계산이 늘지 않는다', async () => {
  const { src } = tempProject();
  startSnapshot(src);
  try {
    await latestModelJson(src);
    const quiet = await settle(src);
    for (let i = 0; i < 50; i++) await latestModelJson(src);
    assert.equal(buildCount(src), quiet, '읽기가 계산을 일으켰다');
    fs.writeFileSync(path.join(src, 'a.ts'), '/** 시험 */\nexport const a = 1;\n');
    for (let i = 0; i < 30 && buildCount(src) === quiet; i++) await sleep(200);
    assert.ok(buildCount(src) > quiet, '소스가 바뀌었는데 계산하지 않았다');
  } finally { stopSnapshot(src); }
});
