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

self.addEventListener("install", (event) => {
  if (isDevEnv) {
    self.skipWaiting();
    return;
  }
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)).catch(() => {}),
      // Only the entry script and startup styles are pre-downloaded.
      // Optional routes (TV, academy, tournaments, etc.) load on demand.
      caches.open(ASSET_CACHE).then((cache) => cache.addAll(PRECACHE_ASSETS)).catch(() => {}),
    ])
  );
  self.skipWaiting();
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
  if (url.pathname.startsWith("/assets/")) {
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
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let payload;
    try { payload = event.data ? event.data.json() : null; } catch { return; }
    if (!payload || typeof payload.title !== "string") return;
    const raw = typeof payload.url === "string" ? payload.url : "/";
    const url = raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\") ? raw : "/";
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
  const raw = event.notification?.data?.url;
  const path = typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\") ? raw : "/";
  const url = new URL(path, self.location.origin).href;
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({type:"window",includeUncontrolled:true});
    for (const client of clientsList) {
      if (client.url.startsWith(self.location.origin)) {
        await client.navigate(url);
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
