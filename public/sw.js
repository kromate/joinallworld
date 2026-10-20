/*
 * OWNER: growth
 * Allworld's service worker. It does three things: show a notification when a push arrives, open the game
 * when that notification is tapped, and show a small "you are offline" page when a page load fails for want
 * of a network. It caches nothing: the offline page is written below, not stored, and every other request
 * (scripts, pictures, the game's data, the socket) never passes through here. A page load that works is
 * handed back untouched, so the worker cannot serve a stale game or change how anything loads.
 *
 * SCOPE AND UPDATES. Registered at "/" in two cases: when a player switches notifications on (the Stay in
 * touch app), and inside the installed app (the Play Store app or Add to Home Screen; see
 * src/app/features/start/offlineWorker.ts), where a failed load would otherwise show the browser's error
 * screen. A visitor in an ordinary browser tab who never switches notifications on has no service worker.
 * The browser re-checks this file on its own (at most every 24 hours, and on navigation); a changed file
 * takes over at once (skipWaiting + clients.claim), which is safe because it holds no cache and no state.
 *
 * A push payload is JSON { title, body, url, tag } made by server/growth/outreach.ts. The words
 * are the server's own; nothing in a payload is run or inserted as markup.
 */
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  // Navigation preload starts the page's request while the worker wakes, so the fetch handler below costs no time.
  const preload = self.registration && self.registration.navigationPreload ? self.registration.navigationPreload.enable().catch(() => {}) : Promise.resolve();
  event.waitUntil(Promise.all([self.clients.claim(), preload]));
});

/*
 * OFFLINE. Only page loads (mode "navigate", GET) are looked at. The network answers as usual; only when
 * it cannot be reached at all is the page below shown in its place. An error page from the server (a 404,
 * a 500) is a real answer and passes through. The offline page answers 200 (Chrome's app checks have counted
 * an error status for a failed load as a crash of the installed app). The page has no script: it reloads itself every 10 seconds
 * (the meta refresh repeats the address that failed) and has a Try again link, so the game comes back by
 * itself when the connection does. Its own policy allows nothing but its inline style.
 */
const OFFLINE_PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<meta http-equiv="refresh" content="10"><meta name="theme-color" content="#183b2a"><title>Allworld: offline</title><style>'
  + 'html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;background:#183b2a;color:#f4efe3;'
  + 'font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center}main{max-width:320px;padding:24px}'
  + 'svg{width:72px;height:72px;margin-bottom:16px}h1{font-size:22px;margin:0 0 8px}p{margin:0 0 24px;opacity:.85}'
  + 'a{display:inline-block;padding:12px 28px;border-radius:999px;background:#f4efe3;color:#183b2a;font-weight:600;text-decoration:none}'
  + '</style></head><body><main><svg viewBox="0 0 64 64" fill="none" stroke="#f4efe3" stroke-width="3" aria-hidden="true">'
  + '<circle cx="32" cy="32" r="28"/><ellipse cx="32" cy="32" rx="12" ry="28"/><path d="M4 32h56M9 18h46M9 46h46"/></svg>'
  + '<h1>You are offline</h1><p>Allworld needs the internet. Check your connection; the world comes back by itself when you are online again.</p>'
  + '<a href="">Try again</a></main></body></html>';
function offlinePage() {
  return new Response(OFFLINE_PAGE, { status: 200, headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  } });
}
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.mode !== 'navigate' || request.method !== 'GET') return;
  event.respondWith((async () => {
    try {
      const preloaded = await event.preloadResponse;
      if (preloaded) return preloaded;
      return await fetch(request);
    } catch (error) { return offlinePage(); }
  })());
});

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
