/**
 * OWNER: growth
 * Browser-side state shared by the growth panels (Missions, Events, Bring a friend, Stay in touch,
 * the away card). Not a panel: it is imported by them and is not registered in panels/index.js.
 *
 * It says hello to /api/growth/hello when a growth panel is drawn and the last answer is older
 * than five minutes (never from a timer), and prepares shares. The link a page was opened with — the
 * player to join, the share code to attach as a referral, the table to open — is read and handled in ONE
 * place, the landing (src/quick-start/entry.js captureLink, src/life-main.js landJoin); nothing here reads the address. Pure decisions live in
 * src/game/share-model.js and src/game/digest.js; this file is the glue.
 *
 * ON THIS DEVICE (localStorage)
 *   allworld-device   a random token made once per browser. It is sent with hello and with a
 *                     referral link and is only ever kept on the server as a salted hash; it lets
 *                     the server refuse "a new life on the same phone through your own link".
 *   allworld-ref      a share code waiting to be attached ({ code, at }), dropped after a week (written and attached by the landing)
 *   allworld-away     the server time of the hello whose away card was dismissed
 */
import './growth.css';
import '../phone/icons-more.js';
import { deviceToken } from '../../quick-start/entry.js';
export { deviceToken };
/** The canvas painter and the share-sheet calls are fetched the first time something is shared, not with the first download. */
const sharing = () => import('../share.js');

const HELLO_MAX_AGE = 5 * 60000;
export const G = {
  api: null, hello: null, at: 0, loading: false, error: null,
  /** A share being shown in the share sheet: { facts, prepared } | null. */
  sharing: null, busy: null,
  /** Where the page's share link came from, once known: { kind, by: { id, name } } | null. */
  landing: null,
};

const store = { get(key) { try { return JSON.parse(window.localStorage.getItem(key)); } catch { return null; } }, set(key, value) { try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* this visit only */ } },
  drop(key) { try { window.localStorage.removeItem(key); } catch { /* nothing to drop */ } } };
/**
 * Product events for whatever analytics the game has (a separate facade listens): a decoupled DOM event, never an SDK
 * call. Props are fixed small values — a kind, an id from the game's own content, a result. Never a name, a message,
 * an address or a position.
 */
export function track(name, props = {}) { try { window.dispatchEvent(new CustomEvent('jaw:track', { detail: { name, props } })); } catch { /* no listener is fine */ } }
const ready = (view) => Boolean(view?.connected) && view.onboarding?.required !== true;
// The device session changed: what was loaded belonged to the previous identity.
try { window.addEventListener('jaw:session', () => { if (G.sharing?.prepared.url) URL.revokeObjectURL(G.sharing.prepared.url); Object.assign(G, { hello: null, at: 0, loading: false, error: null, sharing: null, busy: null, landing: null }); }); } catch { /* not a browser */ }
const refresh = () => G.api?.refresh();

/** The age answer, as the server holds it, is told to whoever listens ('jaw:age'): telemetry switches analytics off for "under 18". */
export function announceAge(age) { if (age === 'minor' || age === 'adult') { try { window.dispatchEvent(new CustomEvent('jaw:age', { detail: { age } })); } catch { /* not a browser */ } } }

/** One POST. Never throws: a failure comes back as { ok: false, code, reason }. */
export async function call(path, body) {
  try { return await G.api.fetchJson(path, body ? { method: 'POST', body: { cityId: G.api.view().cityId, ...body } } : undefined); }
  catch (error) {
    return { ok: false, code: error.code || 'network', transport: !error.status,
      reason: error.reason || (error.status === 429 ? 'Too many requests. Wait a minute and try again.' : error.status === 401 ? 'Your device session expired. Reconnect to continue.' : 'The server could not be reached. Nothing was changed; try again.') };
  }
}

