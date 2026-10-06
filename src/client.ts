import { initialCity } from './storage-city.ts';
import { cityCatalogueEntry, registeredCityIds, cityRules, cityDefaultName, loadCityContent, isCityId, isOpenCityId } from './game/cities/registry.ts';
import { STORAGE_KEY } from './storage-key.ts';
/**
 * Client model: the browser's read-only mirror of the server-held life, plus networking.
 * DOM-free so it can be tested in Node (src/client.test.ts).
 *
 * The server is authoritative. This module never applies a rule locally: while offline or
 * without a session, command() refuses, sends nothing and changes nothing — the cached state
 * is shown read-only until the server is reachable again.
 */
import { createLife, isDeparting } from './life.ts';
import { lifeCities, loadLifeCities } from './game/cities/lifeCities.ts';
import { campusFor } from './game/campus-gate.ts';
import type { LifeState } from './types/life.ts';
import type { ActionRequest, ActionResponse, ApiEnvelope, CityId, LifeResponse, OwnSession, SessionRequest, SessionResponse, TimedId } from './types/protocol.ts';

export interface City { id: CityId; name: string; region: string }
export function clientCity(id: string): City {
  const city = cityCatalogueEntry(id);
  if (!city?.open) throw new TypeError(`Unknown city ${id}`);
  return { id, name: city.name, region: city.state.name };
}

/** Why the game is or is not playable (see createClient). */
export type LinkState = 'connecting' | 'online' | 'new' | 'expired' | 'offline' | 'unreachable'
/** Refusals of POST /api/session that are about the nickname itself. */
export type NameRefusalCode = 'name_not_allowed' | 'invalid_name' | 'muted'
/** What onNeedName gets when the server refused the nickname just tried. */
export interface NameProblem { code: NameRefusalCode; reason: string; name: string }
/** Set while the server says it cannot save. */
export interface StorageProblem { reason: string }
/**
 * Why a state was accepted (one character on several devices, docs/DEVICES.md):
 *   'own'        this device's own action or poll;
 *   'elsewhere'  the server said the life changed and named an action this device did not send: another device did it;
 *   'wake'       the first read after this device was away (the tab was hidden, the network or the socket came back).
 */
export type ChangeCause = 'own' | 'elsewhere' | 'wake'
/** The server's hint that the life changed (src/types/protocol.ts LifeChangedFrame), as far as the client reads it. */
export interface LifeHint { rev: number; by?: readonly string[] }
/** Outcome of command() and switchCity(). `ok: false` with `code: 'offline' | 'busy'` means nothing was sent. */
export interface CommandResult { ok: boolean; code: string | undefined; reason?: string }
/** What api() rejects with. A network failure has neither status nor code. */
export interface ApiError extends Error { status?: number; code?: string; reason?: string; city?: string; /** Seconds after which the server said trying again can succeed. */ retryAfter?: number }
/** Options of api(): fetch's, except that `body` may be an object (sent as JSON). */
export type ApiOptions = Omit<RequestInit, 'body' | 'headers'> & { body?: unknown; headers?: Record<string, string> }

/** The part of Response the client reads. */
export type FetchResponse = Pick<Response, 'ok' | 'status' | 'json'>
export type FetchLike = (path: string, init: RequestInit) => Promise<FetchResponse>
/** The part of Storage the client uses; a missing key may read as null or undefined. */
export interface StorageLike { getItem(key: string): string | null | undefined; setItem(key: string, value: string): void }

export interface ClientOptions {
  fetch?: FetchLike
  storage?: StorageLike
  now?: () => number
  /** A timer handle is whatever the function returns. */
  setTimeout?: (callback: () => void, ms: number) => unknown
  clearTimeout?: (handle: never) => void
  randomUUID?: () => string
  /** True while the page is hidden (polling pauses). */
  isHidden?: () => boolean
  /** After every accepted server state, with why it was accepted (absent when only the link or the storage notice changed). */
  onChange?: (state: LifeState, previous: LifeState, cause?: ChangeCause) => void
  /** Connection status line. */
  onStatus?: (text: string, isError: boolean) => void
  /** The device session is gone (401). */
  onSessionExpired?: () => void
  /** No session yet: ask for a nickname, then call connect(true). `problem` is set when the server refused the nickname just tried. */
  onNeedName?: (problem?: NameProblem) => void
  /** A session was established or replaced. */
  onSession?: (session: OwnSession, createdNew: boolean) => void
  /** False when the device itself has no network (navigator.onLine). */
  isOnline?: () => boolean
}

