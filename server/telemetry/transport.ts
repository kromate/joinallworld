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
import { scrubEvent } from '../../src/telemetry/scrub.ts';
import type { ScrubbedEvent } from '../../src/telemetry/scrub.ts';
import type { ParsedDsn } from './config.ts';

/** The part of `fetch` the transport uses: tests and the Worker pass their own. */
export type TransportFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal | undefined }) => Promise<{ ok: boolean; status: number }>;
export interface StackFrame { function: string; filename: string; lineno: number; colno: number; in_app: boolean }
/** A Sentry event for a thrown value, before scrubbing. */
export interface ErrorEvent {
  event_id: string
  timestamp: number
  platform: string
  level: string
  release: string | undefined
  environment: string | null | undefined
  tags: Record<string, unknown>
  extra: Record<string, unknown>
  sdk: { name: string; version: string }
  message?: string
  exception?: { values: { type: string; value: string; mechanism: { type: string; handled: boolean }; stacktrace: { frames: StackFrame[] } }[] }
}
export interface AnalyticsItem { event: string; distinct_id: string; timestamp: string; properties: Record<string, unknown> }
export interface TransportOptions {
  posthog?: { key: string; host: string } | null
  sentry?: ParsedDsn | null
  fetch?: TransportFetch | undefined
  now?: () => number
  log?: (line: string) => void
  setTimeout?: typeof globalThis.setTimeout
  clearTimeout?: typeof globalThis.clearTimeout
  flushMs?: number
}
const nameOf = (value: unknown, key: 'name' | 'message'): unknown => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined);

export const ANALYTICS_QUEUE_LIMIT = 1000;
export const ERROR_QUEUE_LIMIT = 100;
export const BATCH_SIZE = 100;
export const FLUSH_MS = 5000;
const SEND_TIMEOUT_MS = 5000;

const hex = (length: number): string => { const bytes = new Uint8Array(length / 2); globalThis.crypto.getRandomValues(bytes); return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(''); };
export const eventId = () => hex(32);
export const spanId = () => hex(16);

/** A stack's file as a path inside the project (`app:///server/server.ts`): no machine paths leave. */
function projectPath(file: unknown): string {
  const text = String(file).replace(/^file:\/\//, '');
  if (text.startsWith('node:')) return text;
  const module = text.lastIndexOf('/node_modules/');
  if (module >= 0) return `app:///${text.slice(module + 1)}`;
  const match = /\/(server|src|deploy|scripts)\/[^/].*$/.exec(text);
  return match ? `app://${match[0]}` : `app:///${text.split('/').pop()}`;
}

/** V8 stack text → Sentry frames (oldest call first). */
export function framesOf(stack: unknown): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const line of String(stack ?? '').split('\n').slice(1, 60)) {
    const match = /^\s*at (?:(.+?) \()?((?:file:\/\/|node:|\/)[^()]*?):(\d+):(\d+)\)?$/.exec(line);
    if (!match) continue;
    const filename = projectPath(match[2]);
    frames.push({ function: match[1] || '<anonymous>', filename, lineno: Number(match[3]), colno: Number(match[4]), in_app: !filename.startsWith('node:') && !filename.includes('node_modules/') });
  }
  return frames.reverse();
}

/** A Sentry event for a thrown value, before scrubbing. */
export function errorEvent(error: unknown, { level = 'error', tags = {}, extra = {}, release, environment, now = Date.now() }: { level?: string; tags?: Record<string, unknown>; extra?: Record<string, unknown>; release?: string | undefined; environment?: string | null | undefined; now?: number } = {}): ErrorEvent {
  const thrown = error instanceof Error ? error : null;
  const base: ErrorEvent = { event_id: eventId(), timestamp: now / 1000, platform: 'node', level, release, environment, tags, extra, sdk: { name: 'allworld.server', version: '1' } };
  if (!thrown) return { ...base, message: typeof error === 'string' ? error : 'Non-error thrown' };
  return { ...base, exception: { values: [{ type: thrown.name || 'Error', value: String(thrown.message ?? ''), mechanism: { type: 'generic', handled: true }, stacktrace: { frames: framesOf(thrown.stack) } }] } };
}

