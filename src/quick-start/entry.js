/**
 * OWNER: quick start
 * The browser side of the quick start: what the device keeps between reloads, and the funnel
 * events. Every decision is in ./model.js (pure); this file only reads and writes storage, the
 * address bar and one window event. It is in the first download, so it holds only what every page load needs; the draft
 * of the landing screen is ./draft.js, fetched with that screen.
 *
 * KEPT ON THIS DEVICE (localStorage; a browser without storage keeps them in memory for the visit)
 *   joinallworld-quick-start   { name, look, landedAt, nameEdited, shuffles, preset } — the draft on the
 *                              landing screen, so a reload in the middle of the form loses nothing
 *   joinallworld-quick-play    { look, actionId? } — Play was tapped and the look is not confirmed by the
 *                              server yet. The action id is made once (after the session exists, so it
 *                              carries server time) and reused by every retry and after every reload:
 *                              the server applies it exactly once.
 *   joinallworld-quick-join    the public id an invite link pointed at, until the landing was handled
 *   joinallworld-quick-table   the table id a table link carried, until the Tables app was opened on it
 *   allworld-ref               { code, at } — the share code a link carried, until it was attached as a referral (the
 *                              growth client reads the same key; a code is dropped after a week)
 *   joinallworld-quick-nudge   { [life]: { count, reasons, day } } — how often settling in was offered
 *   joinallworld-quick-landed  1 once the landing screen was shown, so 'landed' is reported once per device
 * None of it is a credential: the session is the cookie the server sets, exactly as before.
 *
 * FUNNEL EVENTS — window 'jaw:track' { name, props }: src/telemetry/index.js listens, and src/telemetry/events.js is the
 * catalogue every name and property here is listed in (a property that is not listed there is dropped before sending).
 * Every event carries `ms`: milliseconds since this device first landed (kept across reloads).
 *   landed                     the landing screen was shown to a new device            { join: boolean }
 *   named                      Play was tapped with this name                          { edited: boolean, length }
 *   quick_look_done            …and this look                                          { shuffles, preset, edited }
 *   play_tapped                Play was tapped                                         { taps }  (taps on the landing screen, Play included)
 *   arrived                    the server confirmed the quick start                    { venue }
 *   first_activity_started     { activity, venue }
 *   first_activity_completed   the first reward                                        { venue, server_ms } (server_ms: server time from the life's creation)
 *   save_character_offered     the "Make this life yours" sheet opened                 { trigger, step }
 *   settle_traits_done · settle_dream_done · settle_lottery_done                       each deferred step
 *   save_character_done        moved in ('life.started')                               { activities }
 *   join_landed                an invite link was handled                              { code }
 *   invite_opened              the page was opened from an invite / share / table link { kind: 'house' | 'share' | 'table', has_session }
 *
 * ONE LANDING. A link may carry `join` (or /v/<id>): the player to stand beside; `ref` (or the older `s`, or /s/<code> on a
 * host that serves the game for that path): the share code, attached as a referral once the life exists; `table`: a table to
 * open. captureLink() reads all three once, before anything rewrites the address, and src/life-main.js handles them in that
 * order after the quick start — one banner, then the table.
 */
import { nudgeMemory, joinIdFrom, linkParts } from './model.ts';

const KEYS = { draft: 'joinallworld-quick-start', play: 'joinallworld-quick-play', join: 'joinallworld-quick-join', nudge: 'joinallworld-quick-nudge', landed: 'joinallworld-quick-landed', table: 'joinallworld-quick-table', ref: 'allworld-ref' };
const REF_KEEP_MS = 7 * 86400000;
const memory = new Map(); // the fallback when storage is off
let storage = null;
try { storage = globalThis.localStorage ?? null; } catch { storage = null; }

function read(key) {
  try { const text = storage ? storage.getItem(key) : null; return text ? JSON.parse(text) : memory.get(key) ?? null; } catch { return memory.get(key) ?? null; }
}
function write(key, value) {
  if (value === null) memory.delete(key); else memory.set(key, value);
  try { if (value === null) storage?.removeItem(key); else storage?.setItem(key, JSON.stringify(value)); } catch { /* kept in memory for this visit */ }
}