export interface Client {
  state: LifeState
  cityId: CityId
  identity: { name: string }
  hasSavedIdentity: boolean
  session: OwnSession | null
  ready: boolean
  busy: boolean
  serverTimeOffset: number
  link: LinkState
  /**
   * Why the last START was turned away by a server that IS answering; null after any other outcome.
   *   'full'   every place is taken (503 device_capacity)
   *   'limit'  too many new players started from this network address in the last hour (429 on a new session)
   * `retryAfter` is the number of seconds the server said to wait, when it said.
   */
  refusal: 'full' | 'limit' | null
  retryAfter: number | null
  serverNow(): number
  newId(): TimedId
  storage: StorageProblem | null
  readonly online: boolean
  api: Api
  fetchJson: Api
  connect(createNew?: boolean, startCity?: string): Promise<boolean>
  command(type: ActionRequest['type'], payload?: Record<string, unknown> | null, options?: { actionId?: string }): Promise<CommandResult>
  switchLegacy(id: string, clientId: string): Promise<CommandResult>
  switchCity(id: string): Promise<CommandResult>
  refresh(lostText?: string): Promise<boolean>
  /** The server said the life changed (a `life-changed` frame): read it again unless this device already holds that revision. */
  lifeChanged(hint: LifeHint): void
  /** This device was away: read the life again now. A command sent meanwhile waits for the answer first. */
  wake(): Promise<boolean>
  /** The revision of the life this device shows; -1 before the server's first answer. */
  readonly revision: number
  schedule(): void
  stop(): void
}
/** JSON request to the same origin. The type argument is the success body the route answers with (the envelope is added). */
export type Api = <T extends object = Record<string, unknown>>(path: string, options?: ApiOptions) => Promise<T & ApiEnvelope>

/** What any answer body may carry, success or error. */
interface Payload extends Partial<ApiEnvelope> { error?: string; code?: string; message?: string; reason?: unknown; retryAfter?: unknown }
/** What the browser cache holds (nothing in it is trusted). */
interface SavedClient { state?: unknown; identity?: { name?: string }; cityId?: unknown }
export { STORAGE_KEY } from './storage-key.ts';
export const TEXT = Object.freeze({
  connectionLost: 'Connection lost. Reconnect to check your saved progress.',
  offlinePaused: 'This device has no internet. Nothing changes until you are back online.',
  /** Why an action was not sent, by connection state (client.link): only 'offline' says the device is offline. */
  paused: Object.freeze({
    offline: 'This device has no internet. Nothing changes until you are back online.',
    unreachable: 'The game server is not answering. Nothing changes until it can be reached again.',
    expired: 'This device’s saved life is no longer on the server. Start a new life to play.',
    new: 'Choose a nickname to start playing.',
    connecting: 'Still connecting. Try again in a moment.',
  }) as Readonly<Record<Exclude<LinkState, 'online'>, string> & { online?: undefined }>, // no sentence for 'online': it is playable, nothing is paused
  outOfSync: 'Your action time was out of sync. Reconnect and try again.',
  worldFull: 'The world is full right now · trying again shortly',
  networkLimit: 'Too many new players from this network · try again later',
  notSaving: 'The server cannot save right now. What you see is the last saved state; nothing new is being kept.',
  cityNote: (cityName: string) => `More places and activities are coming to ${cityName}.`,
});
/**
 * Whether the community room must be (re)joined after a state change: on arrival somewhere
 * new, and when a departure was cancelled — a trip, the automatic commute to work, or any other
 * timed action that moves the player (the shared isDeparting rule, the same one the server
 * revokes by). The server removed the player from the room when they set off, so staying put
 * needs an explicit rejoin. This only joins the room (presence and text chat): the join puts the
 * player back with voice off and muted, and nothing here turns voice or the microphone on.
 */
