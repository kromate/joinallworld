/**
 * SERVER TELEMETRY — error monitoring (Sentry) and product analytics (PostHog) for the game server.
 *
 *   import { track, captureError } from './telemetry/index.ts';
 *   track(session.publicId, 'house_knock_sent');            // analytics, for a player who accepted
 *   captureError(error, { route: 'POST /api/action' });     // an error report, no personal data
 *
 * Both are safe to call anywhere: they return at once, never throw and never delay a request.
 * They only append to a bounded queue; server/telemetry/transport.ts sends it in the background
 * with plain fetch (no SDK, so the Cloudflare Worker can use the same code) and flushes on shutdown.
 *
 * OFF UNLESS CONFIGURED (server/telemetry/config.ts). With nothing set, every function here
 * returns immediately, no timer is started and no request is ever made.
 *
 * THE SAME PRIVACY RULES AS THE BROWSER
 *   analytics  only for a player whose browser has said Accept (POST /api/telemetry/consent, kept
 *              in memory for this process; it is told again on every page load). No consent on
 *              record → nothing is queued. Properties pass the same scrubber and catalogue check,
 *              the distinct id is the PUBLIC id, and GeoIP lookup is disabled per event.
 *   errors     rebuilt by scrubEvent from allowed fields: a route TEMPLATE (never a URL), an action
 *              type and a result code — no body, header, cookie, name, chat text or position.
 *
 * The module-level track/captureError talk to the instance the host installed with
 * useTelemetry(); until then (and in tests that do not install one) they do nothing.
 */
import { readTelemetryConfig, publicConfig, TRACE_SAMPLE_RATE } from './config.ts';
import { createTransport, errorEvent, eventId, spanId } from './transport.ts';
import { routeEvents, replyEvents, createCoPresence, createVoice } from './instrument.ts';
import { scrubProps, isEventName, isUuid, stringsOf } from '../../src/telemetry/scrub.ts';
import { checkProps } from '../../src/telemetry/events.ts';
import { durationBucket } from '../../src/telemetry/policy.ts';
import type { Recorded, VoiceSocket } from './instrument.ts';
import type { TransportFetch } from './transport.ts';
import type { RouteContext } from '../types.ts';

/** createServerTelemetry()'s options. */
export interface ServerTelemetryOptions {
  /** process.env, or the Worker's env */
  env?: Readonly<Record<string, unknown>>
  buildId?: string | undefined
  fetch?: TransportFetch | undefined
  /** Wall-clock time for event timestamps. */
  now?: () => number
  random?: () => number
  log?: (line: string) => void
  flushMs?: number | undefined
}
/** What the host reports about an answered API request. */
export interface HttpReport { method: string; route: string; status: number; ms: number; publicId?: unknown; body?: unknown; action?: { type?: unknown; code?: unknown } | null | undefined }
/** A socket as the telemetry looks at it. */
type TelemetrySocket = VoiceSocket
const field = (value: unknown, key: string): unknown => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined);

const CONSENT_LIMIT = 20000;
const REPEAT_WINDOW_MS = 60000;
const REPEAT_LIMIT = 5;

