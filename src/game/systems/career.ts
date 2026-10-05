import { jobsFor, jobFor, venueFor } from '../cities/runtime.ts';
import { cachedCityContent, cityModule } from '../cities/registry.ts';
/**
 * OWNER: career
 * Jobs, schedules, shifts, performance and promotion.
 *
 * HOW A CAREER WORKS (original beta design)
 *   - Applying is free and hires at once. One job at a time.
 *   - A shift is an ordinary timed activity at the workplace's `work` spot. It needs minimum
 *     Energy and Hunger, pays on completion through the wallet ledger, uses Energy and Hunger,
 *     and trains the track's skill. Cancelling earns nothing and costs nothing.
 *   - ONE paid career shift per Lagos day, at any hour, on the track's work days. The day a
 *     shift counts for is the day it STARTED, so a shift that runs past midnight never uses up
 *     the next day. Switching jobs does not unlock a second shift the same day.
 *   - Orientation: a player who has never completed a career shift may work their first one on
 *     a day off, so a new player can always earn in their first session.
 *   - Each completed shift adds performance (base PERFORMANCE_PER_SHIFT, adjusted by the
 *     'career.performance' modifier). Performance never falls. At 100% with the track skill at
 *     the next role's level the player is promoted on the spot and performance restarts at 50%.
 *   - "Go automatically" (on by default): when a shift can be worked, the workplace is open and
 *     the minimum needs are met, the server starts a free, cancellable commute to the workplace
 *     — at most once per Lagos day, and never while another timed action is running. The
 *     commute arrives at the workplace's `work` spot.
 *   - WORKPLACE HOURS. A shift itself ignores opening hours (staff inside can clock in at any
 *     hour), but getting there does not: travel and the commute are refused while the venue is
 *     closed. Every track's venue is open at some time on each of its work days (asserted in
 *     career.test.ts), and the Jobs and Career screens show the venue's hours next to the
 *     schedule using the same label as the map (clock.openingInfo).
 *   - Switching tracks restarts at level 1 and 50% performance. 'apply-job' never switches: a
 *     switch is its own action, so no client can skip the warning by accident.
 *   - One job at a time: taking a career job replaces the starter job and vice versa.
 *   - The starter Community helper job (original beta gameplay, kept for existing saves): any
 *     time of day, no ladder, no automatic commute, and one shift per HELPER_COOLDOWN_SECONDS
 *     so it can never out-earn a career track.
 *
 * ACTIONS
 *   'apply-job'      { id }          apply while unemployed. Holding another job it is refused with
 *                                    'confirm_switch'; nothing else is accepted through its payload.
 *   'career.switch'  { id }          leave the current job for another (the confirmed switch)
 *   'career.quit'    {}              leave the current job
 *   'career.auto'    { on: bool }    toggle "Go automatically"
 *
 * STATE
 *   job              legacy top-level: job id | null (activities read it for requiresJob)
 *   completedShifts  legacy top-level: lifetime count of completed shifts in any job
 *   career           { level, performance, shifts, auto, lastShiftDay, shiftStartDay, autoDay, oriented }
 *     level          1-based ladder level in the current track (1 when unemployed)
 *     performance    0–100 in the current role
 *     shifts         completed shifts in the current job
 *     auto           "Go automatically"
 *     lastShiftDay   Lagos day index the last paid career shift counted for | null  (idempotency key)
 *     shiftStartDay  Lagos day index the running career shift started on | null
 *     autoDay        Lagos day index of the last automatic commute | null
 *     oriented       true once any career shift has been completed
 *
 * EMITS
 *   'job.applied'     { job }
 *   'job.quit'        { job }
 *   'shift.completed' { job, activity, pay, level }   level and pay are those the shift was worked at
 *   'promotion'       { job, level, role, maxLevel, top }   maxLevel = levels in the track's ladder
 *   'notice.posted'   { kind: 'promotion', text }           a line for the Updates feed
 *   ('job.applied' and 'shift.completed' carry maxLevel too, for track jobs)
 * MODIFIERS ASKED
 *   'career.performance'  data { job, level }  base PERFORMANCE_PER_SHIFT — performance gained by a shift
 *   'career.autoCommute'  data { job }         base true — return false to hold "Go automatically" for now
 * MODIFIERS CONTRIBUTED
 *   'activity.reward'  a career shift pays the player's current ladder level (others then adjust it)
 *   'activity.block'   'shift_done' / 'day_off' with the next shift named
 * TIMED-ACTION KIND
 *   'commute' { id: venue }   the automatic commute; free, cancellable, COMMUTE_SECONDS long
 */
