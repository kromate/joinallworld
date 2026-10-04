/**
 * OWNER: growth
 * Missions: three daily and three weekly tasks dealt from content/missions.js, the weekly stamp
 * card and the count of days lived actively. Everything is driven by registry events; nothing here
 * is punished for absence — an unfinished mission simply lapses, and no count ever goes down.
 *
 * STATE — state.missions
 *   seed      integer — fixes which missions this life is dealt each day
 *   day       Lagos day the daily set belongs to;  daily   [{ id, n, marks, claimed }]
 *   week      Lagos week the weekly set belongs to; weekly  [{ id, n, marks, claimed }]
 *               n = progress, marks = venue ids already counted (for 'venue' missions)
 *   rerolls   daily swaps used on `day`
 *   sets      { day, week } — the Lagos day / week whose set bonus was already granted (0 = none)
 *   active    { days, last } — Lagos days with any counted activity (only ever goes up), and the last one
 *   stamps    { week, days, paid } — this week's stamp card
 *   visited   { week, list } — venues arrived at this Lagos week (for "somewhere new")
 *   paidDay   last Lagos day a paid activity was counted as a day worked
 *   titles    [titleId] earned;  claimed  lifetime missions claimed
 *
 * ACTIONS
 *   'missions.claim'   { id }   collect a finished mission's naira, once (a ledger line "Mission: …")
 *   'missions.reroll'  { id }   swap one unfinished DAILY mission (MISSION_REWARDS.rerollsPerDay a day)
 *   'missions.refresh' {}       deal today's set if the day turned; changes nothing else
 *
 * LISTENS TO  activity.completed, travel.arrived, and every event a mission in the content names
 *   (shift.completed, gem.found, wish.granted, npc.greeted, friend.made, table.played, event.attended).
 * EMITS  'mission.completed' { id, scope }       progress reached its count
 *        'mission.claimed'   { id, scope, cash }
 *        'stars.granted'     { amount, reason }  set bonuses and the stamp card (systems/goals.js adds them)
 *        'work.day'          {}                  first paid activity of a Lagos day (feeds a weekly mission)
 *        'notice.posted'     { kind: 'mission', text }   a finished weekly set, a new title
 */
import { emit } from '../registry.js';
import { fail, finite, isRecord, makeRng, naira, ok, safeCount } from '../util.js';
import { lagosTime, lagosDayStart } from '../clock.js';
import { canCredit, credit } from '../api.js';
import { VENUES } from '../content/venues.js';
import { DAILY_MISSIONS, DAY_TITLES, MISSION_KINDS, MISSION_REWARDS, STAMP_CARD, WEEKLY_MISSIONS, WEEK_TITLE } from '../content/missions.js';
import { hasEventToday } from '../calendar.js';

const POOLS = { daily: DAILY_MISSIONS, weekly: WEEKLY_MISSIONS };
const BY_ID = new Map([...DAILY_MISSIONS, ...WEEKLY_MISSIONS].map((def) => [def.id, def]));
const TITLE_IDS = [...DAY_TITLES.map((title) => title.id), WEEK_TITLE.id];
const MAX_DAYS = 100000, MARKS = 12;
const nowOf = (state, ctx) => (finite(ctx?.now) && ctx.now > 0 ? ctx.now : state.t);
const need = (def) => def.count ?? 1;
const done = (entry) => entry.n >= need(BY_ID.get(entry.id));
const scopeOf = (state, id) => (state.missions.daily.some((entry) => entry.id === id) ? 'daily' : state.missions.weekly.some((entry) => entry.id === id) ? 'weekly' : null);

/** Can this mission be done at all by this life today? A mission that cannot is never dealt. */
function doable(def, state, ctx) {
  if (def.needs === 'job' && !state.job) return false;
  if (def.needs === 'event' && !hasEventToday(nowOf(state, ctx), ctx?.cityId ?? 'lagos')) return false;
  if (Array.isArray(def.go) && !Object.hasOwn(VENUES, def.go[0])) return false;
  return true;
}

/**
 * The set for one period: one mission of each kind, in kind order. Deterministic for (seed, city,
 * scope, period) and for what is doable at the moment of dealing.
 * @param {'daily'|'weekly'} scope
 */
