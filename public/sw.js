// Gym Workout Service Worker — Background Notifications & Focus Handling
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SHOW_NOTIFICATION' && self.registration && typeof self.registration.showNotification === 'function') {
    const title = String(data.title || 'Gym Workout Alert');
    const options = {
      body: String(data.body || ''),
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: String(data.tag || 'gym-workout-alert'),
      renotify: true,
      requireInteraction: Boolean(data.requireInteraction),
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' },
    };
    event.waitUntil(self.registration.showNotification(title, options));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