import { LEFT_OUT, PLAYS } from '../profile.ts';
import { emit, modify } from '../registry.ts';
import { cap, clamp, fail, finite, isRecord, naira, ok, safeCount } from '../util.ts';
import { lagosTime, openingInfo, WEEKDAYS } from '../clock.ts';
import { addMoodlet, arrive, skillLevel, spotsOf } from '../api.ts';
import { JOBS, TRACKS, MAX_CAREER_LEVEL, START_PERFORMANCE, PERFORMANCE_PER_SHIFT, HELPER_COOLDOWN_SECONDS } from '../content/jobs.ts';
import { venueLabel } from '../content/venues.ts';
import type { LadderRung, JobDefinition, TrackJobDefinition } from '../../types/content.ts';
import type { ActionMap } from '../../types/actions.ts';
import type { ActionOutcome, CareerState, JobId, LifeContext, LifeState, NeedId } from '../../types/life.ts';
import type { SystemDefinition } from '../../types/registry.ts';
import type { CareerStep, CareerView, JobListing, PromotionTarget, ShiftStatusCode } from '../../types/view.ts';

/** Seconds the automatic commute takes (original beta value). */
export const COMMUTE_SECONDS = 5;
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CHIP_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Today's shift status: see shiftStatus. `next` is the one "Next shift: …" label. */
export type ShiftStatus =
  | { code: Extract<ShiftStatusCode, 'available' | 'orientation'>; canWork: true; text: string; next: string }
  | { code: Extract<ShiftStatusCode, 'no_job' | 'working' | 'shift_done' | 'day_off'>; canWork: false; text: string; next: string }

const canonicalJobOf = (id: unknown): JobDefinition | null => typeof id === 'string' ? Object.values(JOBS).find((job) => job.id === id) ?? null : null;
const contentReady = (cityId: string): boolean => Boolean(cachedCityContent(cityId));
const cityHasCareer = (cityId: string, id: unknown): boolean => {
  const canonical = canonicalJobOf(id);
  if (!canonical) return false;
  const module = cityModule(cityId);
  return module ? module.rules.careerIds.includes(canonical.id) : cityId === 'lagos' || cityId === 'ibadan';
};
const jobOf = (id: unknown, cityId: string): JobDefinition | null => contentReady(cityId) ? jobFor(cityId, id) ?? null : null;
/** A job can only be held while its workplace venue is part of this build. */
export const workplaceOpen = (job: JobDefinition, cityId: string): boolean => Boolean(venueFor(cityId, job.workplace.venue));
const placeName = (job: JobDefinition, ctx: LifeContext): string => (workplaceOpen(job, ctx.cityId) ? venueLabel(job.workplace.venue, ctx.cityId) : job.workplaceName);
/** The label of the workplace spot as the venue panel shows it (an existing venue spot keeps its own name). */
const spotName = (job: JobDefinition, cityId: string): string => spotsOf(job.workplace.venue, cityId).find((spot) => spot.id === job.workplace.spot)?.label || 'Work';
const nowOf = (state: LifeState, ctx?: LifeContext): number => { const now = ctx?.now; return finite(now) ? now : state.t; };
/** The ladder rung at an index that is always inside the ladder (six rungs, level clamped); a missing rung would have thrown on the first read. */
const ladderRung = (job: TrackJobDefinition, index: number): LadderRung => {
  const found = job.ladder[index];
  if (found === undefined) throw new RangeError(`No ladder rung ${index} for ${job.id}`);
  return found;
};
/** The track behind a job id that names one (a shift's `careerTrack`); a job without a ladder would have thrown at its first read. */
const trackOf = (id: JobId, cityId: string): TrackJobDefinition => {
  const job = jobOf(id, cityId);
  if (!job) throw new TypeError(`${id} is not a job in ${cityId}`);
  if (!job.track) throw new TypeError(`${id} has no career ladder`);
  return job;
};
const rung = (job: TrackJobDefinition, level: number): LadderRung => ladderRung(job, clamp(level, 1, job.ladder.length) - 1);
const freshCareer = (): CareerState => ({ city: null, level: 1, performance: 0, shifts: 0, auto: true, lastShiftDay: null, shiftStartDay: null, autoDay: null, oriented: false });
const dayIndex = (value: unknown): number | null => (Number.isSafeInteger(value) ? (value as number) : null); // isSafeInteger proved the number

