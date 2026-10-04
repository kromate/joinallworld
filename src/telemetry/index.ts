/**
 * TELEMETRY FACADE — the one thing the game talks to. Error monitoring (Sentry) and product
 * analytics (PostHog) sit behind it. This file is all of telemetry that is in the first download,
 * and it is deliberately tiny: it only remembers calls.
 *
 *   import { track, screen, identify, setGroup, captureError, setConsent } from './telemetry/index.js';
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
 * SDK runs, no request goes to either service. Only if it is configured is ./core.js fetched and
 * the kept calls replayed into it, each at the time it was made; core.js decides the rest
 * (development hosts, consent, which SDK may load).
 *
 * The rules are in ./policy.js, the events in ./events.js, the words shown to players in
 * ./what-we-collect.js and the operator's side in SECURITY.md ("Telemetry").
 */
export const CALL_LIMIT = 300;

/**
 * @param {object} [env] injectable for tests
 * @param {Window} [env.window]
 * @param {() => number} [env.now]
 * @param {() => Promise<{ createCore: Function }>} [env.loadCore]
 * @param {() => Promise<{ showConsent: Function }>} [env.loadSheet]
 */
export function createTelemetry({ window: win = globalThis.window, now = Date.now, loadCore = () => import('./core.ts'), loadSheet = () => import('./consent-ui.ts') } = {}) {
  /** Kept calls: [method, args, wall-clock time]. The first ones matter most (landed, named), so a full list refuses new ones. */
  const calls = [];
  let core = null, off = false, started = false;
  const perf = () => { try { return win.performance.now(); } catch { return undefined; } };
  const send = (method, ...args) => {
    try {
      if (off) return undefined;
      if (core) return core[method](...args);
      if (calls.length < CALL_LIMIT) calls.push([method, args, now()]);
    } catch { /* telemetry never reaches the game as an error */ }
    return undefined;
  };
  const forward = (method) => (...args) => send(method, ...args);
  const onTrack = (event) => send('track', event?.detail?.name, event?.detail?.props);
  /** The age question was answered somewhere in the game ('jaw:age' { age: 'adult' | 'minor' }): one stored answer, heard here. */
  const onAge = (event) => send('age', event?.detail?.age);

  function stop() {
    off = true; calls.length = 0;
    try {
      win.removeEventListener('jaw:track', onTrack); win.removeEventListener('jaw:age', onAge);
      win.removeEventListener('error', win.__jawErrorHandler); win.removeEventListener('unhandledrejection', win.__jawErrorHandler);
      win.__jawErrors = []; win.__jawErrorHandler = null;
    } catch { /* not a browser */ }
  }
  /** Ask the game's own server what is configured; fetch the rest only if something is. */
  async function start() {
    if (started) return;
    started = true;
    try {
      const response = await win.fetch('/api/telemetry/config', { headers: { Accept: 'application/json' } });
      const config = response.ok ? await response.json() : null;
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
    /** One analytics event. Names and properties: src/telemetry/events.js. */
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
    state(next, previous, client) { try { if (!off) send('state', next, previous, { session: client.session, cityId: client.cityId, storage: client.storage, now: client.serverNow() }); } catch { /* ignore */ } },
    /** Wrap one game action: `const done = telemetry.action(type); … done(result)`. */
    action(type) {
      const from = perf();
      send('pending', type);
      return (result) => { send('actionDone', type, perf() - from, result && { ok: result.ok, code: result.code }); };
    },
    link: forward('link'),
    hudReady() { send('hudReady', perf()); },
    /** The first scene was drawn (or could not be): from here on telemetry may start, when the browser is idle. */
    sceneReady(ok, canvas) {
      send('sceneReady', ok, canvas, perf());
      try { (win.requestIdleCallback || win.setTimeout)(() => { void start(); }, win.requestIdleCallback ? { timeout: 3000 } : 1); } catch { /* not a browser */ }
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
