/**
 * @spec cost-command 세션 비용 기록·보기 명령
 * @why 담당 세션을 만들거나 깨우는 셸이 claude가 끝난 뒤 그 결과 파일에서 토큰과 비용을 요청별로 적고, 사람과 에이전트가 요청 하나에 얼마 들었는지 볼 수 있게 한다. 서버가 먼저 끝나도 기록이 남도록 서버가 아니라 이 명령이 적는다.
 * @contract `cost --src 소스 --id N --sid 세션 --kind start|wake --file 결과.json`은 한 줄을 적고 결과 파일을 지운다(읽을 수 없으면 적지 않고 이유만 보인다). `cost --src 소스 --id N`은 요청 하나의 합계를 보인다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, errorText } from './cli.js';
import { costOf, parseUsage, recordCost } from './session.js';

/** 명령 입구 */
export async function main(argv: string[]): Promise<number | undefined> {
  const { opts } = parseArgs(argv);
  const scanRoot = path.resolve(opts.src || 'src');
  const id = Number(opts.id);
  try {
    if (opts.file) {
      const text = fs.readFileSync(opts.file, 'utf8');
      const u = parseUsage(text);
      if (!u) { console.error(`비용을 읽지 못했다(claude 결과가 JSON이 아니거나 비용이 없다): ${opts.file}`); return 1; }
      recordCost(scanRoot, { request: id, session: opts.sid, kind: opts.kind === 'wake' ? 'wake' : 'start', at: new Date().toISOString(), ...u });
      fs.rmSync(opts.file, { force: true });
      console.log(`요청 #${id}: 비용 기록 ${u.usd.toFixed(4)}달러 · 입력 ${u.inputTokens} · 출력 ${u.outputTokens}`);
    } else {
      const c = costOf(scanRoot, id);
      console.log(`요청 #${id}: 세션 시작 ${c.start}번 · 깨움 ${c.wake}번 · 입력 ${c.inputTokens} · 출력 ${c.outputTokens} · 약 ${c.usd.toFixed(2)}달러`);
    }
  } catch (e) { console.error(`오류: ${errorText(e)}`); return 1; }
  return 0;
}
