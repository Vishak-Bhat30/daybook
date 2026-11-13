// Small hand-rolled SVG charts: weekly columns, activity heatmap, weight line.
// Thin marks, hairline grid, one hue; every chart has a hover/focus tooltip and a table view.
import { h, s, clamp } from './util.js';
import { addDays, dayDiff, weekStart, fmt } from './dates.js';

const crisp = v => Math.round(v) + 0.5;

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function niceTicks(lo, hi, n = 3) {
  const step = niceStep((hi - lo) / n || 1);
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
  const out = [];
  for (let v = a; v <= b + step / 2; v += step) out.push(+v.toFixed(6));
  return out;
}
const fmtTick = v => (v >= 10000 ? `${+(v / 1000).toFixed(1)}K` : v.toLocaleString(undefined, { maximumFractionDigits: 1 }));

/** Responsive wrapper: redraws at the container's real width so hairlines stay 1px. */
function frame(draw, cls = '') {
  const wrap = h('div', { class: `chart ${cls}`.trim() });
  const tip = h('div', { class: 'chart-tip', role: 'tooltip', hidden: true });
  let lastW = 0;
  const redraw = () => {
    const w = Math.floor(wrap.clientWidth);
    if (!w || w === lastW) return;
    lastW = w;
    tip.hidden = true;
    wrap.replaceChildren(draw(w, tipApi), tip);
  };
  const tipApi = {
    show(x, y, value, label) {
      tip.replaceChildren(h('strong', null, value), h('span', null, label));
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = `${clamp(x - tw / 2, 0, lastW - tw)}px`;
      tip.style.top = `${y}px`;
    },
    hide() { tip.hidden = true; },
  };
  const ro = new ResizeObserver(redraw);
  ro.observe(wrap);
  requestAnimationFrame(redraw);
  return wrap;
}

function colPath(x, y, w, hgt, r) {
  r = Math.min(r, w / 2, hgt);
  return `M${x},${y + hgt}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + hgt}Z`;
}

/**
 * Column chart, one series. data: [{ label, value, tip }] oldest -> newest.
 * The newest column carries a direct value label; the rest live on the axis and tooltip.
 */
export function columnChart(data, { height = 190, unit = '', describe = '' } = {}) {
  return frame((width, tip) => {
    const m = { t: 22, r: 4, b: 24, l: 36 };
    const iw = width - m.l - m.r, ih = height - m.t - m.b;
    const ticks = niceTicks(0, Math.max(10, ...data.map(d => d.value)), 3);
    const top = ticks[ticks.length - 1];
    const y = v => m.t + ih - (v / top) * ih;
    const band = iw / data.length;
    const bw = Math.min(24, band * 0.62);
    const every = band < 22 ? 3 : band < 40 ? 2 : 1;
    const svg = s('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': describe });

    ticks.forEach(v => {
      svg.append(s('line', { class: v === 0 ? 'axis' : 'grid', x1: m.l, x2: width - m.r, y1: crisp(y(v)), y2: crisp(y(v)) }));
      svg.append(s('text', { class: 'tick', x: m.l - 8, y: y(v), dy: '0.32em', 'text-anchor': 'end' }, fmtTick(v)));
    });

    data.forEach((d, i) => {
      const cx = m.l + band * (i + 0.5);
      const bar = d.value > 0 ? s('path', { class: 'bar', d: colPath(cx - bw / 2, y(d.value), bw, y(0) - y(d.value), 4) }) : null;
      if (bar) svg.append(bar);
      if ((data.length - 1 - i) % every === 0) {
        svg.append(s('text', { class: 'tick', x: cx, y: height - 6, 'text-anchor': 'middle' }, d.label));
      }
      const hit = s('rect', {
        class: 'hit', x: m.l + band * i, y: m.t, width: band, height: ih + 4, tabindex: '0',
        'aria-label': `${d.tip}: ${d.value} ${unit}`,
      });
      const show = () => { bar?.classList.add('hover'); tip.show(cx, Math.min(y(d.value), y(0)) - 8, `${d.value.toLocaleString()} ${unit}`, d.tip); };
      const hide = () => { bar?.classList.remove('hover'); tip.hide(); };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointerleave', hide);
      hit.addEventListener('focus', show);
      hit.addEventListener('blur', hide);
      svg.append(hit);
    });

    const last = data[data.length - 1];
    if (last) svg.append(s('text', { class: 'cap', x: m.l + band * (data.length - 0.5), y: y(last.value) - 7, 'text-anchor': 'middle' }, last.value.toLocaleString()));
    return svg;
  });
}

