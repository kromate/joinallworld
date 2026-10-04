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
  offlinePaused: 'Reconnect to save your action. Changes are paused while offline.',
  outOfSync: 'Your action time was out of sync. Reconnect and try again.',
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
 */
export function createClient({ fetch = globalThis.fetch?.bind(globalThis), storage, now = Date.now, setTimeout: later = globalThis.setTimeout, clearTimeout: cancel = globalThis.clearTimeout,
  randomUUID = () => uuid(), isHidden = () => false, onChange = () => {}, onStatus = () => {}, onSessionExpired = () => {}, onNeedName = () => {}, onSession = () => {} } = {}) {
  let saved;
  try { saved = JSON.parse(storage?.getItem(STORAGE_KEY)); } catch {}
  const client = {
    state: createLife(saved?.state),
    cityId: Object.hasOwn(CITIES, saved?.cityId) ? saved.cityId : 'lagos',
    identity: { name: saved?.identity?.name || 'New Lagosian' },
    hasSavedIdentity: Boolean(saved?.identity),
    session: null, ready: false, busy: false, serverTimeOffset: 0,
    serverNow: () => Math.round(now() + client.serverTimeOffset),
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
    client.ready = false; client.session = null; cancel(pollTimer);
    status('Device session expired · saved preview preserved', true);
    onSessionExpired();
  }
  function lost(error, text) {
    client.ready = false;
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
    catch (error) { if (error.status === 401) expired(); else lost(error, lostText); return false; }
  }

  async function connect(createNew = false) {
    status('Connecting…');
    try {
      let response;
      // `onboarding: true` tells the server this client shows character creation, so a life made for this new session must finish it first.
      if (createNew) response = await api('/api/session', { method: 'POST', body: { name: client.identity.name, onboarding: true } });
      else {
        try { response = await api('/api/session'); }
        catch (error) {
          if (error.status !== 401) throw error;
          if (client.hasSavedIdentity) { expired(); return false; }
          status('Choose a nickname to connect');
          onNeedName();
          return false;
        }
      }
      client.session = response.session; client.hasSavedIdentity = true; client.identity.name = response.session.name; client.ready = true;
      onSession(client.session, createNew);
      accept((await api(`/api/life?city=${client.cityId}`)).state);
      status('Connected · progress saved');
      return true;
    } catch (error) {
      client.ready = false;
      // The server refused the nickname (not allowed, malformed, or the player is muted): back to the form, with its reason.
      if (createNew && NAME_REFUSALS.includes(error.code)) {
        status('Choose a different nickname to connect', true);
        onChange(client.state, client.state);
        onNeedName({ code: error.code, reason: error.reason || NAME_TEXT[error.code], name: client.identity.name });
        return false;
      }
      status(error.status === 401 ? 'Session expired · reconnect to review your options' : 'Connection unavailable · changes paused', true);
      onChange(client.state, client.state);
      return false;
    }
  }

  /**
   * Send one action. Resolves { ok, code, reason? }. Offline or busy: nothing is sent and
   * nothing changes ({ ok: false, code: 'offline' | 'busy' }). Each call carries a fresh
   * idempotent action ID stamped with server time.
   */
  async function command(type, payload) {
    if (client.busy) return { ok: false, code: 'busy' };
    if (!client.online) { status(TEXT.offlinePaused, true); return { ok: false, code: 'offline', reason: TEXT.offlinePaused }; }
    client.busy = true;
    try {
      const body = { actionId: `${client.serverNow()}:${randomUUID()}`, cityId: client.cityId, type };
      if (payload !== undefined && payload !== null) body.payload = payload;
      const response = await api('/api/action', { method: 'POST', body });
      accept(response.state);
      if (!response.ok && client.state.message) status(client.state.message, true);
      return { ok: response.ok, code: response.code, reason: response.ok ? undefined : client.state.message };
    } catch (error) {
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
      return { ok: true, code: 'switched' };
    } catch (error) {
      if (error.status === 401) expired(); else status(error.message, true);
      return { ok: false, code: error.code || 'network', reason: error.message };
    }
  }

  return client;
}