/** "Mon–Fri" for a consecutive run (weeks start on Monday and may wrap to Sunday), else a list. */
export function daysText(days: readonly number[]): string {
  const sorted = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const run = sorted.every((day, index) => index === 0 || (day + 6) % 7 === (((sorted[index - 1] ?? 0) + 6) % 7) + 1); // index > 0 here, so the previous day exists
  return run && sorted.length > 2 ? `${SHORT_DAYS[sorted[0] ?? 0]}–${SHORT_DAYS[sorted.at(-1) ?? 0]}` : sorted.map((day) => SHORT_DAYS[day]).join(', '); // run && length > 2: both ends exist
}

/**
 * The single schedule sentence for a job. The Jobs list, the your-job card and the Career tab
 * all show this string, so two screens can never disagree about when a job is worked.
 */
export function scheduleText(job: JobDefinition): string {
  if (!job.track) return `One shift every ${HELPER_COOLDOWN_SECONDS / 3600} hours, any day`;
  return `One paid shift per work day, any time · ${job.days.length} days a week (${daysText(job.days)})`;
}

/** Opening state of a job's workplace venue (null hours = always open). */
const workplaceOpening = (job: JobDefinition, state: LifeState, ctx?: LifeContext) => openingInfo(venueFor(state.estate.city, job.workplace.venue)?.hours, nowOf(state, ctx));
/**
 * The single workplace-hours sentence, shown next to the schedule in Jobs and Career. The hours
 * come from the same clock.openingInfo label the map card uses.
 */
export function workplaceHoursText(job: JobDefinition, ctx: LifeContext): string {
  if (!workplaceOpen(job, ctx.cityId)) return `${cap(job.workplaceName)} is not open in this build yet.`;
  const hours = openingInfo(venueFor(ctx.cityId, job.workplace.venue)?.hours, 0);
  return hours.always ? `${placeName(job, ctx)} · Open 24 hours` : `${placeName(job, ctx)} · Open ${hours.hours} — you can only travel there while it is open`;
}

function nextWorkDay(job: TrackJobDefinition, weekday: number): string {
  for (let offset = 1; offset <= 7; offset++) {
    const day = (weekday + offset) % 7;
    if (job.days.includes(day)) return offset === 1 ? `tomorrow (${WEEKDAYS[day]})` : WEEKDAYS[day] ?? ''; // day is 0–6
  }
  return 'your next work day';
}

/**
 * Whether today's shift can be worked. Pure.
 * → { code: 'no_job'|'working'|'available'|'orientation'|'shift_done'|'day_off', canWork, text, next }
 *   `next` is the one "Next shift: …" label shown everywhere.
 */
export function shiftStatus(state: LifeState, ctx?: LifeContext): ShiftStatus {
  const job = jobOf(state.job, state.career.city ?? state.estate.city);
  if (!job && state.job && state.career.city && cityHasCareer(state.career.city, state.job)) {
    return { code: 'no_job', canWork: false, text: 'Your job is in another city. Apply for its local career track to work here.', next: 'after choosing a local workplace' };
  }
  if (job && state.career.city !== state.estate.city) return { code: 'no_job', canWork: false, text: 'Your job is in another city. Apply for its local career track to work here.', next: 'after choosing a local workplace' };
  if (!job) return { code: 'no_job', canWork: false, text: 'No job yet.', next: 'after you apply for a job' };
  if (!job.track) return { code: 'available', canWork: true, text: `Starter job: a shift at any hour, then a ${HELPER_COOLDOWN_SECONDS / 3600}-hour break before the next one.`, next: 'now' };
  const today = lagosTime(nowOf(state, ctx));
  const career = state.career;
  const upcoming = nextWorkDay(job, today.weekday);
  const running = state.activeAction?.kind === 'activity' && state.activeAction.id === job.shift.id;
  if (running) return { code: 'working', canWork: false, text: 'Shift in progress. You are paid when it finishes; cancelling earns nothing.', next: upcoming };
  if (career.lastShiftDay === today.day) {
    return { code: 'shift_done', canWork: false, next: upcoming,
      text: `You have already worked today’s paid shift (one per day). Next shift: ${upcoming}.` };
  }
  if (job.days.includes(today.weekday)) return { code: 'available', canWork: true, text: 'Work day: today’s shift is available now.', next: 'now' };
  if (!career.oriented) {
    return { code: 'orientation', canWork: true, next: 'now',
      text: `${WEEKDAYS[today.weekday]} is normally a day off, but your first ever shift (orientation) can be worked today.` };
  }
  return { code: 'day_off', canWork: false, next: upcoming, text: `Day off today (${WEEKDAYS[today.weekday]}). Next shift: ${upcoming}.` };
}

