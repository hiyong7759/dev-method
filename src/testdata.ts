/**
 * @spec testdata-command 테스트 데이터 자리·시나리오별 데이터 기록 명령
 * @why 테스트하려면 데이터를 넣어야 하는데 운영 데이터에 그대로 넣기 애매하고, 사용자가 정상 경우조차 못 보고 테스트를 승인하는 일이 많았다. 소스는 하나로 두고 데이터만 테스트용으로 나누되, 그 자리를 저장소 밖에 두어 커밋될 수 없게 하고, 시나리오마다 어떤 데이터로 어떤 경우를 보는지 남겨 테스트를 올릴 때 확인한다.
 * @basis 프로젝트마다 .spec/config.json의 testData에 테스트 환경을 적는다. kind는 folder(저장소 밖 폴더: dev-method), remote(회사 공용 테스트 서버: 접속 주소와 운영 주소 표시), local-db(내 컴퓨터 테스트 DB)다. 설정이 없는 프로젝트는 이 검사의 대상이 아니다. 운영 환경 칸과 배포 절차는 이번 범위 밖이다.
 * @contract `testdata path`는 테스트 데이터 자리를 확인해 보이고(folder면 없을 때 만든다) 저장소 안이거나 운영을 가리키면 오류로 거부한다. `testdata seed --id N --scenario 시나리오 --kind normal|edge|error --label 이름 [--shot 캡처] [--how 만든 방법]`은 시나리오 하나의 경우 하나를 자리 안 seeds/N.json에 적는다(같은 시나리오·이름은 덮어쓴다). `testdata seed --id N`만 주면 지금 기록을 보인다. `testdata serve [--port N] [--fresh true]`는 folder 프로젝트의 테스트용 설계서 서버를 운영과 다른 포트(기본: 설정 포트+100)에 띄운다: 처음에 운영 .spec의 요청·리포트를 자리 안 .spec으로 복사하고(담당 세션 기록·로그·계정은 빼고, --fresh true면 다시 복사), 서버는 환경변수 SPEC_TEST_DIR로 그 .spec만 읽고 쓰며 담당 세션을 깨우지 않고 화면 위쪽에 "테스트 데이터" 표시를 단다. `testdata sync --id N`은 요청 하나를 테스트 자리 .spec으로 다시 복사하고(`request test`가 올릴 때 자동으로 한다), `testdata reset [--id N]`은 기록을 지운다(remote는 [테스트-#번호] 표시 데이터를 프로젝트 시드 스크립트가 지우므로 기록만 지운다). 원격 서버의 남의 데이터는 읽기만 한다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { parseArgs, errorText } from './cli.js';
import { LAUNCHER } from './paths.js';
import { readConfig } from './config.js';
import { projectRoot } from './project.js';
import { writeSamples } from './samples.js';
import type { Request, ReviewFrame, SeedCase, SeedFile, TestDataConfig } from './types.js';

const KINDS = ['normal', 'edge', 'error'] as const;
const KIND_LABEL: Record<string, string> = { normal: '정상', edge: '경계', error: '오류' };

/** ~로 시작하는 자리를 내 컴퓨터의 홈 폴더로 푼다 */
const expand = (p: string): string => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

