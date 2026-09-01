/* TradePro Service Worker
 *
 * Strategie:
 *   - Navigationen (HTML): network-first, Fallback auf Offline-Seite.
 *     NIE aus dem Cache ausliefern, damit Login-Redirects (303 -> /login)
 *     immer korrekt greifen.
 *   - Statische Assets unter /static/: stale-while-revalidate.
 *   - /api/, /ws, /auth/, /login: grundsätzlich nie anfassen (immer Netzwerk).
 *
 * Wird von static/app.html registriert und über die Route /sw.js ausgeliefert,
 * damit der Scope das komplette Origin abdeckt.
 */

const VERSION = 'tradepro-v2';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const OFFLINE_URL = '/offline.html';

const SHELL_ASSETS = [
  OFFLINE_URL,
  '/static/manifest.webmanifest',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
    );
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (_) { /* optional */ }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/** Pfade, die der Service Worker niemals abfangen darf. */
function isBypassed(url) {
  return url.pathname.startsWith('/api/')
      || url.pathname.startsWith('/ws')
      || url.pathname.startsWith('/auth/')
      || url.pathname === '/login'
      || url.pathname === '/healthz';
}

async function handleNavigate(event) {
  try {
    const preload = await event.preloadResponse;
    if (preload) return preload;
    return await fetch(event.request);
  } catch (_) {
    const cache = await caches.open(SHELL_CACHE);
    const offline = await cache.match(OFFLINE_URL);
    return offline || new Response(
      '<h1>Offline</h1><p>TradePro ist nicht erreichbar.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function handleAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  }).catch(() => null);

  if (cached) {
    network.catch(() => {});          // Revalidierung im Hintergrund
    return cached;
  }
  const fresh = await network;
  if (fresh) return fresh;
  return new Response('', { status: 504, statusText: 'Offline' });
}

/** Code-Assets (JS/CSS) network-first: stale-while-revalidate lieferte hier
 *  nach einem Deploy noch eine ganze Sitzung lang die ALTE Datei aus. Wenn
 *  dann neues HTML auf altes JS trifft, fehlen Handler und die UI wirkt kaputt.
 *  Der Cache bleibt nur als Offline-Fallback. */
async function handleCodeAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (_) {
    const cached = await cache.match(request);
    return cached || new Response('', { status: 504, statusText: 'Offline' });
  }
}

function isCodeAsset(url) {
  return /\.(?:js|css|webmanifest)$/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (_) { return; }

  if (url.origin !== self.location.origin) return;   // CDNs etc. unangetastet
  if (isBypassed(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigate(event));
    return;
  }

  if (url.pathname.startsWith('/static/')) {
    event.respondWith(isCodeAsset(url) ? handleCodeAsset(request) : handleAsset(request));
  }
});
