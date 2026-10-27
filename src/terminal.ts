/**
 * @spec terminal-open 담당 세션 창을 iTerm2에 자동으로 열기
 * @why 사용자가 담당 세션과 터미널로 대화하려면 매번 명령을 찾아 치게 되므로, 사건(시작·설계 제출·질문·막힘·테스트 올림·담당 종료)이 생기면 도구가 그 요청의 담당 세션 창(claude attach)을 대신 연다.
 * @contract 요청마다 창 하나다. 열 때 iTerm2의 창 번호를 .spec/terminal-windows.json(커밋하지 않음)에 적고, 다음 사건에서는 그 창이 아직 있으면 앞으로 보이기만 한다(새로 열지 않는다). 창을 닫는 기능은 없다(사용자가 닫는다). iTerm2가 없거나 열기에 실패해도 요청 기록은 막지 않고 실패 이유만 돌려준다. 테스트 서버(SPEC_TEST_DIR)와 SPEC_NO_TERMINAL=1에서는 열지 않는다. 화면의 복사 명령도 같은 모양(attachCommand)이다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** 담당 세션에 들어가는 명령. 이름에 공백·#이 있어 따옴표로 감싼다 */
export const attachCommand = (name: string): string => `claude attach '${name.replace(/'/g, `'\\''`)}'`;

const windowsFile = (root: string): string => path.join(root, '.spec', 'terminal-windows.json');

function loadWindows(root: string): Record<string, number> {
  try { return JSON.parse(fs.readFileSync(windowsFile(root), 'utf8')) as Record<string, number>; } catch { return {}; }
}

/** iTerm2에 줄 AppleScript: 창 번호(existing)가 아직 있으면 앞으로 보이고, 없으면 새 창에서 명령을 실행해 창 번호를 돌려준다 */
export function openScript(command: string, existing?: number): string {
  const cmd = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return [
    'tell application "iTerm2"',
    '  activate',
    existing ? `  if (count of (windows whose id is ${existing})) > 0 then\n    select (first window whose id is ${existing})\n    return ${existing}\n  end if` : '',
    `  set w to (create window with default profile command "${cmd}")`,
    '  return id of w',
    'end tell',
  ].filter(Boolean).join('\n');
}

/** 요청의 담당 세션 창을 연다(이미 열린 창이면 앞으로). 열지 않은 이유나 실패는 문자열로 돌려주고, 열었으면 빈 문자열 */
export function openSessionWindow(root: string, id: number, name: string): string {
  if (process.env.SPEC_TEST_DIR || process.env.SPEC_NO_TERMINAL) return '열지 않음(테스트 환경)';
  if (!name) return '담당 이름이 아직 없다';
  const wins = loadWindows(root);
  const run = spawnSync('osascript', ['-e', openScript(attachCommand(name), wins[String(id)])], { encoding: 'utf8', timeout: 15000 });
  if (run.status !== 0) return `iTerm2 창을 열지 못했다: ${(run.stderr || run.error?.message || '').trim().slice(0, 120)}`;
  const win = Number(run.stdout.trim());
  if (win) { wins[String(id)] = win; fs.mkdirSync(path.dirname(windowsFile(root)), { recursive: true }); fs.writeFileSync(windowsFile(root), JSON.stringify(wins, null, 2) + '\n'); }
  return '';
}
