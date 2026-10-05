/**
 * OWNER: growth
 * The one stored collection of the growth features, `ctx.collection(db, 'growth')`, and every cap
 * on what it can hold. Portable: no Node built-ins (see "RULES" in server/routes/index.ts).
 *
 * STORED   (public ids only — never a cookie secret, an address or a device token)
 *   salt      a random value made once; device tokens and addresses are only ever kept or compared
 *             as a hash salted with it (hash53), so the collection holds nothing that identifies a
 *             device or a network on its own
 *   players   { [publicId]: {
 *                 seen        server ms of the last hello (for "while you were away")
 *                 devices     [hash] — up to LIMITS.devices salted hashes of this browser's device token
 *                 ref         null | { by, code, at, welcomed, counted }   who invited this player
 *                 invited     { [publicId]: { name, at, state: 'joined' | 'counted', device } }   (LIMITS.invited)
 *                 counted     how many invited friends have counted (titles)
 *                 owed        [publicId] — counted friends whose reward this inviter has not been paid yet (LIMITS.owed)
 *                 shares      { day, n } — share links made on that Lagos day
 *                 consent     null | { age: 'adult' | 'minor', push, email, at }
 *                 table       null | { game, label, won, at }   the last finished table game (for a share)
 *                 wins        [{ id, game, label, won, human, counted }] — table results not yet applied to the life (LIMITS.results)
 *             } }
 *   shares    { [code]: { by, kind, at, facts, opened, joined } }          (LIMITS.shares, 30 days)
 *   metrics   see ./metrics.js
 *   tables    see ./tables.js (ratings and the day's pair counts; live matches are in memory only)
 * Players idle for LIMITS.idleDays are forgotten together with their referral links.
 */
import { hash53 } from '../protocol.ts';
import type { Db, GrowthCollection, GrowthPlayerRecord, OutboundResponse, RouteContext } from '../types.ts';

export const LIMITS = Object.freeze({
  devices: 3, invited: 100, owed: 40, results: 12,
  shares: 20000, sharesPerDay: 20, shareDays: 30,
  players: 50000, idleDays: 60, sweepMs: 3600000,
  httpPerMinute: 120, sharePagePerMinute: 60,
});

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The collection, with every part present. */
export function growthOf(ctx: RouteContext, db: Db): GrowthCollection {
  const g = ctx.collection(db, 'growth');
  if (typeof g.salt !== 'string' || g.salt.length < 16) g.salt = ctx.randomId();
  for (const key of ['players', 'shares', 'metrics', 'tables'] as const) if (!isRecord(g[key])) g[key] = {};
  if (!Number.isFinite(g.sweptAt)) g.sweptAt = 0;
  return g;
}

/** The caller's record, created on first use (or null when the collection is full). */
export function playerOf(g: GrowthCollection, id: string, { create = true }: { create?: boolean } = {}): GrowthPlayerRecord | null {
  const known = g.players[id];
  if (known !== undefined && Object.hasOwn(g.players, id)) return known;
  if (!create || Object.keys(g.players).length >= LIMITS.players) return null;
  return (g.players[id] = { seen: 0, devices: [], ref: null, invited: {}, counted: 0, owed: [], shares: { day: 0, n: 0 }, consent: null, table: null, wins: [] });
}

/** A salted, pseudonymous key for a device token or an address. */
export const keyed = (g: GrowthCollection, value: string): string => hash53(`${g.salt}|${value}`);

/** Drop expired share links and players nobody has heard from. At most once an hour. */
export function sweep(g: GrowthCollection, now: number): void {
  if (now - g.sweptAt < LIMITS.sweepMs) return;
  g.sweptAt = now;
  const oldShare = now - LIMITS.shareDays * 86400000, idle = now - LIMITS.idleDays * 86400000;
  for (const [code, share] of Object.entries(g.shares)) if (!(((share as GrowthCollection['shares'][string] | null | undefined)?.at ?? NaN) >= oldShare)) delete g.shares[code];
  for (const [id, player] of Object.entries(g.players)) {
    const seen = (player as GrowthCollection['players'][string] | null | undefined)?.seen ?? NaN;
    // A record that has not said hello yet (`seen: 0`, made by a consent or an invite first) is new, not idle: sweeping it lost the answers just given.
    if (seen >= idle || seen === 0) continue;
    delete g.players[id];
  }
  // Comeback mail's records follow the address: none left for a player whose address is gone. A record made for an account's
  // character (`acct`) is the owner's choice and stays: dropping it would turn the account's default back on.
  for (const id of Object.keys(g.comeback ?? {})) if (!Object.hasOwn(g.contacts ?? {}, id) && g.comeback?.[id]?.acct !== true) delete g.comeback?.[id];
}

/**
 * An answer to ctx.fetch (typed `unknown` there) as the part of a Response the senders read.
 * Throws only for null/undefined (reading `.status` of those always threw, so the callers' catch answers 'network');
 * any other value without a numeric status yields `status: undefined`, as before.
 */
export function outboundResponse(value: unknown): OutboundResponse {
  if (value === null || value === undefined) throw new TypeError('The outside request did not answer with a response');
  const status = typeof value === 'object' && 'status' in value && typeof value.status === 'number' ? value.status : undefined;
  if (typeof value !== 'object') return { status };
  const source = 'headers' in value ? value.headers : undefined;
  const get = source !== null && typeof source === 'object' && 'get' in source ? source.get : undefined;
  if (typeof get !== 'function') return { status };
  return { status, headers: { get: (name: string): string | null => { const found: unknown = Reflect.apply(get, source, [name]); return typeof found === 'string' ? found : null; } } };
}
