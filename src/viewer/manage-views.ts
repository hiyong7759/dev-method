/**
 * @spec manage-views 요청의 정보 변경 겹쳐 보기와 화면 변경 전후 비교
 * @why 설계를 승인하기 전에 "정보가 지금 관계도에서 어떻게 바뀌는지"와 "화면이 지금 모습에서 어떻게 달라지는지"를 눈으로 비교하게 한다. 승인하면 이 모습이 요청에 그대로 남아 나중에 히스토리에서 다시 볼 수 있다.
 * @contract 요청의 설계(types.ts의 RequestDesign)를 읽어 그린다. 정보 변경은 현행 관계도(erd.ts) 위에 얹고, 화면 변경은 에이전트가 올린 변경 후 그림과 지금 화면 그림을 비교한다.
 */
import { h, pageHead, chip } from './util.js';
import { buildErd } from './erd.js';
import { hash, nav } from './route.js';
import type { DesignChange, Model, RequestView } from '../types.js';

/** 모드를 주소 쿼리에서 읽는다 */
const modeOf = (def: string): string => new URLSearchParams(location.hash.split('?')[1] ?? '').get('mode') || def;
/** 쿼리를 바꿔 다시 이동한다 */
const setQuery = (id: number, sub: string, q: Record<string, string>): void => nav(hash('manage', `${id}/${sub}`, q), true);
/** 모드 고르기 줄 */
function modeSeg(items: [string, string][], cur: string, pick: (k: string) => void): HTMLElement {
  return h('div', { class: 'seg' }, items.map(([k, l]) => h('button', { class: cur === k ? 'on' : '', onclick: () => pick(k) }, l)));
}
const MARK: Record<string, [string, string]> = { add: ['+', 'ok'], remove: ['×', 'bad'], change: ['≈', 'me'], link: ['↔', 'ag'] };

/**
 * @screen 정보 변경 겹쳐 보기
 * @route /__spec/#/manage/:id/info
 * @domain 관리
 * @why 설계의 정보 변경을 지금 관계도 위에 겹쳐 보여, 승인하기 전에 무엇이 추가·삭제·바뀌는지 한눈에 보게 한다.
 * @to 요청 상세 | "요청 상세로 돌아가기"를 누른다 | 요청 번호
 * @to 요청 목록 | 위쪽 "요청"을 누른다
 * @does 정보 변경을 현행 관계도 위에서 본다 | 추가·바뀜·삭제가 색으로 표시된다 | 요청의 진행을 확인한다#4 | → 3
 */
