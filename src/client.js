/**
 * Client model: the browser's read-only mirror of the server-held life, plus networking.
 * DOM-free so it can be tested in Node (src/client.test.js).
 *
 * The server is authoritative. This module never applies a rule locally: while offline or
 * without a session, command() refuses, sends nothing and changes nothing — the cached state
 * is shown read-only until the server is reachable again.
 */
import { createLife, isDeparting } from './life.js';

export const CITIES = Object.freeze({ lagos: { id: 'lagos', name: 'Lagos', region: 'Lagos State' }, ibadan: { id: 'ibadan', name: 'Ibadan', region: 'Oyo State' } });
export const STORAGE_KEY = 'joinallworld-life-v1';
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
  }),
  outOfSync: 'Your action time was out of sync. Reconnect and try again.',
  notSaving: 'The server cannot save right now. What you see is the last saved state; nothing new is being kept.',
  cityNote: (cityName) => `More places and activities are coming to ${cityName}.`,
});
/**
 * Whether the community room must be (re)joined after a state change: on arrival somewhere
 * new, and when a departure was cancelled — a trip, the automatic commute to work, or any other
 * timed action that moves the player (the shared isDeparting rule, the same one the server
 * revokes by). The server removed the player from the room when they set off, so staying put
 * needs an explicit rejoin. This only joins the room (presence and text chat): the join puts the
 * player back with voice off and muted, and nothing here turns voice or the microphone on.
 */
export function roomJoinNeeded(previous, next) {
  if (previous.location !== next.location) return true;
  return isDeparting(previous) && !next.activeAction;
}

/**
 * A version-4 UUID. crypto.randomUUID exists only in secure contexts (HTTPS or localhost); on a
 * plain-HTTP LAN address the same random source is still there as crypto.getRandomValues.
 */
