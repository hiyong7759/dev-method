/**
 * @spec reports 리포트와 확인 필요의 처리 기록
 * @why 모든 문제를 한 목록(리포트)에 모으고, 사람이 내린 결정(요청으로 처리 / 그냥 둠 / 도구 개선으로 전달)과 더 분석 기록(사용자 의견·에이전트 조사)을 남겨, 같은 항목이 다시 올라오지 않게 하고 사용자가 소스를 열어 보지 않고도 판단하게 한다.
 * @basis 확인 필요 항목은 코드에서 계산하므로 저장하지 않고, 사람의 결정과 더 분석 기록만 항목 열쇠에 붙여 .spec/reports.json에 저장한다. 에이전트 발견은 에이전트가 이 모듈의 명령(report add)으로 올리고, 더 분석 결과는 report note로 붙인다.
 * @contract 파일 모양은 { items, decisions: { [열쇠]: Decision }, notes: { [열쇠]: ReportNote[] }, numbers }이다. 예전 결정 '의도한 것'·'무시'는 읽을 때 '그냥 둠'으로 본다. 사용자 결정과 의견은 설계서 보기 서버(middleware.ts)만 받는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { specDir, projectRoot } from './project.js';
import { ROOT_DIR } from './paths.js';
import { addRequest, loadRequests } from './request.js';
import { kst } from './kst.js';
import { parseArgs, csv, errorText } from './cli.js';
import { buildModel } from './model.js';
import type { AgentReport, Choice, Decision, ReportNote, ReportRow, ReviewItem } from './types.js';

/** 저장 파일 모양 */
interface Store { items: AgentReport[]; decisions: Record<string, Decision>; notes: Record<string, ReportNote[]>; numbers: Record<string, number> }
const fileOf = (scanRoot: string): string => path.join(specDir(scanRoot), 'reports.json');

/** 저장된 리포트와 결정을 읽는다. 없거나 깨졌으면 빈 것 */
export function loadReports(scanRoot: string): Store {
  try {
    const s = JSON.parse(fs.readFileSync(fileOf(scanRoot), 'utf8')) as Partial<Store>;
    const decisions = Object.fromEntries(Object.entries(s.decisions ?? {}).map(([k, d]) => [k, legacy(d)]));
    return { items: s.items ?? [], decisions, notes: s.notes ?? {}, numbers: s.numbers ?? {} };
  } catch { return { items: [], decisions: {}, notes: {}, numbers: {} }; }
}

/** 예전 기록의 '의도한 것'·'무시'는 '그냥 둠'으로 읽는다 */
function legacy(d: Decision): Decision {
  const old = d.state as string;
  return old === 'intended' || old === 'ignored' ? { ...d, state: 'kept' } : d;
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
  /** 에이전트 추천: registered(요청으로 처리) · kept(그냥 둠) · analyze(더 분석) */
  recommend?: Choice;
  /** 추천 이유 한 줄 */
  why?: string;
}

/** 에이전트가 발견한 것을 리포트로 올린다 */
export function addReport(scanRoot: string, n: NewReport): AgentReport {
  if (!n.title?.trim()) throw new Error('리포트 제목이 비었다');
  const s = loadReports(scanRoot);
  const next = s.items.reduce((m, r) => Math.max(m, Number(r.id.replace(/\D/g, '')) || 0), 0) + 1;
  const r: AgentReport = { id: `agent:${next}`, title: n.title.trim(), detail: (n.detail ?? '').trim(), label: (n.label ?? '').trim(), from: (n.from ?? '주기 점검').trim(), where: n.where ?? [], at: new Date().toISOString(), outOfScope: !!n.outOfScope, ...(n.recommend ? { recommend: n.recommend } : {}), ...(n.why?.trim() ? { why: n.why.trim() } : {}) };
  s.items.push(r);
  s.numbers[r.id] = Object.values(s.numbers).reduce((m, n) => Math.max(m, n), 0) + 1;
  save(scanRoot, s);
  return r;
}

