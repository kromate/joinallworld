/**
 * The activation funnel, derived from the states the server sends (pure: no DOM, no clock of its
 * own, no SDK). Kept small: this file is part of the first download.
 *
 * The client never decides a rule; it only compares the last accepted state with the next one and
 * names what happened. Each milestone is recorded in `memo.done`, so it is reported once per life
 * on this device however often the state is polled or the page reloaded.
 *
 * @typedef {{ done: string[], t: Record<string, number> }} Memo   what has been reported for one player, and when
 * @typedef {[name: string, props: Record<string, string | number | boolean | undefined>]} Event
 */
export const STEPS = ['look', 'traits', 'dream', 'lottery', 'home'];

/** @returns {Memo} */
export const newMemo = () => ({ done: [], t: {} });
const once = (memo, key) => (memo.done.includes(key) ? false : (memo.done.push(key), true));
const since = (from, now) => (Number.isFinite(from) && Number.isFinite(now) ? Math.max(0, Math.round(now - from)) : undefined);

/** A browser without a session was shown the nickname entry. `wall` is the device clock. */
export function landed(memo, wall) {
  if (!once(memo, 'landed')) return [];
  memo.t.landed = wall;
  return [['landed', {}]];
}

/** The server created a session for the nickname. `now` is server time, `wall` the device clock. */
export function named(memo, now, wall) {
  if (!once(memo, 'named')) return [];
  memo.t.session = now; memo.t.step = now;
  return [['named', { ms_since_landed: since(memo.t.landed, wall) }]];
}

/**
 * What an accepted state means for the funnel.
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
  const o = next?.onboarding, before = previous?.onboarding;
  const session = () => since(memo.t.session, now);
  if (!o) return events;
  if (!baseline && before && !before.done && o.step > before.step) {
    for (let index = before.step; index < Math.min(o.step, STEPS.length); index += 1) {
      if (once(memo, `step${index}`)) events.push(['character_step_completed', { step: STEPS[index], step_index: index, ms_in_step: since(memo.t.step, now), ms_since_session: session() }]);
    }
    memo.t.step = now;
  }
  if (o.done && !o.legacy && once(memo, 'character_done')) {
    const old = baseline || before?.done === true;
    events.push(['character_done', { house: o.house ?? undefined, lottery: o.lottery?.id, ...(old ? { backfill: true } : { ms_since_session: session() }) }]);
  }
  const ran = previous?.activeAction;
  if (!baseline && ran?.kind === 'activity' && pending !== 'cancel' && !(next.activeAction?.kind === 'activity' && next.activeAction.id === ran.id)) {
    const props = { activity_id: ran.id, venue_id: previous.location };
    events.push(['activity_completed', props]);
    if (once(memo, 'first_activity')) events.push(['first_activity', { ...props, ms_since_session: session(), ms_since_character_done: since(o.completedAt, now) }]);
  }
  if (next.travel?.trips > 0 && once(memo, 'first_travel')) {
    const old = baseline || previous?.travel?.trips > 0;
    events.push(['first_travel', { mode: next.travel.lastTrip?.mode, ...(old ? { backfill: true } : { ms_since_session: session() }) }]);
  }
  if (next.completedShifts > 0 && once(memo, 'first_job_shift')) {
    const old = baseline || previous?.completedShifts > 0;
    events.push(['first_job_shift', { job_id: typeof next.job === 'string' ? next.job : undefined, ...(old ? { backfill: true } : { ms_since_session: session() }) }]);
  }
  return events;
}
