/**
 * OWNER: growth
 * The browser side of web push: register the service worker (public/sw.js — push and
 * notification taps only), ask the browser for permission, and make or remove a subscription.
 * Called only from a tap in the Stay in touch app, after the game's own explanation: the browser's
 * permission prompt is never shown on arrival, and a "no" is final for the browser, so it is asked once.
 */
const toBytes = (value) => { const s = atob(String(value).replace(/-/g, '+').replace(/_/g, '/')); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };

/** 'ready' | 'unsupported' | 'needs-install' (iPhone and iPad: only after Add to Home Screen) | 'blocked' (the browser said no for good). */
export function pushState(win = globalThis) {
  const nav = win.navigator, ios = /iPad|iPhone|iPod/.test(nav?.userAgent ?? '') || (nav?.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  const standalone = win.matchMedia?.('(display-mode: standalone)').matches || nav?.standalone === true;
  if (ios && !standalone) return 'needs-install';
  if (!('serviceWorker' in (nav ?? {})) || !('PushManager' in win) || !('Notification' in win)) return 'unsupported';
  return win.Notification.permission === 'denied' ? 'blocked' : 'ready';
}

/**
 * Ask the browser and subscribe. Must run inside a tap.
 * @returns {Promise<{ ok: true, subscription: object } | { ok: false, code: 'declined' | 'blocked' | 'unsupported' | 'failed' }>}
 */
export async function enablePush(publicKey, win = globalThis) {
  const state = pushState(win);
  if (state !== 'ready') return { ok: false, code: state === 'blocked' ? 'blocked' : 'unsupported' };
  try {
    const permission = await win.Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, code: permission === 'denied' ? 'blocked' : 'declined' };
    const registration = await win.navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await win.navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(publicKey) });
    return { ok: true, subscription: subscription.toJSON() };
  } catch { return { ok: false, code: 'failed' }; }
}

/** Remove this browser's subscription. Resolves its endpoint (to tell the server), or null. */
export async function disablePush(win = globalThis) {
  try {
    const registration = await win.navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return null;
    const { endpoint } = subscription;
    await subscription.unsubscribe();
    return endpoint;
  } catch { return null; }
}
