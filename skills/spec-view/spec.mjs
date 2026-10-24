#!/usr/bin/env node
// 설계서 보기 도구의 입구. 사용: node <이 폴더>/spec.mjs <명령> [옵션]
// 존재 이유: 도구 소스는 저장소 맨 위 src/에 TypeScript로 있고, 스킬 폴더는 안내만 담는다. 에이전트와 커밋 검사는 늘 이 한 파일로 도구를 부른다.
// 스킬은 링크로 불려도 이 파일의 진짜 위치(저장소 안)에서 시작하므로 ../../src를 찾을 수 있다. TypeScript는 tsx가 읽어서 Node 20에서도 돈다.
import { register } from 'tsx/esm/api';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMANDS = ['extract', 'analyze-ts', 'nav', 'finish', 'request', 'report', 'glossary', 'open', 'serve', 'precommit', 'commit-msg', 'inbox', 'design', 'comment', 'todo', 'cost'];
const [command, ...rest] = process.argv.slice(2);
if (!COMMANDS.includes(command)) {
  console.error(`사용: node spec.mjs <명령> [옵션]\n명령: ${COMMANDS.join(', ')}`);
  process.exit(command ? 1 : 0);
}
const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', `${command}.ts`);
register();
// 각 명령 파일은 main(옵션 낱말들)을 내보낸다. 숫자를 돌려주면 그것이 종료 코드이고, 안 돌려주면(서버처럼 계속 도는 명령) 그대로 둔다
const { main } = await import(file);
const code = await main(rest);
if (typeof code === 'number') process.exit(code);
