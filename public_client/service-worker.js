// Service Worker for Optometry PWA
const CACHE_NAME = "optometry-pwa-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Let network handle all API requests directly without caching
  if (event.request.url.includes("/api/") || event.request.method !== "GET") {
    return;
  }
  // Network first with cache fallback for PWA installability & offline reliability
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
