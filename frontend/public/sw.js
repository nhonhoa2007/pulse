/**
 * Pulse Service Worker - Standards-compliant Web Push Notifications (RFC 8030 / RFC 8292)
 */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {
    title: 'Pulse',
    body: 'Bạn có tương tác mới trên Pulse',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    url: '/',
  };

  try {
    const json = event.data.json();
    payload = {
      title: json.title || 'Pulse',
      body: json.body || json.content || 'Bạn có thông báo mới',
      icon: json.icon || '/favicon.ico',
      badge: json.badge || '/favicon.ico',
      url: json.url || json.targetUrl || '/',
      data: json,
    };
  } catch {
    payload.body = event.data.text();
  }

  const options = {
    body: payload.body,
    icon: payload.icon,
    badge: payload.badge,
    data: {
      url: payload.url,
    },
    vibrate: [100, 50, 100],
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});

// ================= PKG-12: PWA Offline Shell =================
// Static app shell: cache-first (đổi theo build → bump version khi deploy bản mới).
const APP_SHELL_CACHE = 'pulse-shell-v1';
const APP_SHELL_ASSETS = ['/', '/manifest.webmanifest', '/pwa-icon.svg', '/pwa-icon-maskable.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== APP_SHELL_CACHE && k.startsWith('pulse-')).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// Static assets (hashed bởi Vite): cache-first vô thời hạn.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Không đụng vào API/SSE/uploads — luôn đi mạng.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/uploads/') ||
    url.pathname.startsWith('/.well-known/') ||
    url.pathname === '/realtime/stream' ||
    url.pathname === '/inbox'
  ) {
    return;
  }

  // Document navigation: network-first, fallback app shell "/" khi offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(APP_SHELL_CACHE).then((cache) => cache.put('/', copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Hashed static assets (/assets/): cache-first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
            return response;
          })
      )
    );
  }
});
