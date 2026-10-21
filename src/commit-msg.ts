/**
 * @spec commit-msg-check 커밋 메시지에 요청 번호 확인
 * @why 요청 번호가 모든 일의 열쇠라서, 번호 없이 들어간 변경은 이력과 요청에 이어지지 않는다. 말이 아니라 커밋 때 기계가 막는다.
 * @basis 프로젝트의 .spec/config.json이 있고 요청이 하나라도 등록돼 있을 때만 검사한다(아직 요청을 쓰지 않는 프로젝트는 통과). 병합·되돌리기 커밋은 뺀다. 우회가 필요하면 git commit --no-verify를 쓰고, 쓰면 이유를 커밋 메시지에 남긴다.
 * @contract git의 commit-msg 훅이 메시지 파일 경로를 넘긴다. 메시지에 "요청 #번호" 줄이 없거나, 그 번호의 요청 파일(.spec/requests/<번호>.json)이 없으면 커밋을 막는다(종료 코드 1). 줄 모양은 history.ts가 읽는 것과 같다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { configFile } from './config.js';
import { loadRequests } from './request.js';
import { parseArgs } from './cli.js';

/** 명령: commit-msg <메시지 파일> [프로젝트 루트] */
export async function main(argv: string[]): Promise<number | undefined> {
  const a = parseArgs(argv);
  const file = a.pos[0];
  if (!file) { console.error('사용: commit-msg <커밋 메시지 파일> [프로젝트 루트]'); return 1; }
  let root = a.pos[1] ? path.resolve(a.pos[1]) : '';
  if (!root) { try { root = execFileSync('git', ['rev-parse', '--show-toplevel'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 0; } }
  if (!fs.existsSync(configFile(root))) return 0;
  const requests = loadRequests(root);
  if (!requests.length) return 0;
  const msg = fs.readFileSync(file, 'utf8').split('\n').filter((l) => !l.startsWith('#')).join('\n');
  const subject = msg.split('\n')[0] ?? '';
  if (/^(Merge|Revert)\b/.test(subject) || /^revert[:(]/i.test(subject)) return 0;
  const m = msg.match(/요청\s*[:#]?\s*#(\d+)/);
  if (!m) {
    console.error('[spec-view] 커밋 메시지에 요청 번호가 없습니다. 변경은 먼저 요청으로 등록하고(`request add …`), 메시지에 `요청 #번호` 줄을 쓰세요.');
    console.error('            병합·되돌리기는 예외입니다. 그 밖의 우회는 git commit --no-verify이고, 쓰면 이유를 메시지에 남깁니다.');
    return 1;
  }
  if (!requests.some((r) => r.id === Number(m[1]))) {
    console.error(`[spec-view] 요청 #${m[1]}이 등록돼 있지 않습니다. 번호를 확인하거나 먼저 요청을 등록하세요 (등록된 요청: ${requests.map((r) => `#${r.id}`).join(' ')}).`);
    return 1;
  }
  return 0;
}
