/**
 * What telemetry itself derives from the states the server sends (pure: no DOM, no clock of its own, no SDK).
 *
 * ONE SOURCE PER EVENT. The first-minute funnel — landed, named, quick_look_done, play_tapped, arrived,
 * first_activity_started/completed, the settle-in steps, save_character_offered/done, join_landed — is reported by the quick
 * start itself (src/quick-start/entry.js track → 'jaw:track'), with its own timings. Nothing here repeats it. This file adds
 * only what no screen reports: every completed activity, the first trip and the first shift of a life, a new day in the
 * city (the missions' day count, which only ever goes up) and showing up at an event.
 *
 * The client never decides a rule; it only compares the last accepted state with the next one and names what happened.
 * Each once-per-life milestone is recorded in `memo.done`, so it is reported once on this device however often the state is
 * polled or the page reloaded.
 *
 * @typedef {{ done: string[], t: Record<string, number> }} Memo   what has been reported for one player, and when
 * @typedef {[name: string, props: Record<string, string | number | boolean | undefined>]} Event
 */

/** @returns {Memo} */
export const newMemo = () => ({ done: [], t: {} });
const once = (memo, key) => (memo.done.includes(key) ? false : (memo.done.push(key), true));
const since = (from, now) => (Number.isFinite(from) && Number.isFinite(now) ? Math.max(0, Math.round(now - from)) : undefined);

/** The server created a session for this player: the moment the per-life timings count from. `now` is server time. */
export function sessionStarted(memo, now) { if (!Number.isFinite(memo.t.session)) memo.t.session = now; }

/**
 * What an accepted state means.
 * @param {any} previous  the state before
 * @param {any} next      the accepted state
 * @param {Memo} memo
 * @param {{ now: number, baseline?: boolean, pending?: string | null }} ctx
 *   now       server time
 *   baseline  `previous` is not the state this one followed (first state after connecting, another
 *             city's life): nothing is read from the difference, and a milestone the life already
 *             has is reported with `backfill: true` and no timing
 *   pending   the action type being answered ('cancel' ends an activity without completing it)
 * @returns {Event[]}
 */
export function stateEvents(previous, next, memo, { now, baseline = false, pending = null }) {
  /** @type {Event[]} */
  const events = [];
  if (!next?.onboarding) return events;
  const session = () => since(memo.t.session, now);
  const ran = previous?.activeAction;
  if (!baseline && ran?.kind === 'activity' && pending !== 'cancel' && !(next.activeAction?.kind === 'activity' && next.activeAction.id === ran.id)) {
    events.push(['activity_completed', { activity_id: ran.id, venue_id: previous.location }]);
  }
  if (next.travel?.trips > 0 && once(memo, 'first_travel')) {
    const old = baseline || previous?.travel?.trips > 0;
    events.push(['first_travel', { mode: next.travel.lastTrip?.mode, ...(old ? { backfill: true } : { ms_since_session: session() }) }]);
  }
  if (next.completedShifts > 0 && once(memo, 'first_job_shift')) {
    const old = baseline || previous?.completedShifts > 0;
    events.push(['first_job_shift', { job_id: typeof next.job === 'string' ? next.job : undefined, ...(old ? { backfill: true } : { ms_since_session: session() }) }]);
  }
  // A new day lived in the city: the missions' count of active days went up (it never goes down, and never by absence).
  const days = next.missions?.active?.days, before = previous?.missions?.active?.days;
  if (!baseline && Number.isSafeInteger(days) && Number.isSafeInteger(before) && days > before) events.push(['streak_day', { days, stamps: next.missions.stamps?.days }]);
  // Showed up at an event of the calendar: the life's count of events attended went up.
  const joined = next.events?.count, joinedBefore = previous?.events?.count;
  if (!baseline && Number.isSafeInteger(joined) && Number.isSafeInteger(joinedBefore) && joined > joinedBefore) events.push(['event_joined', { venue_id: next.location, total: joined }]);
  return events;
}
