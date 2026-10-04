/**
 * TELEMETRY CORE — everything behind the facade (./index.ts) that is not an SDK. A lazy chunk:
 * the facade downloads it only after the game's own server has said telemetry is configured, and
 * then replays the calls it kept. Neither SDK is imported here; they are two further lazy chunks
 * (./sentry.ts, ./posthog.ts), and so is the consent sheet (./consent-ui.ts).
 *
 * TWO DIFFERENT RULES (./policy.ts, written for players in ./what-we-collect.ts):
 *   errors     sent without asking, with no personal data: see sentry.ts and scrub.ts
 *   analytics  sent only after the player chose Accept on the consent sheet. Before that choice
 *              nothing is sent — events wait in memory and are sent if the answer is Accept, and
 *              discarded if it is Reject. Do Not Track and Global Privacy Control count as Reject.
 * Neither runs on a development host unless the server says TELEMETRY_DEBUG=1.
 *
 * The names and properties of the events are in ./events.ts (the catalogue); the funnel is derived
 * from server states in ./funnel.ts.
 */
import { clientPlan, resolveConsent, privacySignal, lagosDay, daysBetween, latencyBucket, fpsBucket } from './policy.ts';
import type { ClientConfig, Consent } from './policy.ts';
import { newMemo, sessionStarted, stateEvents } from './funnel.ts';
import type { Memo, FunnelState } from './funnel.ts';
// The SDK wrappers and the consent sheet are lazy chunks: they are named below as types only (inline `import()` types),
// so that this file's only static imports stay policy.ts and funnel.ts.
type Item = import('./clean.ts').Item;
type PosthogHandle = import('./posthog.ts').PosthogHandle;
type SentryHandle = import('./sentry.ts').SentryHandle;
type ConsentSource = import('./consent-ui.ts').ConsentSource;

/** The page's own small error buffer (index.html) lives on the window until telemetry takes it over. */
export interface EarlyBuffer { __jawErrors?: Array<{ e: unknown }>; __jawErrorHandler?: ((event: Event) => void) | null }
export type TelemetryWindow = Window & EarlyBuffer;

/** The lazy chunks, injectable for tests. */
export interface CoreLoaders {
  sentry: () => Promise<Pick<typeof import('./sentry.ts'), 'startSentry'>>;
  posthog: () => Promise<Pick<typeof import('./posthog.ts'), 'startPosthog'>>;
  consent: () => Promise<Pick<typeof import('./consent-ui.ts'), 'showConsent'>>;
}
/** Everything the core touches, injectable for tests. `config` is what GET /api/telemetry/config answered. */
export interface CoreEnv { config: ClientConfig; window?: TelemetryWindow; now?: () => number; random?: () => number; loaders?: CoreLoaders }

/** The part of a server state that the core reads. */
export interface CoreState extends FunnelState {
  name?: unknown;
  onboarding?: { required?: boolean; done?: boolean; stage?: string; firstAt?: number | null; completedAt?: number | null } | null;
  estate?: { lgaConfirmed?: boolean; lga?: unknown } | null;
}
/** The facade's snapshot of the client model, read when the state was accepted. */
export interface CoreClient { session?: { id?: string } | null; cityId?: unknown; storage?: unknown; now: number }
/** Everything a call may carry; each method checks what it is given. */
export interface Core {
  track(name?: unknown, props?: unknown): void;
  screen(name?: unknown): void;
  /** `publicId` is the session's PUBLIC id — never the cookie. `traits.under18: true` switches analytics off. */
  identify(publicId?: unknown, more?: unknown): void;
  /** A coarse group, e.g. setGroup('lga', 'ikeja'). */
  setGroup(type?: unknown, id?: unknown): void;
  captureError(error?: unknown, context?: unknown): void;
  setConsent(choice?: unknown, source?: string): Consent;
  openPrivacy(): void;
  readonly consent: Consent;
  readonly mode: 'on' | 'off';
  age(value?: unknown): void;
  needName(): void;
  session(session?: unknown, isNew?: unknown, serverNow?: number): void;
  state(next?: CoreState | null, previous?: CoreState | null, client?: CoreClient): void;
  pending(type?: unknown): void;
  actionDone(type?: unknown, ms?: unknown, result?: unknown): void;
  link(link?: unknown): void;
  hudReady(at?: unknown): void;
  sceneReady(ok?: unknown, canvas?: { getContext(kind: string): unknown } | null, at?: unknown): void;
  chunkFailed(chunk?: unknown, error?: unknown): void;
  replay(calls: Array<[method: string, args: unknown[], at: number]>): void;
}

