const CACHE_NAME = 'playbridge-static-assets-v1';
// The public app shell: index HTML plus the hashed entry assets it references, kept as one unit.
const SHELL_CACHE = 'playbridge-shell-v1';
const SHELL_KEY = '/';
const MAX_ENTRIES = 30;
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const VERSIONED_ASSET = /^\/assets\/[^/?]+-[A-Za-z0-9_-]{8,}\.(?:js|css|wasm|woff2?|png|jpe?g|webp|avif|svg)$/;
const SHELL_PATHS = new Set(['/', '/index.html']);

function cacheable(response, path) {
  if (!response.ok || response.redirected || response.type !== 'basic') return false;
  if (response.headers.get('cache-control')?.includes('no-store')) return false;
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_ASSET_BYTES) return false;
  const type = response.headers.get('content-type') || '';
  return /^(text\/css|text\/javascript|application\/javascript|application\/wasm|image\/|font\/)/i.test(type)
    || (path.endsWith('.wasm') && type.startsWith('application/octet-stream'));
}

function shellResponse(response) {
  return response.ok && !response.redirected && response.type === 'basic'
    && (response.headers.get('content-type') || '').includes('text/html')
    && !response.headers.get('cache-control')?.includes('no-store');
}

function entryAssets(html) {
  return [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)]
    .map((match) => match[1]).filter((path) => VERSIONED_ASSET.test(path)))];
}

async function trimCache(cache) {
  const entries = await cache.keys();
  await Promise.all(entries.slice(0, Math.max(0, entries.length - MAX_ENTRIES)).map((entry) => cache.delete(entry)));
}

/**
 * Store a fetched HTML shell only after every entry asset it needs is cached beside it, then
 * replace the previous shell in one step. A cached shell can therefore always boot: it never
 * references an asset that was evicted or removed by a later deploy.
 */
async function storeShell(html, headers) {
  const paths = entryAssets(html);
  if (!paths.length) return false;
  const cache = await caches.open(SHELL_CACHE);
  const assets = await Promise.all(paths.map(async (path) => {
    const existing = await caches.match(path);
    if (existing) return [path, existing];
    const response = await fetch(path);
    return cacheable(response, path) ? [path, response] : null;
  }));
  if (assets.some((asset) => !asset)) return false;
  const stale = (await cache.keys()).filter((request) => !paths.includes(new URL(request.url).pathname)
    && new URL(request.url).pathname !== SHELL_KEY);
  await Promise.all(assets.map(([path, response]) => cache.put(path, response.clone())));
  // Keep the server's headers (security headers included) on the cached page.
  await cache.put(SHELL_KEY, new Response(html, { headers }));
  await Promise.all(stale.map((request) => cache.delete(request)));
  return true;
}

/** The cached shell, only if all of its entry assets are still present. */
async function cachedShell() {
  const cache = await caches.open(SHELL_CACHE);
  const shell = await cache.match(SHELL_KEY);
  if (!shell) return null;
  const html = await shell.clone().text();
  const complete = await Promise.all(entryAssets(html).map((path) => cache.match(path)));
  return complete.every(Boolean) ? shell : null;
}

async function refreshShell() {
  const page = await fetch(SHELL_KEY, { cache: 'no-cache' });
  if (!shellResponse(page)) return null;
  const html = await page.clone().text();
  await storeShell(html, page.headers).catch(() => false);
  return page;
}

function offlinePage() {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>You're offline</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090b0f;color:#f5f5f5;
font:16px system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box}p{color:#95a7b2}
button{margin-top:12px;padding:10px 18px;border:0;border-radius:10px;background:#f5f5f5;color:#090b0f;font:inherit}</style>
</head><body><main><h1>You're offline</h1><p>Streams will open when you're back online.</p>
<button onclick="location.reload()">Try again</button></main></body></html>`, {
    status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // Prepare the shell (and so its entry assets) for the next launch.
    try { await refreshShell(); } catch { /* Network or storage may be unavailable. */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => (name.startsWith('playbridge-static-assets-') && name !== CACHE_NAME)
      || (name.startsWith('playbridge-shell-') && name !== SHELL_CACHE))
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function navigate(event) {
  let shell = null;
  try { shell = await cachedShell(); } catch { /* Use the network when cache storage is unavailable. */ }
  if (shell) {
    // Open instantly from the cached shell; a new deploy is prepared now and used next launch.
    event.waitUntil(refreshShell().catch(() => {}));
    return shell;
  }
  try {
    const page = await fetch(event.request);
    if (shellResponse(page)) event.waitUntil(page.clone().text().then((html) => storeShell(html, page.headers)).catch(() => {}));
    return page;
  } catch {
    return offlinePage();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('authorization')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.search) return;
  if (request.mode === 'navigate') {
    // Only the public app shell; hash routes all load '/'.
    if (SHELL_PATHS.has(url.pathname)) event.respondWith(navigate(event));
    return;
  }
  if (!VERSIONED_ASSET.test(url.pathname)) return;

  event.respondWith((async () => {
    let cache;
    try {
      // Hashed assets never change, so header-based variants (Vary: Origin) don't matter.
      const hit = await caches.match(request, { ignoreVary: true });
      if (hit) return hit;
      cache = await caches.open(CACHE_NAME);
    } catch { /* Use the network when cache storage is unavailable. */ }

    const response = await fetch(request);
    if (cache && cacheable(response, url.pathname)) {
      event.waitUntil(cache.put(request, response.clone()).then(() => trimCache(cache)).catch(() => {}));
    }
    return response;
  })());
});
