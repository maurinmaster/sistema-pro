const CACHE_NAME = 'pro-combate-v7';
const APP_SHELL_ASSETS = [
    '/painel',
    '/cadastro',
    '/login',
    '/wiki-aluno',
    '/manifest.json?v=7',
    '/assets/icons/icon-192.png?v=7',
    '/assets/icons/icon-512.png?v=7',
    '/assets/icons/apple-touch-icon.png?v=7'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL_ASSETS).catch(() => {}))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    // Nunca fazer cache de chamadas da API (tokens e dados sensíveis sempre frescos da rede)
    if (url.pathname.startsWith('/api/')) {
        return;
    }

    // Estratégia Network-First com fallback para cache offline
    event.respondWith(
        fetch(req)
            .then((networkRes) => {
                if (networkRes && networkRes.ok && networkRes.type === 'basic') {
                    const resClone = networkRes.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone)).catch(() => {});
                }
                return networkRes;
            })
            .catch(() => caches.match(req))
    );
});
