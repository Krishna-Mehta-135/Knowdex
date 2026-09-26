/* Knowdex service worker: offline shell + last-known data.
 *
 * - Static build assets: cache-first (they are content-hashed).
 * - Page navigations: network-first (4s), falling back to the last visited copy,
 *   then /offline.html.
 * - A small allow-list of read-only API GETs: network-first with cache fallback,
 *   so the app can list notes/workspaces while offline. Note *content* comes from
 *   IndexedDB (Yjs), not from here.
 * - Never caches writes, streams (Ask/assist), or the WebSocket.
 * The API/page caches are cleared on sign-out (see 'clear-user-data').
 */
const VERSION = "v1";
const STATIC = `kx-static-${VERSION}`;
const PAGES = `kx-pages-${VERSION}`;
const API = `kx-api-${VERSION}`;
const KEEP = new Set([STATIC, PAGES, API]);

const API_ALLOW = [
  /^\/api\/auth\/me$/,
  /^\/api\/workspaces(\/|$)/,
  /^\/api\/documents(\/[^/]+\/(backlinks|metadata))?$/,
  /^\/api\/kx\/attachments\/[0-9a-f-]{36}$/i,
  /^\/api\/kx\/workspaces\/[^/]+\/graph$/,
  /^\/api\/kx\/databases(\/|$)/,
  /^\/api\/kx\/workspaces\/[^/]+\/databases$/,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((c) => c.add("/offline.html"))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("kx-") && !KEEP.has(k))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "clear-user-data") {
    event.waitUntil(
      Promise.all([
        caches.delete(API),
        caches
          .delete(PAGES)
          .then(() => caches.open(PAGES).then((c) => c.add("/offline.html"))),
      ]),
    );
  }
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

async function networkFirst(request, cacheName, ms, fallback) {
  const cache = await caches.open(cacheName);
  try {
    const res = await withTimeout(fetch(request), ms);
    // Only remember good, non-redirected, non-streamed responses.
    if (res.ok && !res.redirected && res.type === "basic")
      cache.put(request, res.clone());
    return res;
  } catch {
    const hit = await cache.match(request);
    if (hit) return hit;
    if (fallback) return fallback();
    return new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/offline.html"
  ) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      networkFirst(
        req,
        PAGES,
        4000,
        async () => (await caches.match("/offline.html")) || Response.error(),
      ),
    );
    return;
  }

  if (API_ALLOW.some((re) => re.test(url.pathname))) {
    event.respondWith(networkFirst(req, API, 3000));
  }
});
