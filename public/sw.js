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
 * A push payload is JSON { title, body, url, tag } made by server/growth/outreach.ts. The words
 * are the server's own; nothing in a payload is run or inserted as markup.
 */
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

/*
 * A message from a friend (kind 'chat') is shown only when no visible window of the game is open: someone who is looking at the game
 * is told by the game itself, and an active chat does not buzz the phone. One notification per conversation (the tag), which updates
 * in place and carries the count; the app badge (where the browser has one) shows the number of unread messages.
 */
function windows() { return self.clients.matchAll({ type: 'window', includeUncontrolled: true }); }
function showing(list) { return list.some((client) => client.visibilityState === 'visible'); }
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (error) { data = {}; }
  const title = typeof data.title === 'string' && data.title ? data.title.slice(0, 80) : 'Allworld';
  const url = typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : '/';
  const chat = data.kind === 'chat';
  event.waitUntil(windows().then((list) => {
    if (chat && showing(list)) return undefined;
    const badge = Number.isSafeInteger(data.badge) && data.badge >= 0 ? data.badge : null;
    if (badge !== null && self.navigator && typeof self.navigator.setAppBadge === 'function') { try { (badge ? self.navigator.setAppBadge(badge) : self.navigator.clearAppBadge()).catch(() => {}); } catch (error) { /* no badge here */ } }
    return self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body.slice(0, 160) : '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
      tag: typeof data.tag === 'string' ? data.tag.slice(0, 32) : 'allworld', renotify: chat, data: { url, conv: typeof data.conv === 'string' ? data.conv.slice(0, 120) : null },
    });
  }));
});

/* Tapping a notification: an open window of the game is focused AND told to open the conversation; with none open the game is opened at its address. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const info = event.notification.data || {};
  const url = info.url ? info.url : '/';
  event.waitUntil(windows().then((list) => {
    for (const client of list) {
      if (!('focus' in client)) continue;
      if (info.conv && typeof client.postMessage === 'function') client.postMessage({ type: 'open-chat', conv: info.conv });
      return client.focus();
    }
    return self.clients.openWindow(url);
  }));
});
