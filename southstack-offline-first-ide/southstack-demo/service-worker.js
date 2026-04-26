/**
 * SouthStack Demo - Service Worker
 * Handles offline caching of model weights and assets
 */

const CACHE_NAME = 'southstack-demo-v1';
const WEBLLM_CACHE = 'webllm-models-v1';

// URLs to cache
const STATIC_ASSETS = [
    './',
    './index.html',
    './main.js',
    'https://esm.run/@mlc-ai/web-llm'
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
    
    // Skip cross-origin requests (except CDN)
    if (url.origin !== self.location.origin && 
        !url.href.includes('esm.run') &&
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

console.log('[SW] Service worker script loaded');
