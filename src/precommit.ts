/**
 * @spec precommit 커밋 때 경고 0 확인
 * @why 필수 메타정보가 비었거나 끊긴 참조가 있는 채로 커밋되지 않게, 경고 0을 말이 아니라 커밋 때 기계가 확인한다. 이미 만들어진 프로젝트에 방법을 들일 때는 경고가 처음부터 수백 개라 모든 커밋이 막히므로, 도입 시점의 경고를 기준선으로 저장해 두고 그보다 늘어난 경고만 막는다.
 * @basis 프로젝트의 .spec/config.json의 src를 읽는다. 설정이 없으면 이 프로젝트는 대상이 아니라 통과한다. 우회가 필요하면 git commit --no-verify를 쓰고, 쓰면 이유를 커밋 메시지에 남긴다. 기준선은 경고 글에서 줄 번호만 뺀 것과 그 개수로 비교한다(코드가 밀려 줄 번호가 바뀌어도 같은 경고로 본다).
 * @contract 메타정보(extract), 정보 존재 이유(analyze-ts), 이동 선언(nav)을 차례로 검사한다. 기준선(.spec/baseline.json)이 없으면 경고가 하나라도 있을 때, 있으면 기준선보다 늘어난 경고가 있을 때 커밋을 막는다(종료 코드 1). `precommit <루트> --baseline`은 지금의 경고를 기준선으로 저장하고, 기준선을 지우면 다시 경고 0을 요구한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { LAUNCHER } from './paths.js';
import { configFile, readConfig } from './config.js';
import { parseArgs } from './cli.js';

/** 검사 종류 */
const SCRIPTS = ['extract', 'analyze-ts', 'nav'] as const;
/** 기준선 파일: 검사 종류 → (줄 번호를 뺀 경고 글 → 개수) */
type Baseline = Record<string, Record<string, number>>;
const baselineFile = (root: string): string => path.join(root, '.spec', 'baseline.json');

/** 경고 글에서 끝의 줄 번호를 뺀다: "…없다 (src/a.ts:12)" → "…없다 (src/a.ts)" */
export const warningKey = (line: string): string => line.replace(/\(([^()]*?):\d+\)\s*$/, '($1)');

/** 한 검사를 돌려 { 경고 줄들, 도구 자체 오류 글 }을 돌려준다 */
function run(script: string, root: string, src: string): { ok: boolean; warnings: string[]; error: string } {
  const r = spawnSync(process.execPath, [LAUNCHER, script, script === 'extract' ? src : root, ...(script === 'nav' ? ['--src', src] : []), '--check'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const warnings = r.stdout.split('\n').filter((l) => l.startsWith('경고'));
  // 경고 줄이 없는데 실패했다면 도구 자체 오류다 (tsconfig 없음 등) — 내용을 그대로 보인다
  return { ok: r.status === 0, warnings, error: r.status === 0 || warnings.length ? '' : (r.stderr || r.stdout).trim().split('\n').slice(0, 8).join('\n') };
}

/** 경고 줄들을 "줄 번호 뺀 글 → 개수"로 센다 */
function count(lines: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) { const k = warningKey(l); out[k] = (out[k] ?? 0) + 1; }
  return out;
}

/** 명령: precommit [프로젝트 루트] [--baseline] */
export async function main(argv: string[]): Promise<number | undefined> {
  const { pos, flags } = parseArgs(argv, ['baseline']);
  const root = path.resolve(pos[0] || '.');
  if (!fs.existsSync(configFile(root))) return 0;
  const src = path.resolve(root, readConfig(root).src || 'src');
  let base: Baseline | null = null;
  try { base = JSON.parse(fs.readFileSync(baselineFile(root), 'utf8')) as Baseline; } catch { /* 기준선 없음 */ }
  const saving = flags.has('baseline');
  const saved: Baseline = {};
  let bad = false, allowed = 0;
  for (const script of SCRIPTS) {
    const r = run(script, root, src);
    if (r.error) { bad = true; console.error(`[spec-view] ${script} 오류:\n${r.error}`); continue; }
    if (saving) { saved[script] = count(r.warnings); continue; }
    if (!r.ok && !base) {
      bad = true;
      console.error(`[spec-view] ${script} 경고:`);
      console.error(r.warnings.slice(0, 10).join('\n'));
      continue;
    }
    if (!base) continue;
    // 기준선이 있으면 같은 경고를 기준선 개수까지는 봐 주고, 그보다 늘어난 것만 막는다
    const left = { ...(base[script] ?? {}) };
    const fresh: string[] = [];
    for (const l of r.warnings) {
      const k = warningKey(l);
      if ((left[k] ?? 0) > 0) { left[k]--; allowed++; } else fresh.push(l);
    }
    if (fresh.length) { bad = true; console.error(`[spec-view] ${script}에 기준선보다 늘어난 경고 ${fresh.length}건:`); console.error(fresh.slice(0, 10).join('\n')); }
  }
  if (saving) {
    if (bad) return 1;
    fs.mkdirSync(path.dirname(baselineFile(root)), { recursive: true });
    fs.writeFileSync(baselineFile(root), JSON.stringify(saved, null, 2) + '\n');
    const total = Object.values(saved).reduce((n, o) => n + Object.values(o).reduce((a, b) => a + b, 0), 0);
    console.log(`기준선을 저장했다: 지금의 경고 ${total}건(.spec/baseline.json, 커밋한다). 앞으로는 이보다 늘어난 경고만 커밋을 막는다`);
    return 0;
  }
  if (bad) { console.error(base ? '[spec-view] 새로 생긴 경고를 없앤 뒤 커밋한다 (메타정보 채우기: spec-view 스킬 rules/meta.md)' : '[spec-view] 경고를 0으로 만든 뒤 커밋한다 (메타정보 채우기: spec-view 스킬 rules/meta.md. 이미 만들어진 프로젝트를 들이는 중이면 `precommit . --baseline`으로 지금의 경고를 기준선으로 저장한다)'); return 1; }
  if (allowed) console.log(`[spec-view] 기준선에 있는 경고 ${allowed}건은 막지 않았다. 경고가 줄면 \`precommit . --baseline\`으로 기준선을 낮춘다`);
  return 0;
}
