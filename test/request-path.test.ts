/**
 * @why 요청 #107의 구조 보장: 화면 요청을 받는 파일은 무거운 계산(전체 모델·git·소스 분석)을 직접 부를 수 없다. 나중에 어떤 기능이 무거워져도 응답이 느려질 수 없게, 요청 길 파일이 그런 가져오기를 하면 이 시험이 깨진다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/** 요청 길에서 가져오면 안 되는 계산 모듈(배경 계산은 snapshot.ts만 부른다) */
const HEAVY = ['model', 'history', 'extract', 'analyze-ts', 'worktree', 'land', 'delivery', 'design'];
/** 요청을 받는 파일 */
const REQUEST_PATH = ['src/middleware.ts'];

test('요청 길 파일은 무거운 계산 모듈을 가져오지 않는다', () => {
  for (const f of REQUEST_PATH) {
    const imports = [...fs.readFileSync(f, 'utf8').matchAll(/from '\.\/([\w-]+)\.js'/g)].map((m) => m[1]);
    for (const heavy of HEAVY) assert.ok(!imports.includes(heavy), `${f}가 ${heavy}를 직접 가져온다 — 계산은 snapshot.ts를 거쳐 배경에서 한다`);
    assert.ok(imports.includes('snapshot'), `${f}는 snapshot.ts의 읽기 함수를 써야 한다`);
  }
});

test('서버·화면·알림 쪽에 몇 초마다 도는 반복 타이머가 남아 있지 않다', () => {
  for (const f of ['src/serve.ts', 'src/viewer/app.ts', 'src/viewer/terminal-dock.ts', 'src/viewer/screen.ts', 'src/notify.ts', 'src/outbox.ts', 'src/ttyd.ts']) {
    assert.ok(!/setInterval\(/.test(fs.readFileSync(f, 'utf8')), `${f}에 setInterval이 있다 — 트리거로 바꾼다`);
  }
});