export function dealMissions(state, scope, period, ctx, exclude = []) {
  const rng = makeRng(`missions|${ctx?.cityId ?? 'lagos'}|${scope}|${period}|${state.missions.seed}`);
  const picked = [];
  for (const kind of MISSION_KINDS) {
    const options = POOLS[scope].filter((def) => def.kind === kind && doable(def, state, ctx) && !exclude.includes(def.id));
    if (!options.length) continue;
    picked.push({ id: options[Math.floor(rng() * options.length)].id, n: 0, marks: [], claimed: false });
  }
  return picked.slice(0, MISSION_REWARDS[scope].slots);
}

/** Bring the sets, the stamp card and the visited list to today. Unclaimed missions of an old period lapse. */
function roll(state, ctx) {
  const book = state.missions, time = lagosTime(nowOf(state, ctx));
  if (book.week !== time.week) {
    book.week = time.week;
    book.weekly = dealMissions(state, 'weekly', time.week, ctx);
  }
  if (book.day !== time.day) {
    book.day = time.day; book.rerolls = 0;
    book.daily = dealMissions(state, 'daily', time.day, ctx);
  }
  if (book.stamps.week !== time.week) book.stamps = { week: time.week, days: 0, paid: false };
  if (book.visited.week !== time.week) book.visited = { week: time.week, list: [] };
  return time;
}

function grantTitle(state, title, ctx) {
  if (state.missions.titles.includes(title.id)) return;
  state.missions.titles.push(title.id);
  emit(state, 'notice.posted', { kind: 'mission', text: `New title: ${title.label}.` }, ctx);
}

/** Something counted today: one stamp and one active day, each once per Lagos day. */
function markActive(state, time, ctx) {
  const book = state.missions;
  if (book.active.last === time.day) return;
  book.active = { days: Math.min(MAX_DAYS, book.active.days + 1), last: time.day };
  for (const title of DAY_TITLES) if (book.active.days >= title.days) grantTitle(state, title, ctx);
  book.stamps.days = Math.min(7, book.stamps.days + 1);
  if (!book.stamps.paid && book.stamps.days >= STAMP_CARD.need) {
    book.stamps.paid = true;
    emit(state, 'stars.granted', { amount: STAMP_CARD.stars, reason: 'Weekly stamp card' }, ctx);
    emit(state, 'notice.posted', { kind: 'mission', text: `Stamp card complete: ${STAMP_CARD.need} days this week. +${STAMP_CARD.stars} stars.` }, ctx);
  }
}

/** Add progress to every unfinished mission the trigger matches. */
function progress(state, ctx, matches, mark = null) {
  const time = roll(state, ctx);
  markActive(state, time, ctx);
  for (const scope of ['daily', 'weekly']) {
    for (const entry of state.missions[scope]) {
      const def = BY_ID.get(entry.id);
      if (done(entry) || !matches(def)) continue;
      if (mark !== null) { if (entry.marks.includes(mark) || entry.marks.length >= MARKS) continue; entry.marks.push(mark); }
      entry.n = Math.min(need(def), entry.n + 1);
      if (done(entry)) emit(state, 'mission.completed', { id: entry.id, scope }, ctx);
    }
  }
}

/** Grant the set bonus once, when the last mission of a set has been claimed. */
function settleSet(state, scope, time, ctx) {
  const book = state.missions, list = book[scope], period = scope === 'daily' ? time.day : time.week, key = scope === 'daily' ? 'day' : 'week';
  if (list.length < MISSION_REWARDS[scope].slots || !list.every((entry) => entry.claimed) || book.sets[key] === period) return false;
  book.sets[key] = period;
  emit(state, 'stars.granted', { amount: MISSION_REWARDS[scope].setStars, reason: scope === 'daily' ? 'Daily missions' : 'Weekly missions' }, ctx);
  if (scope === 'weekly') {
    grantTitle(state, WEEK_TITLE, ctx);
    emit(state, 'notice.posted', { kind: 'mission', text: `All weekly missions done. +${MISSION_REWARDS.weekly.setStars} stars.` }, ctx);
  }
  return true;
}

