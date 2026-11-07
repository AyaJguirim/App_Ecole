// Service worker : coquille de l'application en cache (PWA). Les appels /api ne sont jamais mis en cache.
const CACHE = 'ecole-v2';
const SHELL = ['/', '/index.html', '/style.css', '/theme.js', '/icons.js', '/app.js', '/pages.js', '/manifest.json', '/icon.svg', '/fonts/inter-latin-wght-normal.woff2', '/fonts/plus-jakarta-sans-latin-wght-normal.woff2'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
