// 정보: 정보 상세 사이드패널(어디서 열든 같은 모양)과 정보 흐름(관계도).
import { h, ROLES, ROLE_LABEL } from './util.js';

const place = (list) => (list.length ? list.join(' · ') : null);

// 정보 상세 — 존재 이유, 관계, 정보의 흐름(입력·보여줌·수정·판단), 필드
const KIND = { create: '새 객체를 만들어 씀', update: '있던 값을 고침(대입 또는 ...펼침)', read: '읽음', write: '씀' };
export function infoDrawer(model, name, { focusField, onClose, openInfo, openScreen }) {
  const open = new Set(focusField ? [focusField] : []);
  const info = model.infos.find((i) => i.name === name);
  const el = h('div', { class: 'side-in', style: 'display:flex;flex-direction:column;min-height:0;flex:1' });
  if (!info) { el.append(h('div', { class: 'empty-note' }, `정보 ${name}을 찾지 못했다`)); return el; }
  const flowKinds = ROLES.map((r) => [r, info.flow[r]]);
  const places = new Set(flowKinds.flatMap(([, l]) => l));
  const screens = new Set(model.screens.map((s) => s.name));
  const rels = model.relations.filter((r) => r.from === name || r.to === name);
  el.append(
    h('div', { class: 'drawer-head' }, h('div', null, h('b', null, info.name)), h('button', { class: 'xbtn', onclick: onClose, 'aria-label': '닫기' }, '×')),
    h('div', { class: 'tbody' },
      h('div', { class: 'reason' }, h('div', { class: 'k' }, '존재 이유'),
        info.doc ? h('div', { class: 'v' }, info.doc) : h('div', { class: 'v', style: 'color:var(--dim2);font-style:italic' }, '미작성'),
        h('div', { class: 'w mono' }, `${info.file}:${info.line} · 필드 ${info.props.length} · 쓰는 곳 ${places.size}`)),
      h('div', { class: 'sec' }, h('h4', null, '관계'),
        rels.length ? rels.map((r) => {
          const mine = r.from === name, other = mine ? r.to : r.from;
          return h('div', { class: 'rel' }, h('span', { class: 'n', onclick: () => openInfo(other) }, other),
            h('span', { class: 'c' }, `${mine ? '1' : r.many} ${r.weak ? '┄' : '─'} ${mine ? r.many : '1'}`),
            h('span', null, `${r.field}${r.fieldDoc ? ` · ${r.fieldDoc.split(/[.。]/)[0]}` : ''}${r.weak ? ' (약한 연결)' : ''}`));
        }) : h('div', { style: 'font-size:12px;color:var(--dim)' }, '다른 정보와 이어진 곳이 없다')),
      h('div', { class: 'sec' }, h('h4', null, '정보의 흐름'),
        flowKinds.map(([r, list]) => h('div', { class: 'flowrow' }, h('span', { class: `lab role ${r}`, style: 'margin:0' }, ROLE_LABEL[r]),
          h('div', { class: 'chips', style: 'gap:6px' }, list.length ? list.map((p) => h('span', { class: 'tag', style: `cursor:${screens.has(p) ? 'pointer' : 'default'}${screens.has(p) ? '' : ';border-color:#6a5a99;border-radius:12px'}`, onclick: screens.has(p) ? () => openScreen(p) : null }, p + (screens.has(p) ? '' : ' (모듈)'))) : h('span', { style: 'font-size:12px;color:var(--dim2)' }, '없음'))))),
      h('div', { class: 'sec' }, h('h4', null, `필드 · ${info.props.length}`, info.flagged ? h('small', { style: 'color:var(--amber)' }, `확인 ${info.flagged}`) : null),
        h('div', { class: 'fld' }, info.props.map((p) => {
          const rolesOf = ROLES.filter((r) => p.roles[r].length);
          const flag = !p.doc ? '정리 후보 · 존재 이유 미작성' : (p.status !== 'rw' ? (p.status === 'none' ? '쓰는 곳 없음' : p.status === 'read-only' ? '쓰는 곳(입력) 없음' : '읽는 곳 없음') : '');
          const row = h('div', { class: `row${focusField === p.name ? ' focus' : ''}`, style: 'cursor:pointer', onclick: () => { open.has(p.name) ? open.delete(p.name) : open.add(p.name); evBox.style.display = open.has(p.name) ? '' : 'none'; } });
          const evBox = h('div', { style: `display:${open.has(p.name) ? '' : 'none'};margin-top:8px;padding:8px 10px;border-radius:6px;background:#14161f;font-size:11.5px;line-height:1.7` }, h('div', { style: 'color:var(--dim);margin-bottom:2px' }, '역할을 이렇게 읽었다 (근거)'), p.evidence && p.evidence.length ? p.evidence.map((e) => h('div', null, h('span', { class: `role ${e.role}` }, ROLE_LABEL[e.role]), `${e.who} · `, h('span', { class: 'mono' }, `${e.file}:${e.line}`), ` · ${KIND[e.kind] || e.kind}`)) : h('div', { style: 'color:var(--dim2)' }, '화면·모듈에서 쓰는 곳을 찾지 못했다'));
          row.append(...[
            flag ? h('span', { class: 'flag' }, flag) : null,
            h('b', null, p.name), focusField === p.name ? h('span', { style: 'color:var(--accent);font-size:12px' }, ' · 지금 보던 필드') : null,
            h('div', { class: `d${p.doc ? '' : ' empty'}` }, p.doc || '존재 이유 미작성'),
            rolesOf.length ? h('div', { style: 'margin-top:6px' }, rolesOf.map((r) => h('span', { class: `role ${r}` }, `${ROLE_LABEL[r]} ${p.roles[r].length}`))) : null, evBox].filter(Boolean));
          return row;
        })))));
  return el;
}