/** Say hello unless a fresh answer is here. Called from bind(), so only when something was drawn. */
export async function load(api, { force = false } = {}) {
  G.api = api;
  if (G.loading || !ready(api.view())) return;
  if (!force && G.at && Date.now() - G.at < HELLO_MAX_AGE) return;
  G.loading = true;
  const result = await call('/api/growth/hello', { device: deviceToken() });
  G.loading = false; G.at = Date.now();
  if (result.ok && result.contact?.email?.confirmed && G.hello && !G.hello.contact?.email?.confirmed) track('email_optin_confirmed');
  if (result.ok) { if ((result.referral?.paid?.paidTotal ?? 0) > (G.hello?.referral?.paid?.paidTotal ?? Infinity)) track('referral_rewarded'); G.hello = result; G.error = null; announceAge(result.consent?.age); if (result.state) void api.command('missions.refresh'); }
  else G.error = result.reason;
  refresh();
}

/** Make a share link, paint the card and open the share sheet panel. */
export async function share(api, kind, extra = {}) {
  G.api = api;
  if (G.busy) return;
  if (!ready(api.view())) { api.toast('Sharing needs a connection to the server.', 'error'); return; }
  G.busy = kind; refresh();
  const made = await call('/api/growth/share', { kind, ...extra });
  if (!made.ok) { G.busy = null; api.toast(made.reason || 'That could not be shared.', 'error'); refresh(); return; }
  const prepared = await (await sharing()).prepareShare(made.share.facts, `${location.origin}${made.share.path}`);
  if (G.sharing?.prepared.url) URL.revokeObjectURL(G.sharing.prepared.url);
  G.sharing = { facts: made.share.facts, prepared };
  track('share_card_created', { kind }); if (kind === 'invite' || kind === 'house' || kind === 'table') track('invite_created');
  G.busy = null;
  api.open('share-sheet');
}
/** The share sheet's own buttons. */
export async function shareNow(api) {
  if (!G.sharing) return;
  const outcome = await (await sharing()).systemShare(G.sharing.prepared);
  void call('/api/growth/client', { signals: [outcome === 'unavailable' ? 'share-fallback' : 'share-sheet'] });
  if (outcome === 'unavailable') api.toast('This browser has no share sheet. Use WhatsApp, X or Copy below.', 'info');
}
export async function copyShare(api) { if (G.sharing) api.toast((await (await sharing()).copyText(G.sharing.prepared.text)) ? 'Copied. Paste it into any chat.' : 'Could not copy. Press and hold the text to copy it yourself.', 'good'); }

/**
 * The link to the owner's WhatsApp Channel, wherever a panel wants it (Events, Stay in touch, Settings, the Messages
 * footer): one place, drawn only when the server says a channel is configured (the hello's `channel`). Following it is
 * between the player and WhatsApp: an ordinary link, opened in a new tab, with nothing sent from the game.
 */
export const channelLink = (label = 'Follow Allworld on WhatsApp', cls = 'ui-button is-block') => (typeof G.hello?.channel === 'string' && /^https:\/\//.test(G.hello.channel)
  ? `<a class="${cls} gr-channel" href="${G.hello.channel.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}" target="_blank" rel="noopener noreferrer">${label}</a>` : '');

/** Was this hello's away card dismissed on this device? */
export const awayDismissed = () => Boolean(G.hello) && store.get('allworld-away') === G.hello.away.since;
export function dismissAway() { if (G.hello) store.set('allworld-away', G.hello.away.since); refresh(); }

// ---- small formatting helpers shared by the growth panels --------------------------------------
/** "2d 4h", "3h 12m", "5m" until a server time. */
export function until(at, now) {
  const minutes = Math.max(0, Math.ceil((at - now) / 60000));
  if (minutes >= 2880) return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}m`;
}
const DAY_TIME = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const CLOCK = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit', hour12: true });
/** "Fri, 8:00 pm – 2:00 am" in Lagos time. */
export const span = (start, end) => `${DAY_TIME.format(new Date(start))} – ${CLOCK.format(new Date(end))}`;
