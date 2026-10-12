// Rejista service worker. It makes the app installable and quick to open, and shows a friendly page when the
// phone is offline. It never stores school data: nothing under /api/ is cached, and pages always come from the
// network first, so a new version of the app is picked up the next time it is opened.
const CACHE = "rejista-shell-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([OFFLINE, "/favicon.svg", "/icon-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  // Opening a page: always the network; offline, the "You're offline" page.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE)));
    return;
  }
  // Build files carry a fingerprint in their name and never change, so a saved copy is always right.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((response) => {
      if (response.ok) { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(request, copy)); }
      return response;
    })));
  }
});
