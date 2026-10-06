/**
 * OWNER: admin
 * THE DASHBOARD'S NUMBERS. Every number says when it was true (`asOf`) and what it cost to get; the whole answer is cached for
 * CACHE_MS, so a refresh button, two admins or a polling page cost one computation. Nothing here writes.
 *
 * CHEAP (memory the host already keeps, or one stored value; no walk over players):
 *   online now, per city       the pulse (server/pulse.ts): live sockets, a reload grace, one player counted once. EXACT.
 *   sockets, sessions held     the host's own counters and the key count of the session table. EXACT.
 *   accounts                   accountLog.accounts (kept by the account service), else the account table's key count. EXACT.
 *   guests                     sessions held minus accounts' characters held: APPROXIMATE (an expired session not yet swept counts).
 *   new players today / 7 d / active today / 7 d / 30 d
 *                              the first-party growth metrics (server/growth/metrics.ts), one read of the growth collection.
 *                              Today is EXACT (distinct lives seen today). 7 d and 30 d are distinct lives for lives under 31 days old
 *                              (EXACT) PLUS, for older lives, visits counted once per day (an upper bound): shown as `exact` and `olderVisits`.
 *   businesses open, reports, problems, mail today, storage sizes, build, uptime, the admin money totals: stored counters.
 * ECONOMY SNAPSHOT (separate, on request, cached longer): one walk over the stored sessions (at most ADMIN_SCAN_MAX) for cash in
 *   circulation, the net of each ledger category on today's Lagos day (wages, gigs, stall sales, admin credits and debits, fares, rent …),
 *   and residents and visitors per city. On the Node host it is memory; on the Worker it reads every session row (no row is written).
 *   Admin credits and debits are two of the ledger categories ("Admin credit", "Admin debit"), so they appear in the same totals.
 */
import { characterCity } from '../character.ts';
import { lagosTime } from '../../src/game/clock.ts';
import { pulseOf } from '../pulse.ts';
import { supportService } from '../support/service.ts';
import { LIMITS as OUTREACH_LIMITS } from '../growth/outreach.ts';
import { limitsOf } from './config.ts';
import { eachSession } from './players.ts';
import { peek } from './store.ts';
import { adminStats } from './tools.ts';
import type { Db, RouteContext } from '../types.ts';

