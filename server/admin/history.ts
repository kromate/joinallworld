/**
 * OWNER: admin
 * THE DASHBOARD'S HISTORY. Two sources, both bounded, neither scanned on a read:
 *
 *   growth metrics (server/growth/metrics.ts, kept 400 days)   new lives, lives seen each day, sessions, every funnel step, and the
 *       retention cohorts. Counted by the server as it happens, so every number is EXACT. Read by walking at most 30 days of counters.
 *   adminDaily (this file)                                       what had NO history before: the busiest moment of each day (players online
 *       at once), accounts, device sessions held, calls, the hosted guide's requests, mail sent and cash in circulation when it was last
 *       measured. One row per Lagos day of a dozen whole numbers, the last DAILY_KEEP days, written by the heartbeat at most once every
 *       TICK_MS and only when a number changed. Recording starts the first time the server runs this code: `startedOn` says the day, and a
 *       day before it has no row (a chart shows a gap, never a zero).
 *
 * WHAT IS EXACT AND WHAT IS NOT. new / seen / sessions / funnel / retention: exact counts of what the server saw. peakOnline: the highest of
 * the samples taken (every TICK_MS), so a short peak between two samples can be missed: a floor, not an exact peak. Calls and guide
 * requests are the host's own day counters (UTC day), taken at the last sample of the Lagos day: close, not exact. Cash: the economy
 * snapshot's total at the time it was last computed (it is computed only when an admin asks for it), so it is sparse.
 * COST. Reading: a few hundred additions over counters already in memory. Recording: one transaction every TICK_MS at most, and only when
 * a value changed; the collection is about 400 x 13 whole numbers, one row on the Worker.
 */
import { lagosTime } from '../../src/game/clock.ts';
import { RETENTION_DAYS } from '../growth/metrics.ts';
import { collectionOf, peek } from './store.ts';
import { DAILY_KEEP } from './store.ts';
import type { Db, RouteContext } from '../types.ts';

export const TICK_MS = 15 * 60000;
/** The fields of one row of adminDaily, in the order they are stored. New ones are only ever added at the END. */
export const DAILY_KEYS = ['peakOnline', 'accounts', 'sessions', 'callsPlaced', 'callsConnected', 'callsRelay', 'callsFailed', 'aiRequests', 'aiModel', 'aiFallback', 'emailSent', 'pushSent', 'cash'] as const;
export type DailyKey = typeof DAILY_KEYS[number];
export type DailySample = Partial<Record<DailyKey, number>>;
/** How a field of the row combines with what the day already holds: the highest seen, or the latest. */
const MERGE: Record<DailyKey, 'max' | 'last'> = { peakOnline: 'max', accounts: 'last', sessions: 'last', callsPlaced: 'max', callsConnected: 'max', callsRelay: 'max', callsFailed: 'max', aiRequests: 'max', aiModel: 'max', aiFallback: 'max', emailSent: 'max', pushSent: 'max', cash: 'last' };

