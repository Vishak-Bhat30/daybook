// Sync with a private GitHub repo through the REST "contents" API.
//
// Repo layout:
//   data/2026-11.json   one file per month: {"records":[ ...one record per line... ]}
//   data/misc.json      undated records (prefs)
//   photos/2026-11/<id>.jpg
//
// Each sync: list data/ (1 request). Download only shards whose git sha changed since we
// last saw them, merge record-by-record (newest updatedAt wins), then upload shards that
// changed locally. Uploads pass the sha we based them on, so a concurrent edit from another
// device is detected (409) and merged before retrying.
import * as db from './db.js';
import { blobToB64 } from './util.js';

const CFG_KEY = 'daybook.sync';
const api = () => localStorage.getItem('daybook.apiBase') || 'https://api.github.com';

export function getConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || null; } catch { return null; }
}
export const configured = () => { const c = getConfig(); return !!(c?.owner && c?.repo && c?.token); };

export async function connect(cfg) {
  const info = await testConnection(cfg);
  const prev = getConfig();
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  if (!prev || prev.owner !== cfg.owner || prev.repo !== cfg.repo) {
    // New destination: forget what we knew about the old one and upload everything.
    await db.setMeta('shas', {});
    db.markAllDirty();
    for (const p of await db.photos.all()) if (p.synced) await db.photos.put({ ...p, synced: false });
  }
  syncNow();
  return info;
}
export function disconnect() {
  localStorage.removeItem(CFG_KEY);
  set({ status: 'off', error: null });
}

// ---- status --------------------------------------------------------------
let state = { status: 'off', error: null, last: Number(localStorage.getItem('daybook.lastSync')) || null };
const subs = new Set();
export function onStatus(fn) { subs.add(fn); fn(state); return () => subs.delete(fn); }
function set(patch) { state = { ...state, ...patch }; subs.forEach(f => f(state)); }
export const getState = () => state;

// ---- low-level API -------------------------------------------------------
async function call(path, { method = 'GET', body, raw = false, cfg = getConfig() } = {}) {
  return fetch(`${api()}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}${path}`, {
    method,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function fail(res, what) {
  let msg = '';
  try { msg = (await res.json()).message || ''; } catch { /* not json */ }
  const c = getConfig();
  if (res.status === 401) return new Error('GitHub rejected the token (expired or mistyped). Update it in Settings.');
  if (res.status === 403 && /rate limit/i.test(msg)) return new Error('GitHub rate limit reached. Sync will retry later.');
  if (res.status === 403 || res.status === 404) return new Error(`No write access to ${c?.owner}/${c?.repo}. Check the repo name and that the token has "Contents: Read and write" on it.`);
  return new Error(`${what} failed (${res.status}${msg ? ': ' + msg : ''})`);
}

function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const textToB64 = t => bytesToB64(new TextEncoder().encode(t));
const b64ToText = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, '')), c => c.charCodeAt(0)));

/** name -> sha for files in a directory (empty if it doesn't exist yet). */
async function listDir(path) {
  const res = await call(`/contents/${path}`);
  if (res.status === 404) return new Map();
  if (!res.ok) throw await fail(res, `Listing ${path}`);
  const arr = await res.json();
  return new Map((Array.isArray(arr) ? arr : []).filter(e => e.type === 'file').map(e => [e.name, e.sha]));
}

