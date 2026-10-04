/**
 * TELEMETRY CORE — everything behind the facade (./index.js) that is not an SDK. A lazy chunk:
 * the facade downloads it only after the game's own server has said telemetry is configured, and
 * then replays the calls it kept. Neither SDK is imported here; they are two further lazy chunks
 * (./sentry.js, ./posthog.js), and so is the consent sheet (./consent-ui.js).
 *
 * TWO DIFFERENT RULES (./policy.js, written for players in ./what-we-collect.js):
 *   errors     sent without asking, with no personal data: see sentry.js and scrub.js
 *   analytics  sent only after the player chose Accept on the consent sheet. Before that choice
 *              nothing is sent — events wait in memory and are sent if the answer is Accept, and
 *              discarded if it is Reject. Do Not Track and Global Privacy Control count as Reject.
 * Neither runs on a development host unless the server says TELEMETRY_DEBUG=1.
 *
 * The names and properties of the events are in ./events.js (the catalogue); the funnel is derived
 * from server states in ./funnel.js.
 */
import { clientPlan, resolveConsent, privacySignal, lagosDay, daysBetween, latencyBucket, fpsBucket } from './policy.js';
import { newMemo, landed, named, stateEvents } from './funnel.js';

export const STORAGE_KEY = 'joinallworld-telemetry-v1';
export const QUEUE_LIMIT = 200;
export const ERROR_LIMIT = 20;
const LATENCY_SAMPLE = 0.2;

/** A bounded list: when full, the oldest entry goes. */
function push(list, item, limit) { list.push(item); if (list.length > limit) list.splice(0, list.length - limit); }
const normalise = (choice) => (choice === true || choice === 'granted' || choice === 'accept' ? 'granted' : choice === false || choice === 'denied' || choice === 'reject' ? 'denied' : null);

/**
 * @param {object} env everything the core touches, injectable for tests
 * @param {import('./policy.js').ClientConfig} env.config   what GET /api/telemetry/config answered
 * @param {Window} [env.window]
 * @param {() => number} [env.now]
 * @param {() => number} [env.random]
 * @param {{ sentry: () => Promise<any>, posthog: () => Promise<any>, consent: () => Promise<any> }} [env.loaders]
 */
