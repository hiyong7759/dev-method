/**
 * @spec land 합치기 전 확인과 main에 합치기
 * @why 요청마다 워크트리에서 일하므로, main에는 사용자가 테스트 승인한 코드만 들어가야 한다. 담당이 스스로 합치지 못하게 합치는 일을 하나의 명령(request land)으로 묶고, 합치기 전에 기계로 확인할 수 있는 것(범위 밖 변경·다른 브랜치와 같은 파일·타입 검사·시험)을 먼저 확인한다. 영향 범위 안 코드의 검토는 검토 에이전트(메인 세션)가 맡고, 전체를 다시 읽는 검토는 하지 않는다.
 * @contract `check`는 읽기와 검사만 한다(아무것도 바꾸지 않는다): ① 브랜치가 바꾼 파일이 승인된 설계의 files 안인지(.spec/ 아래와 .md 문서는 범위 밖으로 세지 않는다) ② 다른 열린 워크트리 브랜치가 같은 파일을 바꿨는지 ③ `npm run typecheck`와 `npm test`. `land`는 요청이 테스트 승인으로 끝났고 워크트리의 저장 안 한 변경이 없고 main 폴더가 main 브랜치일 때만 그 브랜치를 --no-ff로 합친다(승인 전이면 거부, 이미 합쳤으면 그대로 둔다). 충돌하면 합치기를 되돌리고 알린다. `overlapsOf`는 설계 승인 때 같은 파일을 건드리는 다른 진행 중 요청을 찾아 경고하는 데 쓴다(막지 않는다. 겹치면 기존 순서 기능으로 하나씩 하게 한다).
 */
import { execFileSync } from 'node:child_process';
import { loadOne } from './request.js';
import { projectRoot } from './project.js';
import { baseBranch, worktreeOf, worktreeRefOf } from './worktree.js';
import type { Request } from './types.js';

/** 요청이 끝났거나 취소됐는가 */
export const ended = (r: { stage: string }): boolean => r.stage === 'done' || r.stage === 'cancelled';

/** 요청이 건드린다고 적은 파일 경로들(승인된 것이 있으면 그것, 없으면 올린 설계의 것) */
const filesOf = (r: Request): string[] => (r.files ?? r.design?.files ?? []).map((f) => f.path);

/** 이 요청과 같은 파일을 건드리는 다른 진행 중 요청(접수만 된 요청은 설계가 없어 빠진다) */
export function overlapsOf(list: Request[], r: Request): { id: number; files: string[] }[] {
  if (ended(r)) return [];
  const mine = new Set(filesOf(r));
  if (!mine.size) return [];
  return list.filter((o) => o.id !== r.id && !ended(o)).map((o) => ({ id: o.id, files: filesOf(o).filter((f) => mine.has(f)) })).filter((o) => o.files.length);
}

const git = (cwd: string, args: string[]): string => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
const names = (s: string): string[] => s.split('\n').map((x) => x.trim()).filter(Boolean);
/** 범위 밖으로 세지 않는 변경: 요청 기록(.spec/)과 문서 */
const exempt = (f: string): boolean => f.startsWith('.spec/') || f.endsWith('.md');

/** 합치기 전 확인 결과 한 줄 */
export interface CheckLine {
  /** 통과했는가 */
  ok: boolean;
  /** 무엇을 확인했나 */
  what: string;
  /** 결과 설명 */
  detail: string;
}

