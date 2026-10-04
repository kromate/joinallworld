/**
 * OWNER: social
 * Browser-side state shared by the social panels (People, Messages, Contacts, Family, Invite).
 * Not a panel: it is imported by them and is not registered in panels/index.js.
 *
 * It talks to /api/social/* through api.fetchJson and keeps one socket open to /socket for
 * live pushes (new messages, knocks, friend requests). Sending always goes over HTTP so that
 * every message resolves to sent or failed; the socket is only for receiving, and whatever
 * arrived while it was down is fetched again when it reconnects. Rules that can be tested
 * without a browser live in src/game/social-model.js.
 *
 * Nothing here touches the microphone or voice, and no timer repeats: the only timers are the
 * bounded reconnect back-off and single follow-up checks.
 */
import './social.css';
import { createOutbox, mergeMessages, inviteIdFrom, SEND_TIMEOUT_MS } from '../../game/social-model.js';

const MAX_ATTEMPTS = 6;
export const outbox = createOutbox();
export const S = {
  api: null, me: null, loading: false, error: null, socket: 'idle',
  people: null, peopleAt: 0, peopleLoading: false,
  threads: new Map(),   // conv id → { messages, loaded, error }
  profiles: new Map(),  // player id → card | { error }
  openConv: null,       // conversation currently on screen (messages are marked read as they arrive)
  knock: null,          // my own knock: { host, name, status: 'sending' | 'knocking' | 'accepted' | 'declined' | 'failed', reason, expiresAt }
  linkHost: null,       // house id from an invite link that has not been handled yet
  houseRoom: null,      // { host, members: [{ id, name }] } while this socket is in a host's Home room as a guest
};
let joiningHouse = null;
let ws = null, attempts = 0, timer = null, started = false, syncing = false, dirty = false, peopleDirty = false;
const peopleWatchers = new Set();
let profileVersion = 0;
/** Call `fn` whenever the who-is-here listing changes (the scene host draws its crowd from it). */
export function onPeople(fn) { peopleWatchers.add(fn); return () => peopleWatchers.delete(fn); }
const peopleChanged = () => { for (const fn of peopleWatchers) { try { fn(S.people); } catch (error) { console.error('People watcher failed:', error); } } };

const refresh = () => S.api?.refresh();
// Until a new life has finished character creation it is not in the city: the social features stay closed.
const connected = () => { const view = S.api?.view(); return Boolean(view?.connected) && view.onboarding?.required !== true; };
export const cityId = () => S.api.view().cityId;
/** A retry key in the form the server's exactly-once writes require: `<server ms>:<uuid>` (also valid as a message's clientId). */
export const newClientId = () => S.api.newId();

/** One request. Never throws: a failure comes back as { ok: false, code, reason }. */
export async function call(path, body) {
  try { return await S.api.fetchJson(path, body ? { method: 'POST', body } : undefined); }
  catch (error) {
    // A refusal the server explained (blocked wording, a mute) is shown in its own words.
    const reason = error.reason && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 429 ? error.reason
      : error.status === 503 && error.reason ? error.reason // the server could not save (or take) this: its own sentence says nothing was changed
      : error.status === 429 ? 'Too many requests. Wait a minute and try again.'
      : error.status === 401 ? 'Your device session expired. Reconnect to continue.'
        : error.code === 'onboarding_required' ? 'Finish creating your Sim first. People and messages open once you have moved in.'
        : error.status === 409 ? 'That was already sent with different details. Try again.'
          : error.status >= 400 && error.status < 500 ? 'That request was not accepted. Check what you typed.'
            : 'Connection lost. Nothing was changed; try again.';
    return { ok: false, code: error.code || 'network', reason, transport: !error.status };
  }
}

/** A request the player asked for: toast the reason when refused, then re-read the overview. */
export async function perform(path, body, good) {
  const result = await call(path, body);
  if (!result.ok) S.api.toast(result.reason, 'error');
  else if (good) S.api.toast(typeof good === 'function' ? good(result) : good, 'good');
  await sync();
  return result;
}

/** Re-read the life after the server changed it outside /api/action (a gift, a new friend). */
export function refreshLife() { if (connected()) void S.api.command('social.sync'); }

export async function sync() {
  if (!connected()) return;
  if (syncing) { dirty = true; return; }
  syncing = true; S.loading = !S.me;
  const result = await call('/api/social/me');
  syncing = false; S.loading = false;
  if (result.ok) {
    S.me = result; S.error = null;
    if (S.knock?.status === 'accepted' && result.visiting?.host.id !== S.knock.host) S.knock = null;
    joinHouse();
  } else S.error = result.reason;
  refresh();
  if (dirty) { dirty = false; void sync(); }
}

