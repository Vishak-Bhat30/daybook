// Diary: one entry per day with mood, text and photos; browse by calendar or search.
//
// entry: { id:'diary-<date>', type:'diary', date, text, mood (1-5)?, photos: [photoId] }
import { h, icon, debounce, plural, add, fill } from '../util.js';
import { today, addDays, dayDiff, fmt, relDay, resolveDay, monthOf, addMonths, fmtMonth, daysInMonth, weekStart, fmtTime, dayOf } from '../dates.js';
import * as db from '../db.js';
import { dateNav, confirmDialog, toast, empty, card } from '../ui.js';
import { importImage, photoImg, photoURL, deletePhoto } from '../photos.js';
import * as tasks from '../tasks.js';
import * as F from '../fitlib.js';

export const title = 'Diary';
export const MOODS = [['😞', 'Rough'], ['😕', 'Meh'], ['😐', 'Okay'], ['🙂', 'Good'], ['😄', 'Great']];
let month = null;
let query = '';

export const entryId = date => `diary-${date}`;
export const getEntry = date => db.get(entryId(date));
const hasContent = e => !!(e && (e.text?.trim() || e.mood || e.photos?.length));
export const entries = () => db.list('diary', hasContent).sort((a, b) => (a.date < b.date ? 1 : -1));

export function render(root, [param], ctx) {
  const date = resolveDay(param);
  return date ? renderEntry(root, date, ctx) : renderIndex(root, ctx);
}

// ---- browse ------------------------------------------------------------------
function renderIndex(root, ctx) {
  const t = today();
  month ??= monthOf(t);
  const todays = getEntry(t);
  const all = entries();
  const byDate = new Map(all.map(e => [e.date, e]));
  const results = h('div', { class: 'stack' });

  const search = h('input', {
    class: 'input', type: 'search', placeholder: 'Search your diary…', value: query, 'aria-label': 'Search diary',
    onInput: debounce(e => { query = e.target.value; paintResults(); }, 150),
  });

  add(root, 
    h('a', { class: 'cta', href: `#/diary/${t}` },
      h('span', { class: 'cta-emoji', 'aria-hidden': 'true' }, todays?.mood ? MOODS[todays.mood - 1][0] : '✍️'),
      h('span', { class: 'cta-text' },
        h('strong', null, hasContent(todays) ? "Continue today's entry" : 'How was your day?'),
        h('span', null, hasContent(todays) ? snippet(todays.text, 70) || plural(todays.photos?.length || 0, 'photo') : 'Write what you did today and add photos')),
      icon('right')),
    h('div', { class: 'search-row' }, icon('search', 'muted'), search),
    results,
  );

  function paintResults() {
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const hits = all.filter(e => e.text?.toLowerCase().includes(q));
      fill(results, hits.length
        ? h('ul', { class: 'entry-list' }, hits.slice(0, 50).map(e => entryItem(e, q)))
        : empty(`Nothing found for “${query.trim()}”.`));
      return;
    }
    const inMonth = all.filter(e => monthOf(e.date) === month);
    fill(results, 
      calendar(month, byDate, m => { month = m; paintResults(); }),
      inMonth.length
        ? h('ul', { class: 'entry-list' }, inMonth.map(e => entryItem(e)))
        : empty(all.length ? `No entries in ${fmtMonth(month)}.` : 'Your diary is empty. Start with today!'),
    );
  }
  paintResults();
  return { refresh: paintResults };
}

