/**
 * @spec reports 리포트와 확인 필요의 처리 기록
 * @why 에이전트가 발견한 것과 기계가 판단할 수 없어 올라온 "확인 필요"를 한 목록(리포트)에 모으고, 사람이 내린 결정(요청으로 등록 / 의도한 것 / 무시)을 남겨, 같은 항목이 다시 올라오지 않게 한다.
 * @basis 확인 필요 항목은 코드에서 계산하므로 저장하지 않고, 사람의 결정만 항목 열쇠에 붙여 .spec/reports.json에 저장한다. 에이전트 발견은 에이전트가 이 모듈의 명령(report add)으로 올린다.
 * @contract 파일 모양은 { items: AgentReport[], decisions: { [열쇠]: Decision } }이다. 사용자 결정은 설계서 보기 서버(middleware.ts)만 받는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { specDir } from './project.js';
import { parseArgs, csv, errorText } from './cli.js';
import { buildModel } from './model.js';
import type { AgentReport, Decision, Model, ReportRow, ReviewItem } from './types.js';

/** 저장 파일 모양 */
interface Store { items: AgentReport[]; decisions: Record<string, Decision>; numbers: Record<string, number> }
const fileOf = (scanRoot: string): string => path.join(specDir(scanRoot), 'reports.json');

/** 저장된 리포트와 결정을 읽는다. 없거나 깨졌으면 빈 것 */
export function loadReports(scanRoot: string): Store {
  try { const s = JSON.parse(fs.readFileSync(fileOf(scanRoot), 'utf8')) as Partial<Store>; return { items: s.items ?? [], decisions: s.decisions ?? {}, numbers: s.numbers ?? {} }; } catch { return { items: [], decisions: {}, numbers: {} }; }
}

/** 열쇠마다 리포트 번호를 정한다. 이미 정해진 번호는 그대로 두고, 새 열쇠에만 다음 번호를 준다(번호는 다시 쓰지 않는다). 새로 정했으면 저장한다 */
export function assignNumbers(scanRoot: string, keys: string[]): Record<string, number> {
  const s = loadReports(scanRoot);
  let next = Object.values(s.numbers).reduce((m, n) => Math.max(m, n), 0) + 1, changed = false;
  for (const k of keys) if (!(k in s.numbers)) { s.numbers[k] = next++; changed = true; }
  if (changed) save(scanRoot, s);
  return s.numbers;
}
function save(scanRoot: string, s: Store): void {
  fs.mkdirSync(path.dirname(fileOf(scanRoot)), { recursive: true });
  fs.writeFileSync(fileOf(scanRoot), JSON.stringify(s, null, 2) + '\n');
}

/** addReport가 받는 값 */
export interface NewReport {
  /** 한 줄 제목 */
  title: string;
  /** 자세한 설명 */
  detail?: string;
  /** 짧은 분류(보안, 화면 등) */
  label?: string;
  /** 어디서 발견했나 */
  from?: string;
  /** 관련 화면·정보·컴포넌트 이름들 */
  where?: string[];
  /** 이번 요청의 범위 밖에서 발견했는가 */
  outOfScope?: boolean;
}

/** 에이전트가 발견한 것을 리포트로 올린다 */
export function addReport(scanRoot: string, n: NewReport): AgentReport {
  if (!n.title?.trim()) throw new Error('리포트 제목이 비었다');
  const s = loadReports(scanRoot);
  const next = s.items.reduce((m, r) => Math.max(m, Number(r.id.replace(/\D/g, '')) || 0), 0) + 1;
  const r: AgentReport = { id: `agent:${next}`, title: n.title.trim(), detail: (n.detail ?? '').trim(), label: (n.label ?? '').trim(), from: (n.from ?? '주기 점검').trim(), where: n.where ?? [], at: new Date().toISOString(), outOfScope: !!n.outOfScope };
  s.items.push(r);
  s.numbers[r.id] = Object.values(s.numbers).reduce((m, n) => Math.max(m, n), 0) + 1;
  save(scanRoot, s);
  return r;
}

/** 사용자가 항목 하나에 결정을 남긴다(설계서 보기 화면에서만 부른다) */
export function decide(scanRoot: string, id: string, d: Omit<Decision, 'at'>): Decision {
  if (!id) throw new Error('항목 열쇠가 없다');
  if (d.state === 'intended' && !d.reason?.trim()) throw new Error('"의도한 것"은 이유를 한 줄 적어야 한다');
  const s = loadReports(scanRoot);
  const rec: Decision = { ...d, reason: d.reason?.trim(), at: new Date().toISOString() };
  s.decisions[id] = rec;
  save(scanRoot, s);
  return rec;
}

