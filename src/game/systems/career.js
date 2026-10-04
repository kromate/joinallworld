/**
 * OWNER: career
 * Jobs, schedules, shifts, performance and promotion.
 *
 * HOW A CAREER WORKS (original beta design — the reference game's shift was never observed)
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
 *     career.test.js), and the Jobs and Career screens show the venue's hours next to the
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
import { emit, modify } from '../registry.js';
import { cap, clamp, fail, isRecord, naira, ok, safeCount } from '../util.js';
import { lagosTime, openingInfo, WEEKDAYS } from '../clock.js';
import { addMoodlet, arrive, skillLevel, spotsOf } from '../api.js';
import { JOBS, TRACKS, MAX_CAREER_LEVEL, START_PERFORMANCE, PERFORMANCE_PER_SHIFT, HELPER_COOLDOWN_SECONDS } from '../content/jobs.js';
import { VENUES, venueLabel } from '../content/venues.js';

/** Seconds the automatic commute takes (original beta value). */
export const COMMUTE_SECONDS = 5;
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CHIP_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const jobOf = (id) => (typeof id === 'string' && Object.hasOwn(JOBS, id) ? JOBS[id] : null);
/** A job can only be held while its workplace venue is part of this build. */
export const workplaceOpen = (job) => Object.hasOwn(VENUES, job.workplace.venue);
const placeName = (job, ctx) => (workplaceOpen(job) ? venueLabel(job.workplace.venue, ctx?.cityId) : job.workplaceName);
/** The label of the workplace spot as the venue panel shows it (an existing venue spot keeps its own name). */
const spotName = (job) => spotsOf(job.workplace.venue).find((spot) => spot.id === job.workplace.spot)?.label || 'Work';
const nowOf = (state, ctx) => (Number.isFinite(ctx?.now) ? ctx.now : state.t);
const rung = (job, level) => job.ladder[clamp(level, 1, job.ladder.length) - 1];
const freshCareer = () => ({ level: 1, performance: 0, shifts: 0, auto: true, lastShiftDay: null, shiftStartDay: null, autoDay: null, oriented: false });
const dayIndex = (value) => (Number.isSafeInteger(value) ? value : null);

/** "Mon–Fri" for a consecutive run (weeks start on Monday and may wrap to Sunday), else a list. */
export function daysText(days) {
  const sorted = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const run = sorted.every((day, index) => index === 0 || (day + 6) % 7 === ((sorted[index - 1] + 6) % 7) + 1);
  return run && sorted.length > 2 ? `${SHORT_DAYS[sorted[0]]}–${SHORT_DAYS[sorted.at(-1)]}` : sorted.map((day) => SHORT_DAYS[day]).join(', ');
}

/**
 * The single schedule sentence for a job. The Jobs list, the your-job card and the Career tab
 * all show this string, so two screens can never disagree about when a job is worked.
 */
export function scheduleText(job) {
  if (!job.track) return `One shift every ${HELPER_COOLDOWN_SECONDS / 3600} hours, any day`;
  return `One paid shift per work day, any time · ${job.days.length} days a week (${daysText(job.days)})`;
}

/** Opening state of a job's workplace venue (null hours = always open). */
const workplaceOpening = (job, state, ctx) => openingInfo(VENUES[job.workplace.venue]?.hours, nowOf(state, ctx));
/**
 * The single workplace-hours sentence, shown next to the schedule in Jobs and Career. The hours
 * come from the same clock.openingInfo label the map card uses.
 */
export function workplaceHoursText(job, ctx) {
  if (!workplaceOpen(job)) return `${cap(job.workplaceName)} is not open in this build yet.`;
  const hours = openingInfo(VENUES[job.workplace.venue].hours, 0);
  return hours.always ? `${placeName(job, ctx)} · Open 24 hours` : `${placeName(job, ctx)} · Open ${hours.hours} — you can only travel there while it is open`;
}

