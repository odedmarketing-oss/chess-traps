// Trap Book service worker: lets the home-screen app open offline.
// Page: network-first (a new upload shows on the next online launch), cache as fallback.
// Manifest + icons: served from cache, refreshed in the background.
// All paths are relative to this file, so it works at /chess-traps/ or anywhere else.

const CACHE = 'trapbook-v1';
const PAGE = new URL('index.html', self.location).href;
const ASSETS = ['index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png']
  .map(p => new URL(p, self.location).href);
const SLOW_NETWORK_MS = 5000;   // on a crawling connection, show the saved copy instead of a blank screen

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('trapbook-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const url = new URL(req.url); url.search = ''; url.hash = '';
  const isPage = req.mode === 'navigate' || url.href === PAGE;
  if (isPage) event.respondWith(pageNetworkFirst(event));
  else if (ASSETS.includes(url.href)) event.respondWith(assetFromCache(event, url.href));
});

// Always ask the server first; 'no-cache' makes the browser revalidate instead of
// reusing its own HTTP cache, so an upload is never hidden behind a stale copy.
async function pageNetworkFirst(event) {
  const cache = await caches.open(CACHE);
  let saved = null;
  const network = fetch(PAGE, { cache: 'no-cache', credentials: 'same-origin' }).then(async res => {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const clean = res.redirected ? new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers }) : res;
    saved = cache.put(PAGE, clean.clone());   // save while the page streams in
    return clean;
  });
  // keep the worker alive until the download is saved, even if the cached copy was shown
  event.waitUntil(network.then(() => saved, () => {}).catch(() => {}));

  const cached = await cache.match(PAGE);
  if (!cached) return network;                // first launch: nothing saved yet
  const slow = new Promise(resolve => setTimeout(() => resolve(cached), SLOW_NETWORK_MS));
  return Promise.race([network.catch(() => cached), slow]);
}

async function assetFromCache(event, href) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(href);
  const network = fetch(href, { cache: 'no-cache' }).then(res => {
    if (res.ok) return cache.put(href, res.clone()).then(() => res);
    throw new Error('HTTP ' + res.status);
  });
  event.waitUntil(network.catch(() => {}));
  return cached || network;
}