export function roomJoinNeeded(previous: Pick<LifeState, 'location' | 'activeAction'> & Partial<Pick<LifeState, 'estate'>>, next: Pick<LifeState, 'location' | 'activeAction'> & Partial<Pick<LifeState, 'estate'>>): boolean {
  if (previous.estate && next.estate && previous.estate.city !== next.estate.city) return true;
  if (previous.location !== next.location) return true;
  return isDeparting(previous) && !next.activeAction;
}

/**
 * A version-4 UUID. crypto.randomUUID exists only in secure contexts (HTTPS or localhost); on a
 * plain-HTTP LAN address the same random source is still there as crypto.getRandomValues.
 */
export function uuid(source: Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>> = globalThis.crypto): string {
  if (typeof source?.randomUUID === 'function') return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40; bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Refusals of POST /api/session that are about the nickname itself, and what to say when the server sent no sentence. */
const NAME_REFUSALS: readonly string[] = ['name_not_allowed', 'invalid_name', 'muted'];
const NAME_TEXT: Readonly<Record<NameRefusalCode, string>> = { name_not_allowed: 'That nickname is not allowed. Choose another one.', invalid_name: 'A nickname needs 3 to 24 ordinary characters.', muted: 'A moderator has muted you, so your nickname cannot be changed right now.' };

const ACTIVE_POLL_MS = 1000;
const IDLE_POLL_MS = 60000;

/**
 * What this client may send for an action. One rule today: SETTLING IN ('onboarding.home') carries the local government
 * and nothing else — { lga, via?, stay? }. The rules still accept the older rented-home form { house } from old scripts and
 * the Worker (src/game/systems/onboarding.ts), but the game's own client cannot send it: a `house` (or any other key) put
 * in that payload by a panel never leaves the device, and the server then answers 'lga_required'.
 */
const MOVE_IN_KEYS = ['lga', 'via', 'stay'];
export function outgoing<P>(type: string, payload: P): P | Record<string, unknown> {
  if (type !== 'onboarding.home' || !payload || typeof payload !== 'object') return payload;
  const fields = payload as Record<string, unknown>;
  return Object.fromEntries(MOVE_IN_KEYS.filter((key) => fields[key] !== undefined).map((key) => [key, fields[key]]));
}

/**
 * @param options
 *   fetch, storage, now, setTimeout, clearTimeout, randomUUID — injectable for tests
 *   isHidden()            → true while the page is hidden (polling pauses)
 *   onChange(state, previousState)   after every accepted server state
 *   onStatus(text, isError)          connection status line
 *   onSessionExpired()               the device session is gone (401)
 *   onNeedName(problem?)             no session yet: ask for a nickname, then call connect(true).
 *                                    `problem` { code, reason, name } is set when the server refused the nickname just tried.
 *   onSession(session)               a session was established or replaced
 *   isOnline()            → false when the device itself has no network (navigator.onLine)
 *
 * client.link says WHY the game is or is not playable, so the UI never calls two different things
 * "offline":
 *   'connecting'   a connection attempt is in flight
 *   'online'       connected; the server holds this life
 *   'new'          the server is up and this browser has never had a life here (ask for a nickname)
 *   'expired'      the server is up but does not know this browser's session (401): its data was
 *                  reset or the session ran out, while a life is still cached on this device
 *   'offline'      this device has no network
 *   'unreachable'  the device is online but the server did not answer (down, timed out, 5xx)
 */
export function createClient({ fetch = globalThis.fetch?.bind(globalThis), storage, now = Date.now, setTimeout: later = globalThis.setTimeout, clearTimeout: cancel = globalThis.clearTimeout,
  randomUUID = () => uuid(), isHidden = () => false, isOnline = () => globalThis.navigator?.onLine !== false, onChange = () => {}, onStatus = () => {}, onSessionExpired = () => {}, onNeedName = () => {}, onSession = () => {} }: ClientOptions = {}): Client {
  const cancelTimer = cancel as (handle: unknown) => void;
  let saved: SavedClient | null | undefined;
  let cached: string | null = null;
  // getItem may answer null (parses to null) or undefined (JSON.parse throws, caught): either way nothing was saved.
  try { cached = storage?.getItem(STORAGE_KEY) ?? null; saved = JSON.parse(cached ?? 'null') as SavedClient | null; } catch {}
  const cityId = initialCity(cached, isCityId);
  const missingRules = lifeCities(saved?.state, [cityId]).filter((id) => cityRules(id) === null)
  if (missingRules.length) throw new Error(`Saved life rules have not been loaded: ${missingRules.join(', ')}`)
  const client: Client = {
    // A saved life that uses the campus waits for the campus rules (below); until then the device shows a new one.
    state: createLife(campusFor(saved?.state) ? null : saved?.state, { cityId }),
    cityId,
    identity: { name: saved?.identity?.name || cityDefaultName(cityId) },
    hasSavedIdentity: Boolean(saved?.identity),
    session: null, ready: false, busy: false, serverTimeOffset: 0, link: 'connecting', refusal: null, retryAfter: null,
    serverNow: () => Math.round(now() + client.serverTimeOffset),
    /**
     * A retry key the server accepts for exactly-once writes: `<server ms>:<uuid>`, the same form as
     * an action ID. Make ONE per thing the player does and send the same one again on a retry.
     */
    newId: (): TimedId => `${client.serverNow()}:${randomUUID()}`,
    /** null while the server is saving normally; { reason } from the moment it says it cannot (storage: "failing", or 503 storage_unavailable). */
    storage: null,
    get online() { return client.ready && Boolean(client.session); },
    get revision() { return revision; },
    api, fetchJson: api, connect, command, switchCity, switchLegacy, refresh, lifeChanged, wake, schedule, stop,
  };
  let pollTimer: unknown = null;
  // A saved life that uses the campus is rebuilt as soon as the campus rules have arrived, unless the server has answered first.
  const savedWaiting = campusFor(saved?.state);
  if (savedWaiting) void savedWaiting.then(() => { if (!accepted) { const previous = client.state; client.state = createLife(saved?.state); onChange(client.state, previous); } }, () => {});

  function status(text: string, error = false): void { onStatus(text, error); }
  function persist(): void {
    try {
      if (!storage) throw Error('storage');
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, state: client.state, identity: client.identity, cityId: client.cityId }));
      if (!client.session) status('Local preview · saved on this device');
    } catch { status(client.session ? 'Server saved · browser cache unavailable' : 'Not saved · browser storage unavailable', true); }
  }

  /** JSON request to the same origin. Rejects with Error{status, code, reason?}; a network failure reads as connection lost. */
  async function api<T extends object = Record<string, unknown>>(path: string, options: ApiOptions = {}): Promise<T & ApiEnvelope> {
    let response: FetchResponse;
    try {
      // A string, or a falsy value, goes out as it is (fetch decides); anything else is JSON.
      response = await fetch(path, { ...options, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body as BodyInit | null | undefined,
        headers: { 'Content-Type': 'application/json', ...options.headers }, signal: globalThis.AbortSignal?.timeout?.(10000) });
    } catch { throw Error(TEXT.connectionLost); }
    let payload: Payload;
    try { payload = await response.json() as Payload; } catch { throw Error('Server returned an unreadable response'); }
    if (payload === null || typeof payload !== 'object') throw Error('Server returned an unreadable response');
    if (typeof payload.serverTime === 'number' && Number.isFinite(payload.serverTime)) client.serverTimeOffset = payload.serverTime - now();
    // What the server says about its own storage, shown as it is: a success carrying storage "failing"
    // and a 503 storage_unavailable both mean nothing is being saved; any other success means it is.
    const unsaved = payload.storage === 'failing' || (response.status === 503 && (payload.error === 'storage_unavailable' || payload.code === 'storage_unavailable'));
    if (unsaved || response.ok) {
      const next = unsaved ? { reason: typeof payload.reason === 'string' && payload.reason ? payload.reason : TEXT.notSaving } : null;
      const changed = Boolean(next) !== Boolean(client.storage) || (next !== null && next.reason !== client.storage?.reason);
      client.storage = next;
      if (changed) { status(next ? next.reason : 'Connected · progress saved', Boolean(next)); onChange(client.state, client.state); }
    }
    if (!response.ok) {
      const error: ApiError = Error(payload.error === 'action_expired' ? TEXT.outOfSync : payload.error || payload.message || 'Connection failed');
      error.status = response.status; error.code = payload.code || payload.error;
      if (typeof Reflect.get(payload, 'city') === 'string') error.city = String(Reflect.get(payload, 'city'));
      if (typeof payload.reason === 'string' && payload.reason) error.reason = payload.reason; // the sentence the server wrote for the player
      if (typeof payload.retryAfter === 'number' && Number.isFinite(payload.retryAfter) && payload.retryAfter > 0) error.retryAfter = payload.retryAfter;
      throw error;
    }
    return payload as T & ApiEnvelope;
  }

  /** The server's answer is the life now (a late hydration of the saved copy, below, must not replace it). */
  let accepted = false;
  // ONE CHARACTER ON SEVERAL DEVICES (docs/DEVICES.md). Every answer that carries the life carries the character's
  // revision, which only goes up. This device keeps the revision of the life it shows and never replaces it with an
  // older answer that was asked for BEFORE the newer one was taken (two answers that crossed on the way). An answer
  // asked for afterwards is the server's word however low its number: a server that was restored starts lower.
  let revision = -1;
  /** Counts the answers taken, so each request knows whether another answer was taken while it was on its way. */
  let taken = 0;
  /** The highest revision the server has announced, and the highest it announced for an action this device did not send. */
  let announced = -1, announcedElsewhere = -1;
  /** The ids of the actions this device sent lately: a change they caused is this device's own. */
  const sentIds: string[] = [];
  /** Set by wake(): the next read is the one that brings this device up to date. */
  let waking: Promise<boolean> | null = null;
  let catching: Promise<void> | null = null;
  /**
   * Rebuild `next` (it waits first for the campus rules when the life uses the campus and they are not loaded yet) and take
   * it as the life. `rev` is the answer's revision and `askedAt` the value of `taken` when it was asked for; an answer
   * that a newer one overtook is dropped (false).
   */
  async function accept(next: unknown, rev?: number, askedAt = taken, cause: ChangeCause = 'own'): Promise<boolean> {
    const overtaken = (): boolean => typeof rev === 'number' && rev < revision && askedAt < taken;
    if (overtaken()) return false;
    await loadLifeCities(next, [client.cityId]); // every city the life refers to, before it is rebuilt
    const waiting = campusFor(next);
    if (waiting) await waiting;
    if (overtaken()) return false;
    accepted = true;
    // The change another device made arrived with this answer, whichever request carried it.
    const why: ChangeCause = typeof rev === 'number' && announcedElsewhere > revision && rev >= announcedElsewhere ? 'elsewhere' : cause;
    if (typeof rev === 'number') revision = rev;
    taken += 1;
    const previous = client.state;
    // A server snapshot is rebuilt at ITS time and city, not at time zero: a sanitiser that compares with the clock
    // (a running campus shuttle, today's quiz) must not drop what the server has just sent.
    const stamp = (next as { t?: unknown } | null | undefined)?.t;
    const snapshotTime = typeof stamp === 'number' ? stamp : Number.NaN;
    client.state = createLife(next, { now: Number.isFinite(snapshotTime) ? snapshotTime : client.serverNow(), cityId: client.cityId });
    if (isCityId(client.state.estate.city)) client.cityId = client.state.estate.city as CityId;
    persist();
    onChange(client.state, previous, why);
    schedule();
    return true;
  }
  /** Another session, or none: what was held about revisions belonged to the one before. */
  function forgetRevisions(): void { revision = -1; announced = -1; announcedElsewhere = -1; sentIds.length = 0; }
  function expired() {
    forgetRevisions();
    client.ready = false; client.session = null; client.link = 'expired'; cancelTimer(pollTimer);
    status('Device session expired · saved preview preserved', true);
    onSessionExpired();
  }
  /** The request did not get an answer worth having: the device is offline, or the server is not reachable. */
  const down = (): LinkState => (isOnline() ? 'unreachable' : 'offline');
  function lost(error: ApiError, text?: string): void {
    client.ready = false; client.link = down();
    status(text || error.message, true);
    onChange(client.state, client.state);
  }

  /** Poll while the page is visible: every second during a timed action, once a minute when idle. */
  function schedule(): void {
    cancelTimer(pollTimer);
    if (isHidden() || !client.online) return;
    pollTimer = later(() => refresh('Disconnected · action will settle on server'), client.state.activeAction ? ACTIVE_POLL_MS : IDLE_POLL_MS);
  }
  function stop(): void { cancelTimer(pollTimer); }

  async function loadedSnapshot<T extends { state: LifeState }>(response: T): Promise<T> {
    await loadLifeCities(response.state);
    return response;
  }

  async function fetchCurrentLife(city: string): Promise<LifeResponse> {
    try { await loadCityContent(city); return await loadedSnapshot(await api<LifeResponse>(`/api/life?city=${city}`)); }
    catch (error) {
      if (typeof error !== 'object' || error === null || Reflect.get(error, 'code') !== 'city_moved') throw error;
      const destination: unknown = Reflect.get(error, 'city');
      if (typeof destination !== 'string' || !isCityId(destination)) throw error;
      await loadCityContent(destination);
      const response = await api<LifeResponse>(`/api/life?city=${destination}`);
      client.cityId = destination as CityId;
      return loadedSnapshot(response);
    }
  }

  async function refresh(lostText = 'Reconnect to refresh progress', cause: ChangeCause = 'own'): Promise<boolean> {
    if (!client.online) return false;
    const askedAt = taken;
    try { const response = await fetchCurrentLife(client.cityId); await accept(response.state, response.rev, askedAt, cause); return true; }
    catch (e) {
      const error = e as ApiError;
      // The server answered, it just could not save this settlement: still connected, try again at the next poll.
      if (error.code === 'storage_unavailable') { schedule(); return false; }
      if (error.status === 401) expired(); else lost(error, lostText); return false;
    }
  }

  /**
   * The server said the life changed. Nothing is read while an action of this device is on its way (its answer may
   * already be that change), and nothing is read when this device holds that revision or a later one. Otherwise the life is
   * read again, and once more a moment later if the server had not caught up with what it announced.
   */
  function lifeChanged(hint: LifeHint): void {
    if (!hint || typeof hint.rev !== 'number' || !Number.isFinite(hint.rev)) return;
    announced = Math.max(announced, hint.rev);
    if (Array.isArray(hint.by) && hint.by.some((id) => !sentIds.includes(id))) announcedElsewhere = Math.max(announcedElsewhere, hint.rev);
    void catchUp();
  }
  function catchUp(): Promise<void> {
    if (catching) return catching;
    if (client.busy || !client.online || announced <= revision) return Promise.resolve();
    catching = (async () => {
      for (let attempt = 0; attempt < 3 && client.online && !client.busy && announced > revision; attempt++) {
        if (attempt) await new Promise<void>((resolve) => { later(resolve, 250 * attempt); });
        if (!(await refresh())) break;
      }
      // What the server holds now is the life, whatever number it announced (a write that was undone is announced too).
      if (!client.busy) announced = Math.min(announced, revision);
    })().finally(() => { catching = null; });
    return catching;
  }
  /** This device was away (hidden, offline, its socket closed): read the life now. command() waits for this read. */
  function wake(): Promise<boolean> {
    if (!client.online) return Promise.resolve(false);
    waking ??= refresh(undefined, 'wake').finally(() => { waking = null; });
    return waking;
  }

  async function connect(createNew = false, startCity?: string): Promise<boolean> {
    client.link = 'connecting'; client.refusal = null; client.retryAfter = null;
    status('Connecting…');
    try {
      if (createNew && startCity !== undefined) {
        if (!isOpenCityId(startCity)) throw new TypeError('Choose an open city to start.');
        await loadCityContent(startCity);
        client.cityId = startCity;
      }
      let response: SessionResponse;
      // `onboarding: true` tells the server this client shows the quick start: a life made for this new session starts as a guest (its look is confirmed by one action, then it plays).
      if (createNew) response = await api<SessionResponse>('/api/session', { method: 'POST', body: { name: client.identity.name, onboarding: true } satisfies SessionRequest });
      else {
        try { response = await api<SessionResponse>('/api/session'); }
        catch (e) {
          const error = e as ApiError;
          if (error.status !== 401) throw error;
          if (client.hasSavedIdentity) { expired(); return false; }
          client.link = 'new';
          status('Choose a nickname to connect');
          onNeedName();
          return false;
        }
      }
      if (client.session?.id !== response.session.id) forgetRevisions();
      client.session = response.session; client.hasSavedIdentity = true; client.identity.name = response.session.name; client.ready = true;
      // A new device asks for the default city first: when the session says its one life is elsewhere, ask for that one, not for a city that has moved on.
      const held = response.session.cities;
      if (!createNew && Array.isArray(held) && held.length === 1 && isCityId(held[0]) && held[0] !== client.cityId) { await loadCityContent(held[0]); client.cityId = held[0] as CityId; }
      onSession(client.session, createNew);
      client.link = 'online';
      const askedAt = taken;
      const first = await fetchCurrentLife(client.cityId);
      await accept(first.state, first.rev, askedAt);
      holdCity(client.cityId);
      status('Connected · progress saved');
      return true;
    } catch (e) {
      const error = e as ApiError;
      client.ready = false;
      // The server refused the nickname (not allowed, malformed, or the player is muted): back to the form, with its reason.
      if (createNew && error.code !== undefined && NAME_REFUSALS.includes(error.code)) {
        client.link = 'new';
        status('Choose a different nickname to connect', true);
        onChange(client.state, client.state);
        onNeedName({ code: error.code as NameRefusalCode, reason: error.reason || NAME_TEXT[error.code as NameRefusalCode], name: client.identity.name });
        return false;
      }
      client.link = error.status === 401 ? 'expired' : down();
      // Every place is taken: the server is up and said so. The shell tells the visitor and tries again by itself.
      // The same for the limit on new players from one network address (429 when a session was being made).
      if (error.status === 503 && error.code === 'device_capacity') client.refusal = 'full';
      else if (createNew && error.status === 429) client.refusal = 'limit';
      if (client.refusal) client.retryAfter = error.retryAfter ?? null;
      status(error.status === 401 ? 'Session expired · reconnect to review your options' : client.refusal === 'full' ? TEXT.worldFull : client.refusal === 'limit' ? TEXT.networkLimit : 'Connection unavailable · changes paused', true);
      onChange(client.state, client.state);
      return false;
    }
  }

  /**
   * session.cities — which cities this session has a life in, as the server's session response says
   * (about the caller only; an older server sends none, and then the list stays absent). Asking for
   * a city's life creates it, so the list is kept current here without another request.
   */
  function holdCity(id: CityId): void {
    const held = client.session?.cities;
    if (Array.isArray(held) && !held.includes(id)) client.session = { ...client.session as OwnSession, cities: [...held, id] };
  }

  /**
   * Send one action. Resolves { ok, code, reason? }. Offline or busy: nothing is sent and
   * nothing changes ({ ok: false, code: 'offline' | 'busy' }). Each call carries a fresh
   * idempotent action ID stamped with server time — or `options.actionId`, an ID made earlier with
   * client.newId() and kept by the caller, so that a retry (also after a reload) is the SAME action
   * to the server and is applied exactly once.
   */
  async function command(type: ActionRequest['type'], payload?: Record<string, unknown> | null, options?: { actionId?: string }): Promise<CommandResult> {
    if (client.busy) return { ok: false, code: 'busy' };
    // A device that has just come back reads the life first: the action is then sent about what the server holds, not about a stale copy.
    if (waking) { await waking.catch(() => false); if (client.busy) return { ok: false, code: 'busy' }; }
    // `code: 'offline'` is the machine code for "not sent"; the sentence says which of the reasons it really is.
    if (!client.online) { const reason = TEXT.paused[client.link] || TEXT.paused.unreachable; status(reason, true); return { ok: false, code: 'offline', reason }; }
    client.busy = true;
    try {
      const body: Omit<ActionRequest, 'actionId'> & { actionId: string } = { actionId: typeof options?.actionId === 'string' ? options.actionId : client.newId(), cityId: client.cityId, type };
      if (payload !== undefined && payload !== null) body.payload = outgoing(type, payload);
      sentIds.push(body.actionId); if (sentIds.length > 32) sentIds.shift();
      const askedAt = taken;
      const response = await api<ActionResponse>('/api/action', { method: 'POST', body });
      await loadedSnapshot(response);
      await accept(response.state, response.rev, askedAt);
      if (!response.ok && client.state.message) status(client.state.message, true);
      return { ok: response.ok, code: response.code, reason: response.ok ? undefined : client.state.message };
    } catch (e) {
      const error = e as ApiError;
      if (error.code === 'city_moved' && isCityId(error.city)) {
        // The character is in another city now (it travelled on another device): this device follows it there.
        try { const askedAt = taken; const moved = await fetchCurrentLife(error.city); await accept(moved.state, moved.rev, askedAt, 'elsewhere'); }
        catch { lost(error); }
        return { ok: false, code: 'city_moved', reason: error.reason ?? 'Your character moved. Review its current city before trying again.' };
      }
      // Not saved means not done (the server undid it): the player is still connected and may try again.
      if (error.code === 'storage_unavailable') return { ok: false, code: error.code, reason: error.reason || TEXT.notSaving };
      if (error.status === 401) expired(); else lost(error);
      return { ok: false, code: error.code || 'network', reason: error.message };
    } finally { client.busy = false; void catchUp(); }
  }

  async function switchLegacy(id: string, clientId: string): Promise<CommandResult> {
    if (client.busy || client.state.activeAction) return { ok: false, code: 'busy' };
    client.busy = true;
    try {
      const result = await api<{ ok: true; city: string }>('/api/characters/switch', { method: 'POST', body: { id, clientId } });
      const askedAt = taken;
      const current = await fetchCurrentLife(result.city);
      await accept(current.state, current.rev, askedAt);
      return { ok: true, code: 'switched' };
    } catch (error) {
      return { ok: false, code: error instanceof Error ? (error as ApiError).code ?? 'network' : 'network', reason: error instanceof Error ? error.message : 'Could not switch characters.' };
    } finally { client.busy = false; }
  }

  /** Move to another city's life. Refused mid-action and while offline. */
  async function switchCity(id: string): Promise<CommandResult> {
    if (typeof id !== 'string' || !isCityId(id)) return { ok: false, code: 'invalid_city' };
    if (client.state.activeAction) return { ok: false, code: 'busy', reason: 'Complete or cancel your current action before switching cities.' };
    if (!client.online) { const reason = client.session ? 'Reconnect before switching cities.' : 'Connect before entering a city.'; status(reason, true); return { ok: false, code: 'offline', reason }; }
    try {
      await loadCityContent(id);
      const askedAt = taken;
      const data = await api<LifeResponse>(`/api/life?city=${id}`);
      client.cityId = id as CityId;
      await loadedSnapshot(data);
      await accept(data.state, data.rev, askedAt);
      holdCity(id as CityId);
      return { ok: true, code: 'switched' };
    } catch (e) {
      const error = e as ApiError;
      if (error.status === 401) expired(); else status(error.message, true);
      return { ok: false, code: error.code || 'network', reason: error.message };
    }
  }

  return client;
}
