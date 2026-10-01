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
