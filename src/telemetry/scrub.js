/**
 * Scrubbing shared by the browser and the server (pure: no DOM, no Node, no SDK).
 *
 * Nothing leaves the game for Sentry or PostHog without passing through here. The approach is an
 * ALLOW-list, not a deny-list: an outgoing payload is rebuilt from the fields named below, and
 * every string in it is rewritten by scrubText. So a field nobody thought of is dropped, not sent.
 *
 * What can never leave:
 *   - chat or message text, nicknames and any other free text a player typed
 *   - email addresses, long digit runs (phone numbers), cookies, bearer tokens
 *   - any UUID (the session cookie is one; so is the public id — which is why the public id is
 *     carried ONLY as the explicit user id / distinct id, set by the telemetry code itself)
 *   - positions (x/y/z, latitude/longitude) and anything that looks like a pair of coordinates
 *   - query strings, request bodies, request cookies, local variables of stack frames
 */

/** @typedef {string | number | boolean} SafeValue */
/** @typedef {Record<string, SafeValue>} SafeProps */

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID = new RegExp(UUID_SOURCE, 'gi');
const HAS_UUID = new RegExp(UUID_SOURCE, 'i');
const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/** A value that is safe to send as a property: an id, a code, an enum word. No spaces, no punctuation that prose needs. */
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,63}$/;
/** A route template as the server registers it ("POST /api/social/house/:host"): fixed words, never a real id. */
const ROUTE = /^(GET|POST|PUT|PATCH|DELETE|WS) [A-Za-z0-9\-_/:.]{1,80}$/;
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
/** Property names that are refused whatever they hold. */
const DENIED_KEYS = new Set(['name', 'nickname', 'username', 'display_name', 'text', 'body', 'message', 'chat', 'content', 'draft', 'note', 'title', 'reason',
  'email', 'phone', 'x', 'y', 'z', 'lat', 'lng', 'lon', 'latitude', 'longitude', 'position', 'pos', 'coords', 'coordinates', 'location_exact',
  'ip', 'ip_address', 'address', 'secret', 'sid', 'cookie', 'cookies', 'token', 'password', 'authorization', 'query', 'query_string', 'search', 'url', 'href', 'referrer', 'data', 'payload']);
export const MAX_PROPS = 24;
export const MAX_TEXT = 300;

export const isUuid = (value) => typeof value === 'string' && UUID_ONLY.test(value);

