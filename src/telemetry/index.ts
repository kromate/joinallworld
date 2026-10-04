/**
 * TELEMETRY FACADE — the one thing the game talks to. Error monitoring (Sentry) and product
 * analytics (PostHog) sit behind it. This file is all of telemetry that is in the first download,
 * and it is deliberately tiny: it only remembers calls.
 *
 *   import { track, screen, identify, setGroup, captureError, setConsent } from './telemetry/index.ts';
 *   track('activity_completed', { activity_id: 'jog', venue_id: 'park' });
 *
 * Or, without importing anything (for code on another branch):
 *   window.dispatchEvent(new CustomEvent('jaw:track', { detail: { name: 'share_card_created', props: { kind: 'house' } } }));
 *   window.dispatchEvent(new CustomEvent('jaw:age', { detail: { age: 'minor' } }));   // the age question was answered: analytics goes off
 *   window.dispatchEvent(new CustomEvent('jaw:privacy'));   // open "What we collect" and the choice (Settings does)
 *
 * Every function is safe to call anywhere, at any time, with anything: it never throws, and it
 * does nothing when telemetry is off or the player has not accepted analytics.
 *
 * OFF UNLESS CONFIGURED. Until the first scene has been drawn nothing happens: calls are kept in a
 * bounded in-memory list (and errors thrown before any code ran, in the page's own small buffer —
 * index.html). Then the game's OWN server is asked once what is configured
 * (GET /api/telemetry/config). If it says nothing is — or the request fails — the list is thrown
 * away, the listeners are removed and that is the end: no other telemetry code is downloaded, no
 * SDK runs, no request goes to either service. Only if it is configured is ./core.ts fetched and
 * the kept calls replayed into it, each at the time it was made; core.ts decides the rest
 * (development hosts, consent, which SDK may load).
 *
 * The rules are in ./policy.ts, the events in ./events.ts, the words shown to players in
 * ./what-we-collect.ts and the operator's side in SECURITY.md ("Telemetry").
 */
export const CALL_LIMIT = 300;

// Named as types only (inline `import()` types): the facade has no static import, so it stays in the entry chunk alone.
type Core = import('./core.ts').Core;
type CoreState = import('./core.ts').CoreState;
type TelemetryWindow = import('./core.ts').TelemetryWindow;
/** The names of the core's methods (not its getters). */
type CoreMethod = { [K in keyof Core]: Core[K] extends (...args: never[]) => unknown ? K : never }[keyof Core];
/** The part of the game's client model that telemetry reads, taken when a state is accepted. */
export interface ClientSnapshot { session?: { id?: string } | null; cityId?: unknown; storage?: unknown; serverNow(): number }
/** The result of a game action, as far as telemetry looks at it. */
export interface ActionResult { ok?: unknown; code?: unknown }

/** What the facade is given, injectable for tests. */
export interface TelemetryEnv {
  window?: TelemetryWindow;
  now?: () => number;
  loadCore?: () => Promise<{ createCore: typeof import('./core.ts').createCore }>;
  loadSheet?: () => Promise<{ showConsent: typeof import('./consent-ui.ts').showConsent }>;
}