/** 리포트 화면에 보일 줄들: 에이전트 발견 + 확인 필요(처리한 것도 결정과 함께) */
export function reportRows(agent: AgentReport[], reviews: ReviewItem[], decisions: Record<string, Decision>, numbers: Record<string, number>, screens: Set<string>, infos: Set<string>): ReportRow[] {
  const kindOf = (name: string): 'screen' | 'info' | 'other' => (screens.has(name) ? 'screen' : infos.has(name) ? 'info' : 'other');
  const rows: ReportRow[] = [
    ...agent.map((a): ReportRow => ({ id: a.id, no: numbers[a.id] ?? 0, origin: 'agent', title: a.title, detail: a.detail, label: a.label, from: a.from, where: a.where.map((n) => ({ kind: kindOf(n), name: n })), at: a.at, decision: decisions[a.id] ?? null, review: null })),
    ...reviews.map((r): ReportRow => ({ id: r.id, no: numbers[r.id] ?? 0, origin: 'review', title: r.title, detail: r.help, label: '', from: r.screens.length ? '현행 구조 검사' : '정보 검사', where: [{ kind: 'info', name: r.info }, ...r.screens.map((n) => ({ kind: 'screen' as const, name: n }))], at: '', decision: decisions[r.id] ?? null, review: r })),
  ];
  return rows;
}

/** 리포트 한 건을 에이전트와 사람이 같은 모양으로 읽도록 글로 풀어 쓴다 */
export function describeRow(r: ReportRow): string {
  const out: string[] = [`리포트 #${r.no} · ${r.origin === 'agent' ? '에이전트 발견' : '확인 필요'} · ${r.decision ? `처리함(${{ registered: '요청으로 등록', intended: '의도한 것', ignored: '무시' }[r.decision.state] ?? r.decision.state})` : '처리 전'}`, r.title];
  if (r.detail) out.push(`설명: ${r.detail}`);
  if (r.label) out.push(`분류: ${r.label}`);
  out.push(`발견: ${r.from}${r.at ? ` · ${r.at.slice(0, 16).replace('T', ' ')}` : ''}`);
  if (r.review) {
    out.push(`정의된 곳: ${r.review.where}`);
    out.push(r.review.also.length ? `글자로 나오는 다른 곳: ${r.review.also.join(', ')}` : '글자로 나오는 다른 곳: 없음');
    if (r.review.screens.length) out.push(`이 정보를 쓰는 화면: ${r.review.screens.join(', ')}`);
    if (r.review.scenarios.length) out.push(`관련 사용 시나리오: ${r.review.scenarios.join(', ')}`);
    out.push(`판단: ${r.review.tone === 'ok' ? '지워도 안전해 보임' : '지우기 전에 위 곳들을 더 봐야 함'}`);
  } else if (r.where.length) out.push(`관련: ${r.where.map((w) => w.name).join(', ')}`);
  if (r.decision) out.push(`결정: ${r.decision.reason ? r.decision.reason + ' · ' : ''}${r.decision.at.slice(0, 16).replace('T', ' ')}`);
  return out.join('\n');
}

/** 모델에서 처리 전 리포트가 몇 건인지 센다 */
export const openCount = (rows: ReportRow[]): number => rows.filter((r) => !r.decision).length;

/** 명령: report add / list */
export async function main(argv: string[]): Promise<number | undefined> {
  const { pos, opts } = parseArgs(argv);
  const scanRoot = path.resolve(opts.src || 'src');
  try {
    if (pos[0] === 'add') {
      const r = addReport(scanRoot, { title: opts.title, detail: opts.detail, label: opts.label, from: opts.from, where: csv(opts.where), outOfScope: opts.outOfScope === 'true' });
      console.log(`리포트 ${r.id}: 올림 (설계서 보기 "관리 › 리포트"에서 사용자가 요청으로 등록하거나 무시한다)`);
    } else if (pos[0] === 'list') {
      const s = loadReports(scanRoot);
      for (const r of s.items) console.log(`#${s.numbers[r.id] ?? '?'} ${r.id} [${s.decisions[r.id]?.state ?? '처리 전'}] ${r.title}`);
    } else if (pos[0] === 'show') {
      const no = Number((pos[1] ?? '').replace('#', ''));
      if (!no) { console.error('사용: report show <번호> --src <소스 폴더>   (번호는 리포트 화면의 #31 같은 것)'); return 1; }
      const row = buildModel(scanRoot).reports.find((r) => r.no === no);
      if (!row) { console.error(`리포트 #${no}를 찾지 못했다 (코드가 바뀌어 해소된 확인 필요일 수 있다)`); return 1; }
      console.log(describeRow(row));
    } else {
      console.log('사용: node <스킬 폴더>/spec.mjs report add --title "…" [--detail "…"] [--label 보안] [--from "주기 점검"] [--where 화면1,정보1] [--outOfScope true] --src <소스 폴더>\n      node <스킬 폴더>/spec.mjs report list --src <소스 폴더>');
      return 1;
    }
  } catch (e) { console.error(`오류: ${errorText(e)}`); return 1; }
  return undefined;
}
