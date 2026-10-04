/**
 * OWNER: civic
 * Shared browser glue for the civic panels (governor, neighbours, ads, richlist, hunt, radio).
 * Not a panel: it is not registered and renders nothing by itself. It holds the small cache of
 * server responses the panels draw from, and the request helpers that give every server-backed
 * control a pending state, a success, or a failure with a reason and a retry.
 * Rules and validation live on the server (server/civic) and in src/game/systems/civic.js.
 */
import './civic.css';
import { unseenNews } from '../phone/logic.js';
import { esc, skeleton, mark } from '../dom.js';
import { linkWords, linkButton } from '../link.js';

const cache = new Map();
const pending = new Set();
const blank = () => ({ data: null, at: 0, path: '', loading: false, error: null });

const MESSAGES = {
  civic_rate_limited: 'You are doing that too quickly. Wait a minute and try again.',
  rate_limited: 'Too many requests from this network. Wait a minute and try again.',
  device_session_required: 'Your device session is missing or expired. Reconnect first.',
  invalid_city: 'That city is not available.',
  body_too_large: 'That is too much text.',
};
export const explain = (error) => error?.reason || MESSAGES[error?.code] || error?.message || 'The server could not be reached. Try again.';

export const entry = (key) => cache.get(key) ?? blank();
export const put = (key, data) => { const item = cache.get(key) ?? blank(); cache.set(key, Object.assign(item, { data, at: Date.now(), error: null })); };

/** Is this panel on screen? Used so a late response never re-opens a sheet the player closed. */
const showing = (id) => { const node = document.querySelector(`dialog [data-panel="${id}"]`); return Boolean(node?.closest('dialog')?.open); };
/** Re-render a panel. `live: false` sheets ignore api.refresh(), so those are re-opened in place. */
export function rerender(api, id) { if (id && showing(id)) api.open(id); else api.refresh(); }

/**
 * Fetch `path` into the cache unless a fresh copy (younger than maxAge) is there. Never runs
 * from a timer: panels call it from bind(), so it only happens when something was re-rendered.
 */
export function load(api, key, path, { maxAge = 30000, force = false, panel = null, after = null } = {}) {
  const item = cache.get(key) ?? blank();
  cache.set(key, item);
  if (item.loading || !api.view()?.connected) return;
  if (!force && item.path === path && item.at && Date.now() - item.at < maxAge) return;
  item.loading = true; item.path = path;
  api.fetchJson(path).then((data) => { item.data = data; item.error = null; }, (error) => { item.error = explain(error); })
    .finally(() => { item.loading = false; item.at = Date.now(); after?.(item); rerender(api, panel); });
  if (force) rerender(api, panel);
}

export const busy = (tag) => pending.has(tag);

/**
 * POST a civic request. Resolves { ok, code, reason?, ...body }; never rejects. While it runs,
 * busy(tag) is true so the control can show a pending label. A refusal or failure is toasted
 * with its reason. After a success the life is re-synced so the wallet shows the new balance.
 */
export async function send(api, tag, path, body, { panel = null, success = '' } = {}) {
  if (pending.has(tag)) return { ok: false, code: 'busy' };
  if (!api.view()?.connected) { api.toast(`${linkWords(api.view()).why} Nothing was sent.`, 'error'); return { ok: false, code: 'offline' }; }
  pending.add(tag);
  rerender(api, panel);
  let result;
  try {
    result = await api.fetchJson(path, { method: 'POST', body: { cityId: api.view().cityId, ...body } });
    if (result.ok) { if (success) api.toast(success, 'good'); if (result.state) await api.command('civic.refresh'); }
    else api.toast(result.reason || 'That could not be done.', 'error');
  } catch (error) {
    result = { ok: false, code: error.code || 'network', reason: `${explain(error)} Nothing was charged; you can try again.` };
    api.toast(result.reason, 'error');
  }
  pending.delete(tag);
  rerender(api, panel);
  return result;
}

