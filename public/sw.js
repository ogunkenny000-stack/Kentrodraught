// Kentro Draught service worker.
//
// This app is a real-time multiplayer game with a WebSocket connection and
// a coin economy backed by real money -- getting caching wrong here isn't
// just "shows a stale blog post", it could mean a stale coin balance, a
// stale tournament roster, or a player stuck on an old build unable to
// reach a newer opponent. So this is deliberately conservative:
//
//   - /api/* and the WebSocket connection: NEVER cached, always network.
//   - Hashed build assets (Vite's /assets/*.js, *.css with content-hashed
//     filenames): cache-first. Safe, because a new deploy produces NEW
//     filenames -- there's no risk of serving a stale bundle under an old
//     URL, since the URL itself changes when the content does.
//   - The HTML shell / navigation requests: network-first, falling back to
//     a cached copy ONLY if the network request fails (offline), so
//     visiting while online always gets the latest app version.
//   - Everything else not explicitly matched above: pass straight through
//     to the network, uncached. When in doubt, don't cache.

const CACHE_VERSION = "kentro-draught-v2";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;

const SHELL_URLS = [
  "/",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/board/royal-wood/dark.webp",
  "/board/royal-wood/light.webp",
  "/board/royal-wood/black.webp",
  "/board/royal-wood/gold.webp",
];

// Replaced by scripts/inject-sw-assets.cjs after Vite has emitted its chunks.
const PRECACHE_ASSETS = [];

// Storage may be unavailable or full. A failed cache write must never reject
// an otherwise successful network response or leave an unhandled promise.
function keepAlive(event, promise) {
  event.waitUntil(Promise.resolve(promise).catch(() => {}));
}

async function readCached(cacheName, request) {
  try {
    return await (await caches.open(cacheName)).match(request);
  } catch {
    return undefined;
  }
}

function cacheResponse(event, cacheName, request, response) {
  if (!response.ok) return;
  // Clone while the response body is still unused, before returning it.
  const copy = response.clone();
  keepAlive(event, caches.open(cacheName).then((cache) => cache.put(request, copy)));
}

async function navigationFallback(request) {
  return (await readCached(SHELL_CACHE, request)) ||
    (await readCached(SHELL_CACHE, "/")) || Response.error();
}

const isDevEnv =
  self.location.hostname === "localhost" ||
  self.location.hostname === "127.0.0.1" ||
  self.location.hostname.includes("-dev-");

