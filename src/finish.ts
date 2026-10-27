/**
 * @spec finish 끝낼 때 확인
 * @why 에이전트가 "테스트 요청"을 내기 전에, 끝낼 때 확인을 말이 아니라 실행으로 거치게 한다. 기계가 확인할 수 있는 것(경고 0, 서버 응답, 화면 주소 연결)은 도구가 하고, 눈으로 봐야 하는 것(화면이 열리고 오류 없는지, 부품 위치, 눌러야 나오는 부품)은 하이쿠급 에이전트가 ego-browser로 직접 보게 한다. 기계가 브라우저를 흉내 내 보는 것은 가치가 작다는 사용자 결정이다.
 * @basis 설정은 .spec/config.json의 src와 port를 기본값으로 쓴다. --url은 설계서 보기 서버(serve) 주소이지 앱 개발 서버 주소가 아니다. 이 도구는 브라우저를 직접 띄우지 않는다(Playwright·Chrome 사용 없음).
 * @contract 돌릴 때마다 결과(시각·통과 여부)를 .spec/finish.json에 남긴다. 기계 확인이 모두 통과해야 종료 코드 0이고, 하나라도 실패하면 상태는 "개발 중"이라 테스트 요청을 내지 않는다. 통과하면 화면 주소마다 확인 에이전트에게 줄 지시문(열 주소, 찾을 부품과 여는 순서, 로그인 설정 위치)을 출력한다. 그 에이전트가 낸 보고를 읽은 뒤에만 테스트 요청을 낸다.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { specDir } from './project.js';
import { LAUNCHER } from './paths.js';
import { readConfig } from './config.js';
import { localFile, readLocal } from './login.js';
import { main as openServers } from './open.js';
import { parseArgs } from './cli.js';
import { refreshTestServer } from './testdata.js';
import { newCodeProblem } from './stale.js';
import { matchScreen } from './viewer/util.js';
import type { Model, Spec } from './types.js';

/** 부품 하나를 확인 에이전트에게 설명하는 한 줄: 이름, 선택자, 숨어 있으면 여는 순서 */
const partLine = (sp: Spec): string => `- ${sp.title} — 선택자 ${sp.anchor.slice(4)}${sp.open.length ? ` — 처음엔 숨어 있음, 여는 순서: ${sp.open.map((o) => `${o.act ?? '누르기'} ${o.text ?? ''}${o.value ? '=' + o.value : ''}`.trim()).join(' → ')}` : ''}`;

