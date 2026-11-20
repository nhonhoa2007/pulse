/** Pulse service worker: versioned app shell, offline fallback and Web Push. */
const BUILD_ID = '__PULSE_BUILD_ID__';
const APP_SHELL_CACHE = `pulse-shell-${BUILD_ID}`;
const STATIC_CACHE = `pulse-static-${BUILD_ID}`;
const APP_SHELL_ASSETS = [
  '/',
  '/offline.html',
  '/manifest.webmanifest',
  '/pwa-icon.svg',
  '/pwa-icon-maskable.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('pulse-') && key !== APP_SHELL_CACHE && key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Private and mutable data is network-only and is never written to Cache API.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/uploads/') ||
    url.pathname.startsWith('/.well-known/') ||
    url.pathname === '/realtime/stream' ||
    url.pathname === '/inbox'
  ) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        return (await caches.match('/offline.html')) || Response.error();
      })
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy)));
        }
        return response;
      }))
    );
  }
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {
    title: 'Pulse',
    body: 'Bạn có tương tác mới trên Pulse',
    icon: '/pwa-icon.svg',
    badge: '/pwa-icon.svg',
    url: '/',
  };

  try {
    const json = event.data.json();
    payload = {
      ...payload,
      title: json.title || payload.title,
      body: json.body || json.content || 'Bạn có thông báo mới',
      icon: json.icon || payload.icon,
      badge: json.badge || payload.badge,
      url: json.url || json.targetUrl || '/',
    };
  } catch {
    payload.body = event.data.text();
  }

  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: payload.icon,
    badge: payload.badge,
    data: { url: payload.url },
    vibrate: [100, 50, 100],
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url === target);
      if (existing && 'focus' in existing) return existing.focus();
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    })
  );
});
