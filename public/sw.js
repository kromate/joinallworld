/*
 * OWNER: growth
 * Allworld's service worker. It does exactly two things: show a notification when a push arrives,
 * and open the game when that notification is tapped. It caches nothing, intercepts no request
 * (there is no fetch handler), and so cannot serve a stale game or change how anything loads.
 *
 * SCOPE AND UPDATES. Registered at "/" by the Stay in touch app, and only when a player switches
 * notifications on — a visitor who never does has no service worker at all. The browser re-checks
 * this file on its own (at most every 24 hours, and on navigation); a changed file takes over at
 * once (skipWaiting + clients.claim), which is safe because it holds no cache and no state.
 * Switching notifications off unsubscribes; the worker then simply never receives anything.
 *
 * A push payload is JSON { title, body, url, tag } made by server/growth/outreach.js. The words
 * are the server's own; nothing in a payload is run or inserted as markup.
 */
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (error) { data = {}; }
  const title = typeof data.title === 'string' && data.title ? data.title.slice(0, 80) : 'Allworld';
  const url = typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : '/';
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.body === 'string' ? data.body.slice(0, 160) : '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    tag: typeof data.tag === 'string' ? data.tag.slice(0, 32) : 'allworld', data: { url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const client of list) if ('focus' in client) return client.focus();
    return self.clients.openWindow(url);
  }));
});