// Object.entries widens the need ids to string; the keys of a NeedMap are need ids.
const shortNeeds = (state: LifeState, job: JobDefinition): [NeedId, number][] => (Object.entries(job.shift.minimumNeeds || {}) as [NeedId, number][]).filter(([need, minimum]) => state.needs[need] < minimum);

/** What the next promotion needs, or null at the top of the ladder / without a track. */
function nextPromotion(state: LifeState, job: JobDefinition | null): PromotionTarget | null {
  if (!job?.track || state.career.level >= job.ladder.length) return null;
  const target = ladderRung(job, state.career.level);
  const have = skillLevel(state, job.skill);
  const performanceMet = state.career.performance >= 100, skillMet = have >= target.skillLevel;
  return { role: target.role, pay: target.pay, level: state.career.level + 1, skill: job.skill, skillLevel: target.skillLevel, have, performanceMet, skillMet,
    text: `Next: ${target.role} (${naira(target.pay)} per shift) — reach 100% performance with ${cap(job.skill)} level ${target.skillLevel}. You have ${Math.floor(state.career.performance)}% and ${cap(job.skill)} ${have}.` };
}

function tryPromote(state: LifeState, ctx: LifeContext): boolean {
  const job = jobOf(state.job, state.career.city ?? state.estate.city);
  const next = nextPromotion(state, job);
  if (!job?.track || !next || !next.performanceMet || !next.skillMet) return false; // a promotion target exists only for a track job
  state.career.level = next.level;
  state.career.performance = START_PERFORMANCE;
  state.message = `Promoted to ${next.role}! ${job.label} shifts now pay ${naira(next.pay)}.`;
  addMoodlet(state, { id: 'promoted', label: 'Promoted', value: 8, duration: 3600 }, ctx); // original beta value
  emit(state, 'promotion', { job: job.id, level: next.level, role: next.role, maxLevel: job.ladder.length, top: next.level >= job.ladder.length }, ctx);
  emit(state, 'notice.posted', { kind: 'promotion', text: `Promoted to ${next.role} (${job.label}). Shifts now pay ${naira(next.pay)}.` }, ctx);
  return true;
}

/** "Go automatically": start the free commute if a shift is waiting. At most once per Lagos day. */
function maybeCommute(state: LifeState, ctx: LifeContext): boolean {
  const job = jobOf(state.job, state.career.city ?? state.estate.city);
  if (!job?.track || !state.career.auto || state.activeAction || !workplaceOpen(job, state.estate.city) || state.location === job.workplace.venue) return false;
  const today = lagosTime(nowOf(state, ctx)).day;
  if (state.career.autoDay === today || !shiftStatus(state, ctx).canWork || shortNeeds(state, job).length) return false;
  // Another system may hold the commute back (the tutorial does, until it asks for a shift).
  if (modify(state, 'career.autoCommute', true, { job: job.id }, ctx) !== true) return false;
  if (!workplaceOpening(job, state, ctx).open) return false; // closed: try again on a later settlement the same day
  state.career.autoDay = today;
  state.activeAction = { kind: 'commute', id: job.workplace.venue, duration: COMMUTE_SECONDS, remaining: COMMUTE_SECONDS };
  state.message = `Go automatically: heading to ${placeName(job, ctx)} for today’s shift. Cancel to stay where you are.`;
  return true;
}

