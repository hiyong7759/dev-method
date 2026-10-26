/**
 * @spec agent-conversation 담당 세션의 지난 대화 읽기
 * @why 담당 세션이 일하는 중에 사용자가 그 세션에 직접 접속하면 접속이 입력으로 받아들여져 일이 멈추고, 접속해도 지난 대화는 보이지 않았다. 세션 기록 파일을 읽기만 해서 화면에 보여 주면 세션에 끼어들지 않으니 일이 멈추지 않고, 지난 일도 전부 보인다.
 * @contract 읽기만 한다(세션 기록 파일 ~/.claude/projects/<프로젝트>/<세션>.jsonl을 고치지 않는다). 사용자·에이전트의 글과 에이전트가 쓴 도구 이름만 시간순으로 돌려주고, 도구 결과·내부 메타 줄은 뺀다. 글 하나는 2000자까지, 세션마다 마지막 300줄까지. 요청의 담당 세션이 여럿이면(중복 세션) 모두 돌려준다. 파일이 없거나 깨져도 던지지 않고 빈 목록을 돌려준다.
 */
import fs from 'node:fs';
import { ownersOf, transcriptOf } from './session.js';
import { projectRoot } from './project.js';

/** 대화 한 줄(화면의 "대화 보기"에 한 줄로 보인다) */
export interface Turn {
  /** 누가 한 말인가: 받은 글(user), 에이전트(agent), 에이전트가 쓴 도구(tool) */
  role: 'user' | 'agent' | 'tool';
  /** 언제 */
  at: string;
  /** 내용(2000자까지) */
  text: string;
}
/** 담당 세션 하나의 지난 대화 */
export interface Conversation {
  /** 어느 세션인지 */
  sid: string;
  /** 보여 줄 줄들(마지막 300줄까지) */
  turns: Turn[];
  /** 세션에 있는 전체 줄 수(잘렸는지 알리려고) */
  total: number;
}

const MAX_TEXT = 2000;
const MAX_TURNS = 300;

/** 기록 한 줄에서 보여 줄 것을 뽑는다 */
function turnsOf(line: string): Turn[] {
  let j: { type?: string; isMeta?: boolean; isSidechain?: boolean; timestamp?: string; message?: { content?: unknown } };
  try { j = JSON.parse(line); } catch { return []; }
  if ((j.type !== 'user' && j.type !== 'assistant') || j.isMeta || j.isSidechain) return [];
  const at = j.timestamp ?? '';
  const c = j.message?.content;
  const parts = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c as { type?: string; text?: string; name?: string; input?: { command?: string; file_path?: string } }[] : [];
  const out: Turn[] = [];
  for (const p of parts) {
    if (p.type === 'text' && p.text?.trim()) out.push({ role: j.type === 'user' ? 'user' : 'agent', at, text: p.text.trim().slice(0, MAX_TEXT) });
    else if (p.type === 'tool_use' && j.type === 'assistant') out.push({ role: 'tool', at, text: `${p.name ?? '도구'} ${(p.input?.command ?? p.input?.file_path ?? '').slice(0, 200)}`.trim() });
  }
  return out;
}

/** 요청의 담당 세션들의 지난 대화 */
export function conversationsOf(scanRoot: string, id: number): Conversation[] {
  const root = projectRoot(scanRoot);
  return ownersOf(root, id).map((sid) => {
    let turns: Turn[] = [];
    try { turns = fs.readFileSync(transcriptOf(root, sid), 'utf8').split('\n').filter(Boolean).flatMap(turnsOf); } catch { /* 기록이 없으면 빈 대화 */ }
    return { sid, turns: turns.slice(-MAX_TURNS), total: turns.length };
  });
}
