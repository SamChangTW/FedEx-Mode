const CACHE='fedex-ocr-r11';
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
  const req = e.request;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;

  // 規則 1：同源的語言檔（.traineddata / .traineddata.gz）一律走網路優先且不使用快取
  const isTessdata = sameOrigin && /\/assets\/tessdata\/(.*\.(traineddata|traineddata\.gz))$/i.test(url.pathname);
  if (isTessdata){
    e.respondWith(
      fetch(new Request(req, { cache: 'no-store' })).catch(()=>caches.match(req))
    );
    return;
  }

  // 規則 2：index.html 與 main.js 採「網路優先」，避免舊版快取造成卡住
  const isIndexHtml = sameOrigin && /\/index\.html?$/.test(url.pathname);
  const isMainJs = sameOrigin && /\/main\.js(\?.*)?$/.test(url.pathname);
  if (isIndexHtml || isMainJs){
    e.respondWith(
      fetch(new Request(req, { cache: 'no-store' }))
        .then(resp=>{
          const clone = resp.clone(); caches.open(CACHE).then(c=>c.put(req, clone)); return resp;
        })
        .catch(()=> caches.match(req).then(r=> r || caches.match('./index.html')))
    );
    return;
  }

  // 規則 3：其他同源資源仍採「快取優先」
  if (sameOrigin){
    e.respondWith(
      caches.match(req).then(r=> r || fetch(req).then(resp=>{
        const clone = resp.clone(); caches.open(CACHE).then(c=>c.put(req, clone)); return resp;
      }).catch(()=> req.mode==='navigate' ? caches.match('./index.html') : Promise.reject()))
    );
    return;
  }

  // 規則 4：跨源資源直接走網路
  e.respondWith(fetch(req));
});
