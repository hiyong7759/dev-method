/**
 * @spec samples-data 화면 확인용 견본 요청·전달 기록
 * @why '전달 안 됨' 빨간 이름표나 '함께 고친 것' 점선 상자는 실제로 그 일이 생겨야만 볼 수 있어, 화면을 바꿔도 모양을 확인하지 못하고 넘어가기 쉽다. 일부러 만든 견본 요청과 전달 기록으로 정상·경계·오류 모양을 언제든 열어 본다.
 * @contract 견본은 요청 번호 9001번대(결정 전달)와 9011번대(함께 고친 것)를 쓰고, 테스트 데이터 자리의 .spec에만 쓴다(`testdata samples`). 운영 .spec의 요청·전달 기록은 건드리지 않는다. 시각은 부른 때를 기준으로 만들어 모양(전달 중·전달 안 됨·훅 대기)이 해마다 같게 나온다.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AlsoFixed, Request } from './types.js';

/** 견본 전달 기록 한 건(delivery.ts의 저장 모양과 같다) */
interface SampleDelivery { decidedAt: string; sentAt?: string; readAt?: string; resent: number; via?: 'send' | 'bg-resume' | 'bg-new'; failedAt?: string; reason?: string }

/** 견본 한 벌: 요청들과 전달 기록 */
export interface SampleSet {
  /** 견본 요청들(요청 파일로 쓴다) */
  requests: Request[];
  /** 요청 번호 → 견본 전달 기록(deliveries.json에 합쳐 쓴다) */
  deliveries: Record<string, SampleDelivery>;
}

const MIN = 60_000;
const iso = (now: number, minAgo: number): string => new Date(now - minAgo * MIN).toISOString();

/** 구현 중인 요청 한 건(설계를 승인한 직후 모양) */
function implRequest(id: number, title: string, now: number, approvedMinAgo: number): Request {
  return {
    id, title, source: 'user', origin: { text: `견본: ${title}`, channel: '대화', at: iso(now, approvedMinAgo + 5) },
    scope: { screens: [], infos: [], scenarios: [] }, agent: { name: '견본 담당' },
    stage: 'impl', step: 'working',
    events: [
      { at: iso(now, approvedMinAgo + 5), by: 'agent', kind: 'created', note: '요청 등록(견본)' },
      { at: iso(now, approvedMinAgo), by: 'user', kind: 'design-approved', note: '설계 승인' },
    ],
  };
}

const also = (now: number, n: number): AlsoFixed[] => Array.from({ length: n }, (_, i) => ({ at: iso(now, 10 - i), text: `견본 ${i + 1}: 구현하다 막혀 함께 고친 일`, where: i % 2 ? 'src/viewer/reports.ts' : '', commit: i % 2 ? 'abc123' + i : '' }));

/** 견본 한 벌을 만든다 */
export function buildSamples(now = Date.now()): SampleSet {
  const normal = implRequest(9001, '[견본] 결정 전달 — 정상(보냈고 아직 읽기 전)', now, 1);
  const edge = implRequest(9002, '[견본] 결정 전달 — 경계(메신저가 못 보냈다고 이유를 남김 = 전달 안 됨)', now, 30);
  const error = implRequest(9003, '[견본] 결정 전달 — 오류(메신저가 아직 안 가져가 보냄 기록이 없음)', now, 3);
  const none = implRequest(9011, '[견본] 함께 고친 것 0건', now, 20);
  const one = { ...implRequest(9012, '[견본] 함께 고친 것 1건', now, 20), alsoFixed: also(now, 1) };
  const many = { ...implRequest(9013, '[견본] 함께 고친 것 여러 건(테스트 요청 카드에도 같은 목록이 보임)', now, 40), alsoFixed: also(now, 3), stage: 'test' as const, step: 'requested', test: { checks: {}, found: [], none: true } };
  many.events.push({ at: iso(now, 2), by: 'agent', kind: 'test-requested', note: '구현을 마치고 테스트 요청' });
  // 테스트 화면과 요청 상세 입구의 모양(점검 중 / 점검 통과로 사용자 차례 / 고쳐져 돌아와 다시 확인)을 보는 견본
  const seen = [{ what: '코드 리뷰 · 설계와 구현 비교', ok: true, detail: '빠진 것 없음' }, { what: '타입 검사 · 시험', ok: true, detail: '44개 통과' }, { what: '시나리오 단계 직접 확인', ok: true, detail: '12 / 12' }];
  const testReq = (id: number, title: string, step: string, test: NonNullable<Request['test']>): Request => ({ ...implRequest(id, title, now, 60), stage: 'test' as const, step, test, events: [...implRequest(id, title, now, 60).events, { at: iso(now, 3), by: 'agent', kind: step === 'requested' ? 'test-requested' : 'review-started', note: step === 'requested' ? '점검 통과 · 확인하세요' : '구현을 마치고 테스트를 올림' }] });
  const reviewing = testReq(9021, '[견본] 테스트 — 점검 중(사용자가 할 일 없음)', 'review', { checks: {}, found: [], none: false, review: { round: 1, state: 'running', startedAt: iso(now, 12), autoFixes: 0, seen: seen.slice(0, 2), failures: [] } });
  const yourTurn = testReq(9022, '[견본] 테스트 — 점검 통과, 짚은 것 없음(확인하세요)', 'requested', { checks: {}, found: [], none: false, review: { round: 1, state: 'passed', startedAt: iso(now, 20), doneAt: iso(now, 3), autoFixes: 0, seen, failures: [] }, notes: [] });
  const returned = testReq(9023, '[견본] 테스트 — 고쳐져 돌아와 지난번에 짚은 것을 다시 확인', 'requested', { checks: {}, found: [], none: false, review: { round: 2, state: 'passed', startedAt: iso(now, 20), doneAt: iso(now, 3), autoFixes: 0, seen, failures: [] }, notes: [
    { id: '1', kind: 'part', label: '요청 상세 › 제목 줄', url: '/', text: '제목이 너무 길어 두 줄로 잘린다', at: iso(now, 50), round: 1, status: 'returned' },
    { id: '2', kind: 'region', label: '요청 상세 › 그려서 지정한 영역', url: '/', text: '단계 줄 글자가 너무 작아 눈에 안 띈다', at: iso(now, 49), round: 1, status: 'returned' }] });
  return {
    requests: [normal, edge, error, none, one, many, reviewing, yourTurn, returned],
    deliveries: {
      9001: { decidedAt: iso(now, 1), sentAt: iso(now, 1), resent: 0, via: 'send' },
      9002: { decidedAt: iso(now, 30), failedAt: iso(now, 29), resent: 1, reason: '담당 세션이 닫혀 있고 claude --bg --resume이 실패함(견본)' },
      9003: { decidedAt: iso(now, 3), resent: 0 },
    },
  };
}

/** 견본을 테스트 데이터 자리의 .spec(specDir)에 쓴다. 같은 번호의 견본은 덮어쓴다. 쓴 요청 수를 돌려준다 */
export function writeSamples(specDir: string, now = Date.now()): number {
  const s = buildSamples(now);
  fs.mkdirSync(path.join(specDir, 'requests'), { recursive: true });
  for (const r of s.requests) fs.writeFileSync(path.join(specDir, 'requests', `${r.id}.json`), JSON.stringify(r, null, 2) + '\n');
  const file = path.join(specDir, 'deliveries.json');
  let cur: Record<string, unknown> = {};
  try { cur = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { /* 처음 */ }
  fs.writeFileSync(file, JSON.stringify({ ...cur, ...s.deliveries }, null, 2) + '\n');
  return s.requests.length;
}
