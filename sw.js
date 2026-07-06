/* Service Worker — 讓 App 離線可開 */
const CACHE = 'read-article-v13';
const AUDIO_CACHE = 'tts-audio';   // 雲端語音音檔快取，勿刪
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE && k !== AUDIO_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

/* App 檔案改用「網路優先」：有網路一定拿到最新版，離線才退回快取 */
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          return r;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then((r) => r || fetch(e.request))
    );
  }
});