function nextWorkDay(job, weekday) {
  for (let offset = 1; offset <= 7; offset++) {
    const day = (weekday + offset) % 7;
    if (job.days.includes(day)) return offset === 1 ? `tomorrow (${WEEKDAYS[day]})` : WEEKDAYS[day];
  }
  return 'your next work day';
}

/**
 * Whether today's shift can be worked. Pure.
 * → { code: 'no_job'|'working'|'available'|'orientation'|'shift_done'|'day_off', canWork, text, next }
 *   `next` is the one "Next shift: …" label shown everywhere.
 */
export function shiftStatus(state, ctx) {
  const job = jobOf(state.job);
  if (!job) return { code: 'no_job', canWork: false, text: 'No job yet.', next: 'after you apply for a job' };
  if (!job.track) return { code: 'available', canWork: true, text: `Starter job: a shift at any hour, then a ${HELPER_COOLDOWN_SECONDS / 3600}-hour break before the next one.`, next: 'now' };
  const today = lagosTime(nowOf(state, ctx));
  const career = state.career;
  const upcoming = nextWorkDay(job, today.weekday);
  const running = state.activeAction?.kind === 'activity' && state.activeAction.id === job.shift.id;
  if (running) return { code: 'working', canWork: false, text: 'Shift in progress. You are paid when it finishes; cancelling earns nothing.', next: upcoming };
  if (career.lastShiftDay === today.day) {
    return { code: 'shift_done', canWork: false, next: upcoming,
      text: `You have already worked today’s paid shift (one per Lagos day). Next shift: ${upcoming}.` };
  }
  if (job.days.includes(today.weekday)) return { code: 'available', canWork: true, text: 'Work day: today’s shift is available now.', next: 'now' };
  if (!career.oriented) {
    return { code: 'orientation', canWork: true, next: 'now',
      text: `${WEEKDAYS[today.weekday]} is normally a day off, but your first ever shift (orientation) can be worked today.` };
  }
  return { code: 'day_off', canWork: false, next: upcoming, text: `Day off today (${WEEKDAYS[today.weekday]}). Next shift: ${upcoming}.` };
}

const shortNeeds = (state, job) => Object.entries(job.shift.minimumNeeds || {}).filter(([need, minimum]) => state.needs[need] < minimum);

/** What the next promotion needs, or null at the top of the ladder / without a track. */
function nextPromotion(state, job) {
  if (!job?.track || state.career.level >= job.ladder.length) return null;
  const target = job.ladder[state.career.level];
  const have = skillLevel(state, job.skill);
  const performanceMet = state.career.performance >= 100, skillMet = have >= target.skillLevel;
  return { role: target.role, pay: target.pay, level: state.career.level + 1, skill: job.skill, skillLevel: target.skillLevel, have, performanceMet, skillMet,
    text: `Next: ${target.role} (${naira(target.pay)} per shift) — reach 100% performance with ${cap(job.skill)} level ${target.skillLevel}. You have ${Math.floor(state.career.performance)}% and ${cap(job.skill)} ${have}.` };
}

function tryPromote(state, ctx) {
  const job = jobOf(state.job);
  const next = nextPromotion(state, job);
  if (!next || !next.performanceMet || !next.skillMet) return false;
  state.career.level = next.level;
  state.career.performance = START_PERFORMANCE;
  state.message = `Promoted to ${next.role}! ${job.label} shifts now pay ${naira(next.pay)}.`;
  addMoodlet(state, { id: 'promoted', label: 'Promoted', value: 8, duration: 3600 }, ctx); // original beta value
  emit(state, 'promotion', { job: job.id, level: next.level, role: next.role, maxLevel: job.ladder.length, top: next.level >= job.ladder.length }, ctx);
  emit(state, 'notice.posted', { kind: 'promotion', text: `Promoted to ${next.role} (${job.label}). Shifts now pay ${naira(next.pay)}.` }, ctx);
  return true;
}