/** 사용자가 항목 하나에 결정을 남긴다(설계서 보기 화면에서만 부른다) */
export function decide(scanRoot: string, id: string, d: Omit<Decision, 'at'>): Decision {
  if (!id) throw new Error('항목 열쇠가 없다');
  const s = loadReports(scanRoot);
  const rec: Decision = { ...d, reason: d.reason?.trim(), at: new Date().toISOString() };
  s.decisions[id] = rec;
  save(scanRoot, s);
  return rec;
}

/** 더 분석 기록을 한 줄 붙인다. 사용자 의견이면 카드가 확인 중이 되고, 에이전트 조사 결과면 결정 대기가 된다 */
export function addNote(scanRoot: string, id: string, n: Omit<ReportNote, 'at'>): ReportNote {
  if (!id) throw new Error('항목 열쇠가 없다');
  if (n.by === 'agent' && !n.text.trim()) throw new Error('조사 내용이 비었다');
  const s = loadReports(scanRoot);
  const rec: ReportNote = { ...n, text: n.text.trim(), at: new Date().toISOString() };
  (s.notes[id] ??= []).push(rec);
  save(scanRoot, s);
  return rec;
}

/** 카드 상태: 결정이 있으면 처리함, 없으면 마지막 기록을 쓴 쪽으로 정한다 */
function stageOf(decision: Decision | null, notes: ReportNote[]): ReportRow['stage'] {
  if (decision) return '처리함';
  const last = notes[notes.length - 1];
  return !last ? '처리 전' : last.by === 'user' ? '확인 중' : '결정 대기';
}

type Rec = ReportRow['recommend'];

/** 에이전트 추천: 에이전트의 마지막 조사가 새 추천을 달았으면 그것, 아니면 처음 정리한 추천 */
function recommendOf(first: Rec, notes: ReportNote[]): Rec {
  const last = [...notes].reverse().find((n) => n.by === 'agent' && n.recommend);
  return last ? { pick: last.recommend ?? null, why: last.text } : first;
}

/** 도구가 못 읽어서 생긴 확인 필요인가: 쓰는 곳은 못 찾았지만 같은 이름이 다른 곳에 나오는 필드(손으로 다시 정의한 복사본·글자 이름으로 다루는 필드) */
export const isToolLimit = (r: ReviewItem): boolean => !!r.prop && r.tone === 'warn';

/** 도구가 계산한 확인 필요의 처음 추천: 코드와 글자 모두에서 못 찾았으면 요청으로 처리(지우기), 도구 몫이면 추천하지 않는다 */
function reviewRecommend(r: ReviewItem): Rec {
  if (r.tone === 'ok') return { pick: 'registered', why: '코드와 글자 모두에서 쓰는 곳을 찾지 못했습니다. 지워도 고객이 쓰는 화면에는 영향이 없어 보입니다.' };
  if (!r.prop) return { pick: 'registered', why: '이 정보는 어디에서도 쓰이지 않습니다. 지우면 정보 흐름이 단순해집니다.' };
  return { pick: null, why: '도구가 읽지 못하는 모양이라 이 프로젝트에서 할 일은 없어 보입니다.' };
}

/** 리포트 화면에 보일 줄들: 에이전트 발견 + 확인 필요(처리한 것도 결정과 함께) */
export function reportRows(agent: AgentReport[], reviews: ReviewItem[], decisions: Record<string, Decision>, allNotes: Record<string, ReportNote[]>, numbers: Record<string, number>, screens: Set<string>, infos: Set<string>): ReportRow[] {
  const kindOf = (name: string): 'screen' | 'info' | 'other' => (screens.has(name) ? 'screen' : infos.has(name) ? 'info' : 'other');
  const state = (id: string, first: Rec, tool: boolean): Pick<ReportRow, 'decision' | 'notes' | 'stage' | 'recommend' | 'pending' | 'toolRequest'> => {
    const decision = decisions[id] ?? null, notes = allNotes[id] ?? [];
    const stage = stageOf(decision, notes), recommend = recommendOf(first, notes);
    // 추천을 못 채운 건은 사용자 앞에 '추천 없음'으로 올리지 않고 에이전트 몫으로 남긴다(사용자가 의견을 달아 맡긴 건은 확인 중이라 그대로)
    // 도구가 못 읽는 모양은 처음부터 추천이 없는 게 정상이라(도구 몫) 에이전트가 채울 게 없으므로 정리 중에 넣지 않는다
    const pending = !decision && !tool && stage !== '확인 중' && !recommend.pick;
    return { decision, notes, stage, recommend, pending, ...(decision?.state === 'tool' && decision.request ? { toolRequest: decision.request } : {}) };
  };
  const rows: ReportRow[] = [
    ...agent.map((a): ReportRow => ({ id: a.id, no: numbers[a.id] ?? 0, origin: 'agent', title: a.title, detail: a.detail, label: a.label, from: a.from, where: a.where.map((n) => ({ kind: kindOf(n), name: n })), at: a.at, review: null, tool: false, ...state(a.id, { pick: a.recommend ?? null, why: a.why ?? '' }, false) })),
    ...reviews.map((r): ReportRow => ({ id: r.id, no: numbers[r.id] ?? 0, origin: 'review', title: r.title, detail: r.help, label: '', from: r.screens.length ? '현행 구조 검사' : '정보 검사', where: [{ kind: 'info', name: r.info }, ...r.screens.map((n) => ({ kind: 'screen' as const, name: n }))], at: '', review: r, tool: isToolLimit(r), ...state(r.id, reviewRecommend(r), isToolLimit(r)) })),
  ];
  return rows;
}

