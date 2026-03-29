// Service Worker — FedEx OCR PWA
// 版本號與 index.html 的 APP_VERSION 保持一致
const CACHE_VERSION = 'v1.9-gemini';
const CACHE_NAME = `fedex-ocr-${CACHE_VERSION}`;

// 核心資源：必須全數快取成功，PWA 才能離線運作
const CRITICAL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './main.js?v=gemini',
  './manifest.json',
  './ui/tsaa_tokens.css',
  './ui/theme-loader.js',
  './assets/fedex-commercial-invoice-form-tw.pdf',
  './assets/FedEx icon.png',
];

// 選用資源：CDN 套件，快取失敗不影響 SW 安裝
const OPTIONAL_CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
];

// 安裝事件：核心資源整批快取，CDN 資源逐一嘗試（失敗不阻斷）
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      console.log('[SW] 安裝中，快取核心資源...');
      await cache.addAll(CRITICAL_ASSETS);
      console.log('[SW] 核心資源快取完成');

      await Promise.allSettled(
        OPTIONAL_CDN_ASSETS.map(url =>
          cache.add(url).catch(err =>
            console.warn(`[SW] CDN 資源快取失敗（非致命）: ${url}`, err)
          )
        )
      );
      console.log('[SW] CDN 資源快取嘗試完成');
    })
  );
});

// 啟動事件：清除所有舊版快取，接管頁面
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames =>
        Promise.all(
          cacheNames
            .filter(cacheName => cacheName !== CACHE_NAME)
            .map(cacheName => {
              console.log('[SW] 刪除舊快取:', cacheName);
              return caches.delete(cacheName);
            })
        )
      )
      .then(() => {
        console.log('[SW] 新版已啟用，接管頁面');
        return self.clients.claim();
      })
  );
});

// 請求攔截：Network First — 先嘗試網路，失敗才讀快取，導覽請求降級至首頁
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).catch(() => {
      console.log('[SW] 網路失敗，切換至快取模式:', event.request.url);
      return caches.match(event.request).then(response => {
        if (response) return response;
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});