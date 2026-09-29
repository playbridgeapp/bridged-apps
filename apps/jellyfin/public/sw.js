const CACHE_NAME = 'playbridge-static-assets-v1';
const MAX_ENTRIES = 30;
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const VERSIONED_ASSET = /^\/assets\/[^/?]+-[A-Za-z0-9_-]{8,}\.(?:js|css|wasm|woff2?|png|jpe?g|webp|avif|svg)$/;

function cacheable(response, path) {
  if (!response.ok || response.redirected || response.type !== 'basic') return false;
  if (response.headers.get('cache-control')?.includes('no-store')) return false;
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_ASSET_BYTES) return false;
  const type = response.headers.get('content-type') || '';
  return /^(text\/css|text\/javascript|application\/javascript|application\/wasm|image\/|font\/)/i.test(type)
    || (path.endsWith('.wasm') && type.startsWith('application/octet-stream'));
}

async function trimCache(cache) {
  const entries = await cache.keys();
  await Promise.all(entries.slice(0, Math.max(0, entries.length - MAX_ENTRIES)).map((entry) => cache.delete(entry)));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      // Preload only the current HTML's hashed entry assets for the next launch.
      const page = await fetch('/', { cache: 'no-store' });
      if (page.ok && !page.redirected && page.headers.get('content-type')?.includes('text/html')) {
        const html = await page.text();
        const paths = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)]
          .map((match) => match[1]).filter((path) => VERSIONED_ASSET.test(path)))];
        const cache = await caches.open(CACHE_NAME);
        await Promise.all(paths.map(async (path) => {
          try {
            const response = await fetch(path);
            if (cacheable(response, path)) await cache.put(path, response);
          } catch { /* Loading the site must not depend on preloading. */ }
        }));
        await trimCache(cache);
      }
    } catch { /* Network or storage may be unavailable. */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('playbridge-static-assets-') && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode === 'navigate' || request.headers.has('authorization')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.search || !VERSIONED_ASSET.test(url.pathname)) return;

  event.respondWith((async () => {
    let cache;
    try {
      cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(request);
      if (hit) return hit;
    } catch { /* Use the network when cache storage is unavailable. */ }

    const response = await fetch(request);
    if (cache && cacheable(response, url.pathname)) {
      event.waitUntil(cache.put(request, response.clone()).then(() => trimCache(cache)).catch(() => {}));
    }
    return response;
  })());
});
