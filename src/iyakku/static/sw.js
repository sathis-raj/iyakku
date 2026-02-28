const CACHE_NAME = "iyakku-v6";
const OFFLINE_PAGE = "/static/offline.html";
const ASSETS_TO_CACHE = [
  "/controller",
  "/static/style.css",
  "/static/controller.js",
  "/static/socket.io.min.js",
  "/static/icon-192.png",
  "/static/icon-512.png",
  OFFLINE_PAGE
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Always go to network for API calls and socket.io
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/")) {
    return;
  }

  // For page navigations: cache-first, then network, then offline page
  if (event.request.mode === "navigate" ||
      (event.request.method === "GET" && event.request.headers.get("accept") && event.request.headers.get("accept").includes("text/html"))) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        // Serve from cache immediately, update cache in background
        const fetchPromise = fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        });
        return cached || fetchPromise.catch(() => caches.match(OFFLINE_PAGE));
      })
    );
    return;
  }

  // For other assets: network-first, fallback to cache
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
