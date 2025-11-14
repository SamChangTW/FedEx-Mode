const CACHE='fedex-ocr-r7';
const ASSETS=[
  './','./index.html','./style.css','./main.js','./manifest.json',
  './assets/fedex-commercial-invoice-form-tw.pdf'
];

// 立即接管新 SW，避免舊版快取殘留
self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil((async()=>{
    const c = await caches.open(CACHE);
    // 核心資產（必備）
    await c.addAll(ASSETS);
    // 選配資產：語言包（若站點有提供 /assets/tessdata/eng.traineddata 則快取，否則忽略）
    try {
      const url = new URL('./assets/tessdata/eng.traineddata', self.registration.scope);
      const resp = await fetch(url.toString(), { method: 'HEAD', cache: 'no-store' });
      if (resp.ok) {
        // 真正存檔用 GET
        const full = new URL('./assets/tessdata/eng.traineddata', self.registration.scope).toString();
        const blobResp = await fetch(full, { cache: 'no-store' });
        if (blobResp.ok) await c.put(full, blobResp.clone());
      }
    } catch(_){}
  })());
});

// 清除舊快取並接管客戶端
self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
  );
});

// 同源資源：快取優先；跨源（CDN）資源：不快取，避免 API 不匹配
self.addEventListener('fetch',e=>{
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === location.origin;
  if (sameOrigin){
    e.respondWith(
      caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{
        const clone=resp.clone(); caches.open(CACHE).then(c=>c.put(e.request,clone)); return resp;
      }).catch(()=> e.request.mode==='navigate' ? caches.match('./index.html') : Promise.reject()))
    );
  } else {
    e.respondWith(fetch(e.request));
  }
});
