self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) {}
  const title = String(payload.title || 'Notificación');
  const path = typeof payload.url === 'string' && payload.url.startsWith('/#/') ? payload.url : '/#/';
  event.waitUntil(self.registration.showNotification(title, {
    body: String(payload.body || 'Tenés una novedad.'),
    icon: '/push-icon.png', badge: '/push-icon.png',
    tag: String(payload.tag || 'app-alert'),
    data: { url: path }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/#/', self.location.origin).href;
  event.waitUntil((async () => {
    const clientsList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(url);
        return client.focus();
      }
    }
    return clients.openWindow(url);
  })());
});
