// crm-map service worker: keeps the app usable on weak or no signal.
// - App code (/_next/static, icons): cache-first. File names change every build, so entries never go stale.
// - Pages: network first. If the network takes longer than NETWORK_TIMEOUT_MS, show the last saved copy
//   while the fresh page keeps loading in the background for next time. Offline with no copy: offline.html.
// - Everything else (server actions, RSC requests, Supabase, Mapbox) goes straight to the network.
//   Mapbox caches map tiles it has already shown on its own.

const VERSION = "v1";
const PAGES = `pages-${VERSION}`;
const STATIC = `static-${VERSION}`;
const NETWORK_TIMEOUT_MS = 4000;
const NO_SAVE = ["/login", "/auth", "/api"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PAGES).then((c) => c.add("/offline.html")).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== PAGES && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Signing out removes saved pages, which contain contact data.
self.addEventListener("message", (event) => {
  if (event.data === "clear-pages") event.waitUntil(caches.delete(PAGES));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
  } else if (request.mode === "navigate" && !NO_SAVE.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(networkFirst(request, url));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request, url) {
  const cache = await caches.open(PAGES);
  // One saved copy per page, whatever the query string (?c=… just selects a contact).
  const key = url.origin + url.pathname;

  const network = fetch(request).then((res) => {
    // A redirect means signed out: don't keep it.
    if (res.ok && !res.redirected && res.type === "basic") cache.put(key, res.clone());
    return res;
  });

  const saved = await cache.match(key);
  if (!saved) {
    return network.catch(async () => (await cache.match("/offline.html")) ?? Response.error());
  }

  const timeout = new Promise((resolve) => setTimeout(() => resolve(saved), NETWORK_TIMEOUT_MS));
  return Promise.race([network.catch(() => saved), timeout]);
}
