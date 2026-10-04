/**
 * OWNER: growth
 * First-party metrics: daily totals and retention cohorts, counted on this server from requests it
 * already handles. No third-party script, no cookie of its own, no address, no device data.
 *
 * WHAT IS KEPT (inside the growth collection, `metrics`)
 *   days     { [lagosDay]: { [counter]: n } }     daily totals, KEEP.days days
 *   cohorts  { [lagosDay]: { size, r: { 1, 3, 7, 14, 30 } } }   lives that began on that day and how
 *            many of them were seen 1, 3, 7, 14 and 30 days later; KEEP.cohorts days
 *   lives    { [publicId]: { first, last, steps } }   only while a life is inside its 30-day window:
 *            the Lagos day it began, the last day it was seen, and which funnel steps it has been
 *            counted for (a bit mask). Removed after KEEP.window days — after that nothing about an
 *            individual player is kept here at all. At most KEEP.lives records.
 * Nothing here is ever sent to a player. It is read only through GET /api/mod/growth/metrics,
 * with the operator token.
 *
 * COUNTERS  active (lives seen that day) · sessions (a hello after 30 quiet minutes) · new
 *   funnel.onboarded · funnel.goal-1 … funnel.goals-done · funnel.job · funnel.shift ·
 *   funnel.mission · funnel.table · share.made.<kind> · share.opened · share.joined ·
 *   referral.linked · referral.welcomed · referral.counted · referral.paid · referral.refused.<why>
 *   table.started.<game> · table.finished.<game> · table.abandoned.<game> · table.human · table.bot
 *   consent.adult · consent.minor · client.<signal> (webgl-missing, opera-mini, save-data, slow-start)
 */
import { lagosTime } from '../../src/game/clock.js';

export const KEEP = Object.freeze({ days: 400, cohorts: 120, window: 31, lives: 50000 });
export const RETENTION_DAYS = Object.freeze([1, 3, 7, 14, 30]);
/** Funnel steps, in order. `reached(state)` is read from the server's own copy of the life. */
export const FUNNEL = Object.freeze([
  { id: 'onboarded', reached: (state) => !(state.onboarding?.required === true && state.onboarding.done !== true) },
  { id: 'goal-1', reached: (state) => (state.goals?.chain ?? 0) >= 1 },
  { id: 'job', reached: (state) => Boolean(state.job) },
  { id: 'shift', reached: (state) => (state.civic?.work?.days ?? 0) >= 1 },
  { id: 'goals-done', reached: (state) => (state.goals?.chain ?? 0) >= 7 },
  { id: 'mission', reached: (state) => (state.missions?.claimed ?? 0) >= 1 },
  { id: 'table', reached: (state) => (state.growth?.tables?.played ?? 0) >= 1 },
  { id: 'day-two-work', reached: (state) => (state.civic?.work?.days ?? 0) >= 2 },
]);
/** Signals a browser may report about itself (see POST /api/growth/client). A fixed list: nothing free-form is counted. */
export const CLIENT_SIGNALS = Object.freeze(['webgl-missing', 'opera-mini', 'save-data', 'slow-start', 'installed', 'share-sheet', 'share-fallback']);
const COUNTER = /^[a-z0-9][a-z0-9.-]{0,47}$/;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function book(g) {
  const m = g.metrics;
  for (const key of ['days', 'cohorts', 'lives']) if (!isRecord(m[key])) m[key] = {};
  return m;
}

/** Add to one of today's counters. A name that is not a plain counter name is ignored. */
export function count(g, now, name, n = 1) {
  if (typeof name !== 'string' || !COUNTER.test(name) || !Number.isSafeInteger(n) || n <= 0) return;
  const m = book(g), day = lagosTime(now).day;
  const today = (m.days[day] ||= {});
  if (Object.keys(today).length >= 200 && !Object.hasOwn(today, name)) return;
  today[name] = Math.min(Number.MAX_SAFE_INTEGER, (today[name] ?? 0) + n);
}

/** A life was seen: count it once for today, once for each retention day it reaches, and once per funnel step. */
export function touch(g, now, publicId, state) {
  const m = book(g), day = lagosTime(now).day;
  const first = lagosTime(Number.isFinite(state?.civic?.since) ? state.civic.since : now).day;
  let life = Object.hasOwn(m.lives, publicId) ? m.lives[publicId] : null;
  if (!life) {
    // Only a life still inside its window is followed; an old life is counted as active and nothing else.
    if (day - first > KEEP.window - 1 || Object.keys(m.lives).length >= KEEP.lives) { count(g, now, 'active-untracked'); return; }
    life = m.lives[publicId] = { first, last: null, steps: 0 };
    const cohort = (m.cohorts[first] ||= { size: 0, r: {} });
    cohort.size += 1;
    if (first === day) count(g, now, 'new');
  }
  if (life.last !== day) {
    life.last = day;
    count(g, now, 'active');
    const offset = day - life.first;
    if (RETENTION_DAYS.includes(offset) && m.cohorts[life.first]) m.cohorts[life.first].r[offset] = (m.cohorts[life.first].r[offset] ?? 0) + 1;
  }
  FUNNEL.forEach((step, index) => {
    if (life.steps & (1 << index) || !step.reached(state)) return;
    life.steps |= 1 << index;
    count(g, now, `funnel.${step.id}`);
  });
}

/** Drop what is past its retention. Called from the hourly sweep. */
export function prune(g, now) {
  const m = book(g), day = lagosTime(now).day;
  for (const key of Object.keys(m.days)) if (day - Number(key) > KEEP.days) delete m.days[key];
  for (const key of Object.keys(m.cohorts)) if (day - Number(key) > KEEP.cohorts) delete m.cohorts[key];
  for (const [id, life] of Object.entries(m.lives)) if (day - life.first > KEEP.window) delete m.lives[id];
}

const dateOf = (day) => new Date(day * 86400000).toISOString().slice(0, 10);
/** The operator's report: totals per day and the cohort table. Carries no player id. */
export function report(g, now, { days = 35 } = {}) {
  const m = book(g), today = lagosTime(now).day, span = Math.max(1, Math.min(KEEP.days, days));
  const daily = [];
  for (let day = today - span + 1; day <= today; day++) if (m.days[day]) daily.push({ day, date: dateOf(day), ...m.days[day] });
  const cohorts = Object.keys(m.cohorts).map(Number).filter((day) => today - day < span + 30).sort((a, b) => a - b).map((day) => {
    const cohort = m.cohorts[day], row = { day, date: dateOf(day), size: cohort.size };
    // A retention day that has not come yet is null, never zero: "nobody came back" and "too early to say" are different answers.
    for (const offset of RETENTION_DAYS) row[`d${offset}`] = today - day < offset ? null : { returned: cohort.r[offset] ?? 0, rate: cohort.size ? Math.round(((cohort.r[offset] ?? 0) / cohort.size) * 1000) / 10 : 0 };
    return row;
  });
  const totals = {};
  for (const row of daily) for (const [name, value] of Object.entries(row)) if (name !== 'day' && name !== 'date') totals[name] = (totals[name] ?? 0) + value;
  return { generatedAt: now, timezone: 'Africa/Lagos', days: daily, cohorts, totals, tracked: Object.keys(m.lives).length,
    retention: { daily: `${KEEP.days} days`, cohorts: `${KEEP.cohorts} days`, perLife: `${KEEP.window} days, then deleted` } };
}