// ---- the draft -----------------------------------------------------------------------------
/** The draft the landing screen edits lives in ./draft.js (fetched with that screen); it is held here so forgetDraft can drop it. */
export const kept = { draft: null };
/** For ./draft.js: this file's storage and keys. */
export const store = { read, write, KEYS };
let landed = null;
/** True while life-main is sending a tapped Play: the landing screen stays out of the way until it has an answer. */
export const play = { sending: false };
/** The moment this device first landed (kept with the draft, so it survives a reload): what every funnel event's `ms` counts from. */
export function landedAt() {
  if (landed === null) { const saved = read(KEYS.draft)?.landedAt; landed = Number.isFinite(saved) && saved > 0 && saved <= Date.now() ? saved : Date.now(); }
  return landed;
}
/** The first minute is over (the life has moved in, or belongs to a returning player): forget the drafts. */
export function forgetDraft() { kept.draft = null; write(KEYS.draft, null); write(KEYS.play, null); write(KEYS.landed, null); }

// ---- Play, until the server has confirmed it ---------------------------------------------------
/** @returns {{ look: object, actionId?: string } | null} */
export const pendingPlay = () => { const kept = read(KEYS.play); return kept && typeof kept === 'object' && kept.look && typeof kept.look === 'object' ? kept : null; };
export const keepPlay = (play) => write(KEYS.play, play);

// ---- the invite landing ------------------------------------------------------------------------
/** The public id this visit's link points at (read once from the address, then kept until handled). */
export function joinTarget() {
  const fromLink = typeof location === 'undefined' ? null : joinIdFrom(location.pathname, location.search);
  if (fromLink) write(KEYS.join, fromLink);
  const kept = read(KEYS.join);
  return typeof kept === 'string' && joinIdFrom('/', `?join=${kept}`) ? kept : null;
}
export const forgetJoin = () => write(KEYS.join, null);

/**
 * Read the link this page was opened with, once: `join`, `ref` and `table` are kept on the device until each is handled,
 * so a reload in the middle of the quick start loses none of them. Returns what the address carried (for the funnel).
 * @returns {{ join: string | null, ref: string | null, table: string | null }}
 */
let captured = null;
export function captureLink() {
  if (captured) return captured;
  captured = { join: null, ref: null, table: null };
  if (typeof location === 'undefined') return captured;
  captured.join = joinIdFrom(location.pathname, location.search);
  if (captured.join) write(KEYS.join, captured.join);
  const link = linkParts(location.pathname, location.search);
  if (link.ref) { captured.ref = link.ref; write(KEYS.ref, { code: link.ref, at: Date.now() }); }
  if (link.table) { captured.table = link.table; write(KEYS.table, link.table); }
  return captured;
}
/** The share code waiting to be attached as a referral, or null (a code is kept for a week). */
export function pendingRef() { const kept = read(KEYS.ref); if (!kept || typeof kept.code !== 'string') return null; if (!(Date.now() - kept.at < REF_KEEP_MS)) { write(KEYS.ref, null); return null; } return linkParts('/', `?ref=${kept.code}`).ref; }
export const forgetRef = () => write(KEYS.ref, null);
/** The table a link asked for, until the Tables app has been opened on it. */
export function pendingTable() { const kept = read(KEYS.table); return typeof kept === 'string' ? linkParts('/', `?table=${kept}`).table : null; }
export const forgetTable = () => write(KEYS.table, null);

/**
 * A random token made once per browser ('allworld-device'). It is sent with a referral link and with the growth hello and is
 * only ever kept on the server as a salted hash: it lets the server refuse "a new life on the same phone through your own link".
 */
export function deviceToken() {
  let token = read('allworld-device');
  if (typeof token !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(token)) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    token = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    write('allworld-device', token);
  }
  return token;
}

// ---- nudges ------------------------------------------------------------------------------------
export const nudgesOf = (life) => nudgeMemory(read(KEYS.nudge)?.[life]);
export function keepNudges(life, value) { write(KEYS.nudge, { [life]: value }); } // one life per device is enough to remember

// ---- funnel ------------------------------------------------------------------------------------
/** Report one funnel event. Never throws; with nobody listening it does nothing. */
export function track(name, props = {}) {
  try {
    window.dispatchEvent(new CustomEvent('jaw:track', { detail: { name, props: { ...props, ms: Math.max(0, Date.now() - landedAt()) } } }));
  } catch { /* telemetry must never break the game */ }
}
