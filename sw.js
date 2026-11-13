// Offline support: precache the app shell; serve it cache-first.
// Bump VERSION whenever any file changes so phones pick up the update.
const VERSION = '2026-11-13.2';
const CACHE = `daybook-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/charts.js',
  'js/dates.js',
  'js/db.js',
  'js/fitlib.js',
  'js/icons.js',
  'js/photos.js',
  'js/sync.js',
  'js/tasks.js',
  'js/theme.js',
  'js/ui.js',
  'js/util.js',
  'js/views/diary.js',
  'js/views/fitness.js',
  'js/views/plan.js',
  'js/views/settings.js',
  'js/views/today.js',
  'js/views/week.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('daybook-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // GitHub API etc. always go to the network
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('./').then(r => r || fetch(req)).catch(() => fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});
