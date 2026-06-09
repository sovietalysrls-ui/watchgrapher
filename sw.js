// sw.js — Service Worker WatchGrapher
const CACHE = 'watchgrapher-v1';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/audio.js',
  './js/analyzer.js',
  './js/calibration.js',
  './js/profiles.js',
  './js/ui.js',
  './js/app.js',
  './data/lift-angles.json',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Non cachare le chiamate NTP
  if (e.request.url.includes('worldtimeapi') || e.request.url.includes('timeapi.io')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
