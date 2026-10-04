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

export type SafeValue = string | number | boolean;
export type SafeProps = Record<string, SafeValue>;

/** A value read as a bag of properties: anything that is not an object reads as empty. Used on untrusted payloads. */
const rec = (value: unknown): Record<string, unknown> => (value !== null && (typeof value === 'object' || typeof value === 'function') ? (value as Record<string, unknown>) : {});

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

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_ONLY.test(value);

/** A URL reduced to origin + path (no query string, no fragment, no credentials). Unparseable input becomes ''. */
export function stripUrl(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const cut = (value.split(/[?#]/)[0] ?? '').replace(/\/\/[^/@]*@/, '//');
  return cut.replace(UUID, '[id]').slice(0, 200);
}

/**
 * Free text (an error message, a log line) made safe: emails, ids, cookies, tokens, coordinates,
 * long numbers and query strings are replaced, and anything quoted that reads like prose (it has a
 * space or is long) becomes [text] — an error that quotes what a player typed must not carry it.
 */
export function scrubText(value: unknown, limit = MAX_TEXT): string {
  let text: string;
  try { text = typeof value === 'string' ? value : String(value ?? ''); } catch { return ''; }
  text = text.slice(0, 2000)
    .replace(/(["'`])((?:(?!\1)[^\n]){0,400})\1/g, (whole: string, quote: string, inner: string) => (/\s/.test(inner) || inner.length > 40 || /[@,;!?]/.test(inner) ? `${quote}[text]${quote}` : whole))
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
 * `allow`: the only property names accepted (the catalogue's list)
 */
export function scrubProps(props: unknown, { allow = null }: { allow?: readonly string[] | null } = {}): SafeProps {
  const out: SafeProps = {};
  if (!props || typeof props !== 'object' || Array.isArray(props)) return out;
  let kept = 0;
  let keys: string[];
  try { keys = Object.keys(props); } catch { return out; }
  for (const key of keys) {
    if (kept >= MAX_PROPS) break;
    if (!KEY.test(key) || DENIED_KEYS.has(key) || (allow && !allow.includes(key))) continue;
    let value: unknown;
    try { value = (props as Record<string, unknown>)[key]; } catch { continue; }
    if (typeof value === 'number') { if (!Number.isFinite(value)) continue; value = Math.round(value * 1000) / 1000; }
    else if (typeof value === 'string') { if (!(TOKEN.test(value) || ROUTE.test(value)) || HAS_UUID.test(value) || value.includes('@')) continue; }
    else if (typeof value !== 'boolean') continue;
    out[key] = value as SafeValue; kept += 1; // only a finite number, a clean string or a boolean got this far
  }
  return out;
}

/**
 * The strings inside a request body or socket message (what a player sent), so they can be taken
 * out of an error message that quotes them. Protocol words (`type`, city and venue ids) are left.
 */
export function stringsOf(value: unknown, depth = 0, out: string[] = []): string[] {
  if (out.length >= 50 || depth > 4) return out;
  if (typeof value === 'string') { if (value.trim().length >= 3) out.push(value, value.trim()); }
  else if (value && typeof value === 'object') {
    try { for (const [key, inner] of Object.entries(value)) if (!(depth === 0 && ['type', 'cityId', 'venueId'].includes(key))) stringsOf(inner, depth + 1, out); } catch { /* unreadable: nothing to add */ }
  }
  return out;
}

/** `text` with every one of `values` (things a player typed) replaced by [text]. Longest first, so a part never survives its whole. */
export function redact(text: string, values: unknown): string {
  // The guards keep the original behaviour for callers that are not typed (JavaScript): anything but a string comes back as it was.
  if (typeof text !== 'string' || !Array.isArray(values) || !values.length) return text;
  let out: string = text;
  for (const value of [...new Set<unknown>(values)].filter((item): item is string => typeof item === 'string' && item.length >= 3).sort((a, b) => b.length - a.length).slice(0, 100)) out = out.split(value).join('[text]');
  return out;
}

/** An event name as the catalogue writes them: lower snake case (PostHog's own `$pageview` is the one exception). */
export const isEventName = (name: unknown): name is string => typeof name === 'string' && (/^[a-z][a-z0-9_]{2,47}$/.test(name) || name === '$pageview');

const EXTENSION = /(chrome|moz|safari|safari-web|ms-browser)-extension:\/\//;
const LEVELS = ['fatal', 'error', 'warning', 'info', 'debug'];
/** Breadcrumb categories the game itself writes. Anything else (console, DOM, fetch, navigation) is dropped. */
export const BREADCRUMB_CATEGORIES = Object.freeze(['action', 'link', 'screen', 'chunk', 'socket', 'storage', 'consent', 'scene']);
const CONTEXTS = ['game', 'trace', 'runtime'];

export interface ScrubbedFrame { filename?: string; abs_path?: string; function?: string; module?: string; lineno?: number; colno?: number; in_app?: boolean }
export interface ScrubbedException { type: string; value: string; mechanism?: { type: string; handled: boolean }; stacktrace?: { frames: ScrubbedFrame[] } }
export interface ScrubbedBreadcrumb { category: string; timestamp?: number; level?: string; data: SafeProps }
export interface ScrubbedImage { type: string; code_file?: string; debug_id?: string }
/** What scrubEvent returns: a Sentry event rebuilt from allowed fields only. */
export interface ScrubbedEvent {
  event_id?: string; platform?: string; release?: string; environment?: string; dist?: string; type?: string; logger?: string;
  timestamp?: number | string; start_timestamp?: number | string;
  level?: string; transaction?: string; message?: string; fingerprint?: string[];
  exception?: { values: ScrubbedException[] };
  tags: SafeProps; extra?: SafeProps; contexts?: Record<string, Record<string, SafeValue>>;
  user?: { id: string };
  request?: { url?: string; method?: string; headers?: { 'User-Agent': string } };
  breadcrumbs?: ScrubbedBreadcrumb[];
  debug_meta?: { images: ScrubbedImage[] };
  sdk: { name: string; version: string; settings: { infer_ip: 'never' } };
  spans?: never[];
}

function scrubFrame(frame: unknown): ScrubbedFrame | null {
  if (!frame || typeof frame !== 'object') return null;
  const from = rec(frame);
  const out: ScrubbedFrame = {};
  if (typeof from.filename === 'string') out.filename = stripUrl(from.filename);
  if (typeof from.abs_path === 'string') out.abs_path = stripUrl(from.abs_path);
  if (typeof from.function === 'string') out.function = from.function.slice(0, 120);
  if (typeof from.module === 'string') out.module = from.module.slice(0, 120);
  for (const key of ['lineno', 'colno'] as const) { const at = from[key]; if (typeof at === 'number' && Number.isFinite(at)) out[key] = at; }
  if (typeof from.in_app === 'boolean') out.in_app = from.in_app;
  // No `vars`, no source context lines: a local variable can hold anything a player typed.
  return out;
}

/**
 * A Sentry event rebuilt from allowed fields only. Returns null for an event that should not be
 * sent at all (browser-extension noise, or something that is not an event).
 * `userId` is the session's PUBLIC id as the telemetry code knows it — an id found on the event itself is not trusted.
 * `typed` is what the player is known to have typed (a request body's strings, the nickname, the
 * contents of input fields): removed from every message before the general rules apply.
 * The event is `unknown`: it is read defensively, whatever shape the SDK (or a hostile payload) gives it.
 */
export function scrubEvent(input: unknown, { userId = null, typed = [] }: { userId?: string | null, typed?: ReadonlyArray<string | null> } = {}): ScrubbedEvent | null {
  const say = (value: unknown, limit?: number) => scrubText(redact(typeof value === 'string' ? value : String(value ?? ''), typed), limit);
  if (!input || typeof input !== 'object') return null;
  const event = rec(input);
  const rawValues = rec(event.exception).values;
  const values = Array.isArray(rawValues) ? (rawValues.slice(0, 5) as unknown[]) : [];
  const framesOf = (value: unknown): unknown[] => { const frames = rec(rec(value).stacktrace).frames; return Array.isArray(frames) ? (frames as unknown[]) : []; };
  const frames = values.flatMap(framesOf);
  if (frames.some((frame) => EXTENSION.test(String(rec(frame).filename ?? '')) || EXTENSION.test(String(rec(frame).abs_path ?? '')))) return null;
  const out: Partial<ScrubbedEvent> = {}; // `tags` and `sdk` are always set below, in the original key order
  for (const key of ['event_id', 'platform', 'release', 'environment', 'dist', 'type', 'logger'] as const) { const text = event[key]; if (typeof text === 'string') out[key] = text.slice(0, 100); }
  for (const key of ['timestamp', 'start_timestamp'] as const) { const at = event[key]; if (Number.isFinite(at) || typeof at === 'string') out[key] = at as number | string; }
  if (typeof event.level === 'string' && LEVELS.includes(event.level)) out.level = event.level;
  if (typeof event.transaction === 'string') out.transaction = scrubText(stripUrl(event.transaction), 120);
  const message = rec(event.message);
  if (typeof event.message === 'string') out.message = say(event.message);
  else if (event.message && typeof event.message === 'object' && typeof message.formatted === 'string') out.message = say(message.formatted);
  if (Array.isArray(event.fingerprint)) out.fingerprint = (event.fingerprint as unknown[]).slice(0, 6).map((part) => scrubText(part, 80));
  if (values.length) {
    out.exception = { values: values.map((raw): ScrubbedException => {
      const value = rec(raw), mechanism = rec(value.mechanism), stack = rec(value.stacktrace);
      return {
        type: scrubText(value.type ?? 'Error', 80), value: say(value.value ?? ''),
        ...(value.mechanism && typeof value.mechanism === 'object' ? { mechanism: { type: scrubText(mechanism.type ?? 'generic', 40), handled: mechanism.handled !== false } } : {}),
        ...(Array.isArray(stack.frames) ? { stacktrace: { frames: (stack.frames as unknown[]).slice(-50).map(scrubFrame).filter((frame): frame is ScrubbedFrame => Boolean(frame)) } } : {}),
      };
    }) };
  }
  out.tags = scrubProps(event.tags);
  const extra = scrubProps(event.extra);
  if (Object.keys(extra).length) out.extra = extra;
  const contexts: Record<string, Record<string, SafeValue>> = {};
  for (const key of CONTEXTS) {
    const context = rec(event.contexts)[key];
    if (!context || typeof context !== 'object') continue;
    // The trace context is made of ids Sentry generated itself (hex, not UUIDs) and words.
    contexts[key] = key === 'trace' ? Object.fromEntries(Object.entries(context).filter((entry): entry is [string, string] => ['trace_id', 'span_id', 'parent_span_id', 'op', 'status'].includes(entry[0]) && typeof entry[1] === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(entry[1]))) : scrubProps(context);
  }
  if (Object.keys(contexts).length) out.contexts = contexts;
  if (isUuid(userId)) out.user = { id: userId };
  if (event.request && typeof event.request === 'object') {
    const request = rec(event.request), agent = rec(request.headers)['User-Agent'];
    out.request = { ...(typeof request.url === 'string' ? { url: stripUrl(request.url) } : {}), ...(typeof request.method === 'string' ? { method: request.method.slice(0, 10) } : {}),
      ...(typeof agent === 'string' ? { headers: { 'User-Agent': agent.slice(0, 300) } } : {}) };
  }
  if (Array.isArray(event.breadcrumbs)) {
    out.breadcrumbs = (event.breadcrumbs as unknown[]).filter((raw) => { const crumb = rec(raw); return Boolean(raw) && typeof crumb.category === 'string' && BREADCRUMB_CATEGORIES.includes(crumb.category); }).slice(-30)
      .map((raw): ScrubbedBreadcrumb => { const crumb = rec(raw); return { category: String(crumb.category), ...(Number.isFinite(crumb.timestamp) ? { timestamp: crumb.timestamp as number } : {}), ...(typeof crumb.level === 'string' && LEVELS.includes(crumb.level) ? { level: crumb.level } : {}), data: scrubProps(crumb.data) }; });
  }
  // Source maps are matched by these build ids; they describe the bundle, not the player.
  const images = rec(event.debug_meta).images;
  if (Array.isArray(images)) {
    out.debug_meta = { images: (images as unknown[]).slice(0, 200).filter((image) => image && typeof image === 'object')
      .map((raw): ScrubbedImage => { const image = rec(raw); return { type: String(image.type ?? '').slice(0, 20), ...(typeof image.code_file === 'string' ? { code_file: stripUrl(image.code_file) } : {}), ...(typeof image.debug_id === 'string' && /^[0-9a-f-]{32,36}$/i.test(image.debug_id) ? { debug_id: image.debug_id } : {}) }; }) };
  }
  // Sentry is told, on every event, never to work out an IP address for it.
  const sdk = rec(event.sdk);
  out.sdk = { name: String(sdk.name ?? 'allworld').slice(0, 60), version: String(sdk.version ?? '1').slice(0, 30), settings: { infer_ip: 'never' } };
  if (Array.isArray(event.spans)) out.spans = [];
  return out as ScrubbedEvent;
}
