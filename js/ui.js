// Shared UI building blocks.
import { h, icon } from './util.js';
import { fmt } from './dates.js';

// ---- toast ---------------------------------------------------------------
export function toast(msg, { action, onAction, ms = 4000 } = {}) {
  const box = document.getElementById('toasts');
  const close = () => { clearTimeout(timer); el.classList.add('out'); setTimeout(() => el.remove(), 200); };
  const el = h('div', { class: 'toast', role: 'status' },
    h('span', null, msg),
    action && h('button', { class: 'toast-btn', type: 'button', onClick: () => { close(); onAction(); } }, action));
  box.append(el);
  const timer = setTimeout(close, ms);
  return close;
}

// ---- sheet (modal; slides up on phones, centred on desktop) --------------
const openSheets = new Set();
export function sheet({ title, body, footer, onClose }) {
  const prevFocus = document.activeElement;
  const panel = h('div', { class: 'sheet-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
    h('div', { class: 'sheet-head' },
      h('h2', null, title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onClick: () => close() }, icon('x'))),
    h('div', { class: 'sheet-body' }, body),
    footer && h('div', { class: 'sheet-foot' }, footer));
  const overlay = h('div', { class: 'sheet', onPointerdown: e => { if (e.target === overlay) close(); } }, panel);
  const onKey = e => { if (e.key === 'Escape' && [...openSheets].pop() === api) close(); };
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => overlay.classList.add('open'));
  panel.focus({ preventScroll: true });
  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    openSheets.delete(api);
    document.removeEventListener('keydown', onKey);
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 220);
    if (!openSheets.size) document.body.classList.remove('modal-open');
    prevFocus?.focus?.({ preventScroll: true });
    onClose?.(result);
  }
  const api = { close, panel };
  openSheets.add(api);
  return api;
}
export const closeAllSheets = () => [...openSheets].forEach(s => s.close());

export function confirmDialog(message, { ok = 'Delete', danger = true } = {}) {
  return new Promise(resolve => {
    let answer = false;
    const s = sheet({
      title: 'Are you sure?',
      body: h('p', { class: 'muted' }, message),
      footer: [
        h('button', { class: 'btn', type: 'button', onClick: () => s.close() }, 'Cancel'),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onClick: () => { answer = true; s.close(); } }, ok),
      ],
      onClose: () => resolve(answer),
    });
  });
}

// ---- popover menu ----------------------------------------------------------
let openMenu = null;
export function menu(anchor, items) {
  openMenu?.();
  const m = h('div', { class: 'menu', role: 'menu' },
    items.filter(Boolean).map(it => h('button', {
      class: `menu-item${it.danger ? ' danger' : ''}`, role: 'menuitem', type: 'button',
      onClick: () => { close(); it.run(); },
    }, it.icon && icon(it.icon), it.label)));
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const top = r.bottom + m.offsetHeight + 8 > innerHeight ? r.top - m.offsetHeight - 4 : r.bottom + 4;
  m.style.top = `${Math.max(8, top)}px`;
  m.style.left = `${Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8))}px`;
  const outside = e => { if (!m.contains(e.target)) close(); };
  const onKey = e => {
    if (e.key === 'Escape') { close(); anchor.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const btns = [...m.querySelectorAll('button')];
      const i = btns.indexOf(document.activeElement);
      btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length].focus();
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', outside), 0);
  document.addEventListener('keydown', onKey);
  addEventListener('scroll', close, { once: true, capture: true });
  m.querySelector('button')?.focus({ preventScroll: true });
  function close() {
    m.remove();
    document.removeEventListener('pointerdown', outside);
    document.removeEventListener('keydown', onKey);
    removeEventListener('scroll', close, { capture: true });
    if (openMenu === close) openMenu = null;
  }
  openMenu = close;
}

// ---- navigation header for a day / week ----------------------------------
export function dateNav({ title, sub, prev, next, value, onPick, prevLabel = 'Previous', nextLabel = 'Next' }) {
  const picker = onPick && h('input', {
    type: 'date', class: 'date-picker', value, 'aria-label': 'Pick a date', tabindex: '-1',
    onChange: e => e.target.value && onPick(e.target.value),
  });
  const label = h('div', { class: 'datenav-label' }, h('strong', null, title), sub && h('span', null, sub));
  const center = onPick
    ? h('button', { class: 'datenav-center', type: 'button', 'aria-label': `${title}, ${sub || ''}. Pick a date`, onClick: () => { try { picker.showPicker(); } catch { picker.focus(); picker.click(); } } }, label, icon('calendar', 'sm'), picker)
    : h('div', { class: 'datenav-center' }, label);
  return h('div', { class: 'datenav' },
    h('a', { class: 'icon-btn', href: prev, 'aria-label': prevLabel }, icon('left')),
    center,
    h('a', { class: 'icon-btn', href: next, 'aria-label': nextLabel }, icon('right')));
}

// ---- progress meter --------------------------------------------------------
export function meter(done, total, { label } = {}) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const complete = total > 0 && done >= total;
  return h('div', { class: `meter-row${complete ? ' complete' : ''}` },
    h('div', { class: 'meter-text' },
      complete ? h('span', { class: 'meter-status' }, icon('check', 'sm'), 'All done') : h('span', null, label ?? `${done} of ${total} done`),
      h('span', { class: 'meter-pct' }, `${pct}%`)),
    h('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(done), 'aria-label': `${done} of ${total} done` },
      h('div', { class: 'meter-fill', style: { width: `${pct}%` } })));
}