export const CACHE_MS = 45000, SNAPSHOT_CACHE_MS = 600000;
const startedAt = new WeakMap<RouteContext, number>();
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function statsService(ctx: RouteContext) {
  const support = supportService(ctx);
  startedAt.set(ctx, typeof ctx.now === 'function' ? ctx.now() : 0);
  let cache: { at: number; value: ReturnType<typeof compute> } | null = null, snapshotCache: { at: number; value: ReturnType<typeof snapshot> } | null = null;

  function compute(db: Db) {
    const now = ctx.now(), today = lagosTime(now).day;
    const pulse = pulseOf(ctx).pulse(null);
    const g = db.growth;
    const dayRow = (day: number) => { const counters = (g?.metrics.cities ? Object.values(g.metrics.cities) : []).reduce<Record<string, number>>((sum, book) => { for (const [name, value] of Object.entries(book?.days?.[day] ?? {})) sum[name] = (sum[name] ?? 0) + value; return sum; }, {}); for (const [name, value] of Object.entries(g?.metrics.days?.[day] ?? {})) if (!g?.metrics.cities?.['lagos']) counters[name] = (counters[name] ?? 0) + value; return counters; };
    const span = (days: number, name: string): number => { let total = 0; for (let day = today - days + 1; day <= today; day++) total += dayRow(day)[name] ?? 0; return total; };
    let tracked7 = 0, tracked30 = 0, trackedLives = 0;
    for (const book of [...Object.values(g?.metrics.cities ?? {}), ...(g?.metrics.cities?.['lagos'] ? [] : [g?.metrics])]) for (const life of Object.values(book?.lives ?? {})) { trackedLives += 1; if (life.last !== null && life.last >= today - 6) tracked7 += 1; if (life.last !== null && life.last >= today - 29) tracked30 += 1; }
    const sessionsHeld = Object.keys(db.sessions).length, accounts = db.accountLog?.accounts ?? Object.keys(db.accounts ?? {}).length;
    const accountCharacters = Object.values(db.accounts ?? {}).filter((account) => account?.sessionKey).length;
    const open = ctx.core.sockets().length;
    const day = String(today), outreach = db.growth?.outreach, comeback = db.growth?.comebackStats?.[day] ?? {};
    const shops = Object.values(db.business?.shops ?? {});
    const audit = peek(db, 'adminAudit'), todayStart = (lagosTime(now).day) * 86400000 - 3600000;
    let creditToday = 0, debitToday = 0, grantToday = 0;
    for (let i = audit.lines.length - 1; i >= 0; i--) { const line = audit.lines[i]; if (!line || line.at < todayStart) break; if (typeof line.amount !== 'number') continue; if (line.action === 'grant') grantToday += Math.abs(line.amount); else if (line.amount > 0) creditToday += line.amount; else debitToday -= line.amount; }
    const store = ctx.core.storeStats?.() ?? null;
    const activeToday = (dayRow(today)['active'] ?? 0) + (dayRow(today)['active-untracked'] ?? 0);
    return {
      asOf: now,
      online: { value: Math.max(pulse.online, 0), cities: pulse.cities, cost: 'memory', exact: true },
      players: {
        newToday: dayRow(today)['new'] ?? 0, new7d: span(7, 'new'), activeToday,
        active7d: { exact: tracked7, olderVisits: span(7, 'active-untracked') }, active30d: { exact: tracked30, olderVisits: span(30, 'active-untracked') }, tracked: trackedLives,
        cost: 'one read of the growth collection', note: 'Today is exact. 7 and 30 days are exact for lives under 31 days old; older lives are counted once per day they were seen, so those are an upper bound.',
      },
      accounts: { accounts, guests: Math.max(0, sessionsHeld - accountCharacters), approximate: true, cost: 'key counts' },
      capacity: { sessions: { held: sessionsHeld, most: ctx.config.maxActiveSessions }, sockets: { open, most: ctx.config.maxSockets, perAddress: ctx.config.socketsPerAddress } },
      businesses: { open: shops.filter((shop) => shop.status !== 'closed').length, total: shops.length },
      reports: { open: (db.social?.reports ?? []).filter((report) => report.status === 'received').length, problems: support.counts(db) },
      mail: {
        email: { sentToday: outreach?.sent[day]?.email ?? 0, cap: Number(ctx.env('EMAIL_DAILY_CAP')) || OUTREACH_LIMITS.emailPerDay, off: outreach?.off.email === true },
        push: { sentToday: outreach?.sent[day]?.push ?? 0, cap: Number(ctx.env('PUSH_DAILY_CAP')) || OUTREACH_LIMITS.pushPerDay, off: outreach?.off.push === true },
        byKind: Object.fromEntries(Object.entries(comeback).map(([kind, counters]) => [kind, (counters as { sent?: number }).sent ?? 0])),
      },
      adminMoney: { creditToday, debitToday, grantToday, creditTotal: audit.totals.credit, debitTotal: audit.totals.debit, grantTotal: audit.totals.grant },
      storage: { collections: (store as { collections?: Record<string, number> } | null)?.collections ?? {}, rows: (store as { rows?: unknown } | null)?.rows ?? null, writes: isCount((store as { writes?: unknown } | null)?.writes) ? (store as { writes: number }).writes : null, cost: 'counters the store keeps' },
      build: ctx.config.buildId, uptimeMs: now - (startedAt.get(ctx) ?? now),
      extra: adminStats(ctx).map((stat) => ({ id: stat.id, label: stat.label, group: stat.group ?? '', cost: stat.cost, value: stat.read(db) })),
    };
  }

  function snapshot(db: Db) {
    const now = ctx.now(), today = lagosTime(now).day, limit = limitsOf(ctx).scanMax;
    let seen = 0, cash = 0, players = 0, withCash = 0;
    const categories: Record<string, { net: number; players: number }> = {}, cities: Record<string, { residents: number; visitors: number }> = {};
    eachSession(db, (session) => {
      seen += 1;
      if (seen > limit || !(session.expiresAt > now)) return;
      const city = characterCity(session), state = city ? session.cities[city]?.state : undefined;
      if (!city || !state) return;
      players += 1; cash += state.cash; if (state.cash > 0) withCash += 1;
      const entry = (cities[city] ??= { residents: 0, visitors: 0 });
      if (state.estate?.home === city) entry.residents += 1; else entry.visitors += 1;
      const last = state.ledgerDays.at(-1);
      if (last?.day === today) for (const [group, [net]] of Object.entries(last.by)) { const slot = (categories[group] ??= { net: 0, players: 0 }); slot.net += net; slot.players += 1; }
    });
    const list = Object.entries(categories).map(([category, slot]) => ({ category, ...slot })).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
    return { asOf: now, sessionsRead: Math.min(seen, limit), sessionsHeld: seen, truncated: seen > limit, players, cashInCirculation: cash, playersWithCash: withCash, cities,
      faucets: list.filter((item) => item.net > 0).slice(0, 14), sinks: list.filter((item) => item.net < 0).slice(0, 14), cost: `one pass over ${Math.min(seen, limit)} stored sessions (reads only), cached ${SNAPSHOT_CACHE_MS / 60000} minutes` };
  }

  return {
    dashboard(db: Db, fresh = false) {
      if (!fresh && cache && ctx.now() - cache.at < CACHE_MS && ctx.now() >= cache.at) return cache.value;
      const value = compute(db);
      cache = { at: ctx.now(), value };
      return value;
    },
    economy(db: Db, fresh = false) {
      if (!fresh && snapshotCache && ctx.now() - snapshotCache.at < SNAPSHOT_CACHE_MS && ctx.now() >= snapshotCache.at) return snapshotCache.value;
      const value = snapshot(db);
      snapshotCache = { at: ctx.now(), value };
      return value;
    },
    invalidate(): void { cache = null; snapshotCache = null; },
  };
}
