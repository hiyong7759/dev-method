/**
 * @spec owner-check 요청 담당이 원본인지 가리는 단 하나의 검사
 * @why 같은 요청의 담당 세션이 복사돼 둘이 되면 브랜치·워크트리가 겹쳐 만들어진다. "원본인가"를 사람·에이전트의 판단에 맡기지 않고 이 검사 하나가 가리고, 시작 확인(whoami)·훅·커밋·요청 명령이 모두 이것을 부른다.
 * @basis 서버가 만든 원본 담당은 담당 기록(.spec/sessions.json)에 origin 표시로 남는다. 담당 세션은 서버가 띄울 때 환경 변수 SPEC_OWNER_REQUEST(요청 번호)·SPEC_OWNER_SCAN(설계서 소스 폴더)을 받는다. 환경에 그 값이 없는 세션(메인 에이전트·사람이 연 창)은 담당이 아니므로 검사 대상이 아니다.
 * @contract 판정: original(묶인 원본) / syncing(서버가 claude --bg의 실제 번호를 맞추는 중이라 아직 모름) / copy(원본이 아님) / unbound(요청에 묶인 담당 기록이 없음, 통과) / unknown(세션 번호를 모름, 거절). 원본 표시가 있는 기록이 하나도 없는 옛 요청은 기록에 있는 세션이면 원본으로 본다. 막는 대상은 원본이 아닌 담당 세션의 워크트리 만들기·브랜치 만들기·커밋·요청 상태 변경이다. 막을 때는 요청에 '복사본이 거절됨' 한 줄만 남기고(막힘 표시는 하지 않는다. 복사본은 상태를 못 바꾼다) 같은 글을 10분 안에는 다시 적지 않는다.
 */
import { agentsList } from './outbox.js';
import { loadOwners, ownerName } from './session.js';
import { loadRequests, noteCopyRefused } from './request.js';
import { projectRoot } from './project.js';

/** 판정 */
export type Verdict = 'original' | 'syncing' | 'copy' | 'unbound' | 'unknown';

/** 번호 맞추는 중으로 보는 시간 */
const REBINDING_MS = 3 * 60 * 1000;

/** 이 세션이 요청 id의 원본 담당인지 */
export function verdictOf(root: string, id: number, sid: string | undefined, now = Date.now()): Verdict {
  if (!sid) return 'unknown';
  const all = loadOwners(root);
  const mine = Object.entries(all).filter(([, v]) => v.request === id);
  if (!mine.length) return 'unbound';
  const origins = mine.filter(([, v]) => v.origin);
  if (!origins.length) return all[sid]?.request === id ? 'original' : 'copy';
  if (origins.some(([k]) => k === sid)) return 'original';
  if (origins.some(([, v]) => v.rebinding && now - Date.parse(v.rebinding) < REBINDING_MS)) return 'syncing';
  return 'copy';
}

/** 같은 요청 이름으로 지금 떠 있는 다른 세션의 번호들(알 수 없으면 빈 목록) */
export function otherRunning(root: string, id: number, sid: string): string[] {
  try { return (agentsList() ?? []).filter((a) => a.name === ownerName(root, id) && a.sessionId && a.sessionId !== sid).map((a) => a.sessionId as string); } catch { return []; }
}

/** syncing이면 번호가 맞춰질 때까지 짧게 다시 본다(최대 waitMs). 서버가 실제 번호로 바꾸는 데 시간이 걸려 진짜 원본이 복사본으로 판정되는 일을 막는다 */
export function verdictWaiting(root: string, id: number, sid: string | undefined, waitMs = 15_000): Verdict {
  const end = Date.now() + waitMs;
  let v = verdictOf(root, id, sid);
  while (v === 'syncing' && Date.now() < end) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    v = verdictOf(root, id, sid);
  }
  return v;
}

/** 이 세션의 번호(환경에서 읽는다) */
export const mySession = (env: NodeJS.ProcessEnv = process.env): string | undefined => env.CLAUDE_CODE_SESSION_ID || undefined;