// ---- tasks -------------------------------------------------------------------
export function taskRow(task, { onToggle, menuItems, meta }) {
  const moved = task.status === 'moved';
  const li = h('li', { class: `task ${task.status}${task.important ? ' important' : ''}`, dataset: { id: task.id } },
    h('label', { class: 'task-main' },
      h('input', { type: 'checkbox', class: 'check', checked: task.status === 'done', disabled: moved, onChange: e => onToggle(e.target.checked) }),
      h('span', { class: 'task-body' },
        h('span', { class: 'task-text' }, task.important && icon('star', 'star sm'), task.text),
        meta && h('span', { class: 'task-meta' }, meta))),
    h('button', {
      class: 'icon-btn sm', type: 'button', 'aria-label': `Actions for “${task.text}”`, 'aria-haspopup': 'menu',
      onClick: e => menu(e.currentTarget, menuItems(li)),
    }, icon('more')));
  return li;
}

/** Replace a task row's label with a text field; Enter saves, Escape cancels. */
export function inlineEdit(li, text, onSave) {
  const main = li.querySelector('.task-main');
  const input = h('input', { class: 'input inline', value: text, maxlength: 300, 'aria-label': 'Edit task', enterkeyhint: 'done' });
  let done = false;
  const finish = save => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (save && v && v !== text) onSave(v);
    else input.replaceWith(main);
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  main.replaceWith(input);
  input.focus();
  input.select();
}

export function addForm({ placeholder, onAdd, label = 'New task' }) {
  const input = h('input', { class: 'input', type: 'text', placeholder, 'aria-label': label, maxlength: 300, autocomplete: 'off', enterkeyhint: 'enter' });
  return h('form', {
    class: 'add-row',
    onSubmit: e => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return input.focus();
      input.value = '';
      onAdd(v);
      input.focus();
    },
  }, input, h('button', { class: 'btn btn-primary btn-icon', type: 'submit', 'aria-label': 'Add' }, icon('plus')));
}

// ---- misc -------------------------------------------------------------------
export const empty = (text, action) => h('div', { class: 'empty' }, h('p', null, text), action);

export function card(title, { action, cls = '' } = {}, ...body) {
  return h('section', { class: `card ${cls}`.trim() },
    (title || action) && h('div', { class: 'card-head' }, title && h('h3', null, title), action),
    ...body);
}

export const linkBtn = (href, text, cls = 'btn') => h('a', { class: cls, href }, text);

/** Small "from Tue 10 Nov" style date chip. */
export const dayChip = k => fmt(k, { weekday: 'short', day: 'numeric', month: 'short' });
