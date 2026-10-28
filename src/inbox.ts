/**
 * @spec inbox-hook 담당 세션에 사용자 결정 전달
 * @why 설계 승인·반려, 테스트 승인·반려, 순서 정하기는 사용자가 설계서 보기에서 하는데, 그 요청을 맡은 에이전트 세션이 모르면 일이 멈춘다. 감시기를 따로 돌리지 않고, 세션이 다음에 움직일 때(사용자가 말을 걸 때, 도구를 쓴 뒤) 훅이 새 결정을 읽어 알려 준다.
 * @contract 열린 세션에 결정을 넣어 주는 보조 길이다(헤드리스가 아니다. 메인 길은 outbox.ts의 메신저). 읽음은 여기서 찍지 않고 받은 세션의 `request ack`만 찍는다. Claude Code 훅(PostToolUse·UserPromptSubmit)이 표준입력으로 훅 JSON을 넘긴다. 세션이 `request agent --id N`을 실행하면(요청을 접수만 한 `request add`는 담당이 아니다) 그 세션을 요청 N의 담당으로 .spec/sessions.json에 적고(커밋하지 않는다), 이후 그 요청 파일에 사용자가 남긴 새 기록만 additionalContext로 돌려준다. 담당이 아닌 세션과 설계서 보기를 쓰지 않는 프로젝트에서는 아무것도 하지 않는다. 훅은 어떤 경우에도 세션을 막지 않는다(항상 종료 코드 0).
 */
import fs from 'node:fs';
import path from 'node:path';
import { configFile } from './config.js';
import { kst } from './kst.js';
import { loadRequests } from './request.js';

/** 훅이 넘기는 JSON 중 쓰는 것 */
interface HookInput {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  /** UserPromptSubmit에서 사용자가(또는 깨움 명령이) 입력한 글 */
  prompt?: string;
  tool_name?: string;
  tool_input?: { command?: string };
  tool_response?: unknown;
}
/** 담당 세션 기록: 세션 번호 → 맡은 요청과 어디까지 알렸는지 */
type Sessions = Record<string, { request: number; seen: string; origin?: boolean; rebinding?: string }>;

/** 알릴 사용자 기록 종류와, 에이전트가 이어서 할 일 */
const NEXT: Record<string, (id: number, note: string) => string> = {
  'design-approved': (id) => `구현을 시작하세요(구현이 끝나면 request impl --id ${id} → finish → request test --id ${id}).`,
  'design-rejected': (id) => `반려 이유를 읽고 설계를 고쳐 request design --id ${id}로 다시 올리세요.`,
  redesigned: (id) => `사용자가 설계 변경을 요청했습니다. 진행 기록의 변경사항을 읽고 설계를 고쳐 request design --id ${id}로 다시 올리세요(이미 한 커밋과 이전 설계는 기록으로 남습니다).`,
  'test-approved': () => '요청이 완료됐습니다. 더 할 일이 없으면 마무리하세요.',
  'test-problem': (id) => `같은 요청에서 고친 뒤 request test --id ${id}로 테스트를 다시 올리세요.`,
  merged: (id) => `이 요청에 새 요구가 합쳐졌습니다. 요청 파일(.spec/requests/${id}.json)의 원문을 다시 읽고 설계에 반영하세요.`,
  order: () => '끝나는 순서가 정해졌습니다. 기다려야 하면 먼저 끝나는 요청이 끝난 뒤 시작하세요.',
};

/** 훅 JSON에서 이 프로젝트 루트(.spec/config.json이 있는 가장 가까운 위 폴더) */
function findRoot(from: string): string | null {
  let d = path.resolve(from);
  for (;;) {
    if (fs.existsSync(configFile(d))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

/** 명령: inbox (표준입력으로 훅 JSON) */
export async function main(): Promise<number> {
  let input: HookInput = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')) as HookInput; } catch { return 0; }
  try {
    const root = findRoot(input.cwd || process.cwd());
    const sid = input.session_id;
    if (!root || !sid) return 0;
    const file = path.join(root, '.spec', 'sessions.json');
    let sessions: Sessions = {};
    try { sessions = JSON.parse(fs.readFileSync(file, 'utf8')) as Sessions; } catch { /* 처음 */ }
    const requests = loadRequests(root);
    const save = (): void => { fs.writeFileSync(file, JSON.stringify(sessions, null, 2) + '\n'); };
    // 이 세션이 담당으로 정하면(request agent) 그 요청의 담당으로 적는다(그때까지의 기록은 이미 아는 것으로 본다)
    if (input.hook_event_name === 'PostToolUse' && input.tool_name === 'Bash') {
      const cmd = input.tool_input?.command ?? '';
      // 요청을 접수(add)만 한 세션은 담당이 아니다. 접수한 세션이 담당으로 적히면 요청을 시작할 때 "담당이 이미 있다"고 보아 담당 세션이 만들어지지 않는다
      const bound = cmd.match(/spec\.mjs\s+request\s+agent\b[^\n]*?--id[ =](\d+)/)?.[1];
      const req = bound ? requests.find((r) => r.id === Number(bound)) : undefined;
      // 서버가 만든 원본 담당이 따로 있으면(번호를 맞추는 중이 아닐 때) 다른 세션이 스스로 담당이 되지 못한다: 복사본이 원본 행세를 하지 못하게
      const origin = req ? Object.entries(sessions as Record<string, { request: number; origin?: boolean; rebinding?: string }>).filter(([, v]) => v.request === req.id && v.origin) : [];
      if (req && origin.length && !origin.some(([k, v]) => k === sid || (v.rebinding && Date.now() - Date.parse(v.rebinding) < 3 * 60 * 1000))) return 0;
      if (req) { sessions[sid] = { ...sessions[sid], request: req.id, seen: req.events[req.events.length - 1]?.at ?? new Date().toISOString() }; save(); return 0; }
    }
    const mine = sessions[sid];
    const req = mine ? requests.find((r) => r.id === mine.request) : undefined;
    if (!mine || !req) return 0;
    // 읽음은 여기서 찍지 않는다: 받은 세션이 `request ack`로 응답할 때만 찍힌다(글이 들어왔거나 훅이 넣어 줬다는 것은 읽었다는 뜻이 아니다)
    const news = req.events.filter((e) => e.by === 'user' && e.at > mine.seen && NEXT[e.kind]);
    if (!news.length) return 0;
    mine.seen = req.events[req.events.length - 1].at;
    save();
    const lines = news.map((e) => `- ${e.note} (${kst(e.at)}): ${NEXT[e.kind](req.id, e.note)}`);
    const text = `[spec-view] 요청 #${req.id} "${req.title}"에 사용자가 결정했습니다.\n${lines.join('\n')}`;
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: input.hook_event_name || 'UserPromptSubmit', additionalContext: text } }));
  } catch { /* 훅은 세션을 막지 않는다 */ }
  return 0;
}