/** 리포트 한 건을 에이전트와 사람이 같은 모양으로 읽도록 글로 풀어 쓴다 */
export function describeRow(r: ReportRow): string {
  const out: string[] = [`리포트 #${r.no} · ${r.origin === 'agent' ? '에이전트 발견' : '확인 필요'} · ${r.decision ? `처리함(${{ registered: '요청으로 처리', kept: '그냥 둠', tool: '도구 개선으로 전달' }[r.decision.state] ?? r.decision.state})` : '처리 전'}`, r.title];
  if (r.detail) out.push(`설명: ${r.detail}`);
  if (r.label) out.push(`분류: ${r.label}`);
  out.push(`발견: ${r.from}${r.at ? ` · ${kst(r.at, true)}` : ''}`);
  if (r.review) {
    out.push(`정의된 곳: ${r.review.where}`);
    out.push(r.review.also.length ? `글자로 나오는 다른 곳: ${r.review.also.join(', ')}` : '글자로 나오는 다른 곳: 없음');
    if (r.review.screens.length) out.push(`이 정보를 쓰는 화면: ${r.review.screens.join(', ')}`);
    if (r.review.scenarios.length) out.push(`관련 사용 시나리오: ${r.review.scenarios.join(', ')}`);
    out.push(`판단: ${r.review.tone === 'ok' ? '지워도 안전해 보임' : '지우기 전에 위 곳들을 더 봐야 함'}`);
  } else if (r.where.length) out.push(`관련: ${r.where.map((w) => w.name).join(', ')}`);
  if (r.recommend.pick) out.push(`에이전트 추천: ${{ registered: '요청으로 처리', kept: '그냥 둠', analyze: '더 분석' }[r.recommend.pick]} — ${r.recommend.why}`);
  if (r.tool) out.push('도구가 못 읽는 모양: 이 프로젝트가 할 일은 없고 도구 개선으로 전달할 후보');
  if (r.pending) out.push('에이전트가 추천을 정리 중: 아직 사용자가 결정할 건이 아니다(report note로 추천을 채우면 결정 대기로 올라간다)');
  if (r.toolRequest) out.push(`도구 개선 요청: dev-method 요청 #${r.toolRequest}로 접수됨`);
  for (const n of r.notes) out.push(`${n.by === 'user' ? '사용자 의견' : '에이전트 조사'}: ${n.text}`);
  if (r.decision) out.push(`결정: ${r.decision.reason ? r.decision.reason + ' · ' : ''}${kst(r.decision.at, true)}`);
  return out.join('\n');
}

/** 사용자가 결정할 리포트가 몇 건인지 센다(도구 몫과 에이전트가 확인 중이거나 정리 중인 것은 뺀다) */
export const openCount = (rows: ReportRow[]): number => rows.filter((r) => !r.decision && !r.tool && !r.pending && r.stage !== '확인 중').length;

/** 도구 개선 요청이 들어갈 dev-method의 소스 폴더(도구 저장소 안의 src) */
export const TOOL_SCAN_ROOT = path.join(ROOT_DIR, 'src');

