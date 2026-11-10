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
 * RETURN SPLIT (added with friendship after shared play). A life also carries, all optional: `src` (the cleaned "source|medium|campaign"
 * the browser reported at its first hello), `ret` (which of day 1, 7 and 30 it was seen on, a bit mask), `fr` (the Lagos day of its
 * first real friend: noteFriend, called when a friend request is accepted; the founder's welcome friendship is not one) and `done`.
 * When a life is old enough for a return day to be settled (prune, hourly) it is counted ONCE into `split[cohortDay]`, a small
 * aggregate by arrival source and by "made a friend within the first two days", and the life then ages out as before.
 * Two more optional day fields, same shape as `fr`: `cl` (the Lagos day the life first created or joined a clan: noteClan) and `ag` (the
 * Lagos day it first sent a message to an AI character: noteAgent). Like `fr` they live only inside the life record, which the erasure
 * contract already removes by player id (server/admin/erasure-data.ts), and they are split the same way ("within the first two days").
 * ACTIVATION (added for the Phase 7 adverts, docs/AD-READY-PLAN.md). A life also carries `act`, the Lagos day of its FIRST meaningful action: walked
 * in the world (its first move on a socket), posted in the feed, joined or made a community, or said it is going to an event (noteActivated,
 * called from those places; an AI agent's request is never counted). The first time only, it is also counted into `activation[cohortDay]
 * ["source|medium|campaign"]`, the words the life arrived with; the report sets that against the `landed` visits of the same words
 * (activationReport). The life record holds one more day number and the aggregate holds no player id. Same erasure as the rest of `lives`.
 * Nothing here is ever sent to a player. It is read only through GET /api/mod/growth/metrics,
 * with the operator token.
 *
 * FIRST-PARTY, AND INDEPENDENT OF TELEMETRY. These numbers are counted here whether or not Sentry/PostHog is configured
 * (server/telemetry): they need no consent sheet because they hold no person, and they are the operator's fallback when
 * analytics is off, refused or blocked. They are never forwarded to PostHog and PostHog's events are never added to them,
 * so the two can be read side by side without one inflating the other; the report says which of the two it is (`source`).
 *
 * COUNTERS — each thing is counted under ONE name, once
 *   active (lives inside their 31-day window seen that day, once a day each) · active-untracked (older lives, once a
 *   day each: the two add up to everyone seen that day) · sessions (a hello after 30 quiet minutes) · new
 *   funnel.onboarded (arrived in the city: Play was confirmed) · funnel.goal-1 · funnel.settled (settled in: has a local
 *   government and a house) · funnel.job · funnel.shift · funnel.goals-done (the whole starter chain) · funnel.mission ·
 *   funnel.table · funnel.day-two-work — each once per life
 *   share.made.<kind> · share.opened (the preview page /s/<code> was fetched with GET: people AND the link-preview
 *   crawlers of chat apps, so it is an upper bound on people) ·
 *   referral.linked (a new life was attached to a sharer's link; the same act is not counted again under a share name) ·
 *   referral.welcomed · referral.counted · referral.paid · referral.refused.<why>
 *   table.started.<game> · table.finished.<game> · table.abandoned.<game> · table.human · table.bot
 *   consent.adult · consent.minor · client.<signal> (webgl-missing, opera-mini, save-data, slow-start, inapp-tiktok, inapp-meta, old-browser)
 *
 * WHERE VISITS CAME FROM (`sources`, POST /api/growth/source). { [lagosDay]: { "source|medium|campaign|content": { landed,
 * play, game, stayed } } } — four whole-number totals per campaign per day: opened the page, pressed Play, reached the game,
 * still there about ten minutes later. The four words are the `utm_` words of the landing address, cleaned
 * (src/game/attribution.ts). At most KEEP.sourceKeys distinct keys a day (a new one past that is counted under
 * other|other|other|none), kept KEEP.sourceDays days. No player id, address or browser detail is stored with it.
 */
import { lagosTime } from '../../src/game/clock.ts';
import { STARTER_GOALS } from '../../src/game/content/goals.ts';
import type { LifeState } from '../../src/types/life.ts';
import type { ActivationRow, FunnelStep, GrowthMetricsResponse, MetricsCohort, MetricsDay, RetentionCell, ReturnCell, ReturnRow, ReturnSplit, SourceCampaign, SourceRow } from '../../src/types/growth.ts';
import type { CityId } from '../../src/types/protocol.ts';
import { cleanSource, SOURCE_EVENTS } from '../../src/game/attribution.ts';
import type { SourceEvent } from '../../src/game/attribution.ts';
import type { GrowthCollection } from '../types.ts';
import { isAgentOrigin } from '../execution-origin.ts';
import type { ExecutionOrigin } from '../../src/types/progression.ts';

export const KEEP = Object.freeze({ days: 400, cohorts: 120, window: 31, lives: 50000, sourceDays: 90, sourceKeys: 200 });
export const RETENTION_DAYS = Object.freeze([1, 3, 7, 14, 30]);
/** The return days split by arrival source and by friend; bit i of a life's `ret` / `done` is SPLIT_DAYS[i]. */
export const SPLIT_DAYS = Object.freeze([1, 7, 30]);
/** A life made a friend "early" when it did so within this many days of starting (so day 1 and day 30 are judged the same way). */
export const FRIEND_WITHIN_DAYS = 1;
const SPLIT_GROUPS_PER_DAY = 40;
/**
 * Funnel steps. `reached(state)` is read from the server's own copy of the life. A life's steps are kept as a bit mask BY
 * POSITION in this list, so a step is only ever ADDED AT THE END: inserting one would shift the bits of lives already
 * followed and count them a second time. FUNNEL_ORDER is the order a person reads them in.
 */
export const FUNNEL: readonly { id: FunnelStep; reached: (state: LifeState) => boolean }[] = Object.freeze([
  { id: 'onboarded', reached: (state) => !(state.onboarding?.required === true && state.onboarding.done !== true) },
  { id: 'goal-1', reached: (state) => (state.goals?.chain ?? 0) >= 1 },
  { id: 'job', reached: (state) => Boolean(state.job) },
  { id: 'shift', reached: (state) => (state.civic?.work?.days ?? 0) >= 1 },
  { id: 'goals-done', reached: (state) => (state.goals?.chain ?? 0) >= STARTER_GOALS.length },
  { id: 'mission', reached: (state) => (state.missions?.claimed ?? 0) >= 1 },
  { id: 'table', reached: (state) => (state.growth?.tables?.played ?? 0) >= 1 },
  { id: 'day-two-work', reached: (state) => (state.civic?.work?.days ?? 0) >= 2 },
  // Added with the quick start: a guest who settled in (a local government and a house). At the end — see above.
  { id: 'settled', reached: (state) => state.onboarding?.done === true },
]);
export const FUNNEL_ORDER: readonly FunnelStep[] = Object.freeze(['onboarded', 'goal-1', 'settled', 'job', 'shift', 'goals-done', 'mission', 'table', 'day-two-work']);
/** Signals a browser may report about itself (see POST /api/growth/client). A fixed list: nothing free-form is counted. */
export const CLIENT_SIGNALS = Object.freeze(['webgl-missing', 'opera-mini', 'save-data', 'slow-start', 'installed', 'share-sheet', 'share-fallback', 'inapp-tiktok', 'inapp-meta', 'old-browser']);
const COUNTER = /^[a-z0-9][a-z0-9.-]{0,47}$/;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The metrics record with its three parts present (the objects are the stored ones, so changes to them are changes to the collection). */
interface MetricsBook {
  days: Record<string, Record<string, number>>
  cohorts: Record<string, { size: number; r: Record<string, number> }>
  lives: Record<string, { first: number; last: number | null; steps: number; src?: string; ret?: number; fr?: number; cl?: number; ag?: number; po?: number; f3?: number; act?: number; done?: number }>
}
function book(g: GrowthCollection, cityId: CityId = 'lagos'): MetricsBook {
  const m = g.metrics;
  if (!isRecord(m.cities)) m.cities = {};
  let city = m.cities[cityId];
  if (!isRecord(city)) {
    city = cityId === 'lagos' ? { days: isRecord(m.days) ? m.days : {}, cohorts: isRecord(m.cohorts) ? m.cohorts : {}, lives: isRecord(m.lives) ? m.lives : {} } : {};
    m.cities[cityId] = city;
  }
  if (!isRecord(city.days)) city.days = {};
  if (!isRecord(city.cohorts)) city.cohorts = {};
  if (!isRecord(city.lives)) city.lives = {};
  if (cityId === 'lagos') { m.days = city.days; m.cohorts = city.cohorts; m.lives = city.lives; }
  return { days: city.days, cohorts: city.cohorts, lives: city.lives };
}

const cityBooks = (g: GrowthCollection): [CityId, MetricsBook][] => {
  book(g, 'lagos');
  return Object.keys(g.metrics.cities ?? {}).map((cityId) => [cityId, book(g, cityId)]);
};

/** Add to one of today's counters. A name that is not a plain counter name is ignored. */
export function count(g: GrowthCollection, now: number, name: string, n?: number): void;
export function count(g: GrowthCollection, now: number, cityId: CityId, name: string, n?: number): void;
export function count(g: GrowthCollection, now: number, cityOrName: CityId | string, nameOrN: string | number = 1, amount = 1): void {
  const cityId: CityId = typeof nameOrN === 'string' ? cityOrName : 'lagos';
  const name = typeof nameOrN === 'string' ? nameOrN : cityOrName;
  const n = typeof nameOrN === 'number' ? nameOrN : amount;
  if (typeof name !== 'string' || !COUNTER.test(name) || !Number.isSafeInteger(n) || n <= 0) return;
  const m = book(g, cityId), day = lagosTime(now).day;
  const today = (m.days[day] ||= {});
  if (Object.keys(today).length >= 200 && !Object.hasOwn(today, name)) return;
  today[name] = Math.min(Number.MAX_SAFE_INTEGER, (today[name] ?? 0) + n);
}

/**
 * A life was seen: count it once for today, once for each retention day it reaches, and once per funnel step.
 * `lastSeen`: when this player was last seen before now (server ms, or null) — so a life too old to be followed is still
 * counted once a day and not once per visit.
 */
export function touch(g: GrowthCollection, now: number, publicId: string, state: LifeState, lastSeen: number | null = null, arrived?: unknown): void {
  const cityId: CityId = typeof state.estate?.city === 'string' ? state.estate.city : 'lagos';
  const m = book(g, cityId), day = lagosTime(now).day;
  const first = lagosTime(Number.isFinite(state?.civic?.since) ? state.civic.since : now).day;
  let found: MetricsBook['lives'][string] | null = Object.hasOwn(m.lives, publicId) ? m.lives[publicId] ?? null : null;
  if (!found) {
    // Only a life still inside its window is followed; an old life is counted as active and nothing else.
    if (day - first > KEEP.window - 1 || Object.keys(m.lives).length >= KEEP.lives) { if (typeof lastSeen !== 'number' || !Number.isFinite(lastSeen) || lagosTime(lastSeen).day !== day) count(g, now, cityId, 'active-untracked'); return; }
    found = m.lives[publicId] = { first, last: null, steps: 0, src: sourceKey(arrived) };
    const cohort = (m.cohorts[first] ||= { size: 0, r: {} });
    cohort.size += 1;
    if (first === day) count(g, now, cityId, 'new');
  }
  const life = found;
  if (life.last !== day) {
    life.last = day;
    count(g, now, cityId, 'active');
    const offset = day - life.first;
    const cohort = m.cohorts[life.first];
    if (RETENTION_DAYS.includes(offset) && cohort) cohort.r[offset] = (cohort.r[offset] ?? 0) + 1;
    const bit = SPLIT_DAYS.indexOf(offset);
    if (bit >= 0) life.ret = (life.ret ?? 0) | (1 << bit);
  }
  FUNNEL.forEach((step, index) => {
    if (life.steps & (1 << index) || !step.reached(state)) return;
    life.steps |= 1 << index;
    count(g, now, cityId, `funnel.${step.id}`);
  });
}

/** "source|medium|campaign" from a hello's words, cleaned again here. */
function sourceKey(words: unknown): string {
  const { source, medium, campaign } = cleanSource(words);
  return `${source}|${medium}|${campaign}`;
}
/** A real friend was made (a friend request was accepted): note the day on both lives that are followed. Ignored for a life not followed. */
export function noteFriend(g: GrowthCollection, now: number, ...publicIds: string[]): void { noteDay(g, now, 'fr', publicIds); }
/** A life created or joined a clan: note the day, once. Ignored for a life not followed. */
export function noteClan(g: GrowthCollection, now: number, publicId: string): void { noteDay(g, now, 'cl', [publicId]); }
/** A life sent a message to an AI character: note the day, once. Ignored for a life not followed. */
export function noteAgent(g: GrowthCollection, now: number, publicId: string): void { noteDay(g, now, 'ag', [publicId]); }
/** A life posted in the feed for the first time: note the day, once. Ignored for a life not followed. */
/** A life reached three real friends: note the day, once (the north star: three friends within a week). */
export function noteThreeFriends(g: GrowthCollection, now: number, publicId: string): void { noteDay(g, now, 'f3', [publicId]); }
export function notePosted(g: GrowthCollection, now: number, publicId: string): void { noteDay(g, now, 'po', [publicId]); }
const ACTIVATION_OTHER = 'other|other|other';
/**
 * A life did something meaningful for the first time (walked, posted, joined a community, or is going to an event). Counted ONCE per
 * life, under the "source|medium|campaign" it arrived with and the Lagos day it began (so a cohort's activations sit with its landings).
 * `origin` is the request's: an AI agent (a delegated key or an agent's own character) is never activated. Ignored for a life not followed.
 * Returns whether this call was the first.
 */
export function noteActivated(g: GrowthCollection, now: number, publicId: string, origin: ExecutionOrigin = 'human'): boolean {
  if (isAgentOrigin(origin)) return false;
  const day = lagosTime(now).day;
  let first: MetricsBook['lives'][string] | null = null;
  for (const [, m] of cityBooks(g)) {
    const life = Object.hasOwn(m.lives, publicId) ? m.lives[publicId] : undefined;
    if (!life) continue;
    if (life.act !== undefined) return false;
    life.act = day;
    first ??= life;
  }
  if (!first) return false;
  const cohorts = (g.metrics.activation ||= {}), today = (cohorts[first.first] ||= {}), words = first.src ?? 'unknown|unknown|unknown';
  const key = !Object.hasOwn(today, words) && Object.keys(today).length >= SPLIT_GROUPS_PER_DAY ? ACTIVATION_OTHER : words;
  today[key] = Math.min(Number.MAX_SAFE_INTEGER, (today[key] ?? 0) + 1);
  return true;
}
function noteDay(g: GrowthCollection, now: number, field: 'fr' | 'cl' | 'ag' | 'po' | 'f3', publicIds: string[]): void {
  const day = lagosTime(now).day;
  for (const [, m] of cityBooks(g)) for (const id of publicIds) { const life = Object.hasOwn(m.lives, id) ? m.lives[id] : undefined; if (life && life[field] === undefined) life[field] = day; }
}
/** Count every life that is old enough for a return day, once, into `split`; a life is settled for day N when it is N+1 days old (day 1: FRIEND_WITHIN_DAYS + 1). */
function settle(g: GrowthCollection, day: number): void {
  const split = (g.metrics.split ||= {});
  for (const [, m] of cityBooks(g)) for (const life of Object.values(m.lives)) {
    const age = day - life.first;
    SPLIT_DAYS.forEach((offset, bit) => {
      if ((life.done ?? 0) & (1 << bit) || age < Math.max(offset, FRIEND_WITHIN_DAYS) + 1) return;
      life.done = (life.done ?? 0) | (1 << bit);
      const returned = (life.ret ?? 0) & (1 << bit) ? 1 : 0, early = (at: number | undefined): 'yes' | 'no' => (at !== undefined && at - life.first <= FRIEND_WITHIN_DAYS ? 'yes' : 'no');
      const today = (split[life.first] ||= {});
      for (const group of [`src:${life.src ?? 'unknown|unknown|unknown'}`, `friend:${early(life.fr)}`, `clan:${early(life.cl)}`, `agent:${early(life.ag)}`, `posted:${early(life.po)}`]) {
        // Only the source groups are capped (the six yes/no groups are always kept): a new one past the cap is counted under other.
        const key = group.startsWith('src:') && !Object.hasOwn(today, group) && Object.keys(today).length >= SPLIT_GROUPS_PER_DAY ? 'src:other|other|other' : group;
        const cell = ((today[key] ||= {})[offset] ||= [0, 0]);
        cell[0] += 1; cell[1] += returned;
      }
    });
  }
}

const OVERFLOW_KEY = 'other|other|other|none';
/** Count one step of a visit under its (source, medium, campaign, content). The words are cleaned here again; a new key past the day's cap goes to `other`. */
export function countSource(g: GrowthCollection, now: number, words: unknown, event: SourceEvent): void {
  if (!SOURCE_EVENTS.includes(event)) return;
  const { source, medium, campaign, content } = cleanSource(words);
  const sources = (g.metrics.sources ||= {}), day = lagosTime(now).day;
  const today = (sources[day] ||= {});
  let key = `${source}|${medium}|${campaign}|${content}`;
  if (!Object.hasOwn(today, key) && Object.keys(today).length >= KEEP.sourceKeys) key = OVERFLOW_KEY;
  const row = (today[key] ||= { landed: 0, play: 0, game: 0, stayed: 0 });
  row[event] = Math.min(Number.MAX_SAFE_INTEGER, row[event] + 1);
}

/** Drop what is past its retention. Called from the hourly sweep. */
export function prune(g: GrowthCollection, now: number): void {
  const day = lagosTime(now).day;
  for (const key of Object.keys(g.metrics.sources ?? {})) if (day - Number(key) > KEEP.sourceDays) delete g.metrics.sources?.[key];
  for (const key of Object.keys(g.metrics.activation ?? {})) if (day - Number(key) > KEEP.sourceDays) delete g.metrics.activation?.[key];
  // At most once an hour: it looks at every followed life.
  if (!(now - (g.metrics.splitAt ?? 0) < 3600000)) { g.metrics.splitAt = now; settle(g, day); }
  for (const key of Object.keys(g.metrics.split ?? {})) if (day - Number(key) > KEEP.cohorts) delete g.metrics.split?.[key];
  for (const [, m] of cityBooks(g)) {
    for (const key of Object.keys(m.days)) if (day - Number(key) > KEEP.days) delete m.days[key];
    for (const key of Object.keys(m.cohorts)) if (day - Number(key) > KEEP.cohorts) delete m.cohorts[key];
    for (const [id, life] of Object.entries(m.lives)) if (day - life.first > KEEP.window) delete m.lives[id];
  }
}

/** The campaigns' totals, per day and summed over the days shown. */
function sourceReport(g: GrowthCollection, today: number, span: number): { sources: SourceRow[]; campaigns: SourceCampaign[] } {
  const sources: SourceRow[] = [], sums = new Map<string, SourceCampaign>();
  for (let day = today - span + 1; day <= today; day++) {
    for (const [key, counts] of Object.entries(g.metrics.sources?.[day] ?? {})) {
      const [source = '', medium = '', campaign = '', content = ''] = key.split('|');
      sources.push({ day, date: dateOf(day), source, medium, campaign, content, ...counts });
      const sum = sums.get(key) ?? { source, medium, campaign, content, landed: 0, play: 0, game: 0, stayed: 0 };
      for (const event of SOURCE_EVENTS) sum[event] += counts[event];
      sums.set(key, sum);
    }
  }
  const campaigns = [...sums.values()].sort((a, b) => b.landed - a.landed);
  return { sources, campaigns };
}
/**
 * Activated / landed per "source / medium / campaign", over every day kept (KEEP.sourceDays). `landed` is the page opens the browser reported
 * (any content word), `activated` the lives that began on those days and did a first meaningful action since, so the rate is a floor: a
 * reload counts as a landing, and a landing that never made a life is a landing that was not activated. A day not yet settled shows its
 * share as it stands. `rate` is null when nothing landed.
 */
export function activationReport(g: GrowthCollection): ActivationRow[] {
  const rows = new Map<string, { landed: number; activated: number }>();
  const row = (words: string) => { let found = rows.get(words); if (!found) rows.set(words, found = { landed: 0, activated: 0 }); return found; };
  for (const keys of Object.values(g.metrics.sources ?? {})) for (const [key, counts] of Object.entries(keys)) row(key.split('|').slice(0, 3).join('|')).landed += counts.landed;
  for (const keys of Object.values(g.metrics.activation ?? {})) for (const [words, n] of Object.entries(keys)) row(words).activated += n;
  return [...rows].map(([words, { landed, activated }]): ActivationRow => {
    const [source = '', medium = '', campaign = ''] = words.split('|');
    return { source, medium, campaign, landed, activated, rate: landed ? Math.round((activated / landed) * 1000) / 10 : null };
  }).sort((a, b) => b.landed - a.landed || b.activated - a.activated).slice(0, 40);
}
/** The return split, summed over every cohort kept. A day that is not settled yet for anyone shows no rate (null), never 0. */
export function returnSplit(g: GrowthCollection): ReturnSplit {
  const sum = new Map<string, Record<string, [number, number]>>();
  for (const groups of Object.values(g.metrics.split ?? {})) for (const [group, days] of Object.entries(groups)) {
    const into = sum.get(group) ?? {};
    for (const [offset, [lives, returned]] of Object.entries(days)) { const cell = (into[offset] ||= [0, 0]); cell[0] += lives; cell[1] += returned; }
    sum.set(group, into);
  }
  const cell = (days: Record<string, [number, number]> | undefined, offset: number): ReturnCell => {
    const [lives, returned] = days?.[offset] ?? [0, 0];
    return { lives, returned, rate: lives ? Math.round((returned / lives) * 1000) / 10 : null };
  };
  const row = (days: Record<string, [number, number]> | undefined): ReturnRow => ({ d1: cell(days, 1), d7: cell(days, 7), d30: cell(days, 30) });
  const bySource = [...sum].filter(([group]) => group.startsWith('src:')).map(([group, days]) => {
    const [source = '', medium = '', campaign = ''] = group.slice(4).split('|');
    return { source, medium, campaign, ...row(days) };
  }).sort((a, b) => b.d1.lives - a.d1.lives).slice(0, 40);
  return { bySource, byFriend: { yes: row(sum.get('friend:yes')), no: row(sum.get('friend:no')) },
    byClan: { yes: row(sum.get('clan:yes')), no: row(sum.get('clan:no')) }, byAgent: { yes: row(sum.get('agent:yes')), no: row(sum.get('agent:no')) }, byPosted: { yes: row(sum.get('posted:yes')), no: row(sum.get('posted:no')) },
    note: 'A life is counted once it is old enough. "Has a friend" means a real friend made in the first two days (the founder\'s welcome does not count). "Has a clan" means created or joined a clan in the first two days; "talked to an agent" means sent a message to an AI character in the first two days. Lives that started before this was counted are not in it.' };
}
const dateOf = (day: number): string => new Date(day * 86400000).toISOString().slice(0, 10);
/** The operator's report: totals per day and the cohort table. Carries no player id. */
export function report(g: GrowthCollection, now: number, { days = 35 }: { days?: number } = {}): Omit<GrowthMetricsResponse, 'analytics'> {
  const books = cityBooks(g), today = lagosTime(now).day, span = Math.max(1, Math.min(KEEP.days, days));
  const m: MetricsBook = { days: {}, cohorts: {}, lives: {} };
  for (const [cityId, source] of books) {
    for (const [day, counters] of Object.entries(source.days)) {
      const target = (m.days[day] ||= {});
      for (const [name, value] of Object.entries(counters)) target[name] = (target[name] ?? 0) + value;
    }
    for (const [day, cohort] of Object.entries(source.cohorts)) {
      const target = (m.cohorts[day] ||= { size: 0, r: {} }); target.size += cohort.size;
      for (const [offset, value] of Object.entries(cohort.r)) target.r[offset] = (target.r[offset] ?? 0) + value;
    }
    for (const [id, life] of Object.entries(source.lives)) m.lives[`${cityId}:${id}`] = life;
  }
  const daily: MetricsDay[] = [];
  for (let day = today - span + 1; day <= today; day++) { const counters = m.days[day]; if (counters) daily.push({ day, date: dateOf(day), ...counters }); }
  const cohorts = Object.keys(m.cohorts).map(Number).filter((day) => today - day < span + 30).sort((a, b) => a - b).flatMap((day): MetricsCohort[] => {
    const cohort = m.cohorts[day];
    if (!cohort) return [];
    // A retention day that has not come yet is null, never zero: "nobody came back" and "too early to say" are different answers.
    const cell = (offset: number): RetentionCell => (today - day < offset ? null : { returned: cohort.r[offset] ?? 0, rate: cohort.size ? Math.round(((cohort.r[offset] ?? 0) / cohort.size) * 1000) / 10 : 0 });
    return [{ day, date: dateOf(day), size: cohort.size, d1: cell(1), d3: cell(3), d7: cell(7), d14: cell(14), d30: cell(30) }];
  });
  const totals: Record<string, number> = {};
  for (const row of daily) for (const [name, value] of Object.entries(row)) if (name !== 'day' && name !== 'date' && typeof value === 'number') totals[name] = (totals[name] ?? 0) + value;
  const funnel = FUNNEL_ORDER.map((id) => ({ step: id, lives: totals[`funnel.${id}`] ?? 0 }));
  // THE NORTH STAR (docs/SOCIAL-PLATFORM-PLAN.md): of the lives at least eight days old that are still followed, how many had three real friends within their first week.
  const old = Object.values(m.lives).filter((life) => today - life.first >= 8), reached = old.filter((life) => life.f3 !== undefined && life.f3 - life.first <= 7).length
  const northStar = { lives: old.length, threeFriendsInAWeek: reached, rate: old.length ? Math.round((reached / old.length) * 1000) / 10 : null }
  return { generatedAt: now, timezone: 'Africa/Lagos', source: 'first-party', days: daily, cohorts, totals, funnel, ...sourceReport(g, today, span), activation: activationReport(g), returns: returnSplit(g), northStar, tracked: Object.keys(m.lives).length,
    retention: { daily: `${KEEP.days} days`, cohorts: `${KEEP.cohorts} days`, perLife: `${KEEP.window} days, then deleted` } };
}