export function claimMission(state, payload, ctx) {
  const time = roll(state, ctx);
  const id = payload?.id, scope = typeof id === 'string' ? scopeOf(state, id) : null;
  if (!scope) return fail(state, 'unknown_mission', 'That mission is not one of yours today. Missions change at midnight, Lagos time.');
  const entry = state.missions[scope].find((item) => item.id === id), def = BY_ID.get(id);
  if (entry.claimed) return fail(state, 'already_claimed', 'You already collected that mission.');
  if (!done(entry)) return fail(state, 'not_done', `${def.label}: ${entry.n} of ${need(def)} so far.`);
  const cash = MISSION_REWARDS[scope].cash;
  if (!canCredit(state, cash)) return fail(state, 'balance_limit', 'Your saved balance has reached its supported limit.');
  entry.claimed = true;
  credit(state, cash, `Mission: ${def.label}`, ctx);
  state.missions.claimed = Math.min(Number.MAX_SAFE_INTEGER, state.missions.claimed + 1);
  const set = settleSet(state, scope, time, ctx);
  state.message = `Mission done: ${def.label} · +${naira(cash)}${set ? ` · all ${MISSION_REWARDS[scope].slots} done, +${MISSION_REWARDS[scope].setStars} stars` : ''}`;
  emit(state, 'mission.claimed', { id, scope, cash }, ctx);
  return ok(state, 'claimed');
}

export function rerollMission(state, payload, ctx) {
  roll(state, ctx);
  const book = state.missions, index = book.daily.findIndex((entry) => entry.id === payload?.id);
  if (index < 0) return fail(state, 'unknown_mission', 'Only one of today’s missions can be swapped.');
  if (done(book.daily[index])) return fail(state, 'already_done', 'That mission is finished. Collect it instead.');
  if (book.rerolls >= MISSION_REWARDS.rerollsPerDay) return fail(state, 'no_rerolls', 'You have used today’s swap. Missions change at midnight, Lagos time.');
  const old = BY_ID.get(book.daily[index].id);
  const options = DAILY_MISSIONS.filter((def) => def.kind === old.kind && doable(def, state, ctx) && !book.daily.some((entry) => entry.id === def.id));
  if (!options.length) return fail(state, 'nothing_else', 'There is no other mission of that kind today.');
  book.rerolls += 1;
  book.daily[index] = { id: options[Math.floor(ctx.rng() * options.length)].id, n: 0, marks: [], claimed: false };
  state.message = `Swapped for: ${BY_ID.get(book.daily[index].id).label}.`;
  return ok(state, 'rerolled');
}

function sanitizeList(value, scope) {
  const out = [];
  for (const entry of Array.isArray(value) ? value.slice(0, MISSION_REWARDS[scope].slots) : []) {
    const def = isRecord(entry) && typeof entry.id === 'string' ? BY_ID.get(entry.id) : null;
    if (!def || !POOLS[scope].includes(def) || out.some((item) => item.id === def.id)) continue;
    const n = safeCount(entry.n) ? Math.min(entry.n, need(def)) : 0;
    const marks = [...new Set((Array.isArray(entry.marks) ? entry.marks : []).filter((mark) => typeof mark === 'string' && Object.hasOwn(VENUES, mark)))].slice(0, MARKS);
    out.push({ id: def.id, n, marks, claimed: entry.claimed === true && n >= need(def) });
  }
  return out;
}

const eventNames = [...new Set([...DAILY_MISSIONS, ...WEEKLY_MISSIONS].filter((def) => def.on === 'event').map((def) => def.event))];
const listeners = Object.fromEntries(eventNames.map((name) => [name, (state, data, ctx) => progress(state, ctx, (def) => def.on === 'event' && def.event === name)]));

/** One row of the Missions app. */
function row(entry, scope) {
  const def = BY_ID.get(entry.id), count = need(def);
  return { id: def.id, kind: def.kind, label: def.label, hint: def.hint, n: entry.n, count, done: entry.n >= count, claimed: entry.claimed, cash: MISSION_REWARDS[scope].cash,
    open: def.open ?? null, go: def.go ?? null };
}

