// Settings: profile, appearance, GitHub sync, install, backup.
import { h, icon, download, blobToB64, b64ToBlob, plural, add, fill } from '../util.js';
import { today, timeAgo } from '../dates.js';
import * as db from '../db.js';
import * as sync from '../sync.js';
import { storeBlob } from '../photos.js';
import { getTheme, setTheme } from '../theme.js';
import { card, toast, confirmDialog } from '../ui.js';

export const title = 'Settings';
export const APP_VERSION = '1.0.0';

const field = (label, input, hint) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint && h('span', { class: 'field-hint' }, hint));
const ext = (href, text) => h('a', { class: 'link', href, target: '_blank', rel: 'noopener' }, text);

let unsubSync = null;

export function render(root, [section], ctx) {
  add(root, profileCard(ctx), themeCard(), syncCard(ctx), installCard(), backupCard(ctx), aboutCard());
  if (section) queueMicrotask(() => document.getElementById(`s-${section}`)?.scrollIntoView({ block: 'start' }));
  return { cleanup: () => { unsubSync?.(); unsubSync = null; } };
}

function profileCard() {
  const p = db.prefs();
  const name = h('input', { class: 'input', type: 'text', value: p.name, maxlength: 40, placeholder: 'Your first name', autocomplete: 'given-name' });
  const goal = h('input', { class: 'input', type: 'number', inputmode: 'numeric', min: 0, max: 14, value: p.weeklyGoal });
  const dayStart = h('select', { class: 'input', value: String(p.dayStart) },
    [0, 1, 2, 3, 4, 5, 6].map(n => h('option', { value: String(n) }, n === 0 ? 'Midnight' : `${n}:00 am`)));
  const save = () => {
    db.setPrefs({ name: name.value.trim(), weeklyGoal: Math.max(0, Math.min(14, parseInt(goal.value, 10) || 0)), dayStart: Number(dayStart.value) });
    toast('Saved');
  };
  [name, goal].forEach(i => i.addEventListener('change', save));
  dayStart.addEventListener('change', save);
  return card('You', {},
    h('div', { class: 'form' },
      field('Name', name, 'Used for the greeting on the Today page.'),
      field('Workouts per week goal', goal),
      field('A new day starts at', dayStart, "Late nights count as the previous day until this time, so your end-of-day review isn't cut off at midnight.")));
}

function themeCard() {
  const cur = getTheme();
  return card('Appearance', {},
    h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Theme' },
      [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, label]) =>
        h('button', {
          class: 'seg-btn', type: 'button', role: 'radio', 'aria-checked': String(cur === v),
          onClick: e => {
            setTheme(v);
            e.currentTarget.parentElement.querySelectorAll('.seg-btn').forEach(b => b.setAttribute('aria-checked', String(b === e.currentTarget)));
          },
        }, label))));
}