/**
 * Activity heatmap (GitHub-style): columns are weeks, rows Mon..Sun, colour = minutes that day.
 * values: Map day -> minutes (a day present with 0 min still counts as active).
 */
export const HEAT_BINS = [
  { label: 'No workout' },
  { label: 'Under 20 min', max: 20 },
  { label: '20–39 min', max: 40 },
  { label: '40–59 min', max: 60 },
  { label: '60+ min', max: Infinity },
];
const level = v => (v === undefined ? 0 : HEAT_BINS.findIndex((b, i) => i > 0 && v < b.max));

export function heatmap(values, { end, describe = '', tipFor }) {
  return frame((width, tip) => {
    const gap = 3, left = 22, topPad = 16;
    const weeks = clamp(Math.floor((width - left + gap) / (13 + gap)), 8, 26);
    const cell = Math.min(16, Math.floor((width - left - (weeks - 1) * gap) / weeks));
    const height = topPad + 7 * cell + 6 * gap;
    const firstWs = addDays(weekStart(end), -7 * (weeks - 1));
    const svg = s('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': describe, tabindex: '0' });

    ['M', 'W', 'F'].forEach((d, i) => svg.append(s('text', { class: 'tick', x: 0, y: topPad + (i * 2) * (cell + gap) + cell / 2, dy: '0.32em' }, d)));

    const cells = [];
    let lastLabelX = -99;
    for (let wk = 0; wk < weeks; wk++) {
      const ws = addDays(firstWs, wk * 7);
      const x = left + wk * (cell + gap);
      const monthStart = Array.from({ length: 7 }, (_, i) => addDays(ws, i)).find(k => k.endsWith('-01'));
      if ((wk === 0 || monthStart) && x - lastLabelX > 30) {
        svg.append(s('text', { class: 'tick', x, y: 10 }, fmt(monthStart || ws, { month: 'short' })));
        lastLabelX = x;
      }
      for (let d = 0; d < 7; d++) {
        const day = addDays(ws, d);
        if (day > end) continue;
        const v = values.get(day);
        const yy = topPad + d * (cell + gap);
        const r = s('rect', { class: `heat l${level(v)}`, x, y: yy, width: cell, height: cell, rx: 3 });
        svg.append(r);
        cells.push({ day, v, r, cx: x + cell / 2, y: yy });
      }
    }

    let active = -1;
    const focusCell = i => {
      cells[active]?.r.classList.remove('hover');
      active = i;
      const c = cells[i];
      c.r.classList.add('hover');
      const t = tipFor(c.day, c.v);
      tip.show(c.cx, c.y - 6, t.value, t.label);
    };
    cells.forEach((c, i) => c.r.addEventListener('pointerenter', () => focusCell(i)));
    svg.addEventListener('pointerleave', () => { cells[active]?.r.classList.remove('hover'); tip.hide(); });
    svg.addEventListener('focus', () => focusCell(cells.length - 1));
    svg.addEventListener('blur', () => { cells[active]?.r.classList.remove('hover'); tip.hide(); });
    svg.addEventListener('keydown', e => {
      const step = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[e.key];
      if (!step) return;
      e.preventDefault();
      focusCell(clamp(active + step, 0, cells.length - 1));
    });
    return svg;
  }, 'heatmap');
}

export function heatLegend() {
  return h('div', { class: 'heat-legend' },
    HEAT_BINS.map((b, i) => h('span', { class: 'heat-key' }, h('i', { class: `heat-swatch l${i}`, 'aria-hidden': 'true' }), b.label)));
}