async function getFile(path) {
  const res = await call(`/contents/${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw await fail(res, `Reading ${path}`);
  const j = await res.json();
  if (j.encoding === 'base64' && j.content) return { sha: j.sha, text: b64ToText(j.content) };
  // Files over 1 MB come back without content; fetch the raw bytes instead.
  const r2 = await call(`/contents/${path}`, { raw: true });
  if (!r2.ok) throw await fail(r2, `Reading ${path}`);
  return { sha: j.sha, text: await r2.text() };
}

/** Returns the new sha, or null if the file changed underneath us (conflict). */
async function putFile(path, content, sha, message) {
  const res = await call(`/contents/${path}`, { method: 'PUT', body: { message, content, ...(sha ? { sha } : {}) } });
  if (res.status === 409 || res.status === 422) return null;
  if (!res.ok) throw await fail(res, `Saving ${path}`);
  return (await res.json()).content.sha;
}

// ---- shard (de)serialisation ---------------------------------------------
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  return JSON.stringify(v ?? null);
}
function shardText(shard) {
  const recs = db.raw().filter(r => db.shardOf(r) === shard).sort((a, b) => (a.id < b.id ? -1 : 1));
  return recs.length ? '{"app":"daybook","v":1,"records":[\n' + recs.map(stable).join(',\n') + '\n]}\n' : null;
}
function parseShard(text) {
  try { return JSON.parse(text).records || []; } catch { return []; }
}

// ---- sync ----------------------------------------------------------------
let running = null;
let again = false;

export function syncNow() {
  if (!configured()) return Promise.resolve();
  if (running) { again = true; return running; }
  running = run().finally(() => {
    running = null;
    if (again) { again = false; syncNow(); }
  });
  return running;
}

async function run() {
  if (!navigator.onLine) { set({ status: 'offline' }); return; }
  set({ status: 'syncing', error: null });
  try {
    const known = { ...(db.getMeta('shas') || {}) };
    const remote = await listDir('data');
    const fetched = new Map(); // shard -> remote text we just saw

    // 1. Pull shards another device changed.
    for (const [name, sha] of remote) {
      if (!name.endsWith('.json') || known[name] === sha) continue;
      const f = await getFile(`data/${name}`);
      if (!f) continue;
      const shard = name.slice(0, -5);
      remote.set(name, f.sha);
      await db.applyRemote(parseShard(f.text));
      fetched.set(shard, f.text);
      known[name] = f.sha;
    }
    await db.setMeta('shas', known);

    // 2. Push shards that differ locally.
    const dirty = { ...(db.getMeta('dirty') || {}) };
    for (const shard of new Set([...Object.keys(dirty), ...fetched.keys()])) {
      await pushShard(shard, dirty[shard], remote, fetched, known);
    }
    await db.setMeta('shas', known);

    // 3. Photos.
    await pushPhotos();
    await pushPhotoDeletes();

    const now = Date.now();
    localStorage.setItem('daybook.lastSync', String(now));
    set({ status: 'ok', last: now, error: null });
  } catch (e) {
    console.error('sync failed', e);
    set({ status: navigator.onLine ? 'error' : 'offline', error: e.message || String(e) });
  }
}

async function pushShard(shard, stamp, remote, fetched, known) {
  const name = `${shard}.json`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const text = shardText(shard);
    const sha = remote.get(name) ?? null;
    if (text === (fetched.get(shard) ?? null) || (text === null && !sha)) { clearDirty(shard, stamp); return; }
    if (text === null) { clearDirty(shard, stamp); return; } // never delete remote shards; tombstones keep them non-empty
    const newSha = await putFile(`data/${name}`, textToB64(text), sha, `Update ${shard}`);
    if (newSha) {
      known[name] = newSha; remote.set(name, newSha); fetched.set(shard, text);
      clearDirty(shard, stamp);
      return;
    }
    // Someone else wrote this shard since we looked: merge theirs, then retry.
    const f = await getFile(`data/${name}`);
    if (f) { await db.applyRemote(parseShard(f.text)); remote.set(name, f.sha); fetched.set(shard, f.text); known[name] = f.sha; }
    else { remote.delete(name); fetched.delete(shard); }
  }
  throw new Error(`Couldn't save ${shard} after several tries. Will retry.`);
}

function clearDirty(shard, stamp) {
  const d = { ...(db.getMeta('dirty') || {}) };
  if (shard in d && d[shard] === stamp) { delete d[shard]; db.setMeta('dirty', d); }
}

const photoPath = (id, date) => `photos/${date.slice(0, 7)}/${id}.jpg`;

async function pushPhotos() {
  for (const p of await db.photos.all()) {
    if (p.synced) continue;
    const res = await call(`/contents/${photoPath(p.id, p.date)}`, {
      method: 'PUT',
      body: { message: `Photo ${p.date}`, content: await blobToB64(p.full) },
    });
    if (!res.ok && res.status !== 422) throw await fail(res, 'Uploading a photo'); // 422 = already there
    await db.photos.put({ ...p, synced: true });
  }
}

export function queuePhotoDelete(id, date) {
  if (!configured()) return;
  return db.setMeta('photoDeletes', [...(db.getMeta('photoDeletes') || []), { id, date }]);
}

async function pushPhotoDeletes() {
  const queue = db.getMeta('photoDeletes') || [];
  if (!queue.length) return;
  const done = new Set();
  const months = [...new Set(queue.map(q => q.date.slice(0, 7)))];
  for (const m of months) {
    const files = await listDir(`photos/${m}`);
    for (const q of queue.filter(x => x.date.startsWith(m))) {
      const sha = files.get(`${q.id}.jpg`);
      if (!sha) { done.add(q.id); continue; }
      const res = await call(`/contents/${photoPath(q.id, q.date)}`, { method: 'DELETE', body: { message: 'Remove photo', sha } });
      if (res.ok || res.status === 404) done.add(q.id);
    }
  }
  await db.setMeta('photoDeletes', (db.getMeta('photoDeletes') || []).filter(q => !done.has(q.id)));
}

/** Download a photo another device uploaded. */
export async function fetchPhoto(id, date) {
  if (!configured() || !navigator.onLine) return null;
  const res = await call(`/contents/${photoPath(id, date)}`, { raw: true });
  if (!res.ok) return null;
  return new Blob([await res.arrayBuffer()], { type: 'image/jpeg' });
}

export async function testConnection(cfg) {
  let res;
  try {
    res = await call('', { cfg });
  } catch {
    throw new Error("Couldn't reach GitHub. Are you online?");
  }
  if (res.status === 401) throw new Error('GitHub rejected that token. Check you copied all of it.');
  if (res.status === 404 || res.status === 403) throw new Error(`Can't see ${cfg.owner}/${cfg.repo}. Check the spelling, and that the token was given access to this repo.`);
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
  const j = await res.json();
  return { fullName: j.full_name, private: !!j.private };
}

// ---- automatic syncing ---------------------------------------------------
let timer = null;
export function schedule(delay = 10000) {
  if (!configured()) return;
  clearTimeout(timer);
  timer = setTimeout(() => { timer = null; syncNow(); }, delay);
}

export function init() {
  set({ status: configured() ? (navigator.onLine ? 'idle' : 'offline') : 'off' });
  db.on(info => { if (info.local) schedule(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (timer) { clearTimeout(timer); timer = null; syncNow(); } // flush pending edits before the app is backgrounded
    } else schedule(800);
  });
  addEventListener('online', () => schedule(800));
  addEventListener('offline', () => configured() && set({ status: 'offline' }));
  setInterval(() => document.visibilityState === 'visible' && syncNow(), 5 * 60e3);
  schedule(500);
}
