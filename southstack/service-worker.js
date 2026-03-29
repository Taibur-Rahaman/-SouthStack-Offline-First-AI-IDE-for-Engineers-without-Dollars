/**
 * SouthStack Service Worker
 * Handles offline caching of model weights and assets
 */

const CACHE_NAME = 'southstack-v7';
const WEBLLM_CACHE = 'webllm-models-v6';

// URLs to cache
const STATIC_ASSETS = [
    './',
    './index.html',
    './webgpu-early-compat.js',
    './main.js',
    './manifest.json',
    'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.80/lib/index.js'
];

/**
 * Install event - cache static assets
 */
self.addEventListener('install', (event) => {
    console.log('[SW] Installing service worker...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching static assets');
                return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })));
            })
            .then(() => {
                console.log('[SW] Static assets cached');
                return self.skipWaiting();
            })
            .catch((error) => {
                console.error('[SW] Cache installation failed:', error);
            })
    );
});

/**
 * Activate event - clean up old caches
 */
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating service worker...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME && cacheName !== WEBLLM_CACHE) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('[SW] Service worker activated');
            return self.clients.claim();
        })
    );
});

/**
 * Fetch event - serve from cache, fallback to network
 */
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    const isAppShell = url.origin === self.location.origin &&
        (url.pathname.endsWith('/index.html') ||
            url.pathname.endsWith('/main.js') ||
            url.pathname.endsWith('/webgpu-early-compat.js') ||
            url.pathname === '/');
    
    // Skip cross-origin requests (except CDN)
    if (url.origin !== self.location.origin && 
        !url.href.includes('cdn.jsdelivr.net') &&
        !url.href.includes('mlc.ai')) {
        return;
    }

    // Handle model weight requests (WebLLM uses IndexedDB, but we can cache HTTP requests)
    if (url.href.includes('mlc.ai') || url.href.includes('huggingface.co') || 
        url.pathname.includes('.bin') || url.pathname.includes('.json') ||
        url.pathname.includes('model') || url.pathname.includes('weight')) {
        
        event.respondWith(
            caches.open(WEBLLM_CACHE).then((cache) => {
                return cache.match(event.request).then((response) => {
                    if (response) {
                        console.log('[SW] Serving model file from cache:', url.pathname);
                        return response;
                    }
                    
                    return fetch(event.request).then((response) => {
                        // Cache successful responses
                        if (response.status === 200) {
                            const responseToCache = response.clone();
                            cache.put(event.request, responseToCache);
                            console.log('[SW] Caching model file:', url.pathname);
                        }
                        return response;
                    }).catch(() => {
                        console.warn('[SW] Network failed, model file not in cache:', url.pathname);
                        // Return a basic error response
                        return new Response('Offline - model file not cached', {
                            status: 503,
                            statusText: 'Service Unavailable'
                        });
                    });
                });
            })
        );
        return;
    }

    // Always prefer latest app shell files to avoid stale code after fixes.
    if (isAppShell) {
        event.respondWith(
            fetch(event.request).then((response) => {
                if (response && response.status === 200) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                }
                return response;
            }).catch(() => caches.match(event.request))
        );
        return;
    }

    // Handle static assets
    event.respondWith(
        caches.match(event.request).then((response) => {
            if (response) {
                return response;
            }
            
            return fetch(event.request).then((response) => {
                // Don't cache non-successful responses
                if (!response || response.status !== 200 || response.type !== 'basic') {
                    return response;
                }
                
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });
                
                return response;
            }).catch(() => {
                // Offline fallback
                if (event.request.destination === 'document') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});

/**
 * Message handler for cache management
 */
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        event.waitUntil(
            caches.keys().then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        return caches.delete(cacheName);
                    })
                );
            }).then(() => {
                event.ports[0].postMessage({ success: true });
            })
        );
    }
});

console.log('[SW] Service worker script loaded');
