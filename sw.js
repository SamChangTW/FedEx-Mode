// sw.js v2.0-clean
const CACHE_NAME = 'fedex-ocr-v2.0-clean';

// 更新快取清單 (移除了 ocrad.min.js)
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './main.js?v=2.0-clean', // 確保這裡對應 index.html 的版本參數
  './manifest.json',
  './assets/fedex-commercial-invoice-form-tw.pdf',
  'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  './ui/tsaa_tokens.css',
  './ui/scheduler.css',
  './ui/theme-loader.js',
  './ui/tsaa_theme.json' // 加入 theme json 以免離線時遺失主題
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] 刪除舊快取:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});