/** 도구 개선으로 전달: 그 건들을 dev-method 쪽에 '시작 전' 개선 요청으로 접수하고 건마다 요청 번호를 돌려준다. 같은 건(같은 프로젝트·같은 열쇠)이 이미 접수돼 있으면 새로 만들지 않고 그 번호를 쓴다 */
export function sendToTool(scanRoot: string, rows: ReportRow[], toolScanRoot: string = TOOL_SCAN_ROOT): Record<string, number> {
  const project = path.basename(projectRoot(scanRoot));
  const mark = (r: ReportRow): string => `[${project}:${r.id}]`;
  const existing = loadRequests(toolScanRoot).filter((q) => q.stage !== 'cancelled');
  const out: Record<string, number> = {};
  const fresh: ReportRow[] = [];
  for (const r of rows) {
    const hit = existing.find((q) => q.origin.text.includes(mark(r)));
    if (hit) out[r.id] = hit.id; else fresh.push(r);
  }
  if (fresh.length) {
    const origin = fresh.map((r) => [`${mark(r)} #${r.no} ${r.title}`, r.review ? `  정의된 곳 ${r.review.where}${r.review.also.length ? ` · 같은 이름이 나오는 곳 ${r.review.also.slice(0, 5).join(', ')}` : ''}` : ''].filter(Boolean).join('\n')).join('\n');
    const q = addRequest(toolScanRoot, { title: `도구 개선: ${project}에서 도구가 못 읽은 모양 ${fresh.length}건`, origin, channel: '도구 개선', source: 'report', noTest: '도구가 못 읽는 모양을 고치는 후보라, 화면·시나리오는 설계에서 정한다' });
    for (const r of fresh) out[r.id] = q.id;
  }
  return out;
}

/** 명령: report add / list */
export async function main(argv: string[]): Promise<number | undefined> {
  const { pos, opts } = parseArgs(argv);
  const scanRoot = path.resolve(opts.src || 'src');
  try {
    if (pos[0] === 'add') {
      const r = addReport(scanRoot, { title: opts.title, detail: opts.detail, label: opts.label, from: opts.from, where: csv(opts.where), outOfScope: opts.outOfScope === 'true', recommend: opts.recommend as Choice | undefined, why: opts.why });
      console.log(`리포트 ${r.id}: 올림 (설계서 보기 "관리 › 리포트"에서 사용자가 요청으로 처리·그냥 둠·더 분석 중 고른다)`);
    } else if (pos[0] === 'note') {
      // 사용자가 '더 분석'으로 맡긴 건을 조사한 뒤, 결과와 새 추천을 카드에 붙인다
      const no = Number((pos[1] ?? '').replace('#', ''));
      const row = buildModel(scanRoot).reports.find((r) => r.no === no);
      if (!no || !row) { console.error('사용: report note <번호> --text "조사한 사실" [--recommend registered|kept|analyze] --src <소스 폴더>'); return 1; }
      const rec = opts.recommend;
      if (rec && rec !== 'registered' && rec !== 'kept' && rec !== 'analyze') { console.error('--recommend는 registered(요청으로 처리) · kept(그냥 둠) · analyze(더 분석) 중 하나다'); return 1; }
      addNote(scanRoot, row.id, { by: 'agent', text: opts.text ?? '', recommend: rec as Choice | undefined });
      console.log(`리포트 #${no}: 조사 결과를 붙임 (결정 대기로 올라가 사용자가 세 갈래 중 고른다)`);
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
      console.log('사용: node <스킬 폴더>/spec.mjs report add --title "…" [--detail "…"] [--label 보안] [--from "주기 점검"] [--where 화면1,정보1] [--outOfScope true] [--recommend registered|kept|analyze --why "추천 이유 한 줄"] --src <소스 폴더>\n      node <스킬 폴더>/spec.mjs report note <번호> --text "조사한 사실" [--recommend …] --src <소스 폴더>\n      node <스킬 폴더>/spec.mjs report list --src <소스 폴더>');
      return 1;
    }
  } catch (e) { console.error(`오류: ${errorText(e)}`); return 1; }
  return undefined;
}