/** 합치기 전 기계 확인. 하나라도 ok가 아니면 합치지 않는다 */
export function checkRequest(scanRoot: string, id: number, o: { run?: boolean } = {}): CheckLine[] {
  const root = projectRoot(scanRoot);
  const r = loadOne(scanRoot, id);
  const ref = worktreeRefOf(root, id);
  if (!ref) return [{ ok: false, what: '워크트리', detail: '이 요청의 담당 세션이 워크트리를 쓰지 않아 확인할 브랜치가 없다' }];
  const base = baseBranch(root);
  const out: CheckLine[] = [];
  const changed = names(git(root, ['diff', '--name-only', `${base}...${ref.branch}`]));
  // 구현하다 막혀 함께 고친 일(request also)로 남긴 파일도 범위 안으로 센다
  const allowed = new Set([...filesOf(r), ...(r.alsoFixed ?? []).map((a) => a.where)]);
  const outside = changed.filter((f) => !exempt(f) && !allowed.has(f));
  out.push({ ok: !outside.length, what: '설계 범위', detail: outside.length ? `승인된 설계의 files 밖 변경: ${outside.join(', ')}` : `바꾼 ${changed.length}개 파일이 모두 설계 범위 안` });
  const others: string[] = [];
  for (const line of names(git(root, ['worktree', 'list', '--porcelain']).split('\n').filter((l) => l.startsWith('branch ')).join('\n'))) {
    const b = line.replace('branch refs/heads/', '');
    if (b === ref.branch || b === base) continue;
    const same = names(git(root, ['diff', '--name-only', `${base}...${b}`])).filter((f) => changed.includes(f) && !exempt(f));
    if (same.length) others.push(`${b}(${same.join(', ')})`);
  }
  out.push({ ok: !others.length, what: '다른 열린 브랜치', detail: others.length ? `같은 파일을 바꾼 브랜치: ${others.join('; ')}` : '같은 파일을 바꾼 다른 브랜치 없음' });
  if (o.run !== false) {
    for (const [what, args] of [['타입 검사', ['run', 'typecheck']], ['시험', ['test']]] as const) {
      try { execFileSync('npm', [...args], { cwd: ref.path, encoding: 'utf8', timeout: 600000, stdio: ['ignore', 'pipe', 'pipe'] }); out.push({ ok: true, what, detail: '통과' }); } catch (e) { out.push({ ok: false, what, detail: `실패: ${String((e as { stdout?: string }).stdout ?? e).trim().split('\n').slice(-3).join(' / ')}` }); }
    }
  }
  return out;
}

/** 브랜치를 --no-ff로 합친다. 충돌 파일이 실행 기록(.spec/finish.json)뿐이면 main 쪽 것으로 풀어 합치고, 그 밖의 충돌은 합치기를 되돌리고 알린다 */
export function mergeBranch(root: string, branch: string, message: string, base: string): void {
  // main 폴더에서 finish를 돌려 저장 안 한 채 바뀐 실행 기록은 합치기를 막으므로(다시 돌리면 생기는 값) 되돌려 둔다
  if (git(root, ['status', '--porcelain', '--', '.spec/finish.json']).trim()) git(root, ['checkout', 'HEAD', '--', '.spec/finish.json']);
  try { git(root, ['merge', '--no-ff', branch, '-m', message]); return; } catch (e) {
    const conflicted = names(git(root, ['diff', '--name-only', '--diff-filter=U']));
    if (conflicted.length && conflicted.every((f) => f === '.spec/finish.json')) {
      git(root, ['checkout', '--ours', '.spec/finish.json']);
      git(root, ['add', '.spec/finish.json']);
      git(root, ['commit', '--no-edit']);
      return;
    }
    try { git(root, ['merge', '--abort']); } catch { /* 합치던 중이 아니면 할 일 없음 */ }
    throw new Error(`합치다 충돌해 되돌렸다. 담당이 ${base}를 가져와 고친 뒤 다시 한다: ${String((e as { stdout?: string }).stdout ?? e).trim().split('\n').slice(-2).join(' / ')}`);
  }
}

/** 테스트 승인된 요청의 브랜치를 main에 --no-ff로 합친다. 합친 줄을 돌려준다 */
export function landRequest(scanRoot: string, id: number): string {
  const root = projectRoot(scanRoot);
  const r = loadOne(scanRoot, id);
  if (!(r.stage === 'done' && r.events.some((e) => e.kind === 'test-approved'))) throw new Error(`요청 #${id}은 사용자가 테스트를 승인한 요청이 아니라 main에 합칠 수 없다`);
  const wt = worktreeOf(root, id);
  if (!wt) throw new Error(`요청 #${id}의 담당 세션은 워크트리를 쓰지 않아 합칠 브랜치가 없다`);
  if (wt.merged) return `요청 #${id}: 이미 ${baseBranch(root)}에 합쳐져 있다(${wt.branch})`;
  if (wt.dirty) throw new Error(`워크트리에 저장(커밋)하지 않은 변경이 ${wt.dirty}개 있다. 담당이 먼저 커밋해야 한다`);
  const base = baseBranch(root);
  const now = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (now !== base) throw new Error(`합치는 폴더가 ${base} 브랜치가 아니다(지금 ${now})`);
  mergeBranch(root, wt.branch, `요청 #${id}: ${r.title}\n\n사용자가 테스트 승인한 코드를 ${wt.branch}에서 합친다.\n\n요청 #${id}`, base);
  return `요청 #${id}: ${wt.branch}을(를) ${base}에 --no-ff로 합쳤다`;
}