export function createTelemetry({ window: win = globalThis.window as TelemetryWindow, now = Date.now, loadCore = () => import('./core.ts'), loadSheet = () => import('./consent-ui.ts') }: TelemetryEnv = {}) {
  /** Kept calls: [method, args, wall-clock time]. The first ones matter most (landed, named), so a full list refuses new ones. */
  const calls: Array<[method: string, args: unknown[], at: number]> = [];
  let core: Core | null = null, off = false, started = false;
  const perf = () => { try { return win.performance.now(); } catch { return undefined; } };
  const send = (method: string, ...args: unknown[]): unknown => {
    try {
      if (off) return undefined;
      if (core) return (core as unknown as Record<string, ((...args: unknown[]) => unknown) | undefined>)[method]?.(...args);
      if (calls.length < CALL_LIMIT) calls.push([method, args, now()]);
    } catch { /* telemetry never reaches the game as an error */ }
    return undefined;
  };
  /** The public function for one core method: same parameters, same result (nothing, while the core is not here). */
  const forward = <M extends CoreMethod>(method: M) => (...args: Parameters<Core[M]>) => send(method, ...args) as ReturnType<Core[M]> | undefined;
  const onTrack = (event: Event) => send('track', (event as CustomEvent<{ name?: unknown, props?: unknown } | undefined>)?.detail?.name, (event as CustomEvent<{ name?: unknown, props?: unknown } | undefined>)?.detail?.props);
  /** The age question was answered somewhere in the game ('jaw:age' { age: 'adult' | 'minor' }): one stored answer, heard here. */
  const onAge = (event: Event) => send('age', (event as CustomEvent<{ age?: unknown } | undefined>)?.detail?.age);

  function stop() {
    off = true; calls.length = 0;
    try {
      win.removeEventListener('jaw:track', onTrack); win.removeEventListener('jaw:age', onAge);
      const handler = win.__jawErrorHandler;
      if (handler) { win.removeEventListener('error', handler); win.removeEventListener('unhandledrejection', handler); }
      win.__jawErrors = []; win.__jawErrorHandler = null;
    } catch { /* not a browser */ }
  }
  /** Ask the game's own server what is configured; fetch the rest only if something is. */
  async function start() {
    if (started) return;
    started = true;
    try {
      const response = await win.fetch('/api/telemetry/config', { headers: { Accept: 'application/json' } });
      const config: import('./policy.ts').ClientConfig | null = response.ok ? await response.json() : null;
      if (!config || config.enabled !== true) { stop(); return; }
      const made = (await loadCore()).createCore({ config, window: win });
      if (made.mode !== 'on') { stop(); return; } // a development host without TELEMETRY_DEBUG=1
      made.replay(calls.splice(0));
      core = made;
    } catch { stop(); }
  }
  /** Settings → "Analytics and error reports": the sheet says what is true, also when everything is off. */
  async function privacy() {
    try {
      await start();
      if (core) core.openPrivacy();
      else (await loadSheet()).showConsent({ document: win.document, source: 'settings', state: { analytics: false, errors: false } });
    } catch { /* the sheet could not load */ }
  }
  try { win.addEventListener('jaw:track', onTrack); win.addEventListener('jaw:age', onAge); win.addEventListener('jaw:privacy', privacy); } catch { /* not a browser (tests) */ }

  return {
    // ---- the public facade ----------------------------------------------------------------------
    /** One analytics event. Names and properties: src/telemetry/events.ts. */
    track: forward('track'),
    /** The screen in front changed. */
    screen: forward('screen'),
    /** `publicId` is the session's PUBLIC id — never the cookie. `traits.under18: true` switches analytics off. */
    identify: forward('identify'),
    /** A coarse group, e.g. setGroup('lga', 'ikeja'). */
    setGroup: forward('setGroup'),
    /** An error for error monitoring, with flat context (ids and codes only). */
    captureError: forward('captureError'),
    /** 'granted' | 'denied' (also true/false, 'accept'/'reject'). Remembered on this device. */
    setConsent: forward('setConsent'),
    // ---- for the entry (src/life-main.js) ---------------------------------------------------------
    needName: forward('needName'),
    session: forward('session'),
    /** After every accepted server state. Only what telemetry needs of the client model is kept, read now. */
    state(next: CoreState | null | undefined, previous: CoreState | null | undefined, client: ClientSnapshot) { try { if (!off) send('state', next, previous, { session: client.session, cityId: client.cityId, storage: client.storage, now: client.serverNow() }); } catch { /* ignore */ } },
    /** Wrap one game action: `const done = telemetry.action(type); … done(result)`. */
    action(type?: unknown) {
      const from = perf();
      send('pending', type);
      return (result?: ActionResult | null) => { send('actionDone', type, (perf() ?? NaN) - (from ?? NaN), result && { ok: result.ok, code: result.code }); };
    },
    link: forward('link'),
    hudReady() { send('hudReady', perf()); },
    /** The first scene was drawn (or could not be): from here on telemetry may start, when the browser is idle. */
    sceneReady(ok?: unknown, canvas?: { getContext(kind: string): unknown } | null) {
      send('sceneReady', ok, canvas, perf());
      try {
        const idle = win.requestIdleCallback as Window['requestIdleCallback'] | undefined; // not in every browser (Safari)
        if (idle) idle(() => { void start(); }, { timeout: 3000 }); else win.setTimeout(() => { void start(); }, 1);
      } catch { /* not a browser */ }
    },
    chunkFailed: forward('chunkFailed'),
    start, openPrivacy: privacy,
    /** For tests and diagnostics. */
    get status() { return off ? 'off' : core ? 'on' : 'pending'; },
    get kept() { return calls.length; },
  };
}

/** The game's one instance. */
export const telemetry = createTelemetry();
export const { track, screen, identify, setGroup, captureError, setConsent } = telemetry;
