/**
 * How server telemetry leaves the process: plain `fetch` to PostHog's batch capture API and to
 * Sentry's envelope endpoint. No SDK and no Node-only API, so the same file runs in the Cloudflare
 * Worker (the Node SDKs of both services do not).
 *
 * NEVER IN THE WAY OF A PLAYER. Callers only append to an in-memory queue and return at once.
 * Sending happens later, on a timer, and nothing ever awaits it on a request path:
 *   - the queues are bounded (oldest dropped first, and counted) so a dead endpoint cannot grow memory
 *   - a send has a timeout, its failure is swallowed (one log line a minute at most) and its
 *     events are dropped rather than retried for ever
 *   - flush() is for shutdown (and for the Worker's ctx.waitUntil): it resolves when the queues
 *     have been sent or have failed, and it never rejects
 */
import { scrubEvent } from '../../src/telemetry/scrub.js';

export const ANALYTICS_QUEUE_LIMIT = 1000;
export const ERROR_QUEUE_LIMIT = 100;
export const BATCH_SIZE = 100;
export const FLUSH_MS = 5000;
const SEND_TIMEOUT_MS = 5000;

const hex = (length) => { const bytes = new Uint8Array(length / 2); globalThis.crypto.getRandomValues(bytes); return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(''); };
export const eventId = () => hex(32);
export const spanId = () => hex(16);

/** A stack's file as a path inside the project (`app:///server/server.js`): no machine paths leave. */
function projectPath(file) {
  const text = String(file).replace(/^file:\/\//, '');
  if (text.startsWith('node:')) return text;
  const module = text.lastIndexOf('/node_modules/');
  if (module >= 0) return `app:///${text.slice(module + 1)}`;
  const match = /\/(server|src|deploy|scripts)\/[^/].*$/.exec(text);
  return match ? `app://${match[0]}` : `app:///${text.split('/').pop()}`;
}

/** V8 stack text → Sentry frames (oldest call first). */
export function framesOf(stack) {
  const frames = [];
  for (const line of String(stack ?? '').split('\n').slice(1, 60)) {
    const match = /^\s*at (?:(.+?) \()?((?:file:\/\/|node:|\/)[^()]*?):(\d+):(\d+)\)?$/.exec(line);
    if (!match) continue;
    const filename = projectPath(match[2]);
    frames.push({ function: match[1] || '<anonymous>', filename, lineno: Number(match[3]), colno: Number(match[4]), in_app: !filename.startsWith('node:') && !filename.includes('node_modules/') });
  }
  return frames.reverse();
}

/** A Sentry event for a thrown value, before scrubbing. */
export function errorEvent(error, { level = 'error', tags = {}, extra = {}, release, environment, now = Date.now() } = {}) {
  const thrown = error instanceof Error ? error : null;
  const base = { event_id: eventId(), timestamp: now / 1000, platform: 'node', level, release, environment, tags, extra, sdk: { name: 'allworld.server', version: '1' } };
  if (!thrown) return { ...base, message: typeof error === 'string' ? error : 'Non-error thrown' };
  return { ...base, exception: { values: [{ type: thrown.name || 'Error', value: String(thrown.message ?? ''), mechanism: { type: 'generic', handled: true }, stacktrace: { frames: framesOf(thrown.stack) } }] } };
}

/** The text of one Sentry envelope carrying one event or transaction. */
export function envelope(event, dsn, now = Date.now()) {
  const body = JSON.stringify(event);
  return `${JSON.stringify({ event_id: event.event_id, sent_at: new Date(now).toISOString(), dsn })}\n${JSON.stringify({ type: event.type === 'transaction' ? 'transaction' : 'event' })}\n${body}\n`;
}

/**
 * @param {object} options
 * @param {{ key: string, host: string } | null} options.posthog
 * @param {{ dsn: string, key: string, endpoint: string } | null} options.sentry
 * @param {typeof fetch} [options.fetch]
 * @param {() => number} [options.now]
 * @param {(line: string) => void} [options.log]
 */
export function createTransport({ posthog = null, sentry = null, fetch: request = globalThis.fetch?.bind(globalThis), now = Date.now, log = () => {},
  setTimeout: later = globalThis.setTimeout, clearTimeout: cancel = globalThis.clearTimeout, flushMs = FLUSH_MS } = {}) {
  const analytics = [], errors = [];
  const stats = { sent: 0, dropped: 0, failed: 0 };
  let timer = null, sending = null, lastLog = -Infinity;

  function complain(what, error) {
    stats.failed += 1;
    if (now() - lastLog < 60000) return;
    lastLog = now();
    try { log(`Telemetry: ${what} could not be sent (${String(error?.name || error?.message || error).slice(0, 80)}). Nothing is retried; the game is unaffected.`); } catch { /* a failing logger is not our problem */ }
  }
  function schedule() {
    if (timer !== null) return;
    timer = later(() => { timer = null; void flush(); }, flushMs);
    timer?.unref?.(); // never keeps the process alive
  }
  function add(queue, limit, item) {
    queue.push(item);
    if (queue.length > limit) { stats.dropped += queue.length - limit; queue.splice(0, queue.length - limit); }
    if (queue.length >= BATCH_SIZE) { if (timer !== null) { cancel(timer); timer = null; } void flush(); } else schedule();
  }
  async function post(url, body, headers) {
    const response = await request(url, { method: 'POST', headers, body, signal: globalThis.AbortSignal?.timeout?.(SEND_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }
  async function drain() {
    while (analytics.length && posthog) {
      const batch = analytics.splice(0, BATCH_SIZE);
      try { await post(`${posthog.host}/batch/`, JSON.stringify({ api_key: posthog.key, batch }), { 'Content-Type': 'application/json' }); stats.sent += batch.length; }
      catch (error) { stats.dropped += batch.length; complain('analytics', error); }
    }
    while (errors.length && sentry) {
      const event = errors.shift();
      try {
        await post(sentry.endpoint, envelope(event, sentry.dsn, now()), { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${sentry.key}, sentry_client=allworld.server/1` });
        stats.sent += 1;
      } catch (error) { stats.dropped += 1; complain('an error report', error); }
    }
  }
  /** Send what is queued. Never rejects; concurrent calls share one run. */
  function flush() {
    if (typeof request !== 'function') { analytics.length = 0; errors.length = 0; return Promise.resolve(); }
    sending ||= drain().catch(() => {}).finally(() => { sending = null; if (analytics.length || errors.length) schedule(); });
    return sending;
  }
  return {
    stats,
    get pending() { return analytics.length + errors.length; },
    /** One PostHog event: { event, distinct_id, properties, timestamp }. */
    analytics(item) { if (posthog) add(analytics, ANALYTICS_QUEUE_LIMIT, item); },
    /** One Sentry event or transaction. It is scrubbed here, so nothing unscrubbed is ever queued. */
    error(event, userId) { if (!sentry) return; const safe = scrubEvent(event, { userId }); if (safe) add(errors, ERROR_QUEUE_LIMIT, safe); },
    flush,
    async close() { if (timer !== null) { cancel(timer); timer = null; } await flush(); if (analytics.length || errors.length) await flush(); },
  };
}
