/**
 * @spec cli-args 명령줄 옵션 읽기
 * @why 명령마다 "--이름 값"과 "--켜기" 옵션을 따로 읽으면 같은 코드가 여러 번 생기고 서로 달라지므로, 읽는 법을 한 곳에 모은다.
 * @contract 값을 받지 않는 옵션(--check 등)은 부르는 쪽이 이름을 알려 줘야 한다. 알려 주지 않으면 다음 낱말을 그 옵션의 값으로 읽는다.
 */

/** 명령줄을 읽은 결과 */
export interface ParsedArgs {
  /** 옵션이 아닌 낱말들(순서대로) */
  pos: string[];
  /** "--이름 값" 옵션들 */
  opts: Record<string, string>;
  /** 값 없이 켜기만 하는 옵션들 */
  flags: Set<string>;
}

/** 명령줄 낱말들을 위치 인자, 값이 있는 옵션, 켜기 옵션으로 나눈다 */
export function parseArgs(argv: string[], boolFlags: string[] = []): ParsedArgs {
  const pos: string[] = [];
  const opts: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const name = a.slice(2);
    if (boolFlags.includes(name)) flags.add(name);
    else opts[name] = argv[++i] ?? '';
  }
  return { pos, opts, flags };
}

/** 쉼표로 이은 값을 목록으로 */
export const csv = (v: string | undefined): string[] => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** 잡은 오류에서 사람이 읽을 글만 꺼낸다 */
export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