interface CrumbItem { category: string; data: Record<string, unknown>; timestamp: number }
/** What is remembered on this device. */
interface Saved { consent: Consent | null; at: number; firstSeen: string | null; lastDay: string | null; day2: boolean; device: Memo; lives: Record<string, Memo> }
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export const STORAGE_KEY = 'joinallworld-telemetry-v1';
export const QUEUE_LIMIT = 200;
export const ERROR_LIMIT = 20;
const LATENCY_SAMPLE = 0.2;

/** A bounded list: when full, the oldest entry goes. */
function push<T>(list: T[], item: T, limit: number) { list.push(item); if (list.length > limit) list.splice(0, list.length - limit); }
const normalise = (choice: unknown): 'granted' | 'denied' | null => (choice === true || choice === 'granted' || choice === 'accept' ? 'granted' : choice === false || choice === 'denied' || choice === 'reject' ? 'denied' : null);

export function createCore({ config, window: win = globalThis.window as TelemetryWindow, now: wall = Date.now, random = Math.random,
  loaders = { sentry: () => import('./sentry.ts'), posthog: () => import('./posthog.ts'), consent: () => import('./consent-ui.ts') } }: CoreEnv): Core {
  /** While the facade's kept calls are replayed, the clock reads the moment each call was made. */
  let replayAt: number | null = null;
  const now = () => replayAt ?? wall();
  const plan = clientPlan(config, win?.location?.hostname);
  /** 'on' when at least one service may run in this browser, otherwise 'off' (nothing is kept, nothing loads). */
  const mode = plan.sentry || plan.posthog ? 'on' : 'off';
  let sentry: SentryHandle | null = null, posthog: PosthogHandle | null = null, posthogLoading: Promise<void> | null = null, sheetOpen = false, asked = false, viewed = false;
  /** Analytics events and errors waiting for their SDK (or for the player's answer). */
  const events: Item[] = [], errors: Array<{ error: unknown, context: unknown }> = [], crumbs: CrumbItem[] = [];
  // Under 18: the ONE stored answer is the growth age question (server: growth.players[id].consent.age). The game's server
  // says so with the configuration (config.under18), with every consent answer, and the page says so the moment it is
  // answered ('jaw:age' → age()). Once true it stays true for this page: analytics is off whatever was chosen before.
  let user: string | null = null, traits: Record<string, unknown> = {}, under18 = config?.under18 === true;
  /** Has this life had its first reward (or is it past its first minutes)? The consent question waits for it. */
  let rewarded = false, rewardedAt: number | null = null, lastLga: string | null = null;
  /** Which screen is in front ('venue' | 'map' | 'buy' | …): the question is only asked on the venue screen. */
  let screenNow = 'venue';
  /** The player's nickname, kept in memory for one purpose: taking it OUT of error messages. It is never sent. */
  let nickname: string | null = null;
  const groups: Record<string, string> = {};
  /** What is remembered on this device. Only `consent` is written before the player has accepted. */
  let saved: Saved = { consent: null, at: 0, firstSeen: null, lastDay: null, day2: false, device: newMemo(), lives: {} };
  let serverConsent: boolean | null = null, pending: unknown = null, baseline = true, lastCity: unknown = null, lastLink: string | null = null, lastStorage = false, hudAt: number | undefined | null = null, sceneDone = false;

  let storage: Storage | null = null;
  try { storage = win?.localStorage ?? null; } catch { storage = null; }
  try {
    const read: Partial<Saved> | null = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null'); // untrusted: whatever this device holds under the key
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
  const memoFor = (id: string): Memo => (saved.lives[id] ||= newMemo());

  /** Product analytics is possible at all: not switched off by the server, and not refused by the player. */
  const analytics = () => mode === 'on' && plan.posthog && consent() !== 'denied';

  function emit(name: string, props: Record<string, unknown> = {}, extra?: { setOnce?: unknown }) {
    if (!analytics()) return;
    const item = { name, props, at: now(), ...(extra ? { extra } : {}) };
    if (posthog && consent() === 'granted') posthog.capture(item); else push(events, item, QUEUE_LIMIT);
  }
  function crumb(category: string, data: Record<string, unknown>) {
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
    const settings = config.posthog;
    if (posthog || posthogLoading || mode !== 'on' || !plan.posthog || !settings || consent() !== 'granted') return;
    posthogLoading = loaders.posthog().then((module) => {
      if (consent() !== 'granted') return; // the answer changed while the chunk was on its way
      posthog = module.startPosthog({ ...settings, release: config.release, env: config.env, distinctId: user, location: win.location });
      if (!viewed) { viewed = true; emit('$pageview'); } // one view per page load, however often the choice changes
      flush();
      daily();
    }).catch((error) => { posthogLoading = null; report(error, { chunk: 'posthog' }); });
  }
  function loadSentry() {
    const settings = config.sentry;
    if (sentry || !plan.sentry || !settings) return;
    loaders.sentry().then(async (module) => {
      const started = sentry = await module.startSentry({ ...settings, release: config.release, env: config.env, userId: user, window: win, typed: () => [nickname] });
      // The page's own early buffer (index.html) stops here: from now on the SDK listens itself.
      const early = win.__jawErrors || [];
      stopEarlyBuffer();
      for (const item of crumbs.splice(0)) started.crumb(item);
      for (const item of early) started.capture(item.e, { source: 'early' });
      for (const item of errors.splice(0)) started.capture(item.error, item.context);
    }).catch(() => { /* error monitoring could not load: the game is unaffected */ });
  }
  function stopEarlyBuffer() {
    try {
      if (win.__jawErrorHandler) { win.removeEventListener('error', win.__jawErrorHandler); win.removeEventListener('unhandledrejection', win.__jawErrorHandler); }
      win.__jawErrors = []; win.__jawErrorHandler = null;
    } catch { /* not a browser */ }
  }
  function report(error: unknown, context?: unknown) {
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
      Promise.resolve(win.fetch('/api/telemetry/consent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ analytics: wanted }) }))
        .then((response) => (response?.ok ? response.json() : null)).then((answer: { under18?: unknown } | null) => { if (answer?.under18 === true) minor(); }).catch(() => { serverConsent = null; });
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

  function setConsent(choice?: unknown, source = 'api'): Consent {
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
  function openSheet(source: ConsentSource, giveWay = false) {
    if (sheetOpen || !win?.document) return;
    sheetOpen = true;
    loaders.consent().then((module) => {
      // The chunk took a moment: a sheet of the game's may have opened meanwhile. The question waits for it to close.
      if (giveWay && !quiet()) return 'later';
      return module.showConsent({
        document: win.document, source, host: config?.posthog?.host, giveWay,
        state: { analytics: mode === 'on' && plan.posthog, errors: mode === 'on' && plan.sentry, consent: consent(), signal: privacySignal(win.navigator, win), under18 },
        onChoice: (choice) => setConsent(choice, source),
      });
    // 'later': it stepped aside for a sheet of the game's without an answer. It is asked again when that sheet has closed.
    }).then((result) => { if (result === 'later' && source === 'sheet') asked = false; }).catch(() => {}).finally(() => { sheetOpen = false; });
  }
  /** Is nothing else in front? No sheet (any open dialog) and the venue screen — not the map with a trip, not Buy mode. */
  const quiet = () => { try { return screenNow === 'venue' && !win.document.querySelector('dialog[open]'); } catch { return false; } };
  /**
   * Ask once, at the configured moment. 'reward' (the default): never during the first-minute flow — only once the life has
   * had its first reward, a few seconds later so the reward and the "Make this life yours" offer come first; a returning
   * player is not asked on arrival either, but a few seconds into the visit (their invite, arrival or table sheet comes first).
   * And only in a quiet moment: no other sheet open, nothing running, the venue screen in front, not while creating a
   * character and not in the seconds after settling in. If a sheet of the game's opens while the question is still up, the
   * question steps aside and is asked again when that sheet has closed. 'landing': at once (an operator's choice).
   */
  const ASK_AFTER_REWARD_MS = 5000;
  function maybeAsk(state?: CoreState | null, serverNow?: number) {
    if (asked || sheetOpen || mode !== 'on' || !plan.posthog || consent() !== 'unset') return;
    const waits = config.posthog?.consentAt !== 'landing';
    if (waits) {
      if (!user || !rewarded) return;
      if (rewardedAt !== null && finite(serverNow) && serverNow - rewardedAt < ASK_AFTER_REWARD_MS) return;
      const o = state?.onboarding;
      if (state?.activeAction || o?.required === true) return;
      // Just settled in: the new home comes first.
      if (o && finite(o.completedAt) && finite(serverNow) && serverNow - o.completedAt < ASK_AFTER_REWARD_MS) return;
      if (!quiet()) return;
    }
    asked = true;
    openSheet('sheet', waits);
  }
  /** The player is under 18: analytics is off for good on this page, what was waiting is dropped, the SDK is stopped. */
  function minor() {
    if (under18) return;
    under18 = true; events.length = 0;
    try { posthog?.stop(); } catch { /* already stopped */ }
    posthog = null; posthogLoading = null; serverConsent = false;
    persist();
  }

  const onContextLost = (event: Event) => { emit('webgl_context_lost', { scene: (event?.target as Element | null)?.closest?.('.life-scene')?.id }); crumb('scene', { lost: true }); };
  const onPreloadError = () => { api.chunkFailed('preload'); };
  /** The last accepted state and its server time: the consent question is looked at again when a sheet closes. */
  let seen: { state: CoreState | null | undefined, now: number, at: number } | null = null;
  // A sheet was closed (the settle-in offer, say): if the question was only waiting for that, it is asked — but not inside a
  // flow. One sheet often closes so the next can open (a step of settling in, an app opening from a card), so the look is
  // taken a moment later, once, and every condition is checked again then: another sheet open, or something running, and it waits on.
  const AFTER_CLOSE_MS = 600;
  let recheck: number | null = null;
  const onSheetClosed = (event: Event) => {
    if ((event?.target as Element | null)?.id === 'jaw-consent' || !seen || recheck !== null) return;
    try { recheck = win.setTimeout(() => { recheck = null; try { if (seen) maybeAsk(seen.state, seen.now + Math.max(0, wall() - seen.at)); } catch { /* never throws */ } }, AFTER_CLOSE_MS); } catch { recheck = null; }
  };
  if (mode === 'on') {
    try { win.addEventListener('vite:preloadError', onPreloadError); win.document.addEventListener('webglcontextlost', onContextLost, true); win.document.addEventListener('close', onSheetClosed, true); } catch { /* not a browser (tests) */ }
  }

  /** Guard: nothing a caller passes, and nothing an SDK does, may reach the game as an exception. */
  const safe = <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A): R | undefined => { try { return fn(...args); } catch { return undefined; } };

  const api: Core = {
    // ---- the public facade ----------------------------------------------------------------------
    track: safe((name?: unknown, props?: unknown) => { if (typeof name === 'string') emit(name, props && typeof props === 'object' ? { ...props } : {}); }),
    screen: safe((name?: unknown) => { if (typeof name !== 'string') return; screenNow = name; emit('screen_view', { screen: name }); crumb('screen', { screen: name }); }),
    /** `publicId` is the session's PUBLIC id — never the cookie. `traits.under18: true` switches analytics off. */
    identify: safe((publicId?: unknown, more?: unknown) => {
      user = typeof publicId === 'string' ? publicId : null;
      if (more && typeof more === 'object') { traits = { ...traits, ...more }; if ((more as { under18?: unknown }).under18 === true) minor(); }
      sentry?.user(user);
      if (posthog && user) posthog.identify(user, traits);
      if (config?.posthog?.consentAt === 'landing') maybeAsk();
      daily();
    }),
    /** A coarse group, e.g. setGroup('lga', 'ikeja'). */
    setGroup: safe((type?: unknown, id?: unknown) => { if (typeof type !== 'string' || typeof id !== 'string') return; groups[type] = id; if (posthog && consent() === 'granted') posthog.group(type, id); }),
    captureError: safe((error?: unknown, context?: unknown) => report(error, context)),
    setConsent,
    // ---- what the facade forwards from the entry (src/life-main.js) ---------------------------------
    openPrivacy: safe(() => openSheet('settings')),
    get consent() { return consent(); },
    get mode() { return mode; },
    /** The age question was answered (the growth "Stay in touch" screen, or the growth hello): 'minor' switches analytics off. */
    age: safe((value?: unknown) => { if (value === 'minor') minor(); }),
    /** No session in this browser: the landing screen is showing. It reports `landed` itself (one source per event). */
    needName: safe(() => {}),
    /** A session was established (`isNew`: the server just created it for the nickname). */
    session: safe((session?: unknown, isNew?: unknown, serverNow?: number) => {
      const id = (session as { id?: unknown } | null | undefined)?.id;
      if (typeof id !== 'string') return;
      baseline = true;
      if (isNew) sessionStarted(memoFor(id), serverNow ?? now());
      rewarded = false; rewardedAt = null; lastLga = null;
      api.identify(id);
    }),
    /** After every accepted server state. `client` is the facade's snapshot of the client model: { session, cityId, storage, now }. */
    state: safe((next?: CoreState | null, previous?: CoreState | null, client?: CoreClient) => {
      const id = client?.session?.id;
      if (client && Boolean(client.storage) !== lastStorage) { lastStorage = Boolean(client.storage); emit('storage_state', { state: lastStorage ? 'failing' : 'recovered' }); crumb('storage', { failing: lastStorage }); }
      if (typeof next?.name === 'string') nickname = next.name;
      if (!id || !client || next === previous) return;
      const first = baseline || lastCity !== client.cityId;
      baseline = false; lastCity = client.cityId;
      const found = stateEvents(previous, next, memoFor(id), { now: client.now, baseline: first, pending });
      for (const [name, props] of found) emit(name, props);
      if (!next) return; // (the original read `next.onboarding` here and threw into `safe`)
      // The local government is known (chosen and confirmed — never the game's guess): a coarse group, set once per change.
      const lga = next.onboarding?.done === true && next.estate?.lgaConfirmed === true && typeof next.estate.lga === 'string' ? next.estate.lga : null;
      if (lga && lga !== lastLga) { lastLga = lga; api.setGroup('lga', lga); }
      // The consent question waits for the first reward of a new life; a life past its first minutes may be asked now.
      const o = next.onboarding, guest = o?.stage === 'guest' && o.done !== true;
      // (A returning player — settled, or a guest already past the first reward when this page loaded — waits the same few
      // seconds from the first state this page saw, so the question never lands on their arrival.)
      if (!rewarded && o && o.required !== true && (!guest || finite(o.firstAt))) { rewarded = true; rewardedAt = guest && !first ? (o.firstAt ?? null) : finite(client.now) ? client.now : null; }
      seen = { state: next, now: client.now, at: wall() };
      maybeAsk(next, client.now);
      if (found.length && consent() === 'granted') persist();
      daily();
    }),
    /** A game action was sent (`pending`), and answered after `ms` (`actionDone`). */
    pending: safe((type?: unknown) => { pending = type; }),
    actionDone: safe((type?: unknown, ms?: unknown, answer?: unknown) => {
      pending = null;
      const result = answer as { ok?: unknown, code?: unknown } | null | undefined, code = result?.code;
      crumb('action', { type, code, ok: result?.ok === true });
      if (result?.ok !== true && code !== 'busy') emit('action_failed', { action_type: type, code });
      if (code !== 'busy' && code !== 'offline' && finite(ms) && random() < LATENCY_SAMPLE) emit('action_latency', { action_type: type, ms: Math.round(ms), bucket: latencyBucket(ms), ok: result?.ok === true });
    }),
    link: safe((link?: unknown) => {
      if (typeof link !== 'string' || link === lastLink) return;
      if (lastLink) { emit('connection_state', { from: lastLink, to: link }); crumb('link', { from: lastLink, to: link }); }
      lastLink = link;
    }),
    /** `at`: milliseconds since the page started loading (performance.now()) when the HUD was first drawn. */
    hudReady: safe((at?: unknown) => { hudAt ??= finite(at) ? Math.round(at) : undefined; }),
    /**
     * The first scene was drawn (`ok`) or could not be, `at` ms into the page. A coarse frame rate
     * is counted for one second (now that the scene is up), then first_scene is reported.
     */
    sceneReady: safe((ok?: unknown, canvas?: { getContext(kind: string): unknown } | null, at?: unknown) => {
      if (sceneDone) return;
      sceneDone = true;
      const stamp = now();
      let renderer = 'none';
      try { renderer = !ok || !canvas ? 'none' : canvas.getContext('webgl2') ? 'webgl2' : 'webgl'; } catch { renderer = 'unknown'; }
      const cores = win.navigator?.hardwareConcurrency;
      const tier = !Number.isFinite(cores) ? 'unknown' : cores <= 2 ? 'low' : cores <= 6 ? 'mid' : 'high';
      let reported = false;
      const finish = safe((fps: number | null) => {
        if (reported) return;
        reported = true;
        replayAt = stamp;
        try { emit('first_scene', { ok: ok === true, renderer: `${renderer}_${tier}`, tti_ms: hudAt ?? undefined, scene_ms: finite(at) ? Math.round(at) : undefined, ...(fps ? { fps: fpsBucket(fps) } : {}) }); } finally { replayAt = null; }
      });
      let frames = 0, began: number | null = null;
      const tick = (time: number) => { if (reported) return; began ??= time; frames += 1; if (time - began >= 1000) finish((frames - 1) * 1000 / (time - began)); else win.requestAnimationFrame(tick); };
      try { if (ok && !win.document.hidden) win.requestAnimationFrame(tick); } catch { /* no frames to count */ }
      win.setTimeout(() => finish(null), ok ? 2500 : 0);
    }),
    chunkFailed: safe((chunk?: unknown, error?: unknown) => { emit('chunk_load_failed', { chunk }); crumb('chunk', { chunk }); if (error) report(error, { chunk }); }),
    /**
     * The calls the facade kept while this chunk was not here, in order, each at the time it was made.
     */
    replay: safe((calls: Array<[method: string, args: unknown[], at: number]>) => {
      const methods = api as unknown as Record<string, unknown>;
      for (const [method, args, at] of calls) {
        replayAt = at;
        try { const call = methods[method]; if (typeof call === 'function' && method !== 'replay') call(...args); } finally { replayAt = null; }
      }
    }),
  };

  if (mode !== 'on') { stopEarlyBuffer(); return api; }
  if (plan.sentry) loadSentry(); else stopEarlyBuffer();
  if (plan.posthog) { loadPosthog(); maybeAsk(); }
  return api;
}
