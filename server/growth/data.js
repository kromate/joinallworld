/**
 * OWNER: growth
 * The one stored collection of the growth features, `ctx.collection(db, 'growth')`, and every cap
 * on what it can hold. Portable: no Node built-ins (see "RULES" in server/routes/index.js).
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
import { hash53 } from '../protocol.js';

export const LIMITS = Object.freeze({
  devices: 3, invited: 100, owed: 40, results: 12,
  shares: 20000, sharesPerDay: 20, shareDays: 30,
  players: 50000, idleDays: 60, sweepMs: 3600000,
  httpPerMinute: 120, sharePagePerMinute: 60,
});

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The collection, with every part present. */
export function growthOf(ctx, db) {
  const g = ctx.collection(db, 'growth');
  if (typeof g.salt !== 'string' || g.salt.length < 16) g.salt = ctx.randomId();
  for (const key of ['players', 'shares', 'metrics', 'tables']) if (!isRecord(g[key])) g[key] = {};
  if (!Number.isFinite(g.sweptAt)) g.sweptAt = 0;
  return g;
}

/** The caller's record, created on first use (or null when the collection is full). */
export function playerOf(g, id, { create = true } = {}) {
  if (Object.hasOwn(g.players, id)) return g.players[id];
  if (!create || Object.keys(g.players).length >= LIMITS.players) return null;
  return (g.players[id] = { seen: 0, devices: [], ref: null, invited: {}, counted: 0, owed: [], shares: { day: 0, n: 0 }, consent: null, table: null, wins: [] });
}

/** A salted, pseudonymous key for a device token or an address. */
export const keyed = (g, value) => hash53(`${g.salt}|${value}`);

/** Drop expired share links and players nobody has heard from. At most once an hour. */
export function sweep(g, now) {
  if (now - g.sweptAt < LIMITS.sweepMs) return;
  g.sweptAt = now;
  const oldShare = now - LIMITS.shareDays * 86400000, idle = now - LIMITS.idleDays * 86400000;
  for (const [code, share] of Object.entries(g.shares)) if (!(share?.at >= oldShare)) delete g.shares[code];
  for (const [id, player] of Object.entries(g.players)) {
    if (player?.seen >= idle) continue;
    delete g.players[id];
  }
}