/** 사람이 읽는 판정 글 */
export function explain(v: Verdict, id: number, root: string, sid: string | undefined): string {
  const origin = Object.entries(loadOwners(root)).filter(([, x]) => x.request === id && x.origin).map(([k]) => k.slice(0, 8)).join(', ');
  const others = sid ? otherRunning(root, id, sid) : [];
  const tail = others.length ? ` · 같은 이름으로 떠 있는 다른 세션: ${others.map((o) => o.slice(0, 8)).join(', ')}` : '';
  if (v === 'original') return `원본 담당입니다(요청 #${id})${tail}`;
  if (v === 'unbound') return `요청 #${id}에 묶인 담당 기록이 없습니다(통과)${tail}`;
  if (v === 'syncing') return `원본 담당 번호를 서버가 맞추는 중입니다. 잠시 뒤 다시 확인하세요(요청 #${id})`;
  if (v === 'unknown') return `이 세션의 번호를 알 수 없어 원본인지 확인할 수 없습니다(요청 #${id})`;
  return `복사본입니다(요청 #${id}의 원본은 ${origin || '다른 세션'}). 일을 하지 말고 멈추세요. 원본이 맞는데 어긋난 것이면 사용자·메인 세션이 \`request adopt --id ${id} --session ${sid ?? '번호'}\`로 지정합니다${tail}`;
}

/** 담당 세션이 원본이 아니면 거절해야 하는 명령인가 */
export function needsOriginal(tool: string, command: string): boolean {
  if (tool === 'EnterWorktree') return true;
  if (tool !== 'Bash') return false;
  return /\bgit\s+(?:-C\s+\S+\s+)?(?:worktree\s+add\b|checkout\s+-[bB]\b|switch\s+-[cC]\b|branch\s+(?!-d\b|-D\b|--list|-a\b|-v\b|--show|--contains)[^-\s]|commit\b)/.test(command)
    || /spec\.mjs\s+(?:request\s+(?:design|impl|test|ask|blocked|ack|land|start|session|wake|agent)|finish)\b/.test(command);
}

/** 훅 한 번의 판단: 거절해야 하면 사유를, 통과면 null */
export function hookDecision(input: { session_id?: string; tool_name?: string; tool_input?: { command?: string } }, env: NodeJS.ProcessEnv = process.env): string | null {
  const id = Number(env.SPEC_OWNER_REQUEST);
  if (!id || !env.SPEC_OWNER_SCAN) return null;
  if (!needsOriginal(input.tool_name ?? '', input.tool_input?.command ?? '')) return null;
  const scan = env.SPEC_OWNER_SCAN;
  const root = projectRoot(scan);
  const v = verdictWaiting(root, id, input.session_id, 10_000);
  if (v === 'original' || v === 'unbound') return null;
  const why = explain(v, id, root, input.session_id);
  if (v === 'copy' || v === 'unknown') { try { noteCopyRefused(scan, id, `${input.session_id?.slice(0, 8) ?? '번호 모름'}가 ${input.tool_name === 'Bash' ? '명령' : input.tool_name} 시도`); } catch { /* 기록 실패가 거절을 바꾸지 않는다 */ } }
  return why;
}

/** 요청 상태를 바꾸는 request 명령 앞에서 부른다: 담당 세션(환경에 요청 번호가 있음)이 원본이 아니면 던진다 */
export function assertOriginal(scanRoot: string, env: NodeJS.ProcessEnv = process.env): void {
  const id = Number(env.SPEC_OWNER_REQUEST);
  if (!id) return;
  const root = projectRoot(scanRoot);
  const v = verdictWaiting(root, id, mySession(env), 10_000);
  if (v === 'original' || v === 'unbound') return;
  if (v === 'copy' || v === 'unknown') { try { noteCopyRefused(scanRoot, id, `${mySession(env)?.slice(0, 8) ?? '번호 모름'}가 요청 명령 시도`); } catch { /* 기록 실패가 거절을 바꾸지 않는다 */ } }
  throw new Error(explain(v, id, root, mySession(env)));
}

/** 요청이 있는지(훅이 없는 요청 번호로 기록하지 않게) */
export const requestExists = (scanRoot: string, id: number): boolean => loadRequests(scanRoot).some((r) => r.id === id);