function apply(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext): ActionOutcome<ActionMap['apply-job']['ok'], ActionMap['apply-job']['fail']>;
function apply(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext, switching: true): ActionOutcome<ActionMap['career.switch']['ok'], ActionMap['career.switch']['fail']>;
function apply(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext, switching = false): ActionOutcome<ActionMap['apply-job' | 'career.switch']['ok'], ActionMap['apply-job' | 'career.switch']['fail']> {
  if (state.activeAction) return fail(state, 'busy', 'Finish or cancel your current action before applying.');
  const job = jobOf(payload?.id, ctx.cityId);
  if (!job) return fail(state, 'invalid_job', 'Choose a job from the Jobs list.');
  if (state.job === job.id && state.career.city === ctx.cityId) {
    state.message = `You already work as a ${job.label}. Visit your workplace to start a shift.`;
    return ok(state, 'already_employed');
  }
  if (!workplaceOpen(job, ctx.cityId)) return fail(state, 'workplace_unavailable', `${job.label} is based at ${job.workplaceName}, which is not open in this build yet. Choose a track whose workplace is on the map.`);
  const old = jobOf(state.job, state.career.city ?? state.estate.city);
  if (switching && !old) return fail(state, 'no_job', 'You have no job to switch from. Use Apply instead.');
  if (old && !switching) {
    return fail(state, 'confirm_switch', `Switching to ${job.label} ends your ${old.label} job: you start ${job.track ? `as ${ladderRung(job, 0).role} at ${START_PERFORMANCE}% performance` : 'in the starter job, which has no ladder,'} and lose your ${old.label} level and performance. Confirm the switch to continue.`);
  }
  if (old) emit(state, 'job.quit', { job: old.id }, ctx);
  state.job = job.id;
  state.career.city = ctx.cityId;
  Object.assign(state.career, { level: 1, performance: job.track ? START_PERFORMANCE : 0, shifts: 0, shiftStartDay: null });
  const place = placeName(job, ctx);
  if (!job.track) state.message = `${job.label} job accepted. Visit your workplace to work a shift.`;
  else {
    const status = shiftStatus(state, ctx);
    state.message = `Hired as ${ladderRung(job, 0).role} (${job.label}), ${naira(ladderRung(job, 0).pay)} per shift at ${place}. ${status.canWork ? 'You can work your first shift today.' : `Next shift: ${status.next}.`}`;
  }
  emit(state, 'job.applied', { job: job.id, ...(job.track ? { maxLevel: job.ladder.length } : {}) }, ctx);
  maybeCommute(state, ctx);
  return ok(state, old ? 'switched' : 'applied');
}

function quit(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext) {
  const job = jobOf(state.job, state.career.city ?? state.estate.city);
  if (!job) return fail(state, 'no_job', 'You do not have a job to quit.');
  if (state.activeAction) return fail(state, 'busy', 'Finish or cancel your current action before quitting.');
  state.job = null;
  Object.assign(state.career, { city: null, level: 1, performance: 0, shifts: 0, shiftStartDay: null });
  state.message = `You quit your ${job.label} job. Your level and performance in it are gone; apply again any time to start over.`;
  emit(state, 'job.quit', { job: job.id }, ctx);
  return ok(state, 'quit');
}

function setAuto(state: LifeState, payload: Record<string, unknown>) {
  if (typeof payload?.on !== 'boolean') return fail(state, 'invalid_setting', 'Choose on or off for Go automatically.');
  state.career.auto = payload.on;
  state.message = payload.on ? 'Go automatically is on: you will head to work when a shift is available.' : 'Go automatically is off: use Go to work when you are ready.';
  return ok(state, 'auto_set');
}

