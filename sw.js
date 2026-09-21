// Service worker: rede primeiro, cache só se estiver offline.
// Assim cada atualização no GitHub aparece na próxima abertura do app.
const CACHE = 'timesheet-v2';
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
  if (new URL(e.request.url).origin !== self.location.origin) return;   // Apps Script não passa por aqui
  e.respondWith(
    fetch(e.request)
      .then(function (r) {
        const copia = r.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copia); });
        return r;
      })
      .catch(function () { return caches.match(e.request); })
  );
});