/** A URL reduced to origin + path (no query string, no fragment, no credentials). Unparseable input becomes ''. */
export function stripUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  const cut = value.split(/[?#]/)[0].replace(/\/\/[^/@]*@/, '//');
  return cut.replace(UUID, '[id]').slice(0, 200);
}

/**
 * Free text (an error message, a log line) made safe: emails, ids, cookies, tokens, coordinates,
 * long numbers and query strings are replaced, and anything quoted that reads like prose (it has a
 * space or is long) becomes [text] — an error that quotes what a player typed must not carry it.
 * @param {unknown} value
 * @returns {string}
 */
export function scrubText(value, limit = MAX_TEXT) {
  let text;
  try { text = typeof value === 'string' ? value : String(value ?? ''); } catch { return ''; }
  text = text.slice(0, 2000)
    .replace(/(["'`])((?:(?!\1)[^\n]){0,400})\1/g, (whole, quote, inner) => (/\s/.test(inner) || inner.length > 40 || /[@,;!?]/.test(inner) ? `${quote}[text]${quote}` : whole))
    .replace(EMAIL, '[email]')
    .replace(/\b(authorization|set-cookie|cookie)\s*[=:][^\n]*/gi, '$1=[redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(sid|token|secret|password|passwd|api_key|apikey)\s*[=:]\s*\S+/gi, '$1=[redacted]')
    .replace(UUID, '[id]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>]*)[?#][^\s"'<>]*/gi, '$1')
    .replace(/(\/[A-Za-z0-9_\-./]*)\?[^\s"'<>]*/g, '$1')
    .replace(/\b(x|y|z|lat|lng|lon|latitude|longitude)\b(["']?\s*[:=]\s*)-?\d+(?:\.\d+)?/gi, '$1$2[pos]')
    .replace(/-?\d{1,3}\.\d{2,}\s*,\s*-?\d{1,3}\.\d{2,}/g, '[pos]')
    .replace(/\+?\d[\d\s-]{7,}\d/g, '[number]');
  return text.slice(0, limit);
}

/**
 * Event properties made safe. Only flat values survive: finite numbers, booleans and short
 * id-like strings (TOKEN). Refused: denied names, nested values, prose, emails and every UUID.
 * @param {unknown} props
 * @param {{ allow?: readonly string[] | null }} [options] allow: the only property names accepted (the catalogue's list)
 * @returns {SafeProps}
 */
export function scrubProps(props, { allow = null } = {}) {
  /** @type {SafeProps} */
  const out = {};
  if (!props || typeof props !== 'object' || Array.isArray(props)) return out;
  let kept = 0;
  let keys;
  try { keys = Object.keys(props); } catch { return out; }
  for (const key of keys) {
    if (kept >= MAX_PROPS) break;
    if (!KEY.test(key) || DENIED_KEYS.has(key) || (allow && !allow.includes(key))) continue;
    let value;
    try { value = props[key]; } catch { continue; }
    if (typeof value === 'number') { if (!Number.isFinite(value)) continue; value = Math.round(value * 1000) / 1000; }
    else if (typeof value === 'string') { if (!(TOKEN.test(value) || ROUTE.test(value)) || HAS_UUID.test(value) || value.includes('@')) continue; }
    else if (typeof value !== 'boolean') continue;
    out[key] = value; kept += 1;
  }
  return out;
}

/** An event name as the catalogue writes them: lower snake case (PostHog's own `$pageview` is the one exception). */
export const isEventName = (name) => typeof name === 'string' && (/^[a-z][a-z0-9_]{2,47}$/.test(name) || name === '$pageview');

const EXTENSION = /(chrome|moz|safari|safari-web|ms-browser)-extension:\/\//;
const LEVELS = ['fatal', 'error', 'warning', 'info', 'debug'];
/** Breadcrumb categories the game itself writes. Anything else (console, DOM, fetch, navigation) is dropped. */
export const BREADCRUMB_CATEGORIES = Object.freeze(['action', 'link', 'screen', 'chunk', 'socket', 'storage', 'consent', 'scene']);
const CONTEXTS = ['game', 'trace', 'runtime'];

function scrubFrame(frame) {
  if (!frame || typeof frame !== 'object') return null;
  const out = {};
  if (typeof frame.filename === 'string') out.filename = stripUrl(frame.filename);
  if (typeof frame.abs_path === 'string') out.abs_path = stripUrl(frame.abs_path);
  if (typeof frame.function === 'string') out.function = frame.function.slice(0, 120);
  if (typeof frame.module === 'string') out.module = frame.module.slice(0, 120);
  for (const key of ['lineno', 'colno']) if (Number.isFinite(frame[key])) out[key] = frame[key];
  if (typeof frame.in_app === 'boolean') out.in_app = frame.in_app;
  // No `vars`, no source context lines: a local variable can hold anything a player typed.
  return out;
}

/**
 * A Sentry event rebuilt from allowed fields only. Returns null for an event that should not be
 * sent at all (browser-extension noise, or something that is not an event).
 * `userId` is the session's PUBLIC id as the telemetry code knows it — an id found on the event itself is not trusted.
 * @param {any} event
 * @param {{ userId?: string | null }} [options]
 * @returns {object | null}
 */
export function scrubEvent(event, { userId = null } = {}) {
  if (!event || typeof event !== 'object') return null;
  const values = Array.isArray(event.exception?.values) ? event.exception.values.slice(0, 5) : [];
  const frames = values.flatMap((value) => (Array.isArray(value?.stacktrace?.frames) ? value.stacktrace.frames : []));
  if (frames.some((frame) => EXTENSION.test(String(frame?.filename ?? '')) || EXTENSION.test(String(frame?.abs_path ?? '')))) return null;
  const out = {};
  for (const key of ['event_id', 'platform', 'release', 'environment', 'dist', 'type', 'logger']) if (typeof event[key] === 'string') out[key] = event[key].slice(0, 100);
  for (const key of ['timestamp', 'start_timestamp']) if (Number.isFinite(event[key]) || typeof event[key] === 'string') out[key] = event[key];
  if (LEVELS.includes(event.level)) out.level = event.level;
  if (typeof event.transaction === 'string') out.transaction = scrubText(stripUrl(event.transaction), 120);
  if (typeof event.message === 'string') out.message = scrubText(event.message);
  else if (event.message && typeof event.message === 'object' && typeof event.message.formatted === 'string') out.message = scrubText(event.message.formatted);
  if (Array.isArray(event.fingerprint)) out.fingerprint = event.fingerprint.slice(0, 6).map((part) => scrubText(part, 80));
  if (values.length) {
    out.exception = { values: values.map((value) => ({
      type: scrubText(value?.type ?? 'Error', 80), value: scrubText(value?.value ?? ''),
      ...(value?.mechanism && typeof value.mechanism === 'object' ? { mechanism: { type: scrubText(value.mechanism.type ?? 'generic', 40), handled: value.mechanism.handled !== false } } : {}),
      ...(Array.isArray(value?.stacktrace?.frames) ? { stacktrace: { frames: value.stacktrace.frames.slice(-50).map(scrubFrame).filter(Boolean) } } : {}),
    })) };
  }
  out.tags = scrubProps(event.tags);
  const extra = scrubProps(event.extra);
  if (Object.keys(extra).length) out.extra = extra;
  const contexts = {};
  for (const key of CONTEXTS) {
    const context = event.contexts?.[key];
    if (!context || typeof context !== 'object') continue;
    // The trace context is made of ids Sentry generated itself (hex, not UUIDs) and words.
    contexts[key] = key === 'trace' ? Object.fromEntries(Object.entries(context).filter(([name, value]) => ['trace_id', 'span_id', 'parent_span_id', 'op', 'status'].includes(name) && typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value))) : scrubProps(context);
  }
  if (Object.keys(contexts).length) out.contexts = contexts;
  if (isUuid(userId)) out.user = { id: userId };
  if (event.request && typeof event.request === 'object') {
    const agent = event.request.headers?.['User-Agent'];
    out.request = { ...(typeof event.request.url === 'string' ? { url: stripUrl(event.request.url) } : {}), ...(typeof event.request.method === 'string' ? { method: event.request.method.slice(0, 10) } : {}),
      ...(typeof agent === 'string' ? { headers: { 'User-Agent': agent.slice(0, 300) } } : {}) };
  }
  if (Array.isArray(event.breadcrumbs)) {
    out.breadcrumbs = event.breadcrumbs.filter((crumb) => crumb && BREADCRUMB_CATEGORIES.includes(crumb.category)).slice(-30)
      .map((crumb) => ({ category: crumb.category, ...(Number.isFinite(crumb.timestamp) ? { timestamp: crumb.timestamp } : {}), ...(LEVELS.includes(crumb.level) ? { level: crumb.level } : {}), data: scrubProps(crumb.data) }));
  }
  // Source maps are matched by these build ids; they describe the bundle, not the player.
  if (Array.isArray(event.debug_meta?.images)) {
    out.debug_meta = { images: event.debug_meta.images.slice(0, 200).filter((image) => image && typeof image === 'object')
      .map((image) => ({ type: String(image.type ?? '').slice(0, 20), ...(typeof image.code_file === 'string' ? { code_file: stripUrl(image.code_file) } : {}), ...(typeof image.debug_id === 'string' && /^[0-9a-f-]{32,36}$/i.test(image.debug_id) ? { debug_id: image.debug_id } : {}) })) };
  }
  // Sentry is told, on every event, never to work out an IP address for it.
  out.sdk = { name: String(event.sdk?.name ?? 'allworld').slice(0, 60), version: String(event.sdk?.version ?? '1').slice(0, 30), settings: { infer_ip: 'never' } };
  if (Array.isArray(event.spans)) out.spans = [];
  return out;
}