function calendar(mk, byDate, onMonth) {
  const t = today();
  const first = `${mk}-01`;
  const lead = dayDiff(weekStart(first), first);
  const n = daysInMonth(mk);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(h('span', { class: 'cal-cell blank', 'aria-hidden': 'true' }));
  for (let d = 1; d <= n; d++) {
    const k = `${mk}-${String(d).padStart(2, '0')}`;
    const e = byDate.get(k);
    const future = k > t;
    const cell = h(future ? 'span' : 'a', {
      class: `cal-cell${e ? ' has' : ''}${k === t ? ' today' : ''}${future ? ' future' : ''}`,
      href: future ? null : `#/diary/${k}`,
      'aria-label': `${fmt(k, { weekday: 'long', day: 'numeric', month: 'long' })}${e ? ', has entry' : ''}`,
    }, h('span', { class: 'cal-num' }, d), e?.mood ? h('span', { class: 'cal-mood', 'aria-hidden': 'true' }, MOODS[e.mood - 1][0]) : e ? h('span', { class: 'cal-dot', 'aria-hidden': 'true' }) : null);
    if (e?.photos?.length) {
      photoURL(e.photos[0], e.date).then(url => { if (url) { cell.style.backgroundImage = `url("${url}")`; cell.classList.add('photo-bg'); } });
    }
    cells.push(cell);
  }
  const weekdays = Array.from({ length: 7 }, (_, i) => fmt(addDays('2024-01-01', i), { weekday: 'narrow' }));
  return h('div', { class: 'card calendar' },
    h('div', { class: 'cal-head' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous month', onClick: () => onMonth(addMonths(mk, -1)) }, icon('left')),
      h('strong', { 'aria-live': 'polite' }, fmtMonth(mk)),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next month', disabled: mk >= monthOf(t), onClick: () => onMonth(addMonths(mk, 1)) }, icon('right'))),
    h('div', { class: 'cal-grid' }, weekdays.map(w => h('span', { class: 'cal-wd', 'aria-hidden': 'true' }, w)), cells));
}

const snippet = (text = '', n = 140) => { const s = text.trim().replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function highlight(text, q) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text;
  const start = Math.max(0, i - 40);
  const pre = (start ? '…' : '') + text.slice(start, i);
  return [pre, h('mark', null, text.slice(i, i + q.length)), text.slice(i + q.length, i + q.length + 100)];
}

function entryItem(e, q) {
  const text = (e.text || '').trim().replace(/\s+/g, ' ');
  return h('li', null, h('a', { class: 'entry-item', href: `#/diary/${e.date}` },
    h('div', { class: 'entry-top' },
      h('strong', null, relDay(e.date) ?? fmt(e.date, { weekday: 'short', day: 'numeric', month: 'short', year: monthOf(e.date).slice(0, 4) === today().slice(0, 4) ? undefined : 'numeric' })),
      e.mood && h('span', { class: 'entry-mood', title: MOODS[e.mood - 1][1] }, MOODS[e.mood - 1][0])),
    text && h('p', { class: 'entry-snippet' }, q ? highlight(text, q) : snippet(text)),
    e.photos?.length > 0 && h('div', { class: 'thumb-row' },
      e.photos.slice(0, 4).map(id => photoImg(id, e.date, { cls: 'thumb' })),
      e.photos.length > 4 && h('span', { class: 'thumb-more' }, `+${e.photos.length - 4}`))));
}

// ---- a single day ------------------------------------------------------------
function renderEntry(root, date, ctx) {
  const t = today();
  const future = date > t;
  const e = getEntry(date) || { id: entryId(date), type: 'diary', date, text: '', mood: null, photos: [] };
  const state = { text: e.text || '', mood: e.mood || null, photos: [...(e.photos || [])] };
  const status = h('span', { class: 'save-status', 'aria-live': 'polite' }, e.updatedAt ? `Saved ${fmtTime(e.updatedAt)}` : '');

  let dirty = false; // unsaved local edits
  const touch = () => { dirty = true; };
  const save = () => {
    if (!dirty) return;
    dirty = false;
    const cur = getEntry(date);
    const changed = !cur || cur.text !== state.text || cur.mood !== state.mood || JSON.stringify(cur.photos || []) !== JSON.stringify(state.photos);
    if (!changed) return;
    if (!state.text.trim() && !state.mood && !state.photos.length) { if (cur) db.remove(cur.id); status.textContent = ''; return; }
    db.put({ ...(cur || e), text: state.text, mood: state.mood, photos: state.photos });
    status.textContent = `Saved ${fmtTime(Date.now())}`;
  };
  const saveSoon = debounce(save, 600);

  const textarea = h('textarea', {
    class: 'input diary-text', rows: 8, value: state.text, 'aria-label': 'Diary entry',
    placeholder: future ? 'Notes for this day…' : 'What did you do today? Anything you want to remember…',
    onInput: ev => { state.text = ev.target.value; touch(); status.textContent = 'Editing…'; autosize(ev.target); saveSoon(); },
    onBlur: () => saveSoon.flush(),
  });

  const moodRow = h('div', { class: 'mood-row', role: 'radiogroup', 'aria-label': 'Mood' },
    MOODS.map(([emoji, label], i) => h('button', {
      class: 'mood', type: 'button', role: 'radio', 'aria-checked': String(state.mood === i + 1), 'aria-label': label, title: label,
      onClick: ev => {
        state.mood = state.mood === i + 1 ? null : i + 1;
        touch();
        moodRow.querySelectorAll('.mood').forEach((b, j) => b.setAttribute('aria-checked', String(state.mood === j + 1)));
        ev.currentTarget.blur();
        saveSoon.flush();
      },
    }, h('span', { 'aria-hidden': 'true' }, emoji), h('small', null, label))));

  const grid = h('div', { class: 'photo-grid' });
  const fileIn = h('input', {
    type: 'file', accept: 'image/*', multiple: true, class: 'visually-hidden', id: 'photo-input',
    onChange: async ev => {
      const files = [...ev.target.files];
      ev.target.value = '';
      if (!files.length) return;
      const placeholders = files.map(() => h('div', { class: 'photo-tile pending' }, h('span', { class: 'spinner' })));
      grid.lastElementChild.before(...placeholders);
      let failed = 0;
      for (const [i, f] of files.entries()) {
        try { state.photos.push(await importImage(f, date)); touch(); }
        catch (err) { console.error(err); failed++; }
        placeholders[i].remove();
      }
      saveSoon.flush();
      paintPhotos();
      if (failed) toast(`${plural(failed, 'photo')} couldn't be read`);
    },
  });

  function paintPhotos() {
    fill(grid, 
      ...state.photos.map((id, i) => h('button', { class: 'photo-tile', type: 'button', 'aria-label': `Open photo ${i + 1}`, onClick: () => lightbox(i) }, photoImg(id, date))),
      h('label', { class: 'photo-tile add', for: 'photo-input' }, icon('image'), h('span', null, 'Add photos')),
    );
  }

  function lightbox(start) {
    let i = start;
    const img = h('img', { class: 'lb-img', alt: '' });
    const counter = h('span', { class: 'lb-count' });
    const show = () => {
      img.removeAttribute('src');
      counter.textContent = `${i + 1} / ${state.photos.length}`;
      const id = state.photos[i];
      photoURL(id, date, 'full').then(u => { if (state.photos[i] === id && u) img.src = u; });
    };
    const go = d => { if (state.photos.length > 1) { i = (i + d + state.photos.length) % state.photos.length; show(); } };
    const close = () => { lb.remove(); document.removeEventListener('keydown', onKey); document.body.classList.remove('modal-open'); };
    const onKey = ev => { if (ev.key === 'Escape') close(); if (ev.key === 'ArrowLeft') go(-1); if (ev.key === 'ArrowRight') go(1); };
    let x0 = null;
    const lb = h('div', {
      class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Photo viewer',
      onPointerdown: ev => { x0 = ev.clientX; },
      onPointerup: ev => { if (x0 != null && Math.abs(ev.clientX - x0) > 50) go(ev.clientX < x0 ? 1 : -1); x0 = null; },
    },
    h('div', { class: 'lb-bar' },
      counter,
      h('button', {
        class: 'icon-btn', type: 'button', 'aria-label': 'Delete photo',
        onClick: async () => {
          if (!(await confirmDialog('Delete this photo from the entry?'))) return;
          const [id] = state.photos.splice(i, 1);
          touch();
          await deletePhoto(id, date);
          saveSoon.flush();
          paintPhotos();
          if (!state.photos.length) return close();
          i = Math.min(i, state.photos.length - 1);
          show();
        },
      }, icon('trash')),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onClick: close }, icon('x'))),
    h('button', { class: 'lb-nav prev', type: 'button', 'aria-label': 'Previous photo', onClick: () => go(-1) }, icon('left')),
    img,
    h('button', { class: 'lb-nav next', type: 'button', 'aria-label': 'Next photo', onClick: () => go(1) }, icon('right')));
    document.body.append(lb);
    document.body.classList.add('modal-open');
    document.addEventListener('keydown', onKey);
    lb.querySelector('.lb-bar .icon-btn:last-child').focus();
    show();
  }

  add(root, 
    h('a', { class: 'back-link', href: '#/diary' }, icon('left', 'sm'), 'All entries'),
    dateNav({
      title: relDay(date) ?? fmt(date, { weekday: 'long' }),
      sub: fmt(date, { day: 'numeric', month: 'long', year: 'numeric' }),
      value: date, prev: `#/diary/${addDays(date, -1)}`, next: `#/diary/${addDays(date, 1)}`,
      prevLabel: 'Previous day', nextLabel: 'Next day',
      onPick: k => ctx.go(`#/diary/${k}`),
    }),
    glance(date),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, 'Mood')),
      moodRow),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, future ? 'Notes' : 'What happened'), status),
      textarea),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, 'Photos')),
      grid, fileIn),
    hasContent(e) && h('button', {
      class: 'btn btn-ghost danger', type: 'button',
      onClick: async () => {
        if (!(await confirmDialog('Delete this whole entry, including its photos?'))) return;
        saveSoon.cancel();
        dirty = false;
        for (const id of state.photos) await deletePhoto(id, date);
        db.remove(e.id);
        toast('Entry deleted');
        ctx.go('#/diary');
      },
    }, icon('trash', 'sm'), 'Delete entry'),
  );
  paintPhotos();
  requestAnimationFrame(() => autosize(textarea));

  return {
    cleanup: () => saveSoon.flush(),
    // Don't redraw under the user's fingers when a sync brings in changes.
    busy: () => dirty || document.activeElement === textarea || !!document.querySelector('.lightbox'),
  };
}

