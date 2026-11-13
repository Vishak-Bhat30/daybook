// Photo import (resize + compress on device), lookup and object-URL management.
import * as db from './db.js';
import * as sync from './sync.js';
import { uid } from './util.js';

const FULL_MAX = 1600, FULL_Q = 0.82;
const THUMB_MAX = 480, THUMB_Q = 0.72;

async function decode(blob) {
  if ('createImageBitmap' in self) {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { /* fall back */ }
  }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try { await img.decode(); } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
  return img;
}

function toJpeg(src, max, q) {
  const w0 = src.width, h0 = src.height;
  const k = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * k));
  c.height = Math.max(1, Math.round(h0 * k));
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not process image'))), 'image/jpeg', q));
}

/** Resize a picked file, store it, and return its id. */
export async function importImage(file, date) {
  const src = await decode(file);
  const full = await toJpeg(src, FULL_MAX, FULL_Q);
  const thumb = await toJpeg(src, THUMB_MAX, THUMB_Q);
  src.close?.();
  const p = { id: uid(), date, full, thumb, synced: false, createdAt: Date.now() };
  await db.photos.put(p);
  return p.id;
}

/** Store an already-compressed JPEG (from sync or a backup), generating its thumbnail. */
export async function storeBlob(id, date, blob, synced) {
  const src = await decode(blob);
  const thumb = await toJpeg(src, THUMB_MAX, THUMB_Q);
  src.close?.();
  const rec = { id, date, full: blob, thumb, synced, createdAt: Date.now() };
  await db.photos.put(rec);
  return rec;
}

const urls = new Map();
const inflight = new Map();

async function load(id, date) {
  let p = await db.photos.get(id);
  if (p) return p;
  if (!inflight.has(id)) {
    inflight.set(id, (async () => {
      const blob = await sync.fetchPhoto(id, date);
      return blob ? storeBlob(id, date, blob, true) : null;
    })().finally(() => inflight.delete(id)));
  }
  return inflight.get(id);
}

/** Object URL for a photo ('thumb' or 'full'); downloads from sync if needed. null if unavailable. */
export async function photoURL(id, date, variant = 'thumb') {
  const key = `${id}:${variant}`;
  if (urls.has(key)) return urls.get(key);
  let p = null;
  try { p = await load(id, date); } catch (e) { console.warn('photo load failed', e); }
  if (!p) return null;
  const url = URL.createObjectURL(variant === 'full' ? p.full : p.thumb);
  urls.set(key, url);
  return url;
}

/** Release object URLs (called on navigation). */
export function revokeAll() {
  urls.forEach(u => URL.revokeObjectURL(u));
  urls.clear();
}

export async function deletePhoto(id, date) {
  for (const v of ['thumb', 'full']) {
    const u = urls.get(`${id}:${v}`);
    if (u) { URL.revokeObjectURL(u); urls.delete(`${id}:${v}`); }
  }
  await db.photos.del(id);
  await sync.queuePhotoDelete(id, date);
}

/** <img> that fills itself in asynchronously. */
export function photoImg(id, date, { variant = 'thumb', alt = '', cls = '' } = {}) {
  const img = document.createElement('img');
  img.alt = alt;
  img.className = `photo ${cls} loading`.trim();
  img.decoding = 'async';
  photoURL(id, date, variant).then(url => {
    if (url) { img.src = url; img.classList.remove('loading'); }
    else { img.classList.replace('loading', 'missing'); img.alt = 'Photo not on this device yet'; img.title = img.alt; }
  });
  return img;
}