export async function loadPeople() {
  if (!connected()) return;
  // A change that arrives while a read is in flight is read again afterwards, never dropped.
  if (S.peopleLoading) { peopleDirty = true; return; }
  S.peopleLoading = true;
  const result = await call(`/api/social/people?city=${encodeURIComponent(cityId())}`);
  S.peopleLoading = false;
  S.people = result.ok ? result : { error: result.reason };
  S.peopleAt = S.api.view().now;
  peopleChanged();
  refresh();
  if (peopleDirty) { peopleDirty = false; void loadPeople(); }
}
/** Ask the server to tell this socket when who-is-here changes (it answers with the current listing). */
function watchPeople() { if (ws?.readyState === 1 && connected()) ws.send(JSON.stringify({ type: 'people-list', cityId: cityId() })); }

export async function loadProfile(id) {
  const version = profileVersion;
  const result = await call(`/api/social/players/${encodeURIComponent(id)}`);
  if (version !== profileVersion) return; // An older response must not restore invalidated friendship details.
  S.profiles.set(id, result.ok ? result.player : { error: result.reason });
  refresh();
}

// ---- messages -------------------------------------------------------------------------------
const threadOf = (id) => { if (!S.threads.has(id)) S.threads.set(id, { messages: [], loaded: false, error: null }); return S.threads.get(id); };
function noteConv(conv) {
  if (!S.me) return;
  S.me.conversations = [conv, ...S.me.conversations.filter((item) => item.id !== conv.id)];
}
export async function openThread(id) {
  const thread = threadOf(id);
  const last = thread.messages.at(-1)?.seq ?? 0;
  const result = await call(`/api/social/conversations/${encodeURIComponent(id)}${thread.loaded ? `?after=${last}` : ''}`);
  if (result.ok) { thread.messages = mergeMessages(thread.messages, result.messages); thread.loaded = true; thread.error = null; noteConv(result.conv); if (result.conv.unread) void markRead(id); }
  else thread.error = result.reason;
  refresh();
}
async function markRead(id) {
  const result = await call(`/api/social/conversations/${encodeURIComponent(id)}/read`, {});
  if (result.ok) { noteConv(result.conv); refresh(); }
}
/** The messages to show for a conversation key: confirmed ones, then anything still pending or failed. */
export const threadView = (key) => outbox.thread(key, S.threads.get(key)?.messages || []);

async function deliver(entry) {
  const guard = setTimeout(() => { if (outbox.expire(Date.now())) refresh(); }, SEND_TIMEOUT_MS + 50);
  const result = await call('/api/social/messages', { ...entry.target, body: entry.body, clientId: entry.clientId });
  clearTimeout(guard);
  if (result.ok) {
    const thread = threadOf(result.conv.id);
    thread.messages = mergeMessages(thread.messages, [result.message]);
    const provisional = entry.key;
    if (provisional !== result.conv.id) { if (S.openConv === provisional) S.openConv = result.conv.id; outbox.rekey(provisional, result.conv.id); if (!thread.loaded) void openThread(result.conv.id); }
    outbox.confirm(entry.clientId);
    noteConv(result.conv);
  } else outbox.fail(entry.clientId, result.reason, result.code);
  refresh();
}
/** Queue a message: it shows at once as pending, then becomes sent or failed. `target` is { to } or { conv }. */
export function send(key, target, body) {
  const entry = outbox.add(key, body, newClientId(), Date.now());
  entry.target = target;
  refresh();
  void deliver(entry);
}
/** Send a failed message again under the same client id, so the server stores it at most once. */
export function retry(clientId) {
  const entry = outbox.retry(clientId, Date.now());
  if (!entry) return;
  refresh();
  void deliver(entry);
}
export function discard(clientId) { outbox.discard(clientId); refresh(); }

/**
 * While the server lists an accepted visit, this socket joins the HOST's Home room (the server
 * admits it only from its own guest list). That gives truthful presence in the house; the house
 * chat itself is the conversation in Messages. Presence and text only: nothing here touches voice.
 */
function joinHouse() {
  const visit = S.me?.visiting;
  if (!visit || !visit.cityId) { if (S.houseRoom) { S.houseRoom = null; } joiningHouse = null; return; }
  if (S.houseRoom?.host === visit.host.id || joiningHouse === visit.host.id || ws?.readyState !== 1) return;
  joiningHouse = visit.host.id;
  ws.send(JSON.stringify({ type: 'join', cityId: visit.cityId, venueId: 'home', hostId: visit.host.id }));
}

