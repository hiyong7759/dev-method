/**
 * @spec design-status-view 시안 현황 화면
 * @why 시안(Claude Design 캔버스)과 구현이 서로 맞는지 판마다 보여 주어, 사용자도 에이전트도 어느 쪽이 최신인지 한눈에 알고 어긋난 곳을 먼저 손보게 한다.
 * @contract model.designs를 그대로 그린다(상태는 .spec/design-map.json과 소스의 커밋 기록으로 도구가 계산한다). 손볼 것이 위에 오고, 이상 없는 판은 아래에 접어 둔다. 이 화면은 읽기 전용이다.
 */
import { h, pageHead, filterChips, chip, buls, type BulKind, type Tone } from './util.js';
import type { Kid } from './util.js';
import { hash, nav } from './route.js';
import type { DesignView, Model } from '../types.js';

/**
 * @spec design-status-folded 그 밖의 판 접힘 영역
 * @anchor dom:details.rdone
 * @open 누르기 그 밖의 판
 * @why 구현과 같거나 참고용인 시안은 손볼 것을 가리지 않도록 접어 두고, 사용자가 누르면 펼쳐 본다.
 */

/** 기호 → 이름표 색과 짧은 이름 */
const MARK: Record<DesignView['mark'], { tone: Tone; name: string }> = {
  '✓': { tone: 'ok', name: '구현과 같음' }, '△': { tone: 'me', name: '소스가 더 최신' }, '≠': { tone: 'bad', name: '대조해 보니 다름' },
  '◇': { tone: 'ag', name: '아직 구현 전' }, '?': { tone: 'dim', name: '대조 안 됨' }, '·': { tone: 'dim', name: '참고용' },
};
/** 손볼 정도(큰 것이 먼저) */
const WEIGHT: Record<DesignView['mark'], number> = { '≠': 5, '△': 4, '◇': 3, '?': 2, '✓': 1, '·': 0 };

/** 판들 중 가장 손볼 것이 많은 상태(화면 패널 한 줄에 쓴다) */
export const worstMark = (list: DesignView[]): DesignView['mark'] => list.reduce((w, d) => (WEIGHT[d.mark] > WEIGHT[w] ? d.mark : w), list[0].mark);
/** 이름표: "≠ 대조해 보니 다름" */
export const markChip = (m: DesignView['mark'], text?: string, prefix = ''): HTMLElement => chip(MARK[m].tone, `${prefix}${m} ${text ?? MARK[m].name}`);

/** 판 하나의 줄 */
function row(d: DesignView, canvas: string): HTMLElement {
  return h('div', { class: `rrow${d.stale ? ' review' : ''}` },
    h('div', { class: 'dno' }, d.no),
    h('div', { class: 'rbody' },
      h('div', { class: 'rtitle' }, d.title),
      h('div', { class: 'rmeta' }, markChip(d.mark, `${MARK[d.mark].name}${d.detail ? ` · ${d.detail}` : ''}`), d.screens.map((n) => h('a', { class: 'tag c', href: hash('screen', n) }, n))),
      d.verifyLater.length ? h('div', { class: 'later' }, h('b', null, `나중에 확인할 것 ${d.verifyLater.length}건`), d.verifyLater.map((t) => h('div', null, `· ${t}`))) : null),
    h('div', { class: 'ract' }, canvas ? h('a', { class: 'open', href: canvas, target: '_blank', rel: 'noopener' }, '시안 열기 ↗') : null));
}

/**
 * @screen 시안 현황
 * @route /__spec/#/manage/designs
 * @domain 관리
 * @why 시안과 구현이 서로 맞는지 판마다 보여 주어 어느 쪽이 최신인지 알고 어긋난 곳을 먼저 손보게 한다.
 * @to 화면 설계서 | 판의 대응 화면 이름을 누른다 | 화면 이름
 * @does 시안 판마다 구현과 맞는지 상태를 본다 | 손볼 판이 위에 모여 있다 | 시안과 구현의 최신 여부를 확인한다#1 | → 2
 * @does 판의 나중에 확인할 것을 읽는다 | 데이터가 생기면 대조할 것이 보인다 | 시안과 구현의 최신 여부를 확인한다#2 | → 1
 */
export function designStatusView(root: HTMLElement, { model, kind }: { model: Model; kind: string }): void {
  const all = [...model.designs].sort((a, b) => WEIGHT[b.mark] - WEIGHT[a.mark] || a.no.localeCompare(b.no, 'ko', { numeric: true }));
  const KINDS: { key: string; label: string; bul?: BulKind; list: DesignView[] }[] = [
    { key: '', label: '전체', list: all },
    { key: 'fix', label: '손볼 것', bul: 'rev', list: all.filter((d) => d.mark === '≠' || d.mark === '△' || d.mark === '◇') },
    { key: 'ok', label: '구현과 같음', bul: 'scr', list: all.filter((d) => d.mark === '✓') },
    { key: 'ref', label: '참고용·대조 안 됨', bul: 'int', list: all.filter((d) => d.mark === '·' || d.mark === '?') },
  ];
  const cur = KINDS.find((k) => k.key === kind) ?? KINDS[0];
  // 전체 보기에서는 이상 없는 판(나중에 확인할 것도 없는 것)을 아래에 접는다
  const quiet = (d: DesignView): boolean => !d.stale && d.state !== 'draft' && !d.verifyLater.length;
  const shown = cur.key === '' ? cur.list.filter((d) => !quiet(d)) : cur.list, folded = cur.key === '' ? cur.list.filter(quiet) : [];
  const legend: Kid = (Object.keys(MARK) as DesignView['mark'][]).filter((m) => m !== '·').map((m) => markChip(m));
  root.append(h('div', { class: 'wrap' },
    pageHead({ title: '시안 현황', lead: '시안(Claude Design 캔버스)과 구현이 서로 맞는지 판마다 보여 줍니다. 고쳐야 할 것이 위에 옵니다. 판을 소스에 맞춰 두면 “구현과 같음”이 되고, 그 뒤로 소스가 바뀌면 “소스가 더 최신”으로 바뀝니다.' }),
    filterChips(KINDS.map((k) => ({ key: k.key, label: k.label, bul: k.bul, count: k.list.length })), cur.key, (k) => nav(hash('manage', 'designs', { kind: k || undefined }))),
    h('div', { class: 'legend' }, legend),
    h('div', { class: 'rlist' }, shown.length ? shown.map((d) => row(d, model.designCanvas)) : h('div', { class: 'empty-note' }, model.designs.length ? '해당하는 판이 없습니다.' : '시안 대응표(.spec/design-map.json)가 없습니다.')),
    folded.length ? h('details', { class: 'rdone' }, h('summary', null, buls([{ kind: 'fin', label: '이상 없음' }]), h('b', null, '그 밖의 판'), h('span', { class: 'hint' }, `${folded.length}개 · 구현과 같거나 참고용`), h('span', { class: 'grow' }), h('span', { class: 'hint' }, '펼쳐서 보기 ›')),
      h('div', { class: 'rlist', style: 'margin-top:10px' }, folded.map((d) => row(d, model.designCanvas)))) : null));
}
