/**
 * OWNER: civic
 * Shared browser glue for the civic panels (governor, neighbours, ads, richlist, hunt, radio).
 * Not a panel: it is not registered and renders nothing by itself. It holds the small cache of
 * server responses the panels draw from, and the request helpers that give every server-backed
 * control a pending state, a success, or a failure with a reason and a retry.
 * Rules and validation live on the server (server/civic) and in src/game/systems/civic.js.
 */
import './civic.css';
import { esc } from '../dom.js';

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
export const explain = (error) => MESSAGES[error?.code] || error?.message || 'The server could not be reached. Try again.';

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
  if (!api.view()?.connected) { api.toast('You are offline. Reconnect, then try again — nothing was sent.', 'error'); return { ok: false, code: 'offline' }; }
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
  if (!view.connected) return '<p class="civic-note">You are offline. This needs the server — reconnect to load it.</p>';
  if (item.error) return `<p class="ui-error" role="alert">Could not load this: ${esc(item.error)}</p><button class="ui-button" ${retry}>Try again</button>`;
  return '<p class="civic-note" role="status">Loading…</p>';
}
/** A small line under stale data when the last refresh failed. */
export const stale = (item) => (item.data && item.error ? `<p class="ui-error" role="alert">Could not refresh: ${esc(item.error)} Showing the last loaded copy.</p>` : '');

/** A button that always says why it is disabled. */
export function button(label, attrs, { reason = '', primary = false, working = false } = {}) {
  const off = Boolean(reason) || working;
  return `<span class="civic-action"><button class="ui-button${primary ? ' is-primary' : ''}" ${attrs} ${off ? 'disabled' : ''}>${esc(working ? 'Working…' : label)}</button>${reason && !working ? `<small class="civic-why">${esc(reason)}</small>` : ''}</span>`;
}
