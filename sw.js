// Service worker mínimo: só o necessário para o navegador oferecer a instalação.
const CACHE = 'timesheet-v1';
const CASCA = ['./', './index.html', './manifest.json', './icone-192.png', './icone-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CASCA); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (nomes) {
    return Promise.all(nomes.filter(function (n) { return n !== CACHE; })
      .map(function (n) { return caches.delete(n); }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  // Só a casca é servida do cache; o timesheet em si vem sempre da rede.
  if (e.request.mode === 'navigate' || CASCA.some(function (p) { return e.request.url.endsWith(p.replace('./', '')); })) {
    e.respondWith(caches.match(e.request).then(function (r) { return r || fetch(e.request); }));
  }
});