// ---- live pushes ----------------------------------------------------------------------------
function receive(event) {
  let message; try { message = JSON.parse(event.data); } catch { return; }
  if (!message || typeof message.type !== 'string') return;
  const type = message.type;
  if (type === 'dm' && message.conv && message.message) {
    const thread = threadOf(message.conv.id);
    thread.messages = mergeMessages(thread.messages, [message.message]);
    noteConv(message.conv);
    const mine = message.message.from?.id === S.me?.me.id;
    if (S.openConv === message.conv.id) { if (!mine) void markRead(message.conv.id); }
    else if (!mine && !message.message.sys) S.api.toast(`New message from ${message.message.from?.name ?? message.conv.name}`);
    refresh();
  } else if (type === 'social-update' && message.update) {
    if (S.me) S.me.updates = [message.update, ...S.me.updates.filter((item) => item.id !== message.update.id)];
    S.api.toast(String(message.update.text ?? ''));
    refresh();
  } else if (type === 'presence' && Array.isArray(message.members)) {
    // Only ever received for a host's Home room this socket joined as a guest.
    if (joiningHouse || S.houseRoom) { S.houseRoom = { host: joiningHouse ?? S.houseRoom.host, members: message.members.map((member) => ({ id: member.id, name: member.name })) }; joiningHouse = null; refresh(); }
  } else if (type === 'error' && ['visit_ended', 'not_a_guest', 'venue_mismatch'].includes(message.code)) {
    S.houseRoom = null; joiningHouse = null;
    void sync();
  } else if (type === 'people' && message.ok) {
    S.people = message; S.peopleAt = S.api.view().now;
    peopleChanged(); refresh();
  } else if (type === 'people-changed') {
    void loadPeople();
  } else if (type === 'people-presence') {
    const friend = S.me?.friends.find((item) => item.id === message.id);
    if (friend) { friend.status = message.status === 'online' ? 'away' : 'reconnecting'; delete friend.venue; refresh(); }
    // One follow-up read settles "reconnecting" into online or offline once the grace period is over.
    setTimeout(() => { void sync(); if (S.people) void loadPeople(); }, message.status === 'online' ? 1500 : 22000);
  } else if (type === 'people-interaction') {
    S.api.toast(`${message.from?.name ?? 'Someone'}: ${message.label ?? 'said hello'}${message.landed === false ? ' (it flopped)' : ''}`);
  } else if (type === 'invite-answer') {
    if (S.knock && S.knock.host === message.host?.id) S.knock = { ...S.knock, status: message.answer === 'accepted' ? 'accepted' : 'declined' };
    void sync();
  } else if (type === 'transfer') {
    refreshLife(); void sync();
  } else if (['social-sync', 'friend-request', 'friend-accepted', 'invite-knock', 'invite-house'].includes(type)) {
    if (['social-sync', 'friend-request', 'friend-accepted'].includes(type)) { profileVersion += 1; S.profiles.clear(); }
    if (type === 'social-sync') refreshLife();
    void sync();
  }
}

function connectSocket() {
  clearTimeout(timer); timer = null;
  if (ws || !connected()) return;
  S.socket = attempts ? 'reconnecting' : 'connecting';
  const current = ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/socket`);
  current.onopen = () => { attempts = 0; S.socket = 'open'; for (const id of S.threads.keys()) if (S.threads.get(id).loaded) void openThread(id); void sync(); watchPeople(); };
  current.onmessage = receive;
  current.onclose = () => {
    if (ws !== current) return;
    ws = null; S.houseRoom = null; joiningHouse = null;
    if (connected() && attempts < MAX_ATTEMPTS) { S.socket = 'reconnecting'; timer = setTimeout(connectSocket, Math.min(1000 * 2 ** attempts, 15000)); attempts += 1; }
    else S.socket = 'offline';
    refresh();
  };
}
/** Manual reconnect after the automatic attempts ran out. */
export function reconnect() { attempts = 0; connectSocket(); refresh(); }

/** Called from every social panel's bind(): idempotent. */
export function start(api) {
  S.api = api;
  if (!started) {
    started = true;
    S.linkHost = inviteIdFrom(location.pathname) || inviteIdFrom(location.search);
    window.addEventListener('online', () => { if (!ws) reconnect(); });
  }
  if (!connected()) return;
  if (!ws && S.socket !== 'offline' && !timer) connectSocket();
  if (!S.me && !S.loading && !S.error) void sync();
  if (S.linkHost && S.me) {
    const host = S.linkHost; S.linkHost = null;
    try { history.replaceState(null, '', '/'); } catch {}
    api.open('invite', { host });
  }
}

/** Shared bits of markup. */
export const socketNote = () => (S.socket === 'open' ? '' : S.socket === 'offline'
  ? '<p class="social-note is-warn">Live updates are off. <button class="social-link" data-social-reconnect>Reconnect</button></p>'
  : '<p class="social-note">Connecting live updates… new messages still load when you open a chat.</p>');
export function bindCommon(root, api) {
  start(api);
  root.querySelector('[data-social-reconnect]')?.addEventListener('click', reconnect);
  root.querySelector('[data-social-retry]')?.addEventListener('click', () => { S.error = null; void sync(); });
}
/** Standard not-ready states; returns '' when the overview is loaded. */
export function gate(view) {
  if (view.onboarding?.required) return '<p class="social-note">Finish creating your Sim first. People and messages open once you have moved in.</p>';
  if (!view.connected) return '<p class="social-note is-warn">You are offline. People and messages are read-only until you reconnect.</p>';
  if (S.error && !S.me) return `<p class="social-note is-warn">Could not load: ${escapeText(S.error)} <button class="social-link" data-social-retry>Retry</button></p>`;
  if (!S.me) return '<p class="social-note">Loading…</p>';
  return '';
}
const escapeText = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
