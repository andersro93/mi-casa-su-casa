/* Mi Casa Su Casa service worker.
 *
 * Purpose: make the app installable and keep the shell reachable offline.
 * It deliberately never caches anything under /api/ — sessions, inbox data and
 * one-time codes must always come from the network.
 *
 * Bump CACHE_NAME whenever the caching strategy changes so old caches are
 * dropped on activate.
 */
const CACHE_NAME = "mcsc-shell-v1";
const SHELL_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.add(SHELL_URL))
      .catch(() => undefined)
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
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    // Network only: never intercept API/auth traffic or third-party requests.
    return;
  }

  if (request.mode === "navigate") {
    // Network first so a new deploy is picked up immediately; fall back to the
    // cached shell when offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(SHELL_URL, copy))
              .catch(() => undefined);
          }
          return response;
        })
        .catch(() =>
          caches.match(SHELL_URL).then((hit) => hit ?? Response.error()),
        ),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    // Vite emits content-hashed filenames, so these are immutable: cache first.
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(request, copy))
                .catch(() => undefined);
            }
            return response;
          }),
      ),
    );
  }
  // Everything else (manifest, icons, …) goes straight to the network.
});

// Web Push handlers ("push", "notificationclick") are added in the
// notifications feature — see the "instant codes" track.
