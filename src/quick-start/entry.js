/**
 * OWNER: quick start
 * The browser side of the quick start: what the device keeps between reloads, and the funnel
 * events. Every decision is in ./model.js (pure); this file only reads and writes storage, the
 * address bar and one window event.
 *
 * KEPT ON THIS DEVICE (localStorage; a browser without storage keeps them in memory for the visit)
 *   joinallworld-quick-start   { name, look, landedAt, nameEdited, shuffles, preset } — the draft on the
 *                              landing screen, so a reload in the middle of the form loses nothing
 *   joinallworld-quick-play    { look, actionId? } — Play was tapped and the look is not confirmed by the
 *                              server yet. The action id is made once (after the session exists, so it
 *                              carries server time) and reused by every retry and after every reload:
 *                              the server applies it exactly once.
 *   joinallworld-quick-join    the public id an invite link pointed at, until the landing was handled
 *   joinallworld-quick-nudge   { [life]: { count, reasons, day } } — how often settling in was offered
 * None of it is a credential: the session is the cookie the server sets, exactly as before.
 *
 * FUNNEL EVENTS — window 'jaw:track' { name, props } (the telemetry branch listens). Every event
 * carries `ms`: milliseconds since this device first landed (kept across reloads).
 *   landed                     the landing screen was shown to a new device            { join: boolean }
 *   named                      Play was tapped with this name                          { edited: boolean, length }
 *   quick_look_done            …and this look                                          { shuffles, preset, edited }
 *   play_tapped                Play was tapped                                         { taps }  (taps on the landing screen, Play included)
 *   arrived                    the server confirmed the quick start                    { venue }
 *   first_activity_started     { activity, venue }
 *   first_activity_completed   the first reward                                        { venue, serverMs } (serverMs: server time from the life's creation)
 *   save_character_offered     the "Make this life yours" sheet opened                 { reason }
 *   settle_traits_done · settle_dream_done · settle_lottery_done                       each deferred step
 *   save_character_done        moved in ('life.started')                               { activities }
 *   join_landed                an invite link was handled                              { code }
 */
import { draftFrom, nudgeMemory, joinIdFrom } from './model.js';

const KEYS = { draft: 'joinallworld-quick-start', play: 'joinallworld-quick-play', join: 'joinallworld-quick-join', nudge: 'joinallworld-quick-nudge' };
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
let draft = null, landed = null;
/** True while life-main is sending a tapped Play: the landing screen stays out of the way until it has an answer. */
export const play = { sending: false };
/** The draft the landing screen edits (made on first use, then kept). `name`: a name this device already uses. */
export function quickDraft(name) {
  draft ??= draftFrom(read(KEYS.draft), { random: Math.random, now: Date.now(), name });
  landed ??= draft.landedAt;
  return draft;
}
/** Change the draft and keep it. */
export function keepDraft(changes) { draft = { ...quickDraft(), ...changes }; write(KEYS.draft, draft); return draft; }
/** The first minute is over (the life has moved in, or belongs to a returning player): forget the drafts. */
export function forgetDraft() { draft = null; write(KEYS.draft, null); write(KEYS.play, null); }

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

// ---- nudges ------------------------------------------------------------------------------------
export const nudgesOf = (life) => nudgeMemory(read(KEYS.nudge)?.[life]);
export function keepNudges(life, value) { write(KEYS.nudge, { [life]: value }); } // one life per device is enough to remember

// ---- funnel ------------------------------------------------------------------------------------
/** Report one funnel event. Never throws; with nobody listening it does nothing. */
export function track(name, props = {}) {
  try {
    landed ??= quickDraft().landedAt;
    window.dispatchEvent(new CustomEvent('jaw:track', { detail: { name, props: { ...props, ms: Math.max(0, Date.now() - landed) } } }));
  } catch { /* telemetry must never break the game */ }
}