/** 폴더 a가 b 안(또는 같은 곳)인지 */
const inside = (a: string, b: string): boolean => { const r = path.relative(b, a); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

/** 테스트 데이터 설정 읽기. 환경변수 SPEC_DATA_DIR가 있으면 folder 자리를 그것으로 바꾼다 */
export function testDataConfig(root: string): TestDataConfig | null {
  const c = readConfig(root).testData;
  if (!c) return null;
  const env = process.env.SPEC_DATA_DIR;
  return env && c.kind === 'folder' ? { ...c, dir: env } : c;
}

/** 테스트 데이터 자리가 안전한지 본다. 문제가 있으면 이유 글을, 없으면 빈 글을 돌려준다 */
export function dataProblem(root: string, c: TestDataConfig): string {
  if (c.kind === 'folder' && !c.dir) return 'testData.dir(테스트 데이터 자리)이 비었다';
  if (inside(dataDir(root, c), root)) return `테스트 데이터 자리(${c.dir ?? '기본 자리'})가 저장소 안이라 커밋될 수 있다. 저장소 밖(예: ~/.spec-testdata/<프로젝트>)으로 옮긴다`;
  if (c.kind === 'remote') {
    if (!c.url) return 'testData.url(테스트 서버 주소)이 비었다';
    const hit = (c.productionMarks ?? []).find((m) => c.url!.includes(m));
    if (hit) return `테스트 서버 주소(${c.url})에 운영 표시(${hit})가 있어 운영을 가리킨다. 테스트로 띄우지 않는다`;
  }
  return '';
}

/** 기록을 두는 자리: dir이 있으면 그곳, 없으면(remote) ~/.spec-testdata/<프로젝트 폴더 이름> */
const dataDir = (root: string, c: TestDataConfig): string => path.resolve(expand(c.dir || path.join('~', '.spec-testdata', path.basename(root))));

/** 시나리오별 기록 파일 */
const seedFile = (root: string, c: TestDataConfig, id: number): string => path.join(dataDir(root, c), 'seeds', `${id}.json`);

/** 기록을 읽는다. 없으면 빈 기록 */
export function readSeeds(root: string, c: TestDataConfig, id: number): SeedFile {
  try { return JSON.parse(fs.readFileSync(seedFile(root, c, id), 'utf8')) as SeedFile; } catch { return { request: id, cases: [] }; }
}

/** 테스트를 올릴 때 확인: 범위의 시나리오마다 정상 경우의 데이터와 화면 캡처가 있는지. 모자라면 이유 글을 돌려준다 */
export function seedProblem(scanRoot: string, r: Request): string {
  const root = projectRoot(scanRoot);
  const c = testDataConfig(root);
  const scenarios = r.scope.scenarios ?? [];
  if (!c || !scenarios.length) return '';
  const bad = dataProblem(root, c);
  if (bad) return bad;
  const seeds = readSeeds(root, c, r.id).cases;
  const lacks = scenarios.filter((s) => !seeds.some((x) => x.scenario === s && x.kind === 'normal' && x.shot && fs.existsSync(path.resolve(root, x.shot))));
  if (!lacks.length) return '';
  return `시나리오마다 정상 경우의 테스트 데이터와 그것이 화면에 나온 캡처가 있어야 한다. 빠진 시나리오: ${lacks.join(', ')}. \`testdata seed --id ${r.id} --scenario … --kind normal --label … --shot 캡처\`로 남긴다(경계·오류 경우도 함께 남긴다)`;
}

/** 요청 상세에 줄 테스트 서버 정보: 테스트 데이터로 뜬 앱 주소(testData.reviewUrl). 테스트용 서버 자신 안에서는 주지 않는다(거기서 또 테스트 서버로 보내지 않도록) */
export function reviewFrame(root: string): ReviewFrame | undefined {
  const c = testDataConfig(root);
  if (!c?.reviewUrl || process.env.SPEC_TEST_DIR || dataProblem(root, c)) return undefined;
  return { url: c.reviewUrl };
}

/** 테스트용 서버에 처음 채워 넣을 때 운영 .spec에서 복사하지 않는 것(담당 세션 기록·로그·계정·실행 흔적) */
const NOT_COPIED = new Set(['sessions.json', 'session-costs.json', 'wake-out', 'wake.log', 'pids.json', 'local.json', 'serve-stamp', 'serve.log', 'live-shots', 'comment-shots', 'review-shots', 'pending-shots.json']);

/** 운영 .spec의 요청·리포트·용어집 등을 테스트 자리의 .spec으로 복사한다(원본은 읽기만 한다). fresh면 이미 있어도 지우고 다시 복사한다 */
export function copyBase(root: string, dir: string, fresh: boolean): boolean {
  const to = path.join(dir, '.spec');
  if (fs.existsSync(to) && !fresh) return false;
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(path.join(root, '.spec'), to, { recursive: true, filter: (src) => !NOT_COPIED.has(path.basename(src)) && !src.endsWith('.log') });
  return true;
}

/** 테스트 자리의 .spec에 요청 하나(파일과 설계 그림)를 운영에서 다시 복사한다. 테스트용 서버는 처음 띄울 때 복사한 것만 알아서, 그 뒤 만든 요청은 검토 화면에서 "찾지 못했다"가 뜨기 때문이다. 자리가 아직 없으면(서버를 띄운 적 없음) 아무것도 안 한다. 복사했으면 true */
export function syncRequest(root: string, id: number): boolean {
  const c = testDataConfig(root);
  if (!c || c.kind !== 'folder' || dataProblem(root, c)) return false;
  const to = path.join(dataDir(root, c), '.spec');
  if (!fs.existsSync(to)) return false;
  const from = path.join(root, '.spec');
  fs.mkdirSync(path.join(to, 'requests'), { recursive: true });
  fs.copyFileSync(path.join(from, 'requests', `${id}.json`), path.join(to, 'requests', `${id}.json`));
  const shots = path.join(from, 'shots');
  if (fs.existsSync(shots)) {
    fs.mkdirSync(path.join(to, 'shots'), { recursive: true });
    for (const n of fs.readdirSync(shots)) if (n.startsWith(`r${id}-`)) fs.copyFileSync(path.join(shots, n), path.join(to, 'shots', n));
  }
  return true;
}

/** 테스트 서버 포트: 설정 reviewUrl의 포트, 없으면 운영 포트+100 */
function defaultPort(root: string, c: TestDataConfig): number {
  try { if (c.reviewUrl) { const p = Number(new URL(c.reviewUrl).port); if (p) return p; } } catch { /* 주소가 이상하면 기본 */ }
  return (readConfig(root).port || 5290) + 100;
}

/** 테스트용 설계서 서버를 운영과 다른 포트에 띄운다: 운영 .spec 대신 저장소 밖 테스트 자리의 .spec을 읽고 쓰며, 담당 세션은 깨우지 않는다 */
function startServer(root: string, scanRoot: string, dir: string, port: number): void {
  fs.mkdirSync(dir, { recursive: true });
  const log = fs.openSync(path.join(dir, 'serve.log'), 'a');
  const child = spawn(process.execPath, [LAUNCHER, 'serve', '--project', root, '--src', path.relative(root, scanRoot) || '.', '--port', String(port)], { cwd: root, detached: true, stdio: ['ignore', log, log], env: { ...process.env, SPEC_TEST_DIR: dir } });
  child.unref();
}

/** 포트가 열려 있는지(그 서버가 켜져 있는지) */
const listening = (port: number): Promise<boolean> => new Promise((resolve) => {
  const s = net.connect({ port, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false));
  s.setTimeout(800, () => { s.destroy(); resolve(false); });
});

/** 화면의 "테스트 데이터로 첫 화면 열기"가 부른다: 테스트 서버가 꺼져 있으면 켜고(복사본이 없으면 만들어) 열릴 때까지 기다린다. 켜져 있으면 아무것도 안 한다 */
export async function ensureTestServer(scanRoot: string): Promise<{ started: boolean; port: number }> {
  const root = projectRoot(scanRoot);
  const c = testDataConfig(root);
  if (!c || c.kind !== 'folder' || dataProblem(root, c) || process.env.SPEC_TEST_DIR) return { started: false, port: 0 };
  const port = defaultPort(root, c);
  if (await listening(port)) return { started: false, port };
  copyBase(root, dataDir(root, c), false);
  startServer(root, scanRoot, dataDir(root, c), port);
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); if (await listening(port)) return { started: true, port }; }
  throw new Error(`테스트 서버(포트 ${port})가 10초 안에 켜지지 않았다. ${dataDir(root, c)}/serve.log를 본다`);
}

