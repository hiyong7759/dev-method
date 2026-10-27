/**
 * @spec tidy-command 끝난 요청의 테스트 흔적 정리 명령
 * @why 테스트 데이터·테스트 서버 복사본·캡처는 만들기만 하고 지우는 단계가 없어, 사용자가 "정리해"라고 말해야 치워졌다. 요청이 끝나면 도구가 스스로 치워 사용자가 말하지 않아도 되게 한다.
 * @basis 지우는 것은 도구가 만든 것뿐이다: 테스트를 승인한(완료) 요청의 테스트 데이터 기록과 테스트 서버 복사본. 임시 폴더에 있던 캡처는 지우기 전에 대표 한 장을 저장소 안(.spec/shots)으로 옮겨 둔다. 남의 변경·미커밋 파일처럼 도구가 만들지 않은 것은 건드리지 않는다. 묻거나 알리는 화면은 두지 않는다.
 * @contract 요청이 테스트 승인으로 끝날 때 approveTest가 그 요청을 정리한다. `tidy`는 그 전에 이미 쌓인 완료 요청의 테스트 데이터를 한 번에 정리한다(요청마다 대표 캡처 한 장과 데이터 한 줄은 요청의 test.kept에 남는다).
 */
import path from 'node:path';
import { parseArgs, errorText } from './cli.js';
import { projectRoot } from './project.js';
import { loadRequests, saveKept } from './request.js';
import { cleanupRequest, dataProblem, readSeeds, testDataConfig } from './testdata.js';

/** 완료 요청에 남은 테스트 데이터를 지우고, 대표 캡처·한 줄을 요청에 남긴다. 정리한 요청 번호들을 돌려준다 */
export function tidyDone(scanRoot: string): number[] {
  const root = projectRoot(scanRoot);
  const c = testDataConfig(root);
  if (!c || dataProblem(root, c)) return [];
  const done: number[] = [];
  for (const r of loadRequests(scanRoot)) {
    if (r.stage !== 'done' || !readSeeds(root, c, r.id).cases.length) continue;
    const kept = cleanupRequest(root, r.id);
    if (kept) { saveKept(scanRoot, r.id, kept); done.push(r.id); }
  }
  return done;
}

/** 명령: tidy --src <소스 폴더> */
export async function main(argv: string[]): Promise<number | undefined> {
  const { opts } = parseArgs(argv);
  try {
    const ids = tidyDone(path.resolve(opts.src || 'src'));
    console.log(ids.length ? `완료 요청 ${ids.map((i) => `#${i}`).join(' ')}의 테스트 데이터를 지웠다(대표 캡처와 데이터 한 줄은 요청에 남겼다)` : '지울 테스트 데이터가 없다');
  } catch (e) { console.error(`오류: ${errorText(e)}`); return 1; }
  return 0;
}