/** The player's next step, in one sentence, with where to send them. */
function nextStep(state: LifeState, ctx: LifeContext, job: JobDefinition | null, status: ShiftStatus): CareerStep {
  if (!job) return { kind: 'apply', text: 'Pick a job and tap Apply. Applying is free and you can work your first shift the same day.' };
  const shift = job.shift, place = placeName(job, ctx), pay = payOf(state, job);
  if (status.code === 'working') return { kind: 'wait', text: `Shift in progress: ${naira(pay)} arrives when it finishes. Cancelling earns nothing.` };
  if (state.activeAction?.kind === 'commute') return { kind: 'wait', text: `On your way to ${place}. Open the ${spotName(job, ctx.cityId)} spot when you arrive.` };
  if (!status.canWork) return { kind: 'wait', text: status.text };
  const short = shortNeeds(state, job);
  if (short.length) {
    return { kind: 'home', venue: 'home', text: `Before your shift you need ${short.map(([need, minimum]) => `${cap(need)} ${minimum}+ (you have ${Math.floor(state.needs[need])})`).join(' and ')}. Eat and rest at Home first.` };
  }
  const facts = `It takes ${shift.duration} seconds and pays ${naira(pay)}.`;
  if (state.activeAction) return { kind: 'wait', text: `Finish what you are doing, then go to ${place} for today’s shift. ${facts}` };
  const opening = workplaceOpening(job, state, ctx);
  if (state.location !== job.workplace.venue && !opening.open) {
    return { kind: 'wait', text: `${place} is closed right now${opening.opensAt ? `: it opens ${opening.opensAt}` : ''}. Travel there once it is open to work today’s shift. ${facts}` };
  }
  if (state.location !== job.workplace.venue) return { kind: 'go', venue: job.workplace.venue, spot: job.workplace.spot, text: `Go to ${place} and open the ${spotName(job, ctx.cityId)} spot to start today’s shift. ${facts}` };
  if (state.spot !== job.workplace.spot) return { kind: 'go', venue: job.workplace.venue, spot: job.workplace.spot, text: `You are at ${place}. Open the ${spotName(job, ctx.cityId)} spot to start today’s shift. ${facts}` };
  return { kind: 'start', text: `You are at work. Close this and tap “${shift.label}” to start. ${facts}` };
}

const payOf = (state: LifeState, job: JobDefinition): number => (job.track ? rung(job, state.career.level).pay : job.shift.reward ?? 0); // the starter shift always defines its reward

/**
 * What only a host that plays the game runs: player actions, settling time and event listeners. The browser reads lives, it never plays them,
 * so its build leaves this out (PLAYS is false there: src/game/profile.ts).
 */
const play = PLAYS ? {
  actions: {
    'apply-job': (state, payload, ctx) => apply(state, payload, ctx),
    'career.switch': (state, payload, ctx) => apply(state, payload, ctx, true),
    'career.quit': quit,
    'career.auto': setAuto,
  },
  on: {
    'activity.started'(state, { def }, ctx) {
      if (def?.careerTrack) state.career.shiftStartDay = lagosTime(nowOf(state, ctx)).day;
    },
    'action.cancelled'(state, { kind, id }) {
      if (kind === 'activity' && jobOf(state.job, state.career.city ?? state.estate.city)?.shift.id === id) state.career.shiftStartDay = null;
    },
    'activity.completed'(state, { def }, ctx) {
      if (!def?.requiresJob) return;
      const job = jobOf(def.requiresJob, state.career.city ?? state.estate.city);
      state.completedShifts += 1;
      const career = state.career, level = job?.track ? career.level : 1;
      const pay = Math.max(0, Math.round(modify(state, 'activity.reward', def.reward || 0, { def }, ctx)));
      if (job?.track) {
        career.lastShiftDay = career.shiftStartDay ?? lagosTime(nowOf(state, ctx)).day;
        career.shiftStartDay = null;
        career.oriented = true;
        career.shifts += 1;
        const gain = Number(modify(state, 'career.performance', PERFORMANCE_PER_SHIFT, { job: job.id, level }, ctx));
        career.performance = clamp(career.performance + (Number.isFinite(gain) ? Math.max(0, gain) : 0));
      }
      emit(state, 'shift.completed', { job: def.requiresJob, activity: def.id, pay, level, ...(job?.track ? { maxLevel: job.ladder.length } : {}) }, ctx);
      if (job?.track && !tryPromote(state, ctx)) {
        const next = nextPromotion(state, job);
        state.message = `${def.label} completed. You earned ${naira(pay)}. Performance ${Math.floor(career.performance)}%. Next shift: ${shiftStatus(state, ctx).next}.${next && next.performanceMet && !next.skillMet ? ` Promotion to ${next.role} is waiting on ${cap(job.skill)} level ${next.skillLevel}.` : ''}`;
      }
    },
    'skill.levelup'(state, { skill }, ctx) {
      const job = jobOf(state.job, state.career.city ?? state.estate.city);
      if (job?.track && job.skill === skill) tryPromote(state, ctx); // only a track has a skill
    },
  },
  advance(state, dt, ctx) { maybeCommute(state, ctx); },
} satisfies Pick<SystemDefinition<'career'>, 'actions' | 'on' | 'advance'> : LEFT_OUT;