/** The text of one Sentry envelope carrying one event or transaction. */
export function envelope(event: ScrubbedEvent, dsn: string, now = Date.now()): string {
  const body = JSON.stringify(event);
  return `${JSON.stringify({ event_id: event.event_id, sent_at: new Date(now).toISOString(), dsn })}\n${JSON.stringify({ type: event.type === 'transaction' ? 'transaction' : 'event' })}\n${body}\n`;
}

/** Queues and sends telemetry; see the header. Everything is optional: with no destination nothing is queued. */
export function createTransport({ posthog = null, sentry = null, fetch: request = globalThis.fetch?.bind(globalThis) as TransportFetch | undefined, now = Date.now, log = () => {},
  setTimeout: later = globalThis.setTimeout, clearTimeout: cancel = globalThis.clearTimeout, flushMs = FLUSH_MS }: TransportOptions = {}) {
  const analytics: AnalyticsItem[] = [], errors: ScrubbedEvent[] = [];
  const stats = { sent: 0, dropped: 0, failed: 0 };
  let timer: ReturnType<typeof setTimeout> | null = null, sending: Promise<void> | null = null, lastLog = -Infinity;

  function complain(what: string, error: unknown): void {
    stats.failed += 1;
    if (now() - lastLog < 60000) return;
    lastLog = now();
    try { log(`Telemetry: ${what} could not be sent (${String(nameOf(error, 'name') || nameOf(error, 'message') || error).slice(0, 80)}). Nothing is retried; the game is unaffected.`); } catch { /* a failing logger is not our problem */ }
  }
  function schedule(): void {
    if (timer !== null) return;
    timer = later(() => { timer = null; void flush(); }, flushMs);
    timer?.unref?.(); // never keeps the process alive
  }
  function add<T>(queue: T[], limit: number, item: T): void {
    queue.push(item);
    if (queue.length > limit) { stats.dropped += queue.length - limit; queue.splice(0, queue.length - limit); }
    if (queue.length >= BATCH_SIZE) { if (timer !== null) { cancel(timer); timer = null; } void flush(); } else schedule();
  }
  async function post(url: string, body: string, headers: Record<string, string>): Promise<void> {
    const response = await request!(url, { method: 'POST', headers, body, signal: globalThis.AbortSignal?.timeout?.(SEND_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }
  async function drain(): Promise<void> {
    while (analytics.length && posthog) {
      const batch = analytics.splice(0, BATCH_SIZE);
      try { await post(`${posthog.host}/batch/`, JSON.stringify({ api_key: posthog.key, batch }), { 'Content-Type': 'application/json' }); stats.sent += batch.length; }
      catch (error) { stats.dropped += batch.length; complain('analytics', error); }
    }
    while (errors.length && sentry) {
      const event = errors.shift()!;
      try {
        await post(sentry.endpoint, envelope(event, sentry.dsn, now()), { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${sentry.key}, sentry_client=allworld.server/1` });
        stats.sent += 1;
      } catch (error) { stats.dropped += 1; complain('an error report', error); }
    }
  }
  /** Send what is queued. Never rejects; concurrent calls share one run. */
  function flush(): Promise<void> {
    if (typeof request !== 'function') { analytics.length = 0; errors.length = 0; return Promise.resolve(); }
    sending ||= drain().catch(() => {}).finally(() => { sending = null; if (analytics.length || errors.length) schedule(); });
    return sending;
  }
  return {
    stats,
    get pending() { return analytics.length + errors.length; },
    /** One PostHog event: { event, distinct_id, properties, timestamp }. */
    analytics(item: AnalyticsItem): void { if (posthog) add(analytics, ANALYTICS_QUEUE_LIMIT, item); },
    /** One Sentry event or transaction. It is scrubbed here, so nothing unscrubbed is ever queued. */
    error(event: unknown, userId: string | null, typed?: ReadonlyArray<string | null>): void { if (!sentry) return; const safe = scrubEvent(event, { userId, typed }); if (safe) add(errors, ERROR_QUEUE_LIMIT, safe); },
    flush,
    async close() { if (timer !== null) { cancel(timer); timer = null; } await flush(); if (analytics.length || errors.length) await flush(); },
  };
}