export function manageInfoOverlay(root: HTMLElement, { model, r }: { model: Model; r: RequestView }): void {
  const changes: DesignChange[] = r.design?.changes ?? [];
  if (!changes.length) {
    root.append(h('div', { class: 'wrap' }, pageHead({ crumb: [h('a', { href: hash('manage') }, '요청'), ' › ', h('a', { href: hash('manage', String(r.id)) }, `#${r.id}`), ' › 정보 변경'], title: '이 요청에는 정보 변경이 없습니다', lead: r.design ? '에이전트가 올린 설계에 정보 변경이 없습니다.' : '아직 에이전트가 설계를 올리지 않았습니다. 올리면 여기에서 정보가 어떻게 바뀌는지 겹쳐 볼 수 있습니다.' }),
      h('div', null, h('button', { class: 'btn', onclick: () => nav(hash('manage', String(r.id))) }, '‹ 요청 상세로 돌아가기'))));
    return;
  }
  const mode = modeOf('overlay');
  const touched = new Set(changes.flatMap((c) => (c.kind === 'link' ? [c.info, c.field.split('.')[0]] : [c.info])));
  const infoOf = (n: string): DesignChange[] => changes.filter((c) => c.info === n && c.kind !== 'link');
  // 바뀌는 정보와 그 이웃(관계가 있는 정보)만 그린다. 나머지는 이 요청과 상관없으므로 보이지 않는다
  const near = new Set(touched);
  for (const rel of model.relations) { if (touched.has(rel.from)) near.add(rel.to); if (touched.has(rel.to)) near.add(rel.from); }
  const erd = buildErd(model, {
    infos: model.infos.filter((i) => near.has(i.name)), availW: Math.min(root.clientWidth || innerWidth, 1240) - 420 - 48,
    dimOthers: (i) => mode !== 'now' && !touched.has(i.name),
    decorate: (i) => {
      if (mode === 'now' || !touched.has(i.name)) return null;
      const cs = infoOf(i.name);
      const base = i.props.map((p) => ({ name: p.name, kind: '' as const }));
      const del = new Set(cs.filter((c) => c.kind === 'remove').map((c) => c.field));
      const adds = cs.filter((c) => c.kind === 'add').map((c) => ({ name: c.field, kind: 'add' as const }));
      const fields = mode === 'after' ? [...base.filter((f) => !del.has(f.name)), ...adds.map((a) => ({ ...a, kind: '' as const }))] : [...base.map((f) => (del.has(f.name) ? { ...f, kind: 'del' as const } : f)), ...adds];
      const plus = cs.filter((c) => c.kind === 'add').length, minus = cs.filter((c) => c.kind === 'remove').length;
      return { cls: mode === 'overlay' ? 'changed' : '', sub: cs.length ? `바뀝니다 · 필드 ${plus ? `+${plus}` : ''}${minus ? ` −${minus}` : ''}` : '', fields, badge: undefined };
    },
    extraLinks: mode === 'now' ? [] : changes.filter((c) => c.kind === 'link').map((c) => ({ from: c.info, to: c.field.split('.')[0], label: c.note || '새 연결 (추가)' })),
  });
  const side = [
    h('div', { class: 'card' }, h('h3', null, `바뀌는 것 ${changes.length}가지`),
      changes.length ? changes.map((c) => { const [m, tone] = MARK[c.kind]; return h('div', { class: 'chgrow' }, h('span', { class: `chip ${tone} mk` }, m), h('div', null, h('b', null, c.kind === 'link' ? `연결 · ${c.info} → ${c.field}` : `${c.info} · ${c.field}`), h('div', { class: 'hint' }, c.note))); }) : h('div', { class: 'hint' }, '정보 변경이 없습니다.')),
    r.design?.data ? h('div', { class: 'card' }, h('h3', null, '이미 있는 데이터와 되돌리기'), h('div', { class: 'kv' }, h('span', null, '저장된 데이터'), h('span', null, r.design.data.existing), h('span', null, '되돌리기'), h('span', null, r.design.data.rollback), h('span', null, '실제 데이터'), h('span', null, r.design.data.real))) : null,
    h('div', { class: 'card snap' }, h('h3', null, '스냅샷'), h('div', null, `설계 승인을 하면 지금 이 모습(현행과 변경)이 요청 #${r.id}에 그대로 저장됩니다. 나중에 히스토리에서 "이 요청으로 정보가 이렇게 바뀌었다"를 다시 볼 수 있습니다.`),
      h('button', { class: 'btn', onclick: () => nav(hash('manage', String(r.id))) }, '‹ 요청 상세로 돌아가기')),
  ];
  root.append(h('div', { class: 'wrap' },
    pageHead({ crumb: [h('a', { href: hash('manage') }, '요청'), ' › ', h('a', { href: hash('manage', String(r.id)) }, `#${r.id}`), ' › 정보 변경'], title: `${[...touched][0] ?? '정보'} 정보가 이렇게 바뀝니다`, lead: `요청 #${r.id}가 정보에 가져오는 변화를 지금 관계도 위에 겹쳐 봅니다.`,
      actions: modeSeg([['now', '현행만'], ['overlay', '변경 겹쳐 보기'], ['after', '변경 후']], mode, (k) => setQuery(r.id, 'info', { mode: k })) }),
    h('div', { class: 'legend2' }, h('span', { class: 'sw-box' }), h('span', null, '현행(그대로)'), h('span', { class: 'sw-box g' }), h('span', null, '추가'), h('span', { class: 'sw-box a' }), h('span', null, '바뀌는 정보'), h('span', { class: 'sw-box r' }), h('span', null, '삭제')),
    h('div', { class: 'detail-cols ov' }, h('div', { class: 'erd-wrap' }, erd), h('div', { class: 'dcol side' }, side))));
}

/**
 * @screen 화면 변경 전후 비교
 * @route /__spec/#/manage/:id/compare
 * @domain 관리
 * @why 설계에서 승인한 화면 디자인과 지금 화면을 현행·변경 후·나란히·겹쳐 보기로 눌러 비교하게 한다.
 * @to 요청 상세 | "요청 상세로 돌아가기"를 누른다 | 요청 번호
 * @to 요청 목록 | 위쪽 "요청"을 누른다
 * @does 지금 화면과 변경 후 디자인을 비교한다 | 네 가지 보기 방식으로 바뀐다 | 요청의 진행을 확인한다#5 | → 3
 */
