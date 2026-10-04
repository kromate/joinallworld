/**
 * What telemetry itself derives from the states the server sends (pure: no DOM, no clock of its own, no SDK).
 *
 * ONE SOURCE PER EVENT. The first-minute funnel — landed, named, quick_look_done, play_tapped, arrived,
 * first_activity_started/completed, the settle-in steps, save_character_offered/done, join_landed — is reported by the quick
 * start itself (src/quick-start/entry.ts track → 'jaw:track'), with its own timings. Nothing here repeats it. This file adds
 * only what no screen reports: every completed activity, the first trip and the first shift of a life, a new day in the
 * city (the missions' day count, which only ever goes up) and showing up at an event.
 *
 * The client never decides a rule; it only compares the last accepted state with the next one and names what happened.
 * Each once-per-life milestone is recorded in `memo.done`, so it is reported once on this device however often the state is
 * polled or the page reloaded.
 */

/** What has been reported for one player, and when. */
export interface Memo { done: string[]; t: Record<string, number> }
export type FunnelEvent = [name: string, props: Record<string, string | number | boolean | null | undefined>];
/** The part of a server state that telemetry reads (everything else is ignored). */
export interface FunnelState {
  onboarding?: unknown;
  activeAction?: { kind?: string; id?: string } | null;
  location?: string;
  travel?: { trips?: number; lastTrip?: { mode?: string | null } | null } | null;
  completedShifts?: number;
  job?: unknown;
  missions?: { active?: { days?: number } | null; stamps?: { days?: number } | null } | null;
  events?: { count?: number } | null;
}

export const newMemo = (): Memo => ({ done: [], t: {} });
const once = (memo: Memo, key: string) => (memo.done.includes(key) ? false : (memo.done.push(key), true));
const since = (from: number | undefined, now: number) => (typeof from === 'number' && Number.isFinite(from) && Number.isFinite(now) ? Math.max(0, Math.round(now - from)) : undefined);

/** The server created a session for this player: the moment the per-life timings count from. `now` is server time. */
export function sessionStarted(memo: Memo, now: number): void { if (!Number.isFinite(memo.t.session)) memo.t.session = now; }

/**
 * What an accepted state means.
 * `previous` is the state before, `next` the accepted state, `ctx`:
 *   now       server time
 *   baseline  `previous` is not the state this one followed (first state after connecting, another
 *             city's life): nothing is read from the difference, and a milestone the life already
 *             has is reported with `backfill: true` and no timing
 *   pending   the action type being answered ('cancel' ends an activity without completing it)
 */
export function stateEvents(previous: FunnelState | null | undefined, next: FunnelState | null | undefined, memo: Memo, { now, baseline = false, pending = null }: { now: number, baseline?: boolean, pending?: unknown }): FunnelEvent[] {
  const events: FunnelEvent[] = [];
  if (!next?.onboarding) return events;
  const session = () => since(memo.t.session, now);
  const ran = previous?.activeAction;
  if (!baseline && ran?.kind === 'activity' && pending !== 'cancel' && !(next.activeAction?.kind === 'activity' && next.activeAction.id === ran.id)) {
    events.push(['activity_completed', { activity_id: ran.id, venue_id: previous?.location }]);
  }
  if ((next.travel?.trips ?? 0) > 0 && once(memo, 'first_travel')) {
    const old = baseline || (previous?.travel?.trips ?? 0) > 0;
    events.push(['first_travel', { mode: next.travel?.lastTrip?.mode, ...(old ? { backfill: true } : { ms_since_session: session() }) }]);
  }
  if ((next.completedShifts ?? 0) > 0 && once(memo, 'first_job_shift')) {
    const old = baseline || (previous?.completedShifts ?? 0) > 0;
    events.push(['first_job_shift', { job_id: typeof next.job === 'string' ? next.job : undefined, ...(old ? { backfill: true } : { ms_since_session: session() }) }]);
  }
  // A new day lived in the city: the missions' count of active days went up (it never goes down, and never by absence).
  const days = next.missions?.active?.days, before = previous?.missions?.active?.days;
  if (!baseline && typeof days === 'number' && Number.isSafeInteger(days) && typeof before === 'number' && Number.isSafeInteger(before) && days > before) events.push(['streak_day', { days, stamps: next.missions?.stamps?.days }]);
  // Showed up at an event of the calendar: the life's count of events attended went up.
  const joined = next.events?.count, joinedBefore = previous?.events?.count;
  if (!baseline && typeof joined === 'number' && Number.isSafeInteger(joined) && typeof joinedBefore === 'number' && Number.isSafeInteger(joinedBefore) && joined > joinedBefore) events.push(['event_joined', { venue_id: next.location, total: joined }]);
  return events;
}