/** Line chart for a single measure over time. points: [{ day, value }] sorted by day. */
export function lineChart(points, { height = 170, unit = '', describe = '', digits = 1 } = {}) {
  return frame((width, tip) => {
    const m = { t: 24, r: 14, b: 22, l: 40 };
    const iw = width - m.l - m.r, ih = height - m.t - m.b;
    const vals = points.map(p => p.value);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = Math.max(0.5, (hi - lo) * 0.2);
    const ticks = niceTicks(lo - pad, hi + pad, 3);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const span = Math.max(1, dayDiff(points[0].day, points[points.length - 1].day));
    const x = p => m.l + (dayDiff(points[0].day, p.day) / span) * iw;
    const y = v => m.t + ih - ((v - y0) / (y1 - y0)) * ih;
    const f = v => v.toLocaleString(undefined, { maximumFractionDigits: digits });
    const svg = s('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': describe, tabindex: '0' });

    ticks.forEach((v, i) => {
      svg.append(s('line', { class: i === 0 ? 'axis' : 'grid', x1: m.l, x2: width - m.r, y1: crisp(y(v)), y2: crisp(y(v)) }));
      svg.append(s('text', { class: 'tick', x: m.l - 8, y: y(v), dy: '0.32em', 'text-anchor': 'end' }, fmtTick(v)));
    });
    const first = points[0], last = points[points.length - 1];
    svg.append(s('text', { class: 'tick', x: m.l, y: height - 5 }, fmt(first.day, { day: 'numeric', month: 'short' })));
    if (points.length > 1) svg.append(s('text', { class: 'tick', x: width - m.r, y: height - 5, 'text-anchor': 'end' }, fmt(last.day, { day: 'numeric', month: 'short' })));

    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
    svg.append(s('path', { class: 'area', d: `${line}L${x(last).toFixed(1)},${y(y0)}L${x(first).toFixed(1)},${y(y0)}Z` }));
    svg.append(s('path', { class: 'line', d: line }));

    const cross = s('line', { class: 'crosshair', y1: m.t, y2: m.t + ih, visibility: 'hidden' });
    const hover = s('circle', { class: 'dot', r: 4, visibility: 'hidden' });
    svg.append(cross);
    svg.append(s('circle', { class: 'dot', cx: x(last), cy: y(last.value), r: 4 }));
    svg.append(s('text', { class: 'cap', x: Math.min(x(last), width - m.r), y: y(last.value) - 10, 'text-anchor': 'end' }, `${f(last.value)} ${unit}`));
    svg.append(hover);

    let active = -1;
    const show = i => {
      active = i;
      const p = points[i];
      const px = x(p), py = y(p.value);
      cross.setAttribute('x1', crisp(px)); cross.setAttribute('x2', crisp(px)); cross.setAttribute('visibility', 'visible');
      hover.setAttribute('cx', px); hover.setAttribute('cy', py); hover.setAttribute('visibility', 'visible');
      tip.show(px, py - 10, `${f(p.value)} ${unit}`, fmt(p.day, { weekday: 'short', day: 'numeric', month: 'short' }));
    };
    const hide = () => { cross.setAttribute('visibility', 'hidden'); hover.setAttribute('visibility', 'hidden'); tip.hide(); };
    const hit = s('rect', { class: 'hit', x: m.l, y: m.t, width: iw, height: ih });
    hit.addEventListener('pointermove', e => {
      const px = e.clientX - svg.getBoundingClientRect().left;
      let best = 0;
      points.forEach((p, i) => { if (Math.abs(x(p) - px) < Math.abs(x(points[best]) - px)) best = i; });
      show(best);
    });
    hit.addEventListener('pointerleave', hide);
    svg.append(hit);
    svg.addEventListener('focus', () => show(points.length - 1));
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', e => {
      const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (!step) return;
      e.preventDefault();
      show(clamp(active + step, 0, points.length - 1));
    });
    return svg;
  });
}

/** Collapsible table view of a chart's data. */
export function tableView(headers, rows, summary = 'View as table') {
  return h('details', { class: 'table-view' },
    h('summary', null, summary),
    h('div', { class: 'table-scroll' },
      h('table', null,
        h('thead', null, h('tr', null, headers.map(t => h('th', { scope: 'col' }, t)))),
        h('tbody', null, rows.map(r => h('tr', null, r.map((c, i) => (i === 0 ? h('th', { scope: 'row' }, c) : h('td', null, c)))))))));
}