export function manageCompare(root: HTMLElement, { r, screen }: { r: RequestView; screen: string }): void {
  const ds = r.design?.screens ?? [];
  const d = ds.find((x) => x.screen === screen) ?? ds[0];
  if (!d) { root.append(h('div', { class: 'empty-note', style: 'flex:1' }, '비교할 화면 디자인이 없습니다.')); return; }
  const mode = modeOf('side');
  const img = (name: string, alt: string): HTMLElement => (name ? h('img', { class: 'shot big', src: `/__spec/shots/${name}`, alt }) : h('div', { class: 'empty-note' }, `${alt} 그림이 없습니다`));
  const CAP: Record<string, string> = { before: '지금 화면을 그대로 찍은 모습입니다.', after: '승인 대상 디자인(변경 후)입니다.', side: '왼쪽이 현행, 오른쪽이 변경 후입니다.', blend: '두 그림을 겹쳐 놓았습니다. 아래 막대를 움직여 섞는 정도를 바꿔 보세요.' };
  const view = h('div', { class: 'cmp-stage' });
  if (mode === 'before') view.append(img(d.before, '현행'));
  else if (mode === 'after') view.append(img(d.after, '변경 후'));
  else if (mode === 'blend') {
    const top = img(d.after, '변경 후'); top.classList.add('top');
    const range = h('input', { type: 'range', min: '0', max: '100', value: '50', 'aria-label': '섞는 정도' });
    top.style.opacity = '.5';
    range.addEventListener('input', () => { top.style.opacity = String(Number(range.value) / 100); });
    view.append(h('div', { class: 'blend' }, img(d.before, '현행'), top), h('div', { class: 'blendbar' }, h('span', { class: 'hint' }, '현행'), range, h('span', { class: 'hint' }, '변경 후')));
  } else view.append(h('div', { class: 'sbs' }, h('div', null, h('div', { class: 'hint' }, '현행'), img(d.before, '현행')), h('div', null, h('div', { class: 'hint' }, '변경 후'), img(d.after, '변경 후'))));
  root.append(h('div', { class: 'wrap' },
    pageHead({ crumb: [h('a', { href: hash('manage') }, '요청'), ' › ', h('a', { href: hash('manage', String(r.id)) }, `#${r.id}`), ` › 화면 변경 · ${d.screen}`], title: `${d.screen} 화면이 이렇게 바뀝니다`, lead: `요청 #${r.id} 설계에서 승인한 화면 디자인을 지금 화면과 네 가지 방식으로 비교합니다.`,
      actions: modeSeg([['before', '현행'], ['after', '변경 후'], ['side', '나란히'], ['blend', '겹쳐 보기']], mode, (k) => setQuery(r.id, 'compare', { mode: k, screen: d.screen })) }),
    h('div', { class: 'detail-cols' },
      h('div', { class: 'dcol' }, h('div', { class: 'box' }, CAP[mode] ?? ''), view),
      h('div', { class: 'dcol side' },
        h('div', { class: 'card' }, h('h3', null, '바뀌는 것'), h('div', { class: 'tagrow' }, chip('ok', `추가 ${d.counts.add}`), chip('me', `바뀜 ${d.counts.change}`), chip('bad', `삭제 ${d.counts.remove}`)), d.note ? h('div', null, d.note) : null,
          d.link ? h('a', { class: 'lnk', href: d.link, target: '_blank', rel: 'noopener' }, 'Claude Design에서 열기 ↗') : null),
        h('div', { class: 'card' }, h('h3', null, '이 비교는 이렇게 만들어집니다'), h('div', null, '현행은 에이전트가 실제 화면을 그대로 찍어 오고, 변경 후는 같은 화면 위에 디자인으로 고쳐 그린 것입니다. 승인하면 이 비교가 요청에 저장되어 나중에 히스토리에서 같은 모습으로 다시 볼 수 있습니다.'),
          h('button', { class: 'btn', onclick: () => nav(hash('manage', String(r.id))) }, '‹ 요청 상세로 돌아가기')),
        null))));
}