async function offlineStatus() {
  const [shell, assets] = await Promise.all([caches.open(SHELL_CACHE), caches.open(ASSET_CACHE)]);
  const checks = await Promise.all([
    ...SHELL_URLS.map(async url => !!(await shell.match(url))),
    ...PRECACHE_ASSETS.map(async url => !!(await assets.match(url))),
  ]);
  const missing = checks.filter(found => !found).length;
  return { ready: PRECACHE_ASSETS.length > 0 && missing === 0, missing };
}
let preparation;
function prepareOffline() {
  if (preparation) return preparation;
  preparation = (async () => {
    const [shell, assets] = await Promise.all([caches.open(SHELL_CACHE), caches.open(ASSET_CACHE)]);
    const tasks = [...SHELL_URLS.map(url => ({ url, cache: shell })), ...PRECACHE_ASSETS.map(url => ({ url, cache: assets }))];
    let next = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < tasks.length) {
        const { url, cache } = tasks[next++];
        if (await cache.match(url)) continue;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60_000);
        try {
          const response = await fetch(url, { signal: controller.signal, cache: 'reload' });
          if (response.ok && !(/\.(js|css|wasm|webp)$/.test(url) && /text\/html/i.test(response.headers.get('content-type') || ''))) await cache.put(url, response);
        } catch { /* Preserve successful files; the missing ones can be retried. */ }
        finally { clearTimeout(timer); }
      }
    }));
    return offlineStatus();
  })().finally(() => { preparation = undefined; });
  return preparation;
}
self.addEventListener("install", event => {
  if (isDevEnv) { self.skipWaiting(); return; }
  event.waitUntil(prepareOffline().then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});
self.addEventListener("message", event => {
  if (!['KENTRO_OFFLINE_STATUS', 'KENTRO_PREPARE_OFFLINE'].includes(event.data?.type)) return;
  const port = event.ports[0];
  if (!port) return;
  event.waitUntil((event.data.type === 'KENTRO_PREPARE_OFFLINE' ? prepareOffline() : offlineStatus())
    .then(status => port.postMessage(status)).catch(() => port.postMessage({ error: true })));
});

self.addEventListener("activate", (event) => {
  if (isDevEnv) {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(
        keys.filter((k) => k.startsWith("kentro-draught-")).map((k) => caches.delete(k))
      ))
        .then(() => self.registration.unregister())
    );
    return;
  }
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("kentro-draught-") && key !== SHELL_CACHE && key !== ASSET_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // In development environments, do not intercept or cache any requests
  if (isDevEnv) {
    return;
  }

  // Only ever handle same-origin GET requests -- never intercept the
  // WebSocket upgrade, POST/PUT/DELETE API calls, or cross-origin requests
  // (Supabase, fonts CDN, etc.) at all.
  if (req.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  // Never intercept dev requests, Vite internal modules, source files, or hot reload queries
  if (
    url.pathname.startsWith("/@") ||
    url.pathname.startsWith("/node_modules/") ||
    url.pathname.startsWith("/src/") ||
    url.searchParams.has("v") ||
    url.searchParams.has("t")
  ) {
    return;
  }

  // Never cache API routes -- coin balances, tournament rosters, engine
  // moves, and admin data must always be fresh.
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Hashed static build assets: cache-first (safe -- see comment above).
  if ((url.pathname.startsWith("/assets/") || url.pathname.startsWith("/engine/"))) {
    event.respondWith(
      (async () => {
        const cached = await readCached(ASSET_CACHE, req);
        if (cached) return cached;
        const res = await fetch(req);
        cacheResponse(event, ASSET_CACHE, req, res);
        return res;
      })()
    );
    return;
  }

  // Navigation (HTML) requests: network-first, cached-shell fallback so a
  // dropped connection shows SOMETHING instead of a blank white screen.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(async (res) => {
          // A temporary server error must not overwrite the last working shell.
          if (res.status >= 500) {
            const cached = await readCached(SHELL_CACHE, req) || await readCached(SHELL_CACHE, "/");
            if (cached) return cached;
          }
          cacheResponse(event, SHELL_CACHE, req, res);
          return res;
        })
        .catch(() => navigationFallback(req))
    );
    return;
  }

  // Safe static asset types only (manifest, icons, audio, fonts)
  const isStaticFile =
    url.pathname.endsWith(".webp") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".jpeg") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".ico") ||
    url.pathname.endsWith(".json") ||
    url.pathname.endsWith(".woff2") ||
    url.pathname.endsWith(".mp3") ||
    url.pathname.endsWith(".wav");

  if (isStaticFile) {
    event.respondWith(
      (async () => {
        const cached = await readCached(SHELL_CACHE, req);
        const networkFetch = fetch(req)
          .then((res) => {
            cacheResponse(event, SHELL_CACHE, req, res);
            return res;
          })
          .catch(() => cached || Response.error());
        // Returning the cached response must not terminate revalidation.
        keepAlive(event, networkFetch);
        return cached || networkFetch;
      })()
    );
  }
});

// Web Push: display only a same-origin route. Clicking takes the player to
// the correct game invite / replay / tournament; no game state is cached.
function notificationPath(raw) {
  // Browsers strip control characters when parsing URLs; reject those before
  // checking // so a disguised protocol-relative link cannot leave this app.
  return typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") &&
    !/[\\\u0000-\u0020\u007f]/.test(raw) ? raw : "/";
}
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let payload;
    try { payload = event.data ? event.data.json() : null; } catch { return; }
    if (!payload || typeof payload.title !== "string") return;
    const url = notificationPath(payload.url);
    await self.registration.showNotification(payload.title.slice(0,150), {
      body: String(payload.body || "").slice(0,500),
      icon: "/icon-192.png", badge: "/icon-192.png",
      tag: String(payload.tag || "kentro-alert").slice(0,100),
      data: {url},
    });
  })());
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = notificationPath(event.notification?.data?.url);
  const url = new URL(path, self.location.origin).href;
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({type:"window",includeUncontrolled:true});
    for (const client of clientsList) {
      // The app may have an unfinished match in memory. Reuse only a tab
      // already at this destination; never reload or redirect another tab.
      if (new URL(client.url).href === url) {
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
