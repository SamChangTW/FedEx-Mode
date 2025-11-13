const CACHE='fedex-ocr-r2';
const ASSETS=[
  './','./index.html','./style.css','./main.js','./manifest.json',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js'
];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>{e.waitUntil(self.clients.claim())});
self.addEventListener('fetch',e=>{
  e.respondWith(
    caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{
      const clone=resp.clone(); caches.open(CACHE).then(c=>c.put(e.request,clone)); return resp;
    }).catch(()=>caches.match('./index.html')))
  )
});