/** 명령 입구 */
export async function main(argv: string[]): Promise<number | undefined> {
  const { pos, opts } = parseArgs(argv);
  const scanRoot = path.resolve(opts.src || 'src');
  const root = projectRoot(scanRoot);
  try {
    const c = testDataConfig(root);
    if (!c) { console.error('이 프로젝트의 .spec/config.json에 testData(테스트 환경)가 없다. kind(folder·remote·local-db)와 dir 또는 url을 적는다'); return 1; }
    const bad = dataProblem(root, c);
    if (bad) { console.error(`오류: ${bad}`); return 1; }
    const dir = dataDir(root, c);
    const id = Number(opts.id);
    if (pos[0] === 'path') {
      if (c.kind === 'folder') fs.mkdirSync(dir, { recursive: true });
      console.log(c.kind === 'remote' ? `테스트 서버: ${c.url} (공용이라 [테스트-#번호] 표시를 붙여 넣고, 남의 데이터는 읽기만 한다)` : `테스트 데이터 자리: ${dir} (저장소 밖, 환경변수 SPEC_DATA_DIR로 바꿀 수 있다)`);
    } else if (pos[0] === 'seed') {
      if (!id) throw new Error('--id(요청 번호)가 필요하다');
      if (opts.scenario) {
        if (!KINDS.includes(opts.kind as never)) throw new Error(`--kind는 ${KINDS.join('|')} 중 하나다`);
        if (!opts.label?.trim()) throw new Error('--label(이 경우를 부르는 이름. 예: 정상-홍길동)이 필요하다');
        const f = readSeeds(root, c, id);
        const one: SeedCase = { scenario: opts.scenario, kind: opts.kind as SeedCase['kind'], label: opts.label.trim(), how: opts.how ?? '', shot: opts.shot ?? '', at: new Date().toISOString() };
        f.cases = [...f.cases.filter((x) => !(x.scenario === one.scenario && x.label === one.label)), one];
        fs.mkdirSync(path.dirname(seedFile(root, c, id)), { recursive: true });
        fs.writeFileSync(seedFile(root, c, id), JSON.stringify(f, null, 2) + '\n');
      }
      const f = readSeeds(root, c, id);
      console.log(f.cases.length ? f.cases.map((x) => `${x.scenario} · ${KIND_LABEL[x.kind]} · ${x.label}${x.shot ? ` · 캡처 ${x.shot}` : ' · 캡처 없음'}`).join('\n') : `요청 #${id}: 기록된 테스트 데이터가 없다`);
    } else if (pos[0] === 'serve') {
      // 테스트용 설계서 서버: 운영과 다른 포트, 운영 .spec 대신 저장소 밖 테스트 자리의 .spec을 읽고 쓰며, 담당 세션은 깨우지 않는다
      if (c.kind !== 'folder') throw new Error('이 명령은 folder 종류(저장소 밖 폴더) 프로젝트에서만 쓴다. remote는 테스트 서버 주소로, local-db는 테스트 DB 접속 주소로 앱을 띄운다');
      const port = Number(opts.port || defaultPort(root, c));
      const fresh = copyBase(root, dir, opts.fresh === 'true');
      startServer(root, scanRoot, dir, port);
      console.log(`${fresh ? '운영 요청·리포트를 복사해 테스트 자리를 채웠다. ' : '기존 테스트 자리를 그대로 쓴다. '}테스트용 서버: http://localhost:${port}/__spec/  (자리 ${dir}/.spec, 담당 세션은 깨우지 않음)`);
    } else if (pos[0] === 'sync') {
      if (!id) throw new Error('--id(요청 번호)가 필요하다');
      console.log(syncRequest(root, id) ? `요청 #${id}을 테스트 자리로 복사했다` : '복사하지 않았다(folder 종류가 아니거나 테스트 자리가 아직 없다. `testdata serve`로 한 번 띄운 뒤 쓴다)');
    } else if (pos[0] === 'samples') {
      // 화면 모양 확인용 견본 요청(결정 전달 정상·경계·오류, 함께 고친 것 0·1·여러 건)을 테스트 자리 .spec에만 쓴다
      if (c.kind !== 'folder') throw new Error('이 명령은 folder 종류(저장소 밖 폴더) 프로젝트에서만 쓴다');
      copyBase(root, dir, false);
      const n = writeSamples(path.join(dir, '.spec'));
      console.log(`견본 요청 ${n}건(#9001~#9003 결정 전달, #9011~#9013 함께 고친 것)을 테스트 자리 ${dir}/.spec에 썼다. 운영 .spec은 건드리지 않았다. 테스트용 서버(testdata serve)의 요청 목록에서 본다`);
    } else if (pos[0] === 'reset') {
      const target = id ? [seedFile(root, c, id)] : fs.existsSync(path.join(dir, 'seeds')) ? fs.readdirSync(path.join(dir, 'seeds')).map((n) => path.join(dir, 'seeds', n)) : [];
      for (const t of target) fs.rmSync(t, { force: true });
      console.log(`테스트 데이터 기록 ${target.length}건을 지웠다${c.kind === 'remote' ? '(서버의 [테스트-#번호] 표시 데이터는 프로젝트 시드 스크립트로 지운다)' : ''}`);
    } else {
      console.log('사용: testdata path | serve [--port N] [--fresh true] | seed --id N [--scenario 시나리오 --kind normal|edge|error --label 이름 --shot 캡처 --how 방법] | samples | reset [--id N]   (--src 소스 폴더)');
    }
  } catch (e) { console.error(`오류: ${errorText(e)}`); return 1; }
  return 0;
}