function autosize(el) {
  el.style.height = 'auto';
  el.style.height = `${Math.max(160, el.scrollHeight + 2)}px`;
}

/** What else happened that day: tasks done, workouts, body stats. */
function glance(date) {
  const done = tasks.doneOn(date, dayOf);
  const linked = new Set(done.filter(x => x.list === 'day' && x.linkId).map(x => x.linkId));
  const doneTasks = done.filter(x => !linked.has(x.id));
  const planned = tasks.counts(tasks.forDay(date)).total;
  const ws = F.workoutsOn(date);
  const m = F.metricOn(date);
  if (!doneTasks.length && !ws.length && !m && !planned) return null;
  const chips = [
    planned || doneTasks.length ? h('a', { class: 'chip-link', href: `#/plan/${date}` }, icon('check', 'xs'), `${doneTasks.length} task${doneTasks.length === 1 ? '' : 's'} done`) : null,
    ...ws.map(w => h('a', { class: 'chip-link', href: `#/fitness/edit/${w.id}` }, `${F.kindOf(w).emoji} ${F.workoutName(w)}${w.duration ? ` · ${w.duration} min` : ''}`)),
    m?.weight ? h('span', { class: 'chip-link' }, `⚖️ ${m.weight} kg`) : null,
    m?.steps ? h('span', { class: 'chip-link' }, `👣 ${Number(m.steps).toLocaleString()} steps`) : null,
    m?.sleep ? h('span', { class: 'chip-link' }, `😴 ${m.sleep} h sleep`) : null,
  ];
  return card('Day at a glance', { cls: 'glance' },
    h('div', { class: 'chip-row' }, chips),
    doneTasks.length > 0 && h('details', null,
      h('summary', null, 'Show completed tasks'),
      h('ul', { class: 'plain-list' }, doneTasks.map(x => h('li', null, icon('check', 'xs good'), x.text)))));
}

