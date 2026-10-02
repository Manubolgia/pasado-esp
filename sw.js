const CACHE = "pasado-v12";
// the vendored library is pinned by version, so it keeps its own cache across app updates
const VENDOR = "pasado-vendor-0.2.85";
const ASSETS = [
  "./",
  "index.html",
  "style.css",
  "data.js",
  "app.js",
  "analyzer.js",
  "chat-data.js",
  "chat.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      // only our own old caches: WebLLM keeps the downloaded model in caches of
      // its own («webllm/…»), and wiping those would mean downloading it again
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("pasado-") && k !== CACHE && k !== VENDOR).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first would pin the app to whatever version installed first: the running
// worker answers from cache, never refetches, and so never learns a new CACHE exists.
// The markup and code go network-first so a new deploy is picked up while online,
// falling back to cache offline. Icons don't change, so they stay cache-first.
const CODE = /\.(?:html|js|css|webmanifest)$/;
const isCode = (url) => url.pathname.endsWith("/") || CODE.test(url.pathname);

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // vendor/ holds a pinned library (6 MB): cache-first, fetched once on first use
  if (url.pathname.includes("/vendor/")) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VENDOR).then((c) => c.put(e.request, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  if (e.request.mode === "navigate" || isCode(url)) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
    )
  );
});
