// Service Worker for P2P SouthStack
const CACHE = 'p2p-southstack-v8';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const reqUrl = new URL(req.url);
  const path = reqUrl.pathname;
  const isRootDoc = path === '/' || path === '' || path.endsWith('/index.html');
  const isAppShell =
    isRootDoc ||
    path.endsWith('/main.js') ||
    path.endsWith('/webgpu-early-compat.js') ||
    path.endsWith('/manifest.json') ||
    path.endsWith('/sw.js');
  const isMlcBundle =
    reqUrl.hostname === 'cdn.jsdelivr.net' &&
    (reqUrl.pathname.includes('@mlc-ai/web-llm') || reqUrl.pathname.includes('web-llm-webgpu'));
  // Network-first: app + WebLLM JS so a second visit can load offline after one online session.
  if (isAppShell || isMlcBundle) {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(cache => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }
  if (reqUrl.pathname.startsWith('/api/southstack/')) {
    e.respondWith(fetch(req));
    return;
  }
  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