/** Fold one sample into the day's row. Returns whether the row changed. */
export function fold(row: number[], sample: DailySample): boolean {
  let changed = false;
  DAILY_KEYS.forEach((key, index) => {
    const value = sample[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return;
    const next = Math.round(value), before = row[index];
    const merged = before === undefined || before < 0 ? next : MERGE[key] === 'max' ? Math.max(before, next) : next;
    if (merged !== before) { row[index] = merged; changed = true; }
  });
  for (let i = 0; i < DAILY_KEYS.length; i++) if (row[i] === undefined) row[i] = -1; // not measured that day
  return changed;
}

const dateOf = (day: number): string => new Date(day * 86400000).toISOString().slice(0, 10);

interface Counters { [name: string]: number }
/** Today's counters of every city added together (a read of the stored counters, nothing is created). */
export function dayCounters(db: Db, day: number): Counters {
  const g = db.growth, out: Counters = {};
  const books = Object.values(g?.metrics.cities ?? {});
  for (const book of books) for (const [name, value] of Object.entries(book?.days?.[day] ?? {})) out[name] = (out[name] ?? 0) + value;
  if (!g?.metrics.cities?.['lagos']) for (const [name, value] of Object.entries(g?.metrics.days?.[day] ?? {})) out[name] = (out[name] ?? 0) + value;
  return out;
}
/** The first-visit-and-next-day return rate of the lives that began on `day`: null while "the next day" has not come, or the cohort is gone. */
function cohortOf(db: Db, day: number): { size: number; r: Record<string, number> } | null {
  const g = db.growth;
  let size = 0; const r: Record<string, number> = {};
  const books = [...Object.values(g?.metrics.cities ?? {}), ...(g?.metrics.cities?.['lagos'] ? [] : [g?.metrics])];
  for (const book of books) {
    const cohort = book?.cohorts?.[day];
    if (!cohort) continue;
    size += cohort.size;
    for (const [offset, n] of Object.entries(cohort.r)) r[offset] = (r[offset] ?? 0) + n;
  }
  return size ? { size, r } : null;
}

export interface HistoryDay { day: number; date: string; new: number; seen: number; sessions: number; funnel: Record<string, number>; daily: Record<DailyKey, number | null> | null }
/** The funnel as a list: what each step counts, whether it is exact, and the figure for the period. */
export interface FunnelStep { id: string; label: string; count: number | null; exact: boolean; note: string }

export function historyOf(db: Db, now: number, days: number) {
  const today = lagosTime(now).day, span = Math.max(1, Math.min(DAILY_KEEP, Math.floor(days) || 30));
  const store = peek(db, 'adminDaily');
  const first = Object.keys(store.days).map(Number).filter(Number.isFinite).sort((a, b) => a - b)[0] ?? null;
  const rows: HistoryDay[] = [];
  for (let day = today - span + 1; day <= today; day++) {
    const c = dayCounters(db, day), raw = store.days[day];
    const funnel: Record<string, number> = {};
    for (const [name, value] of Object.entries(c)) if (name.startsWith('funnel.')) funnel[name.slice(7)] = value;
    rows.push({ day, date: dateOf(day), new: c['new'] ?? 0, seen: (c['active'] ?? 0) + (c['active-untracked'] ?? 0), sessions: c['sessions'] ?? 0, funnel,
      daily: raw ? Object.fromEntries(DAILY_KEYS.map((key, index) => [key, (raw[index] ?? -1) < 0 ? null : raw[index] ?? null])) as Record<DailyKey, number | null> : null });
  }
  return { asOf: now, today, startedOn: first === null ? null : dateOf(first), kept: Object.keys(store.days).length, days: rows,
    exact: { new: true, seen: true, sessions: true, funnel: true, peakOnline: false, accounts: true, calls: false, ai: false, cash: false } };
}

/** The new-player funnel over the last `span` days (1 = today). Counts are of steps reached in the period by anyone the server was following: not strictly the same people. */
export function funnelOf(db: Db, now: number, span: number): { span: number; steps: FunnelStep[]; returned: { size: number; back: number; rate: number | null } } {
  const today = lagosTime(now).day, total: Counters = {};
  for (let day = today - span + 1; day <= today; day++) for (const [name, value] of Object.entries(dayCounters(db, day))) total[name] = (total[name] ?? 0) + value;
  // The next-day return: lives that began on the days of the period whose "next day" has already come (so today's lives are not counted).
  let size = 0, back = 0;
  for (let day = today - span + 1; day < today; day++) { const cohort = cohortOf(db, day); if (cohort) { size += cohort.size; back += cohort.r[String(RETENTION_DAYS[0])] ?? 0; } }
  const step = (id: string, label: string, name: string, note: string): FunnelStep => ({ id, label, count: total[name] ?? 0, exact: true, note });
  return {
    span,
    steps: [
      { id: 'landed', label: 'Opened the page', count: null, exact: false, note: 'Not counted on the server: page views are only in the analytics tool, if it is switched on.' },
      step('new', 'New lives (pressed Play)', 'new', 'A life seen for the first time that day: exact.'),
      step('onboarded', 'Arrived in the city', 'funnel.onboarded', 'Play confirmed: exact.'),
      step('goal-1', 'Finished the first goal', 'funnel.goal-1', 'Exact.'),
      step('settled', 'Settled a home', 'funnel.settled', 'A local government and a house chosen: exact.'),
      step('shift', 'First paid work', 'funnel.shift', 'First shift worked: exact.'),
      { id: 'friend', label: 'Made a first friend', count: null, exact: false, note: 'Not counted as a funnel step yet.' },
    ],
    returned: { size, back, rate: size ? Math.round((back / size) * 1000) / 10 : null },
  };
}

/** Per-city counters of today and the ids of every city that has any: new lives and lives seen. */
export function citiesToday(db: Db, now: number): Record<string, { new: number; seen: number }> {
  const day = lagosTime(now).day, out: Record<string, { new: number; seen: number }> = {};
  for (const [city, book] of Object.entries(db.growth?.metrics.cities ?? {})) {
    const c = book?.days?.[day] ?? {};
    out[city] = { new: c['new'] ?? 0, seen: (c['active'] ?? 0) + (c['active-untracked'] ?? 0) };
  }
  return out;
}

/** The recorder: a heartbeat hook that takes one sample every TICK_MS and folds it into today's row. */
export function recorder(ctx: RouteContext, sample: (db: Db) => DailySample) {
  let last = 0, busy = false;
  return {
    async tick(force = false): Promise<void> {
      const now = ctx.now();
      if (busy || (!force && now - last < TICK_MS) || now < last) return;
      busy = true; last = now;
      try {
        const taken = await ctx.store.read((db) => sample(db));
        await ctx.store.transact((db) => {
          const day = String(lagosTime(ctx.now()).day), existing = peek(db, 'adminDaily').days[day];
          // Look first: a sample that changes nothing writes nothing (and does not even create the collection).
          const probe = existing ? [...existing] : [];
          if (!fold(probe, taken) && existing) return;
          const store = collectionOf(ctx, db, 'adminDaily');
          const row = store.days[day] ?? [];
          fold(row, taken);
          store.days[day] = row;
          if (!store.first) store.first = Number(day);
          const keys = Object.keys(store.days).map(Number).sort((a, b) => a - b);
          for (const key of keys.slice(0, Math.max(0, keys.length - DAILY_KEEP))) delete store.days[key];
        });
      } catch { /* a sample that could not be saved is taken again at the next tick */ } finally { busy = false; }
    },
  };
}