export function createCore({ config, window: win = globalThis.window, now: wall = Date.now, random = Math.random,
  loaders = { sentry: () => import('./sentry.js'), posthog: () => import('./posthog.js'), consent: () => import('./consent-ui.js') } }) {
  /** While the facade's kept calls are replayed, the clock reads the moment each call was made. */
  let replayAt = null;
  const now = () => replayAt ?? wall();
  const plan = clientPlan(config, win?.location?.hostname);
  /** 'on' when at least one service may run in this browser, otherwise 'off' (nothing is kept, nothing loads). */
  const mode = plan.sentry || plan.posthog ? 'on' : 'off';
  let sentry = null, posthog = null, posthogLoading = null, sheetOpen = false, asked = false, viewed = false;
  /** Analytics events and errors waiting for their SDK (or for the player's answer). */
  const events = [], errors = [], crumbs = [];
  let user = null, traits = {}, under18 = false;
  const groups = {};
  /** What is remembered on this device. Only `consent` is written before the player has accepted. */
  let saved = { consent: null, at: 0, firstSeen: null, lastDay: null, day2: false, device: newMemo(), lives: {} };
  let serverConsent = null, pending = null, baseline = true, lastCity = null, lastLink = null, lastStorage = false, hudAt = null, sceneDone = false;

  let storage = null;
  try { storage = win?.localStorage ?? null; } catch { storage = null; }
  try {
    const read = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
    if (read && typeof read === 'object') saved = { ...saved, ...read, device: { ...newMemo(), ...read.device }, lives: read.lives && typeof read.lives === 'object' ? read.lives : {} };
  } catch { /* nothing remembered */ }

  const consent = () => resolveConsent({ stored: saved.consent, signal: privacySignal(win?.navigator, win), under18 });
  function persist() {
    try {
      // Before Accept (and after Reject) the only thing kept is the choice itself.
      const keep = Object.keys(saved.lives).slice(-3);
      const body = consent() === 'granted' ? { ...saved, lives: Object.fromEntries(keep.map((id) => [id, saved.lives[id]])) } : { consent: saved.consent, at: saved.at };
      storage?.setItem(STORAGE_KEY, JSON.stringify(body));
    } catch { /* storage is off: the choice lasts for this page */ }
  }
  const memoFor = (id) => (saved.lives[id] ||= newMemo());

  /** Product analytics is possible at all: not switched off by the server, and not refused by the player. */
  const analytics = () => mode === 'on' && plan.posthog && consent() !== 'denied';

  function emit(name, props = {}, extra) {
    if (!analytics()) return;
    const item = { name, props, at: now(), ...(extra ? { extra } : {}) };
    if (posthog && consent() === 'granted') posthog.capture(item); else push(events, item, QUEUE_LIMIT);
  }
  function crumb(category, data) {
    if (mode !== 'on' || !plan.sentry) return;
    const item = { category, data, timestamp: now() / 1000 };
    if (sentry) sentry.crumb(item); else push(crumbs, item, 30);
  }
  function flush() {
    if (!posthog || consent() !== 'granted') return;
    if (user) posthog.identify(user, traits);
    for (const [type, id] of Object.entries(groups)) posthog.group(type, id);
    for (const item of events.splice(0)) posthog.capture(item);
  }

  /** Download and start PostHog — only ever after Accept. */
  function loadPosthog() {
    if (posthog || posthogLoading || mode !== 'on' || !plan.posthog || consent() !== 'granted') return;
    posthogLoading = loaders.posthog().then((module) => {
      if (consent() !== 'granted') return; // the answer changed while the chunk was on its way
      posthog = module.startPosthog({ ...config.posthog, release: config.release, env: config.env, distinctId: user, location: win.location });
      if (!viewed) { viewed = true; emit('$pageview'); } // one view per page load, however often the choice changes
      flush();
      daily();
    }).catch((error) => { posthogLoading = null; report(error, { chunk: 'posthog' }); });
  }
  function loadSentry() {
    if (sentry || !plan.sentry) return;
    loaders.sentry().then(async (module) => {
      sentry = await module.startSentry({ ...config.sentry, release: config.release, env: config.env, userId: user, window: win });
      // The page's own early buffer (index.html) stops here: from now on the SDK listens itself.
      const early = win.__jawErrors || [];
      stopEarlyBuffer();
      for (const item of crumbs.splice(0)) sentry.crumb(item);
      for (const item of early) sentry.capture(item.e, { source: 'early' });
      for (const item of errors.splice(0)) sentry.capture(item.error, item.context);
    }).catch(() => { /* error monitoring could not load: the game is unaffected */ });
  }
  function stopEarlyBuffer() {
    try {
      if (win.__jawErrorHandler) { win.removeEventListener('error', win.__jawErrorHandler); win.removeEventListener('unhandledrejection', win.__jawErrorHandler); }
      win.__jawErrors = []; win.__jawErrorHandler = null;
    } catch { /* not a browser */ }
  }
  function report(error, context) {
    if (mode !== 'on' || !plan.sentry) return;
    if (sentry) sentry.capture(error, context); else push(errors, { error, context }, ERROR_LIMIT);
  }

  /** Tell the game server the choice, so events it records for this player follow it too. */
  function syncServer() {
    if (mode !== 'on' || !plan.posthog || !user) return;
    const wanted = consent() === 'granted';
    if (serverConsent === wanted || (!wanted && serverConsent === null && saved.consent !== 'denied')) return;
    serverConsent = wanted;
    try {
      Promise.resolve(win.fetch('/api/telemetry/consent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ analytics: wanted }) })).catch(() => { serverConsent = null; });
    } catch { serverConsent = null; }
  }

  /** session_start: once per Lagos day per device, for a connected player who accepted. */
  function daily() {
    if (!user || mode !== 'on' || !plan.posthog || consent() !== 'granted') return;
    syncServer();
    const today = lagosDay(now());
    if (saved.lastDay === today) return;
    saved.firstSeen ||= today;
    const days = daysBetween(saved.firstSeen, today);
    saved.lastDay = today;
    emit('session_start', { days_since_first_seen: days, returning: days > 0 }, { setOnce: { first_seen_date: saved.firstSeen } });
    if (days === 1 && !saved.day2) { saved.day2 = true; emit('day2_return'); }
    persist();
  }

  function setConsent(choice, source = 'api') {
    try {
      const next = normalise(choice);
      if (!next) return consent();
      saved.consent = next; saved.at = now();
      if (consent() === 'granted') {
        persist();
        emit('consent_choice', { choice: 'granted', source });
        loadPosthog(); flush(); daily();
      } else {
        // Reject: what was waiting is discarded, the SDK (if it ever ran) is stopped and its storage cleared.
        events.length = 0;
        try { posthog?.stop(); } catch { /* already stopped */ }
        posthog = null; posthogLoading = null;
        persist();
        syncServer();
      }
      crumb('consent', { choice: next });
    } catch { /* never throws */ }
    return consent();
  }

  /** The consent sheet, or (from Settings) the same sheet showing the current choice. */
  function openSheet(source) {
    if (sheetOpen || !win?.document) return;
    sheetOpen = true;
    loaders.consent().then((module) => module.showConsent({
      document: win.document, source, host: config?.posthog?.host,
      state: { analytics: mode === 'on' && plan.posthog, errors: mode === 'on' && plan.sentry, consent: consent(), signal: privacySignal(win.navigator, win), under18 },
      onChoice: (choice) => setConsent(choice, source),
    })).catch(() => {}).finally(() => { sheetOpen = false; });
  }
  /** Ask once, at the configured moment: 'named' (default) = as soon as this browser has a session; 'landing' = at once. */
  function maybeAsk() {
    if (asked || mode !== 'on' || !plan.posthog || consent() !== 'unset') return;
    if (config.posthog.consentAt !== 'landing' && !user) return;
    asked = true;
    openSheet('sheet');
  }

  const onContextLost = (event) => { emit('webgl_context_lost', { scene: event?.target?.closest?.('.life-scene')?.id }); crumb('scene', { lost: true }); };
  const onPreloadError = () => { api.chunkFailed('preload'); };
  if (mode === 'on') {
    try { win.addEventListener('vite:preloadError', onPreloadError); win.document.addEventListener('webglcontextlost', onContextLost, true); } catch { /* not a browser (tests) */ }
  }

  /** Guard: nothing a caller passes, and nothing an SDK does, may reach the game as an exception. */
  const safe = (fn) => (...args) => { try { return fn(...args); } catch { return undefined; } };

  const api = {
    // ---- the public facade ----------------------------------------------------------------------
    track: safe((name, props) => { if (typeof name === 'string') emit(name, props && typeof props === 'object' ? { ...props } : {}); }),
    screen: safe((name) => { if (typeof name !== 'string') return; emit('screen_view', { screen: name }); crumb('screen', { screen: name }); }),
    /** `publicId` is the session's PUBLIC id — never the cookie. `traits.under18: true` switches analytics off. */
    identify: safe((publicId, more) => {
      user = typeof publicId === 'string' ? publicId : null;
      if (more && typeof more === 'object') { traits = { ...traits, ...more }; if (more.under18 === true) { under18 = true; events.length = 0; try { posthog?.stop(); } catch { /* stopped */ } posthog = null; } }
      sentry?.user(user);
      if (posthog && user) posthog.identify(user, traits);
      maybeAsk(); daily();
    }),
    /** A coarse group, e.g. setGroup('lga', 'ikeja'). */
    setGroup: safe((type, id) => { if (typeof type !== 'string' || typeof id !== 'string') return; groups[type] = id; if (posthog && consent() === 'granted') posthog.group(type, id); }),
    captureError: safe((error, context) => report(error, context)),
    setConsent,
    // ---- what the facade forwards from the entry (src/life-main.js) ---------------------------------
    openPrivacy: safe(() => openSheet('settings')),
    get consent() { return consent(); },
    get mode() { return mode; },
    /** No session in this browser: the nickname entry is showing. */
    needName: safe(() => { for (const [name, props] of landed(saved.device, now())) emit(name, props); }),
    /** A session was established (`isNew`: the server just created it for the nickname). */
    session: safe((session, isNew, serverNow) => {
      const id = session?.id;
      if (typeof id !== 'string') return;
      baseline = true;
      if (isNew) for (const [name, props] of named(Object.assign(memoFor(id), { t: { ...memoFor(id).t, landed: saved.device.t.landed } }), serverNow ?? now(), now())) emit(name, props);
      api.identify(id);
    }),
    /** After every accepted server state. `client` is the facade's snapshot of the client model: { session, cityId, storage, now }. */
    state: safe((next, previous, client) => {
      const id = client?.session?.id;
      if (client && Boolean(client.storage) !== lastStorage) { lastStorage = Boolean(client.storage); emit('storage_state', { state: lastStorage ? 'failing' : 'recovered' }); crumb('storage', { failing: lastStorage }); }
      if (!id || next === previous) return;
      const first = baseline || lastCity !== client.cityId;
      baseline = false; lastCity = client.cityId;
      const found = stateEvents(previous, next, memoFor(id), { now: client.now, baseline: first, pending });
      for (const [name, props] of found) emit(name, props);
      if (found.length && consent() === 'granted') persist();
      daily();
    }),
    /** A game action was sent (`pending`), and answered after `ms` (`actionDone`). */
    pending: safe((type) => { pending = type; }),
    actionDone: safe((type, ms, result) => {
      pending = null;
      const code = result?.code;
      crumb('action', { type, code, ok: result?.ok === true });
      if (result?.ok !== true && code !== 'busy') emit('action_failed', { action_type: type, code });
      if (code !== 'busy' && code !== 'offline' && Number.isFinite(ms) && random() < LATENCY_SAMPLE) emit('action_latency', { action_type: type, ms: Math.round(ms), bucket: latencyBucket(ms), ok: result?.ok === true });
    }),
    link: safe((link) => {
      if (typeof link !== 'string' || link === lastLink) return;
      if (lastLink) { emit('connection_state', { from: lastLink, to: link }); crumb('link', { from: lastLink, to: link }); }
      lastLink = link;
    }),
    /** `at`: milliseconds since the page started loading (performance.now()) when the HUD was first drawn. */
    hudReady: safe((at) => { hudAt ??= Number.isFinite(at) ? Math.round(at) : undefined; }),
    /**
     * The first scene was drawn (`ok`) or could not be, `at` ms into the page. A coarse frame rate
     * is counted for one second (now that the scene is up), then first_scene is reported.
     */
    sceneReady: safe((ok, canvas, at) => {
      if (sceneDone) return;
      sceneDone = true;
      const stamp = now();
      let renderer = 'none';
      try { renderer = !ok || !canvas ? 'none' : canvas.getContext('webgl2') ? 'webgl2' : 'webgl'; } catch { renderer = 'unknown'; }
      const cores = win.navigator?.hardwareConcurrency;
      const tier = !Number.isFinite(cores) ? 'unknown' : cores <= 2 ? 'low' : cores <= 6 ? 'mid' : 'high';
      let reported = false;
      const finish = safe((fps) => {
        if (reported) return;
        reported = true;
        replayAt = stamp;
        try { emit('first_scene', { ok: ok === true, renderer: `${renderer}_${tier}`, tti_ms: hudAt ?? undefined, scene_ms: Number.isFinite(at) ? Math.round(at) : undefined, ...(fps ? { fps: fpsBucket(fps) } : {}) }); } finally { replayAt = null; }
      });
      let frames = 0, began = null;
      const tick = (time) => { if (reported) return; began ??= time; frames += 1; if (time - began >= 1000) finish((frames - 1) * 1000 / (time - began)); else win.requestAnimationFrame(tick); };
      try { if (ok && !win.document.hidden) win.requestAnimationFrame(tick); } catch { /* no frames to count */ }
      win.setTimeout(() => finish(null), ok ? 2500 : 0);
    }),
    chunkFailed: safe((chunk, error) => { emit('chunk_load_failed', { chunk }); crumb('chunk', { chunk }); if (error) report(error, { chunk }); }),
  };
  /**
   * The calls the facade kept while this chunk was not here, in order, each at the time it was made.
   * @param {Array<[method: string, args: unknown[], at: number]>} calls
   */
  api.replay = safe((calls) => {
    for (const [method, args, at] of calls) {
      replayAt = at;
      try { if (typeof api[method] === 'function' && method !== 'replay') api[method](...args); } finally { replayAt = null; }
    }
  });

  if (mode !== 'on') { stopEarlyBuffer(); return api; }
  if (plan.sentry) loadSentry(); else stopEarlyBuffer();
  if (plan.posthog) { loadPosthog(); maybeAsk(); }
  return api;
}
