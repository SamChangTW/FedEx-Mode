// 1. 修改版本號 (這是讓手機知道要更新的關鍵)
const CACHE_NAME = 'fedex-ocr-v1.8-final-fix';

// 2. 更新快取清單 (加入新版 main.js 和 PDF)
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './main.js?v=ner-final-fix', // 重要：這裡要跟 index.html 的引用一致
  './manifest.json',
  './assets/fedex-commercial-invoice-form-tw.pdf', // 模板檔案
  './assets/FedEx icon.png',                        // PWA 圖示
  './ui/tsaa_tokens.css',
  './ui/theme-loader.js',
  'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js', // 外部套件也快取
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
];

// 安裝事件：下載核心檔案
self.addEventListener('install', event => {
  // 強制跳過等待，立即啟用新版 SW
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] 安裝中，正在快取檔案...');
        return cache.addAll(ASSETS);
      })
  );
});

// 啟動事件：刪除舊版快取
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // 如果快取名稱跟現在的不一樣，就刪掉 (例如刪除 fedex-ocr-r11)
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] 刪除舊快取:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[SW] 新版已啟用，接管頁面');
      return self.clients.claim();
    })
  );
});

// 請求攔截：網路優先 (Network First)
// 邏輯：先嘗試去網路上抓最新的 -> 抓不到(離線)才去讀快取 -> 再沒有就回傳 index.html
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .catch(() => {
        console.log('[SW] 網路失敗，切換至快取模式:', event.request.url);
        return caches.match(event.request)
          .then(response => {
            if (response) return response;
            // 如果是導覽請求(HTML)且找不到，回傳首頁
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html');
            }
          });
      })
  );
});