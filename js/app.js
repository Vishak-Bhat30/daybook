// App shell: navigation, hash router, sync indicator, service worker.
import { h, icon } from './util.js';
import { setDayStart, today } from './dates.js';
import * as db from './db.js';
import * as sync from './sync.js';
import { revokeAll } from './photos.js';
import { applyTheme } from './theme.js';
import { toast, closeAllSheets } from './ui.js';
import * as Today from './views/today.js';
import * as Plan from './views/plan.js';
import * as Week from './views/week.js';
import * as Diary from './views/diary.js';
import * as Fitness from './views/fitness.js';
import * as Settings from './views/settings.js';

const ROUTES = { today: Today, plan: Plan, week: Week, diary: Diary, fitness: Fitness, settings: Settings };
const NAV = [['today', 'Today'], ['plan', 'Plan'], ['week', 'Week'], ['diary', 'Diary'], ['fitness', 'Fitness']];

const viewEl = document.getElementById('view');
const titleEl = document.getElementById('title');
let current = { name: null, handle: {} };

function parse() {
  const [name, ...params] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  return { name: ROUTES[name] ? name : 'today', params };
}

const ctx = {
  go: hash => { if (location.hash === hash) render(); else location.hash = hash; },
  refresh: () => render({ keepScroll: true }),
};

function render({ keepScroll = false } = {}) {
  const { name, params } = parse();
  const y = scrollY;
  try { current.handle?.cleanup?.(); } catch (e) { console.error(e); }
  closeAllSheets();
  revokeAll();
  const mod = ROUTES[name];
  const root = h('div', { class: `page page-${name}` });
  viewEl.replaceChildren(root);
  titleEl.textContent = mod.title;
  document.title = `${mod.title} · Daybook`;
  let handle = {};
  try {
    handle = mod.render(root, params, ctx) || {};
  } catch (e) {
    console.error(e);
    root.replaceChildren(h('div', { class: 'empty' }, h('p', null, 'Something went wrong showing this page.'), h('pre', { class: 'small' }, String(e?.message || e))));
  }
  current = { name, handle };
  document.querySelectorAll('.nav a').forEach(a => (a.dataset.route === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  if (keepScroll) scrollTo(0, y);
  else { scrollTo(0, 0); viewEl.focus({ preventScroll: true }); }
}

function buildNav() {
  document.getElementById('nav').replaceChildren(
    h('div', { class: 'nav-brand' }, h('img', { src: 'icons/icon.svg', alt: '', width: 28, height: 28 }), 'Daybook'),
    ...NAV.map(([route, label]) => h('a', { href: `#/${route}`, dataset: { route } }, icon(route), h('span', null, label))),
    h('a', { href: '#/settings', class: 'nav-settings', dataset: { route: 'settings' } }, icon('settings'), h('span', null, 'Settings')));
}

function buildSyncButton() {
  const btn = document.getElementById('syncBtn');
  sync.onStatus(st => {
    const map = {
      off: ['cloudOff', 'Not syncing — tap to set up'],
      idle: ['cloud', 'Sync ready'],
      syncing: ['sync', 'Syncing…'],
      ok: ['cloudOk', 'Synced'],
      offline: ['cloudOff', 'Offline — changes saved on this device'],
      error: ['cloudErr', `Sync problem: ${st.error || ''}`],
    };
    const [ic, label] = map[st.status] || map.idle;
    btn.replaceChildren(icon(ic, st.status === 'syncing' ? 'spin' : ''));
    btn.className = `icon-btn sync-${st.status}`;
    btn.setAttribute('aria-label', label);
    btn.title = label;
  });
  btn.addEventListener('click', () => {
    const st = sync.getState();
    if (!sync.configured()) return ctx.go('#/settings/sync');
    if (st.status === 'error') toast(st.error || 'Sync failed', { action: 'Retry', onAction: () => sync.syncNow(), ms: 8000 });
    else { sync.syncNow(); toast('Syncing…', { ms: 1500 }); }
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  // Reload only when the user accepts an update, never on the first install (it would wipe typing).
  let accepted = false;
  navigator.serviceWorker.register('sw.js').then(reg => {
    const offer = worker => toast('A new version of Daybook is ready.', { action: 'Reload', onAction: () => { accepted = true; worker.postMessage('skipWaiting'); }, ms: 30000 });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60e3);
  }).catch(err => console.warn('SW registration failed', err));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (accepted && !reloading) { reloading = true; location.reload(); } });
}

async function start() {
  applyTheme();
  buildNav();
  try {
    await db.open();
  } catch (e) {
    viewEl.replaceChildren(h('div', { class: 'empty' },
      h('p', null, "Daybook couldn't open its storage on this browser."),
      h('p', { class: 'small muted' }, String(e?.message || e)),
      h('p', { class: 'small muted' }, 'Private/incognito windows sometimes block it — try a normal window.')));
    return;
  }
  setDayStart(db.prefs().dayStart);
  buildSyncButton();

  db.on(info => {
    if (info.error) { toast(`Couldn't save: ${info.error.message || info.error}`); return; }
    if (info.ids?.includes('prefs')) setDayStart(db.prefs().dayStart);
    // Changes from sync or another tab: redraw, unless the user is in the middle of typing.
    if (info.remote) scheduleRemoteRefresh();
  });

  addEventListener('hashchange', () => render());
  render();
  sync.init();
  registerServiceWorker();
  navigator.storage?.persist?.().catch(() => {});

  // Keep "today" correct if the app stays open past the day boundary.
  let lastDay = today();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (today() !== lastDay) { lastDay = today(); ctx.refresh(); }
  });
}

let remoteTimer = null;
function scheduleRemoteRefresh() {
  clearTimeout(remoteTimer);
  remoteTimer = setTimeout(() => {
    const typing = document.activeElement?.matches?.('input:not([type=checkbox]):not([type=radio]), textarea, select');
    if (current.handle?.busy?.() || typing || document.querySelector('.sheet, .menu, .lightbox')) {
      scheduleRemoteRefresh(); // try again shortly
      return;
    }
    ctx.refresh();
  }, 400);
}

addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__installPrompt = e; });

start();