/** 명령: finish --routes /a,/b [--src src] [--url 서버 주소] [--root 프로젝트 루트] */
export async function main(argv: string[]): Promise<number | undefined> {
  const { opts } = parseArgs(argv);
  const root = path.resolve(opts.root || '.'); // tsconfig.json이 있는 프로젝트 루트(analyze-ts가 필요)
  const cfg = readConfig(root);
  const src = opts.src || cfg.src || 'src';
  const base = (opts.url || `http://localhost:${cfg.port || 5290}`).replace(/\/$/, '');
  const routes = (opts.routes || '/').split(',');

  const results: boolean[] = [];
  const step = (name: string, ok: boolean, detail = ''): void => {
    results.push(ok);
    console.log(`${ok ? '통과' : '실패'}  ${name}${detail ? ' — ' + detail : ''}`);
  };
  const run = (script: string): { ok: boolean; text: string } => {
    const r = spawnSync(process.execPath, [LAUNCHER, script, script === 'extract' ? src : root, ...(script === 'nav' ? ['--src', src] : []), '--check'], { encoding: 'utf8' });
    return { ok: r.status === 0, text: (r.stdout + r.stderr).trim() };
  };

  // 1. 경고 0
  for (const [label, script] of [['메타정보 경고 0 (extract)', 'extract'], ['정보 존재 이유 경고 0 (analyze-ts)', 'analyze-ts'], ['이동 선언(@to)이 코드와 같다 (nav)', 'nav']]) {
    const r = run(script);
    step(label, r.ok, r.ok ? '' : r.text.split('\n').filter((l) => l.startsWith('경고')).slice(0, 5).join(' / '));
  }

  // 2. 서버와 설계서 보기 모델
  // 도구를 고친 뒤에도 옛 코드의 서버가 남아 엉뚱한 실패를 만들지 않도록, 확인 전에 서버를 최신으로 맞춘다(주소를 직접 준 경우는 건드리지 않는다)
  if (!opts.url) await openServers([root, '--no-open']);
  let model: Model | null = null;
  // 테스트 서버(설정이 있고 떠 있을 때)도 같은 이유로 새 코드로 맞춘다
  if (!opts.url) {
    try { const t = await refreshTestServer(path.resolve(root, src)); if (t.port) step('테스트 서버가 새 코드로 떠 있다', !(await newCodeProblem(`http://localhost:${t.port}`)), `포트 ${t.port}${t.started ? ' · 다시 띄움' : ''}`); } catch (e) { step('테스트 서버가 새 코드로 떠 있다', false, e instanceof Error ? e.message : String(e)); }
  }
  try { model = await (await fetch(base + '/__spec/model.json')).json() as Model; } catch { /* 응답 없음 */ }
  step('설계서 보기 서버가 응답한다', !!model, model ? `${base} · 화면 ${model.screens.length}개` : `${base}/__spec/model.json 에 응답이 없다. 앱 개발 서버와 설계서 보기 서버(node <스킬 폴더>/spec.mjs serve --project .)를 에이전트가 직접 띄운 뒤 다시 실행한다`);

  // 3. 화면 주소가 @screen의 @route와 맞는다 (맞는 화면마다 확인 에이전트의 지시문을 모은다)
  const briefs: string[] = [];
  if (model) {
    for (const route of routes) {
      // 쿼리(?editTripId=…)는 @route 비교에서 뺀다. 설계서 보기처럼 #이 주소의 일부인 화면도 있어 #까지 넣은 것을 먼저 본다
      const sc = matchScreen(model, route.split('?')[0]) ?? matchScreen(model, route.split(/[?#]/)[0]);
      step(`${route} 이 주소가 @screen의 @route와 맞는다`, !!sc, sc ? `화면 "${sc.name}"` : opts.routes ? '맞는 @screen @route가 없다 — 설계서 보기가 이 화면을 찾지 못한다' : '확인할 화면 주소를 안 줬다 — --routes에 바뀐 화면의 주소를 적어 다시 돌린다(예: --routes "/__spec/#/manage/designs")');
      if (!sc) continue;
      const mine = model.specs.filter((x) => x.screens.includes(sc.name) && x.kind === 'dom' && x.anchor);
      briefs.push([
        `■ 화면 "${sc.name}" (${route})`,
        `  1) 설계서 보기 ${base}/__spec/#/screen/${encodeURIComponent(sc.name)}?tab=overview&at=${encodeURIComponent(route)} 가 열리고 사이드 패널 제목이 "${sc.name}"인지`,
        '  2) 안의 실제 화면에 본문이 있고 콘솔 오류가 없는지',
        '  3) 아래 부품이 실제 화면에서 모두 찾히는지(숨어 있는 것은 적힌 순서대로 눌러 연 뒤 확인. 순서가 없는데 안 보이면 눌러 보며 찾고, 찾은 순서를 보고)',
        ...(mine.length ? mine.map(partLine) : ['- (등록된 부품 없음)']),
      ].join('\n'));
    }
  }

  // 결과를 남긴다: `request test`가 이 기록이 통과이고 그 뒤 소스가 안 바뀐 때만 테스트를 올리게 한다
  const record = (ok: boolean): void => {
    try { const f = path.join(specDir(path.resolve(root, src)), 'finish.json'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), ok }, null, 2) + '\n'); } catch { /* 기록 실패는 확인 결과를 바꾸지 않는다 */ }
  };
  record(results.every(Boolean));
  if (!results.every(Boolean)) { console.log('\n결과: 실패 — 상태는 "개발 중". 테스트 요청을 내지 않는다'); return 1; }

  // 4. 눈으로 보는 확인: 하이쿠급 에이전트가 ego-browser로 한다
  const login = readLocal(root).login;
  console.log('\n기계 확인 통과. 이제 하이쿠급 에이전트(Agent 도구, model haiku)에게 ego-browser(/ego-browser 스킬)로 아래를 확인시킨다. Playwright·Chrome은 쓰지 않는다.');
  console.log(`앱이 로그인을 요구하면 ${login ? `${localFile(root)}의 login(아이디·비밀번호는 그 파일에서 직접 읽고, 보고에 쓰지 않는다)으로 먼저 로그인한다` : '테스트 계정이 없으니 로그인 화면에서 막히면 그대로 보고한다'}.`);
  console.log('각 항목마다 통과/실패와 근거(찍은 그림 경로, 오류 글)를 보고하게 한다. 부품이 안 찾히면 ① @anchor 선택자가 맞는지 고치고 ② 숨은 요소면 그 @spec에 @open 순서를 쓴다.\n');
  console.log(briefs.join('\n\n'));
  console.log('\n결과: 기계 확인 통과 — 확인 에이전트의 보고를 직접 읽고 이상이 없을 때만 "request test"로 테스트를 올린다');
  return 0;
}