/**
 * The request id of a paid civic request (rent, stand for office): `<server ms>:<uuid>`, the form
 * the server requires. `slot` is a module-level object the panel keeps; the id is reused for as
 * long as the request's contents are the same, so pressing the button again after a lost answer
 * repeats the SAME request (applied once), and changing anything makes a new one. Call
 * `done(slot, result)` afterwards: an applied request forgets its id.
 */
export function requestId(api, slot, contents) {
  const what = JSON.stringify(contents);
  if (slot.what !== what || !slot.id) { slot.what = what; slot.id = api.newId(); }
  return slot.id;
}
export function requestDone(slot, result) { if (result?.ok) { slot.what = null; slot.id = null; } }

const NEWS_KEY = 'joinallworld-civic-news-read';
let newsRead = null;
function newsReadAt(cityId) {
  if (!newsRead) { try { newsRead = JSON.parse(window.localStorage.getItem(NEWS_KEY)) || {}; } catch { newsRead = {}; } }
  return Number(newsRead[cityId]) || 0;
}
/**
 * City news (a new Governor, an announcement) that is new to THIS life and that the player has not
 * opened the Governor app for yet: its badge on the Phone. News from before the life began in the
 * city (state.civic.since) never counts, so a brand-new life starts with no badge.
 */
export function civicNews(view, state) {
  const notices = cache.get(`pulse:${view.cityId}`)?.data?.notices ?? [];
  return unseenNews(notices, { readAt: newsReadAt(view.cityId), since: state?.civic?.since });
}
/** The Governor app is on screen: its news is read. */
export function markCivicNewsRead(view) {
  const newest = Math.max(0, ...(cache.get(`pulse:${view.cityId}`)?.data?.notices ?? []).map((item) => item.at));
  if (newest <= newsReadAt(view.cityId)) return false;
  newsRead[view.cityId] = newest;
  try { window.localStorage.setItem(NEWS_KEY, JSON.stringify(newsRead)); } catch { /* read for this visit only */ }
  return true;
}

/** "2d 4h", "3h 12m", "5m" until a server time. */
export function until(at, now) {
  const minutes = Math.max(0, Math.ceil((at - now) / 60000));
  if (minutes >= 2880) return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}m`;
}
const DATE = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
/** A server time as a Lagos date and time, e.g. "Sun, 11 Oct, 5:28 am". */
export const dateTime = (at) => DATE.format(new Date(at));
export const count = (value) => Math.round(Number(value) || 0).toLocaleString('en-NG');

/** Standard loading / offline / error states for a cached response. Returns '' when data is ready. */
export function status(item, view, { retry = 'data-civic-retry' } = {}) {
  if (item.data) return '';
  if (!view.connected) { const words = linkWords(view); return `<div class="ui-empty is-compact"><span aria-hidden="true">${mark('cloud-off')}</span><h3>${esc(words.short)}</h3><p>${esc(words.why)} This screen is loaded from the server, so it cannot be shown right now.</p>${linkButton(view, 'ui-button is-small')}</div>`; }
  if (item.error) return `<div class="ui-empty is-compact" role="alert"><span aria-hidden="true">${mark('cloud-off')}</span><h3>This did not load</h3><p>${esc(item.error)}</p><button class="ui-button is-small" ${retry}>Try again</button></div>`;
  return skeleton(4);
}
/** A small line under stale data when the last refresh failed. */
export const stale = (item) => (item.data && item.error ? `<p class="ui-error" role="alert">Could not refresh: ${esc(item.error)} Showing the last loaded copy.</p>` : '');

/** A button that always says why it is disabled. */
export function button(label, attrs, { reason = '', primary = false, working = false } = {}) {
  const off = Boolean(reason) || working;
  return `<span class="civic-action"><button class="ui-button${primary ? ' is-primary' : ''}" ${attrs} ${off ? 'disabled' : ''}>${esc(working ? 'Working…' : label)}</button>${reason && !working ? `<small class="civic-why">${esc(reason)}</small>` : ''}</span>`;
}
