/**
 * @spec scenario-builder 사용 시나리오 모으기
 * @why 사용자가 이루려는 일(시나리오)과 그 단계·갈래·되돌아가기를 화면 단위가 아니라 일 단위로 보여 주려고, 컴포넌트와 화면의 @does에 적힌 시나리오 이름·단계 이름·다음 단계를 한데 모아 그래프로 만든다.
 * @contract 시나리오는 별도로 선언하지 않는다. @does의 세 번째 칸 "시나리오#단계", 네 번째 칸 "→ 다음 단계(쉼표로 여럿)", 다섯 번째 칸 "조건"이 전부다. 이름순(1, 2, 2b, 3)으로 가장 앞 단계가 시작이고, 각 단계의 첫 번째 다음 단계를 따라가는 길이 기본 흐름이다. 이름이 어긋나면 경고로 올린다.
 */
import type { Does, Extracted, Scenario, ScenarioEdge, ScenarioStep } from './types.js';

/** 단계 하나를 모으려고 잠깐 쓰는 재료: 일 + 그 일이 일어나는 자리 */
interface Raw { does: Does; owner: string; ownerKind: 'screen' | 'spec'; screens: string[]; file: string; line: number }

/** "단계" 또는 "시나리오#단계"를 (시나리오, 단계)로 나눈다. 시나리오가 없으면 빈 글 */
const splitRef = (ref: string): { scenario: string; step: string } => {
  const i = ref.indexOf('#');
  return i < 0 ? { scenario: '', step: ref.trim() } : { scenario: ref.slice(0, i).trim(), step: ref.slice(i + 1).trim() };
};

/** 단계 이름을 사람이 세는 순서로 비교한다: 숫자 먼저(1, 2, 10), 같은 숫자면 뒤 글자(2, 2b, 2c) */
const byStepId = (a: string, b: string): number => {
  const ma = a.match(/^(\d+)(.*)$/), mb = b.match(/^(\d+)(.*)$/);
  return ma && mb ? Number(ma[1]) - Number(mb[1]) || ma[2].localeCompare(mb[2]) : a.localeCompare(b);
};

/** 읽은 화면과 요소의 @does에서 사용 시나리오를 만든다. 어긋난 곳은 out.warnings에 보탠다 */
export function buildScenarios(out: Extracted): Scenario[] {
  const byScenario = new Map<string, Raw[]>();
  const add = (r: Raw): void => {
    if (!r.does.scenario) return;
    byScenario.set(r.does.scenario, [...(byScenario.get(r.does.scenario) ?? []), r]);
  };
  for (const s of out.screens) for (const d of s.does) add({ does: d, owner: s.name, ownerKind: 'screen', screens: [s.name], file: s.file, line: s.line });
  for (const sp of out.specs) for (const d of sp.does) add({ does: d, owner: sp.title, ownerKind: 'spec', screens: sp.screens, file: sp.file, line: sp.line });

  const screenDomain = new Map(out.screens.map((s) => [s.name, s.domain]));
  const scenarios: Scenario[] = [];
  for (const [name, raws] of byScenario) {
    const where = (r: Raw): string => `(${r.file}:${r.line})`;
    const ids = new Set<string>();
    for (const r of raws) {
      if (!r.does.step) { out.warnings.push(`시나리오 "${name}"의 "${r.does.title}"에 단계 이름이 없다 — "${name}#1"처럼 쓴다 ${where(r)}`); continue; }
      if (ids.has(r.does.step)) out.warnings.push(`시나리오 "${name}"에 단계 "${r.does.step}"가 두 번 나온다 ${where(r)}`);
      ids.add(r.does.step);
    }
    // 단계는 이름순(1, 2, 2b, 3)으로 놓는다 — 여러 파일에 흩어져 적혀도 순서가 흔들리지 않게
    raws.sort((x, y) => byStepId(x.does.step, y.does.step));
    const order = raws.filter((r) => r.does.step).map((r) => r.does.step);
    const edgesOf = (r: Raw): ScenarioEdge[] => r.does.next.map((n): ScenarioEdge => {
      const ref = splitRef(n);
      if (ref.scenario && ref.scenario !== name) {
        const other = byScenario.get(ref.scenario)?.some((x) => x.does.step === ref.step);
        if (!other) out.warnings.push(`시나리오 "${name}"의 "${r.does.title}"가 이어지는 "${n}"을 찾지 못했다 ${where(r)}`);
        return { to: ref.step, scenario: ref.scenario, kind: 'other' };
      }
      if (!ids.has(ref.step)) out.warnings.push(`시나리오 "${name}"의 "${r.does.title}"가 이어지는 단계 "${n}"을 찾지 못했다 ${where(r)}`);
      return { to: ref.step, scenario: '', kind: order.indexOf(ref.step) <= order.indexOf(r.does.step) ? 'loop' : 'forward' };
    });
    // 기본 흐름: 첫 단계에서 각 단계에서 조건이 없는 첫 번째 앞으로 가는 길을 따라간다(조건이 붙은 단계는 갈래)
    const main = new Set<string>();
    const raw = new Map(raws.filter((r) => r.does.step).map((r) => [r.does.step, r]));
    for (let cur = order[0]; cur && !main.has(cur);) {
      main.add(cur);
      const next = raw.get(cur) && edgesOf(raw.get(cur) as Raw).find((e) => e.kind === 'forward' && !raw.get(e.to)?.does.cond);
      cur = next ? next.to : '';
    }
    const steps: ScenarioStep[] = raws.filter((r) => r.does.step).map((r) => ({
      id: r.does.step, title: r.does.title, check: r.does.check, owner: r.owner, ownerKind: r.ownerKind, screens: r.screens,
      cond: r.does.cond, edges: edgesOf(r), main: main.has(r.does.step), file: r.file, line: r.line,
    }));
    const first = steps[0];
    scenarios.push({ name, domain: first ? (screenDomain.get(first.screens[0]) ?? '') : '', steps, firstScreens: first ? first.screens : [] });
  }
  return scenarios;
}
