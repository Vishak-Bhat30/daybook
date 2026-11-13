// Local storage: IndexedDB, mirrored in memory so views can query synchronously.
//
// Every piece of data is a "record" { id, type, updatedAt, ... }. Deleting leaves a
// tombstone { id, type, shard, deleted: true } so deletions sync too.
// Records are grouped into monthly "shards" (by their date) for syncing.
import { uid } from './util.js';

const DB_NAME = 'daybook';
let idb;
const mem = new Map();
const meta = new Map();
const listeners = new Set();
const bc = 'BroadcastChannel' in self ? new BroadcastChannel('daybook') : null;

const wrap = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const finish = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error); });

export async function open() {
  idb = await new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('records', { keyPath: 'id' });
      d.createObjectStore('photos', { keyPath: 'id' });
      d.createObjectStore('meta');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('Close other Daybook tabs and reload.'));
  });
  idb.onversionchange = () => { idb.close(); location.reload(); };
  const t = idb.transaction(['records', 'meta']);
  const [recs, keys, vals] = await Promise.all([
    wrap(t.objectStore('records').getAll()),
    wrap(t.objectStore('meta').getAllKeys()),
    wrap(t.objectStore('meta').getAll()),
  ]);
  recs.forEach(r => mem.set(r.id, r));
  keys.forEach((k, i) => meta.set(k, vals[i]));
  if (bc) bc.onmessage = e => reloadFromDisk(e.data?.ids || []);
}

// Another tab changed something: pull those records (and the dirty map) back in.
async function reloadFromDisk(ids) {
  const t = idb.transaction(['records', 'meta']);
  const recs = await Promise.all(ids.map(id => wrap(t.objectStore('records').get(id))));
  const dirty = await wrap(t.objectStore('meta').get('dirty'));
  recs.forEach(r => r && mem.set(r.id, r));
  meta.set('dirty', { ...(dirty || {}), ...(meta.get('dirty') || {}) });
  emit({ remote: true, ids });
}

export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(info) {
  for (const fn of listeners) { try { fn(info); } catch (e) { console.error(e); } }
}

// ---- queries -------------------------------------------------------------
export const get = id => { const r = mem.get(id); return r && !r.deleted ? r : undefined; };
export function list(type, pred) {
  const out = [];
  for (const r of mem.values()) if (r.type === type && !r.deleted && (!pred || pred(r))) out.push(r);
  return out;
}
/** Every record including tombstones (used by sync / backup). */
export const raw = () => [...mem.values()];

/** Which monthly shard a record syncs in: "2026-11", or "misc" for undated records. */
export function shardOf(r) {
  if (r.shard) return r.shard;
  const d = r.date || r.bucket;
  return typeof d === 'string' && /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : 'misc';
}

// ---- writes --------------------------------------------------------------
export function put(rec) {
  const prev = mem.get(rec.id);
  const now = Date.now();
  const r = { ...rec, id: rec.id || uid(), createdAt: rec.createdAt ?? prev?.createdAt ?? now };
  delete r.deleted; delete r.shard;
  r.updatedAt = Math.max(now, (prev?.updatedAt ?? 0) + 1);
  commit([r], [prev && shardOf(prev), shardOf(r)]);
  return r;
}

export function remove(id) {
  const prev = mem.get(id);
  if (!prev || prev.deleted) return;
  const t = { id, type: prev.type, shard: shardOf(prev), deleted: true, updatedAt: Math.max(Date.now(), prev.updatedAt + 1) };
  commit([t], [t.shard]);
  return prev;
}

function commit(recs, shards) {
  recs.forEach(r => mem.set(r.id, r));
  markDirty(shards);
  const t = idb.transaction('records', 'readwrite');
  recs.forEach(r => t.objectStore('records').put(r));
  finish(t).catch(error => emit({ error }));
  const ids = recs.map(r => r.id);
  bc?.postMessage({ ids });
  emit({ local: true, ids });
}

/**
 * Merge records from elsewhere (sync / backup import). Newest updatedAt wins. Returns count applied.
 * `dirty`: also queue them for upload (imports), which sync-pulled records don't need.
 */
export async function applyRemote(records, { dirty = false } = {}) {
  const changed = records.filter(r => r && r.id && r.type && (!mem.has(r.id) || r.updatedAt > mem.get(r.id).updatedAt));
  if (!changed.length) return 0;
  if (dirty) markDirty([...new Set(changed.map(shardOf))]);
  changed.forEach(r => mem.set(r.id, r));
  const t = idb.transaction('records', 'readwrite');
  changed.forEach(r => t.objectStore('records').put(r));
  await finish(t);
  const ids = changed.map(r => r.id);
  bc?.postMessage({ ids });
  emit({ remote: true, ids });
  return changed.length;
}

// ---- meta (sync bookkeeping) ---------------------------------------------
export const getMeta = k => meta.get(k);
export function setMeta(k, v) {
  meta.set(k, v);
  const t = idb.transaction('meta', 'readwrite');
  t.objectStore('meta').put(v, k);
  return finish(t);
}
export function markDirty(shards) {
  const d = { ...(meta.get('dirty') || {}) };
  const stamp = Date.now() + Math.random();
  shards.filter(Boolean).forEach(s => { d[s] = stamp; });
  setMeta('dirty', d);
}
export function markAllDirty() { markDirty([...new Set(raw().map(shardOf))]); }

// ---- prefs (synced across devices) ---------------------------------------
const DEFAULT_PREFS = { name: '', weeklyGoal: 4, dayStart: 3 };
export const prefs = () => ({ ...DEFAULT_PREFS, ...(get('prefs') || {}) });
export const setPrefs = patch => put({ ...prefs(), ...patch, id: 'prefs', type: 'prefs' });

// ---- photos (blobs, stored separately; synced as image files) ------------
export const photos = {
  put(p) { const t = idb.transaction('photos', 'readwrite'); t.objectStore('photos').put(p); return finish(t); },
  get: id => wrap(idb.transaction('photos').objectStore('photos').get(id)),
  del(id) { const t = idb.transaction('photos', 'readwrite'); t.objectStore('photos').delete(id); return finish(t); },
  all: () => wrap(idb.transaction('photos').objectStore('photos').getAll()),
  count: () => wrap(idb.transaction('photos').objectStore('photos').count()),
};

/** Delete everything on this device. */
export async function erase() {
  idb?.close();
  await new Promise((res, rej) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = res; r.onerror = () => rej(r.error); r.onblocked = res; });
}