export default {
  id: 'missions',
  stateKeys: ['missions'],
  sanitize(input, state, ctx) {
    const saved = isRecord(input.missions) ? input.missions : {};
    const count = (value, max = Number.MAX_SAFE_INTEGER) => (safeCount(value) && value <= max ? value : 0);
    const active = isRecord(saved.active) && safeCount(saved.active.days) && saved.active.days <= MAX_DAYS && (saved.active.last === null || safeCount(saved.active.last))
      && (saved.active.days === 0) === (saved.active.last === null) ? { days: saved.active.days, last: saved.active.last } : { days: 0, last: null };
    state.missions = {
      seed: Number.isInteger(saved.seed) && saved.seed >= 0 && saved.seed < 4294967296 ? saved.seed
        : Math.floor(makeRng(`missions-seed|${state.t}|${state.name}|${ctx?.cityId}`)() * 4294967296),
      day: count(saved.day), daily: sanitizeList(saved.daily, 'daily'),
      week: count(saved.week), weekly: sanitizeList(saved.weekly, 'weekly'),
      rerolls: count(saved.rerolls, MISSION_REWARDS.rerollsPerDay),
      sets: { day: count(saved.sets?.day), week: count(saved.sets?.week) },
      active,
      stamps: isRecord(saved.stamps) && safeCount(saved.stamps.week) && safeCount(saved.stamps.days) && saved.stamps.days <= 7
        ? { week: saved.stamps.week, days: saved.stamps.days, paid: saved.stamps.paid === true && saved.stamps.days >= STAMP_CARD.need } : { week: 0, days: 0, paid: false },
      visited: isRecord(saved.visited) && safeCount(saved.visited.week)
        ? { week: saved.visited.week, list: [...new Set((Array.isArray(saved.visited.list) ? saved.visited.list : []).filter((id) => typeof id === 'string' && Object.hasOwn(VENUES, id)))].slice(0, 64) } : { week: 0, list: [] },
      paidDay: count(saved.paidDay),
      titles: [...new Set((Array.isArray(saved.titles) ? saved.titles : []).filter((id) => TITLE_IDS.includes(id)))],
      claimed: count(saved.claimed),
    };
  },
  actions: {
    'missions.claim': claimMission,
    'missions.reroll': rerollMission,
    'missions.refresh'(state, payload, ctx) { roll(state, ctx); return ok(state, 'refreshed'); },
  },
  on: {
    ...listeners,
    'activity.completed'(state, data, ctx) {
      const tags = Array.isArray(data?.tags) ? data.tags : [];
      progress(state, ctx, (def) => def.on === 'tag' && def.tags.some((tag) => tags.includes(tag)));
      if (!(data?.def?.reward > 0)) return;
      progress(state, ctx, (def) => def.on === 'paid');
      const day = lagosTime(nowOf(state, ctx)).day;
      if (state.missions.paidDay !== day) { state.missions.paidDay = day; emit(state, 'work.day', {}, ctx); }
    },
    'travel.arrived'(state, data, ctx) {
      const venue = data?.venue;
      if (typeof venue !== 'string' || venue === 'home' || !Object.hasOwn(VENUES, venue)) return;
      roll(state, ctx);
      const visited = state.missions.visited, fresh = !visited.list.includes(venue);
      progress(state, ctx, (def) => def.on === 'venue' && (!def.fresh || fresh), venue);
      if (fresh && visited.list.length < 64) visited.list.push(venue);
    },
  },
  advance(state, dt, ctx) { roll(state, ctx); },
  view(state, ctx) {
    const book = state.missions, now = nowOf(state, ctx), time = lagosTime(now);
    // What is shown is today's set: a saved set from an earlier day is about to be replaced and is not offered.
    const daily = book.day === time.day ? book.daily : [], weekly = book.week === time.week ? book.weekly : [];
    const stamps = book.stamps.week === time.week ? book.stamps : { days: 0, paid: false };
    const set = (list, scope, granted) => ({ done: list.filter((entry) => done(entry)).length, claimed: list.filter((entry) => entry.claimed).length, total: list.length,
      stars: MISSION_REWARDS[scope].setStars, granted });
    const weekStart = lagosDayStart(time.day - ((time.weekday + 6) % 7));
    const titles = book.titles.map((id) => DAY_TITLES.find((title) => title.id === id) ?? WEEK_TITLE);
    return {
      day: time.day, week: time.week,
      daily: daily.map((entry) => row(entry, 'daily')), weekly: weekly.map((entry) => row(entry, 'weekly')),
      dailySet: set(daily, 'daily', book.sets.day === time.day), weeklySet: set(weekly, 'weekly', book.sets.week === time.week),
      rerollsLeft: book.day === time.day ? Math.max(0, MISSION_REWARDS.rerollsPerDay - book.rerolls) : MISSION_REWARDS.rerollsPerDay,
      claimable: [...daily, ...weekly].filter((entry) => done(entry) && !entry.claimed).length,
      stamps: { days: stamps.days, need: STAMP_CARD.need, stars: STAMP_CARD.stars, paid: stamps.paid },
      activeDays: book.active.days, title: titles.at(-1)?.label ?? null, titles: titles.map((title) => title.label),
      nextTitle: DAY_TITLES.find((title) => title.days > book.active.days) ?? null,
      resetAt: lagosDayStart(time.day + 1), weekResetAt: weekStart + 7 * 86400000, claimed: book.claimed,
    };
  },
};
