const CACHE='fedex-ocr-r9';
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
    // 選配資產：語言包（若站點有提供則快取，否則忽略）
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
    try {
      const urlgz = new URL('./assets/tessdata/eng.traineddata.gz', self.registration.scope);
      const respgz = await fetch(urlgz.toString(), { method: 'HEAD', cache: 'no-store' });
      if (respgz.ok) {
        const fullgz = new URL('./assets/tessdata/eng.traineddata.gz', self.registration.scope).toString();
        const blobRespgz = await fetch(fullgz, { cache: 'no-store' });
        if (blobRespgz.ok) await c.put(fullgz, blobRespgz.clone());
      }
    } catch(_){}
    // 可選：繁中語言包（若存在則快取）
    try {
      const urlChi = new URL('./assets/tessdata/chi_tra.traineddata', self.registration.scope);
      const respChi = await fetch(urlChi.toString(), { method: 'HEAD', cache: 'no-store' });
      if (respChi.ok) {
        const fullChi = new URL('./assets/tessdata/chi_tra.traineddata', self.registration.scope).toString();
        const blobRespChi = await fetch(fullChi, { cache: 'no-store' });
        if (blobRespChi.ok) await c.put(fullChi, blobRespChi.clone());
      }
    } catch(_){ }
    try {
      const urlChiGz = new URL('./assets/tessdata/chi_tra.traineddata.gz', self.registration.scope);
      const respChiGz = await fetch(urlChiGz.toString(), { method: 'HEAD', cache: 'no-store' });
      if (respChiGz.ok) {
        const fullChiGz = new URL('./assets/tessdata/chi_tra.traineddata.gz', self.registration.scope).toString();
        const blobRespChiGz = await fetch(fullChiGz, { cache: 'no-store' });
        if (blobRespChiGz.ok) await c.put(fullChiGz, blobRespChiGz.clone());
      }
    } catch(_){ }
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