// 정보 흐름(관계도): 가리키는 정보(1)를 위에, 가리키는 쪽(N)을 아래에 놓는다
export function infoMap(root, model, { selected, onSelect, drawer }) {
  const infos = model.infos;
  const level = {};
  const strong = model.relations.filter((r) => !r.weak);
  const lv = (n, seen = []) => {
    if (level[n] !== undefined) return level[n];
    if (seen.includes(n)) return 0;
    const parents = strong.filter((r) => r.from === n).map((r) => r.to);
    return (level[n] = parents.length ? 1 + Math.max(...parents.map((p) => lv(p, [...seen, n]))) : 0);
  };
  infos.forEach((i) => lv(i.name));
  const rows = {};
  infos.forEach((i) => (rows[level[i.name]] = rows[level[i.name]] || []).push(i));
  const W = 230, GAPX = 90, GAPY = 90;
  const pos = {}; let maxX = 0, y = 30;
  const rowH = {};
  const nodeH = (i) => 44 + 8 + Math.min(5, i.props.length) * 19 + (i.props.length > 5 ? 19 : 0) + 8 + 38;
  Object.keys(rows).sort((a, b) => a - b).forEach((l) => {
    rowH[l] = Math.max(...rows[l].map(nodeH));
    rows[l].forEach((i, k) => { pos[i.name] = { x: 30 + k * (W + GAPX), y, h: nodeH(i) }; maxX = Math.max(maxX, 30 + k * (W + GAPX) + W); });
    y += rowH[l] + GAPY;
  });
  // 가운데 정렬
  Object.keys(rows).forEach((l) => { const w = rows[l].length * (W + GAPX) - GAPX; const off = Math.max(0, (maxX - 30 - w) / 2); rows[l].forEach((i) => { pos[i.name].x += off; }); });
  const canvasW = maxX + 60, canvasH = y;
  const erd = h('div', { class: 'erd' });
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('width', canvasW); svg.setAttribute('height', canvasH);
  const line = (d, weak, hl) => { const p = document.createElementNS(svgNS, 'path'); p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', hl ? '#9db4ff' : '#7a6f60'); p.setAttribute('stroke-width', hl ? 3 : 2); if (weak) p.setAttribute('stroke-dasharray', '5 4'); svg.append(p); };
  const text = (x, t, yy, hl) => { const e = document.createElementNS(svgNS, 'text'); e.setAttribute('x', x); e.setAttribute('y', yy); e.setAttribute('fill', hl ? '#9db4ff' : '#cfc6b8'); e.setAttribute('font-size', 12); e.setAttribute('font-family', 'ui-monospace,Menlo,monospace'); e.textContent = t; svg.append(e); };
  for (const r of model.relations) {
    const a = pos[r.to], b = pos[r.from]; if (!a || !b) continue;
    const hl = selected && (r.from === selected || r.to === selected);
    if (Math.abs(a.y - b.y) < 4) { // 같은 줄: 옆에서 옆으로
      const [l, rr] = a.x < b.x ? [a, b] : [b, a];
      const yy = l.y + 60; line(`M${l.x + W} ${yy} L${rr.x} ${yy}`, r.weak, hl);
      text(l.x + W + 8, '1', yy - 6, hl); text(rr.x - 14, r.many, yy - 6, hl); text((l.x + W + rr.x) / 2 - 20, r.field, yy + 16, hl);
    } else {
      const [top, bot] = a.y < b.y ? [a, b] : [b, a];
      const x1 = top.x + W / 2, y1 = top.y + top.h, x2 = bot.x + W / 2, y2 = bot.y;
      const my = y1 + 28;
      line(`M${x1} ${y1} L${x1} ${my} L${x2} ${my} L${x2} ${y2}`, r.weak, hl);
      text(x1 + 8, a === top ? '1' : r.many, y1 + 18, hl); text(x2 + 8, a === top ? r.many : '1', y2 - 8, hl);
      text(x2 + 10, r.field, (my + y2) / 2 + 4, hl);
    }
  }
  erd.append(svg);
  for (const i of infos) {
    const p = pos[i.name];
    const keyFields = [...i.props.filter((x) => x.name === 'id'), ...i.props.filter((x) => /Id$/.test(x.name) && x.name !== 'id'), ...i.props.filter((x) => x.name !== 'id' && !/Id$/.test(x.name))].slice(0, 5);
    const fk = new Set(model.relations.filter((r) => r.from === i.name && !r.weak).map((r) => r.field));
    const node = h('div', { class: `inode${i.unused ? ' unused' : ''}${selected === i.name ? ' sel' : ''}${selected && selected !== i.name ? ' dim' : ''}`, style: `left:${p.x}px;top:${p.y}px`, onclick: () => onSelect(i.name) },
      h('div', { class: 'h' }, h('b', null, i.name), i.doc ? h('span', null, i.doc.split(/[.。]/)[0].slice(0, 14)) : null),
      h('div', { class: 'f' }, keyFields.map((f) => h('div', null, f.name, ' ', f.name === 'id' ? h('em', null, 'PK') : fk.has(f.name) ? h('em', null, 'FK') : null, !f.doc ? h('span', { class: 'fl' }, ' 확인') : null)),
        i.props.length > 5 ? h('div', null, h('em', null, `외 ${i.props.length - 5}개`)) : null),
      i.unused ? h('div', { class: 'un' }, '쓰는 곳 없음 — 정리 후보') : null,
      h('div', { class: 'c' }, ROLES.map((r) => h('span', { class: `cnt-chip ${r}${i.flow[r].length ? '' : ' zero'}` }, `${ROLE_LABEL[r]} ${i.flow[r].length}`))));
    erd.append(node);
  }
  const spacer = h('div', { style: `width:${canvasW}px;height:${canvasH}px` });
  erd.append(spacer);
  if (!infos.length) erd.append(h('div', { class: 'empty-note' }, '정보를 찾지 못했다', h('br'), model.analysisError || '타입을 export한 정의가 있고 쓰이는 곳이 있어야 보인다'));
  root.append(h('div', { class: 'legend' },
    h('span', null, '관계선'), h('span', { class: 'mono' }, '──'), h('span', null, '소유 (실제 연결)'), h('span', { class: 'mono' }, '┄┄'), h('span', null, '약한 연결 (값으로만 가리킴)'),
    h('span', { style: 'margin-left:12px' }, '표시'), ROLES.map((r) => h('span', { class: `cnt-chip ${r}`, style: 'font-size:12px;padding:2px 10px' }, ROLE_LABEL[r])), h('span', { style: 'color:var(--dim)' }, '= 그 일을 하는 곳의 수')));
  root.append(h('div', { class: 'erd-wrap' }, erd, drawer ? h('aside', { class: 'side', style: 'width:420px' }, drawer) : null));
}