function syncCard(ctx) {
  const body = h('div', { class: 'stack' });
  const box = card('Sync between devices', { cls: 'sync-card' }, body);
  box.id = 's-sync';
  function paint() {
    unsubSync?.();
    unsubSync = null;
    if (sync.configured()) connected(); else setup();
  }

  function connected() {
    const c = sync.getConfig();
    const status = h('p', { class: 'sync-status' });
    unsubSync = sync.onStatus(st => {
      const map = {
        syncing: [icon('sync', 'sm spin'), 'Syncing…'],
        ok: [icon('cloudOk', 'sm good'), `Up to date · synced ${st.last ? timeAgo(st.last) : ''}`],
        idle: [icon('cloud', 'sm'), st.last ? `Last synced ${timeAgo(st.last)}` : 'Waiting to sync'],
        offline: [icon('cloudOff', 'sm'), 'Offline — changes are saved on this device and will sync when you are back online'],
        error: [icon('cloudErr', 'sm bad'), st.error || 'Sync failed'],
      };
      status.className = `sync-status ${st.status}`;
      status.replaceChildren(...(map[st.status] || map.idle));
    });
    fill(body, 
      h('p', null, 'Connected to ', h('strong', null, `${c.owner}/${c.repo}`), ' on GitHub. Your data syncs automatically when you make changes and when you open the app.'),
      status,
      h('div', { class: 'actions-row' },
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => sync.syncNow() }, icon('sync', 'sm'), 'Sync now'),
        h('button', { class: 'btn', type: 'button', onClick: () => setup(c) }, 'Change token'),
        h('button', {
          class: 'btn btn-ghost danger', type: 'button',
          onClick: async () => {
            if (!(await confirmDialog('Stop syncing this device? Your data stays here and on GitHub.', { ok: 'Disconnect', danger: true }))) return;
            sync.disconnect();
            paint();
          },
        }, 'Disconnect')));
  }

  function setup(prev) {
    const owner = h('input', { class: 'input', type: 'text', value: prev?.owner || '', placeholder: 'your-github-username', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', required: true });
    const repo = h('input', { class: 'input', type: 'text', value: prev?.repo || 'daybook-data', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', required: true });
    const token = h('input', { class: 'input', type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', spellcheck: 'false', required: true });
    const msg = h('p', { class: 'form-msg', role: 'alert' });
    const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Connect');
    const form = h('form', {
      class: 'form',
      onSubmit: async e => {
        e.preventDefault();
        const cfg = { owner: owner.value.trim().replace(/^@/, ''), repo: repo.value.trim(), token: token.value.trim() };
        if (cfg.repo.includes('/')) [cfg.owner, cfg.repo] = cfg.repo.split('/').slice(-2);
        btn.disabled = true; btn.textContent = 'Checking…'; msg.textContent = ''; msg.className = 'form-msg';
        try {
          const info = await sync.connect(cfg);
          toast(`Connected to ${info.fullName}`);
          if (!info.private) toast('Warning: that repo is PUBLIC. Make it private on GitHub so nobody else can read your diary.', { ms: 12000 });
          paint();
        } catch (err) {
          msg.textContent = err.message;
          msg.className = 'form-msg bad';
          btn.disabled = false; btn.textContent = 'Connect';
        }
      },
    },
    field('GitHub username', owner),
    field('Repository name', repo, 'A private repo that only holds your Daybook data.'),
    field('Access token', token, 'Stored only on this device.'),
    msg,
    h('div', { class: 'actions-row' }, btn, prev && h('button', { class: 'btn', type: 'button', onClick: paint }, 'Cancel')));

    fill(body, 
      h('p', null, 'Right now everything is saved only on this device. Connect a ', h('strong', null, 'private'), ' GitHub repository to keep your phone and laptop in sync and to have a backup.'),
      h('details', { class: 'howto', open: !prev },
        h('summary', null, 'How to set it up (2 minutes, once)'),
        h('ol', null,
          h('li', null, ext('https://github.com/new?name=daybook-data&visibility=private', 'Create a new repository'), ' called ', h('code', null, 'daybook-data'), '. Choose ', h('strong', null, 'Private'), '.'),
          h('li', null, ext('https://github.com/settings/personal-access-tokens/new', 'Create a fine-grained token'), ': under ', h('em', null, 'Repository access'), ' pick ', h('em', null, 'Only select repositories'), ' → ', h('code', null, 'daybook-data'), '. Under ', h('em', null, 'Permissions → Repository permissions'), ' set ', h('strong', null, 'Contents: Read and write'), '. Generate it and copy it.'),
          h('li', null, 'Paste it below. On your other devices, open Daybook and enter the same details.'))),
      form);
  }

  paint();
  return box;
}

function installCard() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const prompt = window.__installPrompt;
  return card('Install on your phone', {},
    standalone
      ? h('p', { class: 'muted' }, icon('check', 'sm good'), ' Daybook is installed as an app on this device.')
      : [
        prompt && h('button', {
          class: 'btn btn-primary', type: 'button',
          onClick: async () => { prompt.prompt(); await prompt.userChoice; window.__installPrompt = null; },
        }, icon('phone', 'sm'), 'Install Daybook'),
        h('ul', { class: 'plain-list howto-list' },
          h('li', null, h('strong', null, 'iPhone: '), 'open this page in Safari → tap the Share button → ', h('em', null, 'Add to Home Screen'), '.'),
          h('li', null, h('strong', null, 'Android: '), 'open in Chrome → tap ⋮ → ', h('em', null, 'Install app'), ' (or ', h('em', null, 'Add to Home screen'), ').')),
        h('p', { class: 'muted small' }, 'It then opens full-screen with its own icon and works offline.'),
      ]);
}

function backupCard(ctx) {
  const info = h('p', { class: 'muted small' });
  (async () => {
    const parts = [`${plural(db.raw().filter(r => !r.deleted).length, 'item')}`, `${plural(await db.photos.count(), 'photo')}`];
    if (navigator.storage?.estimate) {
      const { usage } = await navigator.storage.estimate();
      parts.push(`${(usage / 1048576).toFixed(1)} MB used`);
    }
    if (navigator.storage?.persisted) parts.push((await navigator.storage.persisted()) ? 'storage is persistent' : 'browser may clear storage if space runs low');
    info.textContent = `On this device: ${parts.join(' · ')}.`;
  })();

  const fileIn = h('input', {
    type: 'file', accept: 'application/json,.json', class: 'visually-hidden', id: 'import-file',
    onChange: async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (data.app !== 'daybook') throw new Error('That file is not a Daybook backup.');
        const n = await db.applyRemote(data.records || [], { dirty: true });
        let np = 0;
        for (const p of data.photos || []) {
          if (await db.photos.get(p.id)) continue;
          await storeBlob(p.id, p.date, b64ToBlob(p.data, 'image/jpeg'), false);
          np++;
        }
        toast(`Imported ${plural(n, 'item')} and ${plural(np, 'photo')}`);
        ctx.refresh();
      } catch (err) {
        toast(`Import failed: ${err.message}`);
      }
    },
  });

  return card('Backup', {},
    h('p', null, 'Download everything (including photos) as one file, or restore from one. Importing merges with what is already here.'),
    h('div', { class: 'actions-row' },
      h('button', {
        class: 'btn', type: 'button',
        onClick: async e => {
          const b = e.currentTarget;
          b.disabled = true;
          try {
            const photos = [];
            for (const p of await db.photos.all()) photos.push({ id: p.id, date: p.date, data: await blobToB64(p.full) });
            const out = { app: 'daybook', v: 1, exportedAt: new Date().toISOString(), records: db.raw(), photos };
            download(`daybook-backup-${today()}.json`, new Blob([JSON.stringify(out)], { type: 'application/json' }));
          } finally { b.disabled = false; }
        },
      }, icon('download', 'sm'), 'Export backup'),
      h('label', { class: 'btn', for: 'import-file' }, icon('upload', 'sm'), 'Import backup'),
      fileIn),
    info,
    h('details', { class: 'danger-zone' },
      h('summary', null, 'Erase this device'),
      h('p', { class: 'muted small' }, 'Removes all Daybook data from this browser. Anything synced to GitHub stays there and comes back if you reconnect.'),
      h('button', {
        class: 'btn btn-danger', type: 'button',
        onClick: async () => {
          if (!(await confirmDialog('Erase all Daybook data on this device? This cannot be undone.', { ok: 'Erase everything' }))) return;
          await db.erase();
          Object.keys(localStorage).filter(k => k.startsWith('daybook.')).forEach(k => localStorage.removeItem(k));
          location.hash = '#/today';
          location.reload();
        },
      }, 'Erase everything on this device')));
}

function aboutCard() {
  return card('About', {},
    h('p', { class: 'muted small' }, `Daybook ${APP_VERSION}. Your data lives in this browser${sync.configured() ? ' and in your private GitHub repo' : ''}; nothing is sent anywhere else.`));
}