export default {
  id: 'career',
  stateKeys: ['job', 'completedShifts', 'career'],
  sanitize(input, state, ctx) {
    const saved = isRecord(input.career) ? input.career : {};
    const jobCity = typeof saved.city === 'string' ? saved.city : ctx.cityId;
    const loaded = contentReady(jobCity), job = jobOf(input.job, jobCity), canonical = canonicalJobOf(input.job);
    state.job = loaded ? (job && workplaceOpen(job, jobCity) ? job.id : null) : (canonical && cityHasCareer(jobCity, canonical.id) ? canonical.id : null);
    state.completedShifts = safeCount(input.completedShifts) ? input.completedShifts : 0;
    const held = job ?? canonicalJobOf(state.job);
    const career = freshCareer();
    career.city = state.job ? jobCity : null;
    if (held?.track) {
      career.level = finite(saved.level) && Number.isInteger(saved.level) && saved.level >= 1 && saved.level <= held.ladder.length ? saved.level : 1;
      career.performance = finite(saved.performance) ? clamp(saved.performance) : START_PERFORMANCE;
    }
    career.shifts = safeCount(saved.shifts) ? saved.shifts : 0;
    career.auto = saved.auto !== false;
    career.lastShiftDay = dayIndex(saved.lastShiftDay);
    career.shiftStartDay = dayIndex(saved.shiftStartDay);
    career.autoDay = dayIndex(saved.autoDay);
    career.oriented = saved.oriented === true;
    state.career = career;
  },
  activitiesFor: (cityId) => jobsFor(cityId).filter((job) => job.shift && venueFor(cityId, job.workplace.venue))
    .map((job) => ({ ...job.shift, requiresJob: job.id, where: { ...job.workplace, spotLabel: 'Work', spotIcon: '💼' } })),
  active: {
    commute: {
      moves: true, // the player is on their way out of the venue: no room, no voice, until they arrive or cancel
      sanitize(value, state) {
        const job = jobOf(state.job, state.career.city ?? state.estate.city);
        return job?.track && value.id === job.workplace.venue && value.id !== state.location && value.duration === COMMUTE_SECONDS ? {} : null;
      },
      complete(state, active, ctx) {
        const job = jobOf(state.job, state.career.city ?? state.estate.city);
        if (!arrive(state, active.id, ctx, { spot: job?.workplace.spot, mode: null })) return;
        state.message = `You are at ${venueLabel(active.id, ctx?.cityId)}, at the ${job ? spotName(job, ctx.cityId) : 'Work'} spot. Start ${job ? `your ${job.label} shift` : 'your shift'} when you are ready.`;
      },
    },
  },
  modifiers: {
    'activity.reward': (value, state, { def }) => (def?.careerTrack && state.job === def.careerTrack && state.career.city
      ? rung(trackOf(def.careerTrack, state.career.city), state.career.level).pay
      : value),
    'activity.block'(value, state, { def }, ctx) {
      if (value || !def?.requiresJob) return value;
      if (state.completedShifts >= Number.MAX_SAFE_INTEGER) return { code: 'balance_limit', reason: 'Your shift count has reached its supported limit.' };
      if (!state.career.city || state.career.city !== ctx.cityId) {
        return { code: 'no_job', reason: 'Your job is in another city. Apply for its local equivalent to work here.' };
      }
      if (!def.careerTrack || state.job !== def.careerTrack) return null;
      const status = shiftStatus(state, ctx);
      return status.canWork ? null : { code: status.code, reason: status.text };
    },
  },
  view(state, ctx): CareerView {
    const heldJob = jobOf(state.job, state.career.city ?? state.estate.city);
    const coldJob = !heldJob && state.job && state.career.city && cityHasCareer(state.career.city, state.job) ? canonicalJobOf(state.job) : null;
    const shown = heldJob ?? coldJob;
    const job = state.career.city === state.estate.city ? heldJob : null;
    const status = shiftStatus(state, ctx);
    const today = lagosTime(nowOf(state, ctx));
    const career = state.career;
    const pay = job ? payOf(state, job) : 0;
    return {
      job, // legacy field: the raw catalogue entry
      completedShifts: state.completedShifts,
      employed: Boolean(shown),
      id: shown?.id ?? null,
      label: shown?.label ?? null,
      icon: shown?.icon ?? '💼',
      isTrack: Boolean(shown?.track),
      level: shown?.track ? career.level : null,
      levels: shown?.track ? shown.ladder.length : null,
      role: shown ? (shown.track ? rung(shown, career.level).role : shown.label) : null,
      pay,
      weeklyPay: job?.track ? pay * job.days.length : 0,
      performance: shown?.track ? Math.floor(career.performance) : null,
      shifts: career.shifts,
      schedule: job ? scheduleText(job) : null,
      chips: CHIP_LETTERS.map((letter, weekday) => ({ letter, name: WEEKDAYS[weekday] ?? '', work: job ? (job.track ? job.days.includes(weekday) : true) : false, today: weekday === today.weekday })),
      today: { code: status.code, canWork: status.canWork, text: status.text, weekday: WEEKDAYS[today.weekday] ?? '' },
      nextShift: job ? `Next shift: ${status.next}` : null,
      next: nextPromotion(state, shown),
      topOfLadder: Boolean(shown?.track && career.level >= shown.ladder.length),
      auto: career.auto,
      workplace: job ? { venue: job.workplace.venue, spot: job.workplace.spot, label: placeName(job, ctx), open: workplaceOpening(job, state, ctx).open, status: workplaceOpening(job, state, ctx).status } : null,
      hours: job ? workplaceHoursText(job, ctx) : null,
      shift: job ? { id: job.shift.id, label: job.shift.label, duration: job.shift.duration, minimumNeeds: job.shift.minimumNeeds ?? {}, effects: job.shift.effects ?? {}, xp: job.shift.xp || {} } : null, // every shipped shift defines both; see CareerView.shift
      step: job ? nextStep(state, ctx, job, status) : shown ? { kind: 'apply', text: status.text } : nextStep(state, ctx, null, status),
      busy: Boolean(state.activeAction),
      rules: [
        'Applying is free and hires you at once.',
        'One paid shift per day, at any hour, on your work days. Your first ever shift can also be worked on a day off.',
        'You can only travel to a workplace while it is open; each track lists its workplace hours.',
        'You are paid when the shift finishes. Cancelling earns nothing and costs nothing.',
        `Each shift adds about ${PERFORMANCE_PER_SHIFT}% performance; it never drops. Promotion needs 100% plus the track skill.`,
      ],
      jobs: jobsFor(ctx.cityId).map((item): JobListing => {
        const open = workplaceOpen(item, ctx.cityId), current = state.job === item.id && state.career.city === ctx.cityId;
        const blocked = current ? null
          : !open ? `${cap(item.workplaceName)} is not open in this build yet.`
          : state.activeAction ? 'Finish or cancel your current action first.'
          : null;
        return {
          id: item.id, label: item.label, icon: item.icon || '💼', track: Boolean(item.track), beta: Boolean(item.beta), current,
          entryRole: item.track ? ladderRung(item, 0).role : item.label,
          pay: item.track ? ladderRung(item, 0).pay : item.shift.reward ?? 0, // the starter shift always defines its reward
          topRole: item.track ? ladderRung(item, item.ladder.length - 1).role : null,
          summary: item.summary || '', schedule: scheduleText(item), hours: workplaceHoursText(item, ctx),
          skill: item.track ? item.skill : null, duration: item.shift.duration,
          workplace: placeName(item, ctx), blocked,
          // The workplace venue's id (null while it is not in this build) and whether it is open at this moment.
          venue: open ? item.workplace.venue : null, openNow: open ? workplaceOpening(item, state, ctx).open : false,
          switchWarning: shown && !current ? `You will leave ${shown.label}${shown.track ? ` (level ${career.level}, ${Math.floor(career.performance)}% performance)` : ''} and start as ${item.track ? ladderRung(item, 0).role : item.label}${item.track ? ` at ${START_PERFORMANCE}% performance` : ''}. This cannot be undone.${career.lastShiftDay === today.day && item.track ? ' You already worked today, so your first shift there is on its next work day.' : ''}` : null,
        };
      }),
    };
  },
  ...play,
} satisfies SystemDefinition<'career'>;

export { TRACKS, MAX_CAREER_LEVEL };
