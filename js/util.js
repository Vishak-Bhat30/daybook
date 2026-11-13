import { ICONS } from './icons.js';

const SVGNS = 'http://www.w3.org/2000/svg';

function setAttrs(el, attrs, isSvg) {
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false || k === 'value') continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.setAttribute('class', v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (!isSvg && (k === 'checked' || k === 'disabled' || k === 'selected')) el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false || k === true) continue;
    el.append(k instanceof Node ? k : String(k)); // strings become text nodes: never parsed as HTML
  }
}

/** Create an HTML element. Children may be nodes, strings, arrays or null. */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) setAttrs(el, attrs, false);
  append(el, kids);
  if (attrs && attrs.value != null) el.value = attrs.value; // after children so <select> works
  return el;
}

/** Append children, skipping null/false (unlike Element.append, which would print them). */
export const add = (el, ...kids) => { append(el, kids); return el; };
/** Replace all children, skipping null/false. */
export const fill = (el, ...kids) => { el.replaceChildren(); append(el, kids); return el; };

/** Create an SVG element. */
export function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  if (attrs) setAttrs(el, attrs, true);
  append(el, kids);
  return el;
}

export function icon(name, cls = '') {
  const el = document.createElementNS(SVGNS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('class', `ic ${cls}`.trim());
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = ICONS[name] || '';
  return el;
}

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  Date.now().toString(36) + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const fmtNum = (n, d = 0) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
export const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

export async function blobToB64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export const b64ToBlob = (b64, type) => new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type });

export function download(filename, blob) {
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