export function createServerTelemetry({ env = {}, buildId, fetch: request, now = Date.now, random = Math.random, log = () => {}, flushMs }: ServerTelemetryOptions = {}) {
  const config = readTelemetryConfig(env, { buildId });
  for (const problem of config.problems) { try { log(`Telemetry: ${problem}`); } catch { /* ignore */ } }
  const transport = createTransport({ posthog: config.active ? config.posthog : null, sentry: config.active ? config.sentryServer : null, fetch: request, now, log, ...(flushMs ? { flushMs } : {}) });
  const analyticsOn = config.active && Boolean(config.posthog), errorsOn = config.active && Boolean(config.sentryServer);
  /** Public ids whose browser said Accept. Insertion-ordered, so the oldest is the one forgotten when full. */
  const accepted = new Set<string>();
  const repeats = new Map<string, { start: number; count: number }>();
  const chats = new Set<unknown>();
  const presence = createCoPresence(), voice = createVoice({ now });
  let lastBeat: number | null = null;
  const safe = <A extends unknown[], R>(fn: (...args: A) => R, fallback?: R): ((...args: A) => R) => (...args) => { try { return fn(...args); } catch { return fallback as R; } };

  /** At most REPEAT_LIMIT reports of the same thing a minute: a failing dependency must not flood Sentry. */
  function allowReport(key: string): boolean {
    const time = now();
    if (repeats.size > 500) for (const [id, entry] of repeats) if (time - entry.start >= REPEAT_WINDOW_MS) repeats.delete(id);
    const entry = repeats.get(key);
    if (!entry || time - entry.start >= REPEAT_WINDOW_MS) { repeats.set(key, { start: time, count: 1 }); return true; }
    return ++entry.count <= REPEAT_LIMIT;
  }
  const base = () => ({ release: config.release, environment: config.env, now: now() });

  const track = safe((publicId: unknown, name: unknown, props?: unknown): void => {
    if (!analyticsOn || !isUuid(publicId) || !accepted.has(publicId) || !isEventName(name)) return;
    transport.analytics({ event: name, distinct_id: publicId, timestamp: new Date(now()).toISOString(),
      properties: { ...checkProps(name, props, scrubProps), $geoip_disable: true, $lib: 'allworld-server', app: 'allworld', environment: config.env, release: config.release, source: 'server' } });
  });
  const record = (events: Recorded[]): void => { for (const event of events) { const props = event.props; track(event.to, event.name, props && 'seconds' in props ? { ...props, duration: durationBucket(Number(props.seconds)) } : props); } };

  const captureError = safe((error: unknown, context: unknown = {}): void => {
    if (!errorsOn) return;
    // `sent`: what the player sent with the failing request (a body, a socket message). It is never
    // reported; it is only used to take the player's own words out of the error message.
    const { level, publicId, sent, ...tags }: Record<string, unknown> = context && typeof context === 'object' ? context as Record<string, unknown> : {};
    const event = errorEvent(error, { ...base(), level: typeof level === 'string' ? level : 'error', tags: scrubProps(tags) });
    const key = `${event.exception?.values?.[0]?.type ?? 'message'}|${String(event.exception?.values?.[0]?.value ?? event.message).slice(0, 80)}|${tags.route ?? ''}`;
    if (allowReport(key)) transport.error(event, isUuid(publicId) ? publicId : null, stringsOf(sent));
  });
  /** A named operational event (not an exception): 'server_started', 'store_write_failed'. */
  const captureMessage = safe((name: unknown, level: string = 'info', tags: Record<string, unknown> = {}): void => {
    if (!errorsOn || !allowReport(`message|${name}`)) return;
    transport.error({ ...errorEvent(String(name), { ...base(), level, tags: scrubProps(tags) }), fingerprint: [String(name)] }, null);
  });


  /** Who is in which room right now → co-presence minutes and house visits. Called on every heartbeat. */
  const beat = safe((sockets: Iterable<TelemetrySocket & { room: string | null }>): void => {
    if (!analyticsOn) return;
    const time = now(), seconds = lastBeat === null ? 0 : Math.min(60, Math.max(0, (time - lastBeat) / 1000));
    lastBeat = time;
    if (!accepted.size && !presence.size) return;
    const rooms = new Map<string, Set<string>>();
    for (const ws of sockets) {
      if (!ws.room || typeof ws.session?.id !== 'string') continue;
      if (!rooms.has(ws.room)) rooms.set(ws.room, new Set());
      rooms.get(ws.room)!.add(ws.session.id);
    }
    record(presence.beat(rooms, seconds));
  });

  const api = {
    enabled: config.active,
    config,
    /** What GET /api/telemetry/config answers. */
    publicConfig: () => publicConfig(config),
    track, captureError, captureMessage,
    /** The player's browser said Accept (true) or Reject (false). */
    consent: safe((publicId: unknown, granted: unknown): boolean => {
      if (!analyticsOn || !isUuid(publicId)) return false;
      accepted.delete(publicId);
      if (granted !== true) return false;
      accepted.add(publicId);
      if (accepted.size > CONSENT_LIMIT) accepted.delete(accepted.values().next().value!);
      return true;
    }, false),
    hasConsent: (publicId: string) => accepted.has(publicId),

    // ---- what the host reports (server/server.ts) ---------------------------------------------------
    /** The release/health marker: one info event when the server starts taking requests. */
    started: safe((): void => captureMessage('server_started', 'info', { node: globalThis.process?.version })),
    /**
     * An API request was answered. `route` is the registered template ("/api/social/house/:host").
     * A slow one may be sampled as a transaction; a social result becomes analytics events.
     */
    http: safe(({ method, route, status, ms, publicId, body, action }: HttpReport): void => {
      if (!config.active) return;
      if (analyticsOn && status < 300 && publicId) record(routeEvents(method, route, publicId, body));
      if (errorsOn && ms >= config.slowMs && random() < TRACE_SAMPLE_RATE) {
        const end = now() / 1000;
        transport.error({ type: 'transaction', event_id: eventId(), platform: 'node', transaction: `${method} ${route}`, start_timestamp: end - ms / 1000, timestamp: end, release: config.release, environment: config.env,
          contexts: { trace: { trace_id: eventId(), span_id: spanId(), op: 'http.server', status: status < 500 ? 'ok' : 'internal_error' } },
          tags: scrubProps({ route: `${method} ${route}`, status, ...(action?.type ? { action_type: action.type } : {}), ...(action?.code ? { result_code: action.code } : {}) }), spans: [] }, null);
      }
    }),
    /** An API request failed. Known refusals (4xx with a code) are not errors; 5xx and unknown throws are. */
    httpFailed: safe((error: unknown, { method, route, status, code, body, publicId }: { method: string; route?: string | null | undefined; status: number; code?: string | undefined; body?: unknown; publicId?: unknown }): void => {
      if (!errorsOn || status < 500) return;
      const tags: Record<string, unknown> = { route: `${method} ${route || 'unmatched'}`, status, ...(code ? { result_code: code } : {}), ...(typeof field(body, 'type') === 'string' ? { action_type: field(body, 'type') } : {}) };
      if (code === 'storage_unavailable') captureMessage('store_write_failed', 'error', tags);
      else captureError(error instanceof Error ? error : new Error(`HTTP ${status} ${code || 'internal_error'}`), { ...tags, publicId, sent: body });
    }),
    /** A socket message was handled without an error. */
    socketIn: safe((ws: TelemetrySocket, message: unknown): void => {
      if (!analyticsOn) return;
      if (field(message, 'type') === 'voice-state') record(voice.state(ws, field(message, 'enabled')));
      else if (field(message, 'type') === 'join') record(voice.leave(ws));
    }),
    /** The server sent `message` to `ws`. Only replies to that player's own requests are looked at. */
    socketOut: safe((ws: TelemetrySocket, message: unknown): void => {
      if (!analyticsOn || !message || !accepted.size) return;
      const id = ws?.session?.id;
      if (field(message, 'type') === 'chat') {
        // The sender's own copy of an accepted line: counted once however many sockets or resends there are.
        const chatId = field(message, 'id');
        if (field(field(message, 'from'), 'id') !== id || chats.has(chatId)) return;
        chats.add(chatId); if (chats.size > 2000) chats.delete(chats.values().next().value);
        track(id, 'chat_message_sent', { venue_id: String(ws.room ?? '').split(':')[1] });
      } else record(replyEvents(id, message));
    }),
    /** A socket message failed: a machine code (a refusal) is counted, anything else is an error report. */
    socketFailed: safe((ws: TelemetrySocket, message: unknown, text: unknown, coded: unknown, error: unknown): void => {
      const type = field(message, 'type'), kind = typeof type === 'string' && /^[a-z][a-z0-9-]{1,39}$/.test(type) ? type : 'unknown';
      if (coded) track(ws?.session?.id, 'ws_error', { message_type: kind, code: text });
      else captureError(error instanceof Error ? error : new Error('Socket message failed'), { route: `WS ${kind}`, publicId: ws?.session?.id, sent: message });
    }),
    socketClosed: safe((ws: TelemetrySocket): void => { if (analyticsOn) record(voice.leave(ws)); }),
    /** Who is in which room right now → co-presence minutes and house visits. Called on every heartbeat. */
    beat,
    /** Hook the in-process events the host raises (ctx.on). */
    attach: safe((ctx: RouteContext): void => { if (config.active) ctx.on?.('heartbeat', () => beat(ctx.core?.sockets?.() ?? [])); }),
    stats: transport.stats,
    get pending() { return transport.pending; },
    flush: () => transport.flush(),
    /** Shutdown: close what is still running, then send everything. Never rejects. */
    async close() { try { record(presence.end()); } catch { /* nothing to close */ } await transport.close(); },
  };
  return api;
}

/** The instance the module-level functions use. A disabled one until the host installs its own. */
export type ServerTelemetry = ReturnType<typeof createServerTelemetry>;
let current: ServerTelemetry = createServerTelemetry();
export function useTelemetry(instance?: ServerTelemetry | null): ServerTelemetry { current = instance || createServerTelemetry(); return current; }
export const track = (publicId: unknown, name: unknown, props?: unknown): void => current.track(publicId, name, props);
export const captureError = (error: unknown, context?: unknown): void => current.captureError(error, context);