/** "Go automatically": start the free commute if a shift is waiting. At most once per Lagos day. */
function maybeCommute(state, ctx) {
  const job = jobOf(state.job);
  if (!job?.track || !state.career.auto || state.activeAction || !workplaceOpen(job) || state.location === job.workplace.venue) return false;
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

function apply(state, payload, ctx, switching = false) {
  if (state.activeAction) return fail(state, 'busy', 'Finish or cancel your current action before applying.');
  const job = jobOf(payload?.id);
  if (!job) return fail(state, 'invalid_job', 'Choose a job from the Jobs list.');
  if (state.job === job.id) {
    state.message = `You already work as a ${job.label}. Visit your workplace to start a shift.`;
    return ok(state, 'already_employed');
  }
  if (!workplaceOpen(job)) return fail(state, 'workplace_unavailable', `${job.label} is based at ${job.workplaceName}, which is not open in this build yet. Choose a track whose workplace is on the map.`);
  const old = jobOf(state.job);
  if (switching && !old) return fail(state, 'no_job', 'You have no job to switch from. Use Apply instead.');
  if (old && !switching) {
    return fail(state, 'confirm_switch', `Switching to ${job.label} ends your ${old.label} job: you start ${job.track ? `as ${job.ladder[0].role} at ${START_PERFORMANCE}% performance` : 'in the starter job, which has no ladder,'} and lose your ${old.label} level and performance. Confirm the switch to continue.`);
  }
  if (old) emit(state, 'job.quit', { job: old.id }, ctx);
  state.job = job.id;
  Object.assign(state.career, { level: 1, performance: job.track ? START_PERFORMANCE : 0, shifts: 0, shiftStartDay: null });
  const place = placeName(job, ctx);
  if (!job.track) state.message = `${job.label} job accepted. Visit your workplace to work a shift.`;
  else {
    const status = shiftStatus(state, ctx);
    state.message = `Hired as ${job.ladder[0].role} (${job.label}), ${naira(job.ladder[0].pay)} per shift at ${place}. ${status.canWork ? 'You can work your first shift today.' : `Next shift: ${status.next}.`}`;
  }
  emit(state, 'job.applied', { job: job.id, ...(job.track ? { maxLevel: job.ladder.length } : {}) }, ctx);
  maybeCommute(state, ctx);
  return ok(state, old ? 'switched' : 'applied');
}

function quit(state, payload, ctx) {
  const job = jobOf(state.job);
  if (!job) return fail(state, 'no_job', 'You do not have a job to quit.');
  if (state.activeAction) return fail(state, 'busy', 'Finish or cancel your current action before quitting.');
  state.job = null;
  Object.assign(state.career, { level: 1, performance: 0, shifts: 0, shiftStartDay: null });
  state.message = `You quit your ${job.label} job. Your level and performance in it are gone; apply again any time to start over.`;
  emit(state, 'job.quit', { job: job.id }, ctx);
  return ok(state, 'quit');
}

function setAuto(state, payload) {
  if (typeof payload?.on !== 'boolean') return fail(state, 'invalid_setting', 'Choose on or off for Go automatically.');
  state.career.auto = payload.on;
  state.message = payload.on ? 'Go automatically is on: you will head to work when a shift is available.' : 'Go automatically is off: use Go to work when you are ready.';
  return ok(state, 'auto_set');
}

/** The player's next step, in one sentence, with where to send them. */
function nextStep(state, ctx, job, status) {
  if (!job) return { kind: 'apply', text: 'Pick a track in Phone → Jobs and tap Apply. Applying is free and you can work your first shift the same day.' };
  const shift = job.shift, place = placeName(job, ctx), pay = payOf(state, job);
  if (status.code === 'working') return { kind: 'wait', text: `Shift in progress: ${naira(pay)} arrives when it finishes. Cancelling earns nothing.` };
  if (state.activeAction?.kind === 'commute') return { kind: 'wait', text: `On your way to ${place}. Open the ${spotName(job)} spot when you arrive.` };
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
  if (state.location !== job.workplace.venue) return { kind: 'go', venue: job.workplace.venue, spot: job.workplace.spot, text: `Go to ${place} and open the ${spotName(job)} spot to start today’s shift. ${facts}` };
  if (state.spot !== job.workplace.spot) return { kind: 'go', venue: job.workplace.venue, spot: job.workplace.spot, text: `You are at ${place}. Open the ${spotName(job)} spot to start today’s shift. ${facts}` };
  return { kind: 'start', text: `You are at work. Close this and tap “${shift.label}” to start. ${facts}` };
}

const payOf = (state, job) => (job.track ? rung(job, state.career.level).pay : job.shift.reward);

export default {
  id: 'career',
  stateKeys: ['job', 'completedShifts', 'career'],
  sanitize(input, state) {
    const job = jobOf(input.job);
    state.job = job && workplaceOpen(job) ? job.id : null;
    state.completedShifts = safeCount(input.completedShifts) ? input.completedShifts : 0;
    const saved = isRecord(input.career) ? input.career : {};
    const held = jobOf(state.job);
    const career = freshCareer();
    if (held?.track) {
      career.level = Number.isInteger(saved.level) && saved.level >= 1 && saved.level <= held.ladder.length ? saved.level : 1;
      career.performance = Number.isFinite(saved.performance) ? clamp(saved.performance) : START_PERFORMANCE;
    }
    career.shifts = safeCount(saved.shifts) ? saved.shifts : 0;
    career.auto = saved.auto !== false;
    career.lastShiftDay = dayIndex(saved.lastShiftDay);
    career.shiftStartDay = dayIndex(saved.shiftStartDay);
    career.autoDay = dayIndex(saved.autoDay);
    career.oriented = saved.oriented === true;
    state.career = career;
  },
  actions: {
    'apply-job': (state, payload, ctx) => apply(state, payload, ctx),
    'career.switch': (state, payload, ctx) => apply(state, payload, ctx, true),
    'career.quit': quit,
    'career.auto': setAuto,
  },
  activities: Object.values(JOBS).filter((job) => job.shift && workplaceOpen(job))
    .map((job) => ({ ...job.shift, requiresJob: job.id, where: { ...job.workplace, spotLabel: 'Work', spotIcon: '💼' } })),
  active: {
    commute: {
      moves: true, // the player is on their way out of the venue: no room, no voice, until they arrive or cancel
      sanitize(value, state) {
        const job = jobOf(state.job);
        return job?.track && value.id === job.workplace.venue && value.id !== state.location && value.duration === COMMUTE_SECONDS ? {} : null;
      },
      complete(state, active, ctx) {
        const job = jobOf(state.job);
        if (!arrive(state, active.id, ctx, { spot: job?.workplace.spot, mode: null })) return;
        state.message = `You are at ${venueLabel(active.id, ctx?.cityId)}, at the ${job ? spotName(job) : 'Work'} spot. Start ${job ? `your ${job.label} shift` : 'your shift'} when you are ready.`;
      },
    },
  },
  modifiers: {
    'activity.reward': (value, state, { def }) => (def?.careerTrack && state.job === def.careerTrack ? rung(JOBS[def.careerTrack], state.career.level).pay : value),
    'activity.block'(value, state, { def }, ctx) {
      if (value || !def?.requiresJob) return value;
      if (state.completedShifts >= Number.MAX_SAFE_INTEGER) return { code: 'balance_limit', reason: 'Your shift count has reached its supported limit.' };
      if (!def.careerTrack || state.job !== def.careerTrack) return null;
      const status = shiftStatus(state, ctx);
      return status.canWork ? null : { code: status.code, reason: status.text };
    },
  },
  on: {
    'activity.started'(state, { def }, ctx) {
      if (def?.careerTrack) state.career.shiftStartDay = lagosTime(nowOf(state, ctx)).day;
    },
    'action.cancelled'(state, { kind, id }) {
      if (kind === 'activity' && jobOf(state.job)?.shift.id === id) state.career.shiftStartDay = null;
    },
    'activity.completed'(state, { def }, ctx) {
      if (!def?.requiresJob) return;
      const job = jobOf(def.requiresJob);
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
      if (jobOf(state.job)?.skill === skill) tryPromote(state, ctx);
    },
  },
  advance(state, dt, ctx) { maybeCommute(state, ctx); },
  view(state, ctx) {
    const job = jobOf(state.job);
    const status = shiftStatus(state, ctx);
    const today = lagosTime(nowOf(state, ctx));
    const career = state.career;
    const pay = job ? payOf(state, job) : 0;
    return {
      job, // legacy field: the raw catalogue entry
      completedShifts: state.completedShifts,
      employed: Boolean(job),
      id: job?.id ?? null,
      label: job?.label ?? null,
      icon: job?.icon ?? '💼',
      isTrack: Boolean(job?.track),
      level: job?.track ? career.level : null,
      levels: job?.track ? job.ladder.length : null,
      role: job ? (job.track ? rung(job, career.level).role : job.label) : null,
      pay,
      weeklyPay: job?.track ? pay * job.days.length : 0,
      performance: job?.track ? Math.floor(career.performance) : null,
      shifts: career.shifts,
      schedule: job ? scheduleText(job) : null,
      chips: CHIP_LETTERS.map((letter, weekday) => ({ letter, name: WEEKDAYS[weekday], work: job ? (job.track ? job.days.includes(weekday) : true) : false, today: weekday === today.weekday })),
      today: { code: status.code, canWork: status.canWork, text: status.text, weekday: WEEKDAYS[today.weekday] },
      nextShift: job ? `Next shift: ${status.next}` : null,
      next: nextPromotion(state, job),
      topOfLadder: Boolean(job?.track && career.level >= job.ladder.length),
      auto: career.auto,
      workplace: job ? { venue: job.workplace.venue, spot: job.workplace.spot, label: placeName(job, ctx), open: workplaceOpening(job, state, ctx).open, status: workplaceOpening(job, state, ctx).status } : null,
      hours: job ? workplaceHoursText(job, ctx) : null,
      shift: job ? { id: job.shift.id, label: job.shift.label, duration: job.shift.duration, minimumNeeds: job.shift.minimumNeeds, effects: job.shift.effects, xp: job.shift.xp || {} } : null,
      step: nextStep(state, ctx, job, status),
      busy: Boolean(state.activeAction),
      rules: [
        'Applying is free and hires you at once.',
        'One paid shift per Lagos day, at any hour, on your work days. Your first ever shift can also be worked on a day off.',
        'You can only travel to a workplace while it is open; each track lists its workplace hours.',
        'You are paid when the shift finishes. Cancelling earns nothing and costs nothing.',
        `Each shift adds about ${PERFORMANCE_PER_SHIFT}% performance; it never drops. Promotion needs 100% plus the track skill.`,
      ],
      jobs: Object.values(JOBS).map((item) => {
        const open = workplaceOpen(item), current = state.job === item.id;
        const blocked = current ? null
          : !open ? `${cap(item.workplaceName)} is not open in this build yet.`
          : state.activeAction ? 'Finish or cancel your current action first.'
          : null;
        return {
          id: item.id, label: item.label, icon: item.icon || '💼', track: Boolean(item.track), beta: Boolean(item.beta), current,
          entryRole: item.track ? item.ladder[0].role : item.label,
          pay: item.track ? item.ladder[0].pay : item.shift.reward,
          topRole: item.track ? item.ladder.at(-1).role : null,
          summary: item.summary || '', schedule: scheduleText(item), hours: workplaceHoursText(item, ctx),
          skill: item.skill ?? null, duration: item.shift.duration,
          workplace: placeName(item, ctx), blocked,
          switchWarning: job && !current ? `You will leave ${job.label}${job.track ? ` (level ${career.level}, ${Math.floor(career.performance)}% performance)` : ''} and start as ${item.track ? item.ladder[0].role : item.label}${item.track ? ` at ${START_PERFORMANCE}% performance` : ''}. This cannot be undone.${career.lastShiftDay === today.day && item.track ? ' You already worked today, so your first shift there is on its next work day.' : ''}` : null,
        };
      }),
    };
  },
};

export { TRACKS, MAX_CAREER_LEVEL };