export function uuid(source = globalThis.crypto) {
  if (typeof source?.randomUUID === 'function') return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Refusals of POST /api/session that are about the nickname itself, and what to say when the server sent no sentence. */
const NAME_REFUSALS = ['name_not_allowed', 'invalid_name', 'muted'];
const NAME_TEXT = { name_not_allowed: 'That nickname is not allowed. Choose another one.', invalid_name: 'A nickname needs 3 to 24 ordinary characters.', muted: 'A moderator has muted you, so your nickname cannot be changed right now.' };

const ACTIVE_POLL_MS = 1000;
const IDLE_POLL_MS = 60000;

/**
 * @param {object} options
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
  randomUUID = () => uuid(), isHidden = () => false, isOnline = () => globalThis.navigator?.onLine !== false, onChange = () => {}, onStatus = () => {}, onSessionExpired = () => {}, onNeedName = () => {}, onSession = () => {} } = {}) {
  let saved;
  try { saved = JSON.parse(storage?.getItem(STORAGE_KEY)); } catch {}
  const client = {
    state: createLife(saved?.state),
    cityId: Object.hasOwn(CITIES, saved?.cityId) ? saved.cityId : 'lagos',
    identity: { name: saved?.identity?.name || 'New Lagosian' },
    hasSavedIdentity: Boolean(saved?.identity),
    session: null, ready: false, busy: false, serverTimeOffset: 0, link: 'connecting',
    serverNow: () => Math.round(now() + client.serverTimeOffset),
    /**
     * A retry key the server accepts for exactly-once writes: `<server ms>:<uuid>`, the same form as
     * an action ID. Make ONE per thing the player does and send the same one again on a retry.
     */
    newId: () => `${client.serverNow()}:${randomUUID()}`,
    /** null while the server is saving normally; { reason } from the moment it says it cannot (storage: "failing", or 503 storage_unavailable). */
    storage: null,
    get online() { return client.ready && Boolean(client.session); },
    api, fetchJson: api, connect, command, switchCity, refresh, schedule, stop,
  };
  let pollTimer = null;

  function status(text, error = false) { onStatus(text, error); }
  function persist() {
    try {
      if (!storage) throw Error('storage');
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, state: client.state, identity: client.identity, cityId: client.cityId }));
      if (!client.session) status('Local preview · saved on this device');
    } catch { status(client.session ? 'Server saved · browser cache unavailable' : 'Not saved · browser storage unavailable', true); }
  }

  /** JSON request to the same origin. Rejects with Error{status, code, reason?}; a network failure reads as connection lost. */
  async function api(path, options = {}) {
    let response;
    try {
      response = await fetch(path, { ...options, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
        headers: { 'Content-Type': 'application/json', ...options.headers }, signal: globalThis.AbortSignal?.timeout?.(10000) });
    } catch { throw Error(TEXT.connectionLost); }
    let payload;
    try { payload = await response.json(); } catch { throw Error('Server returned an unreadable response'); }
    if (Number.isFinite(payload.serverTime)) client.serverTimeOffset = payload.serverTime - now();
    // What the server says about its own storage, shown as it is: a success carrying storage "failing"
    // and a 503 storage_unavailable both mean nothing is being saved; any other success means it is.
    const unsaved = payload.storage === 'failing' || (response.status === 503 && (payload.error === 'storage_unavailable' || payload.code === 'storage_unavailable'));
    if (unsaved || response.ok) {
      const next = unsaved ? { reason: typeof payload.reason === 'string' && payload.reason ? payload.reason : TEXT.notSaving } : null;
      const changed = Boolean(next) !== Boolean(client.storage) || (next && next.reason !== client.storage.reason);
      client.storage = next;
      if (changed) { status(next ? next.reason : 'Connected · progress saved', Boolean(next)); onChange(client.state, client.state); }
    }
    if (!response.ok) {
      const error = Error(payload.error === 'action_expired' ? TEXT.outOfSync : payload.error || payload.message || 'Connection failed');
      error.status = response.status; error.code = payload.code || payload.error;
      if (typeof payload.reason === 'string' && payload.reason) error.reason = payload.reason; // the sentence the server wrote for the player
      throw error;
    }
    return payload;
  }

  function accept(next) {
    const previous = client.state;
    client.state = createLife(next);
    persist();
    onChange(client.state, previous);
    schedule();
  }
  function expired() {
    client.ready = false; client.session = null; client.link = 'expired'; cancel(pollTimer);
    status('Device session expired · saved preview preserved', true);
    onSessionExpired();
  }
  /** The request did not get an answer worth having: the device is offline, or the server is not reachable. */
  const down = () => (isOnline() ? 'unreachable' : 'offline');
  function lost(error, text) {
    client.ready = false; client.link = down();
    status(text || error.message, true);
    onChange(client.state, client.state);
  }

  /** Poll while the page is visible: every second during a timed action, once a minute when idle. */
  function schedule() {
    cancel(pollTimer);
    if (isHidden() || !client.online) return;
    pollTimer = later(() => refresh('Disconnected · action will settle on server'), client.state.activeAction ? ACTIVE_POLL_MS : IDLE_POLL_MS);
  }
  function stop() { cancel(pollTimer); }

  async function refresh(lostText = 'Reconnect to refresh progress') {
    if (!client.online) return false;
    try { accept((await api(`/api/life?city=${client.cityId}`)).state); return true; }
    catch (error) {
      // The server answered, it just could not save this settlement: still connected, try again at the next poll.
      if (error.code === 'storage_unavailable') { schedule(); return false; }
      if (error.status === 401) expired(); else lost(error, lostText); return false;
    }
  }

  async function connect(createNew = false) {
    client.link = 'connecting';
    status('Connecting…');
    try {
      let response;
      // `onboarding: true` tells the server this client shows the quick start: a life made for this new session starts as a guest (its look is confirmed by one action, then it plays).
      if (createNew) response = await api('/api/session', { method: 'POST', body: { name: client.identity.name, onboarding: true } });
      else {
        try { response = await api('/api/session'); }
        catch (error) {
          if (error.status !== 401) throw error;
          if (client.hasSavedIdentity) { expired(); return false; }
          client.link = 'new';
          status('Choose a nickname to connect');
          onNeedName();
          return false;
        }
      }
      client.session = response.session; client.hasSavedIdentity = true; client.identity.name = response.session.name; client.ready = true;
      onSession(client.session, createNew);
      client.link = 'online';
      accept((await api(`/api/life?city=${client.cityId}`)).state);
      holdCity(client.cityId);
      status('Connected · progress saved');
      return true;
    } catch (error) {
      client.ready = false;
      // The server refused the nickname (not allowed, malformed, or the player is muted): back to the form, with its reason.
      if (createNew && NAME_REFUSALS.includes(error.code)) {
        client.link = 'new';
        status('Choose a different nickname to connect', true);
        onChange(client.state, client.state);
        onNeedName({ code: error.code, reason: error.reason || NAME_TEXT[error.code], name: client.identity.name });
        return false;
      }
      client.link = error.status === 401 ? 'expired' : down();
      status(error.status === 401 ? 'Session expired · reconnect to review your options' : 'Connection unavailable · changes paused', true);
      onChange(client.state, client.state);
      return false;
    }
  }

  /**
   * session.cities — which cities this session has a life in, as the server's session response says
   * (about the caller only; an older server sends none, and then the list stays absent). Asking for
   * a city's life creates it, so the list is kept current here without another request.
   */
  function holdCity(id) {
    const held = client.session?.cities;
    if (Array.isArray(held) && !held.includes(id)) client.session = { ...client.session, cities: [...held, id] };
  }

  /**
   * Send one action. Resolves { ok, code, reason? }. Offline or busy: nothing is sent and
   * nothing changes ({ ok: false, code: 'offline' | 'busy' }). Each call carries a fresh
   * idempotent action ID stamped with server time — or `options.actionId`, an ID made earlier with
   * client.newId() and kept by the caller, so that a retry (also after a reload) is the SAME action
   * to the server and is applied exactly once.
   */
  async function command(type, payload, options) {
    if (client.busy) return { ok: false, code: 'busy' };
    // `code: 'offline'` is the machine code for "not sent"; the sentence says which of the reasons it really is.
    if (!client.online) { const reason = TEXT.paused[client.link] || TEXT.paused.unreachable; status(reason, true); return { ok: false, code: 'offline', reason }; }
    client.busy = true;
    try {
      const body = { actionId: typeof options?.actionId === 'string' ? options.actionId : client.newId(), cityId: client.cityId, type };
      if (payload !== undefined && payload !== null) body.payload = payload;
      const response = await api('/api/action', { method: 'POST', body });
      accept(response.state);
      if (!response.ok && client.state.message) status(client.state.message, true);
      return { ok: response.ok, code: response.code, reason: response.ok ? undefined : client.state.message };
    } catch (error) {
      // Not saved means not done (the server undid it): the player is still connected and may try again.
      if (error.code === 'storage_unavailable') return { ok: false, code: error.code, reason: error.reason || TEXT.notSaving };
      if (error.status === 401) expired(); else lost(error);
      return { ok: false, code: error.code || 'network', reason: error.message };
    } finally { client.busy = false; }
  }

  /** Move to another city's life. Refused mid-action and while offline. */
  async function switchCity(id) {
    if (!Object.hasOwn(CITIES, id)) return { ok: false, code: 'invalid_city' };
    if (client.state.activeAction) return { ok: false, code: 'busy', reason: 'Complete or cancel your current action before switching cities.' };
    if (!client.online) { const reason = client.session ? 'Reconnect before switching cities.' : 'Connect before entering a city.'; status(reason, true); return { ok: false, code: 'offline', reason }; }
    try {
      const data = await api(`/api/life?city=${id}`);
      client.cityId = id;
      accept(data.state);
      holdCity(id);
      return { ok: true, code: 'switched' };
    } catch (error) {
      if (error.status === 401) expired(); else status(error.message, true);
      return { ok: false, code: error.code || 'network', reason: error.message };
    }
  }

  return client;
}
