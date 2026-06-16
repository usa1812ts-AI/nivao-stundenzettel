const CACHE_NAME = "nivaox-stundenzettel-v6";
const BASE_URL = new URL(self.registration.scope);
const appUrl = (path = "") => new URL(path, BASE_URL).href;
const APP_SHELL = [
  appUrl(),
  appUrl("manifest.webmanifest"),
  appUrl("assets/nivaox-lockup.png"),
  appUrl("assets/nivaox-icon-192.png"),
  appUrl("assets/nivaox-icon-512.png"),
  appUrl("assets/nivaox-apple-touch-icon.png"),
  appUrl("assets/nivaox-favicon-32.png"),
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached ?? caches.match(appUrl()))),
  );
});
