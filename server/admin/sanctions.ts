/**
 * OWNER: admin
 * BANS AND SUSPENSIONS, and how the rest of the server asks about them without reading storage.
 *
 *   ctx.checks.banned(publicId, accountId?)      null | { code: 'account_banned', until, reason }   the player may not use the game
 *   ctx.checks.suspended(publicId, kind)         null | { code: 'suspended', until, reason }        kind 'pictures' | 'calls'
 *
 * A BAN is held under the player's public id and, for a character that belongs to an account, under the account too, so a
 * banned account that plays another of its characters is still banned. It is enforced for EVERY route by buildRoutes
 * (routes/index.ts): the first time a request resolves a session that is banned it is answered 403 `account_banned` with a plain
 * sentence, except under /api/account/ (a banned person can still sign out). Open sockets are closed when the ban is made and
 * a socket that opens later is refused (ws/admin.ts). A guest is banned by session: clearing the cookie makes a new guest, which the per-address
 * new-session limits already slow down; a ban on a guest is therefore a deterrent, not a wall (docs/ADMIN.md says so).
 * MUTES are not here: they are the moderation module's (server/moderation/service.ts), used as they are.
 * Everything is held in memory (loaded before the host takes requests, replaced after each committed change), like mutes.
 */
import { collectionOf, peek, SANCTIONS_KEEP } from './store.ts';
import type { SanctionKind, SanctionRecord, SanctionSet } from './store.ts';
import type { Db, RouteContext } from '../types.ts';

export interface Verdict { code: 'account_banned' | 'suspended'; until: number; reason: string }
const untilText = (ms: number): string => (ms > 0 ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'further notice');
const services = new WeakMap<RouteContext, ReturnType<typeof build>>();
export function sanctionsOf(ctx: RouteContext) {
  let found = services.get(ctx);
  if (!found) services.set(ctx, found = build(ctx));
  return found;
}

/** What a banned player is told. */
export const banSentence = (verdict: Pick<Verdict, 'until' | 'reason'>): string => `This account is suspended from Allworld until ${untilText(verdict.until)}${verdict.reason ? ` (${verdict.reason})` : ''}. If you think this is a mistake, write to support.`;

function build(ctx: RouteContext) {
  let live = new Map<string, SanctionSet>(), accounts = new Map<string, SanctionRecord>();
  const active = (record: SanctionRecord | undefined): record is SanctionRecord => record !== undefined && (record.until === 0 || record.until > ctx.now());
  function sync(players: Record<string, SanctionSet>, byAccount: Record<string, SanctionRecord>): void {
    live = new Map(Object.entries(players)); accounts = new Map(Object.entries(byAccount));
  }
  const service = {
    sync,
    load: (): Promise<void> => ctx.store.read((db) => {
      const stored = peek(db, 'adminSanctions');
      return { players: stored.players, accounts: stored.accounts };
    }).then(({ players, accounts: byAccount }) => sync(players, byAccount)),
    banned(publicId: string, accountId?: string): (Verdict & { code: 'account_banned' }) | null {
      const record = live.get(publicId)?.ban, byAccount = accountId ? accounts.get(accountId) : undefined;
      const found = active(record) ? record : active(byAccount) ? byAccount : undefined;
      return found ? { code: 'account_banned', until: found.until, reason: found.reason } : null;
    },
    suspended(publicId: string, kind: SanctionKind): (Verdict & { code: 'suspended' }) | null {
      const record = live.get(publicId)?.[kind];
      return active(record) ? { code: 'suspended', until: record.until, reason: record.reason } : null;
    },
    /** Inside a transaction: set or lift one sanction. Returns what the in-memory copy must become after the commit. */
    set(db: Db, publicId: string, kind: SanctionKind, record: SanctionRecord | null, accountId?: string) {
      const store = collectionOf(ctx, db, 'adminSanctions');
      const players = store.players, byAccount = store.accounts;
      for (const [id, set] of Object.entries(players)) {
        for (const key of Object.keys(set) as SanctionKind[]) if (!active(set[key])) delete set[key];
        if (!Object.keys(set).length) delete players[id];
      }
      for (const [id, entry] of Object.entries(byAccount)) if (!active(entry)) delete byAccount[id];
      if (record && !players[publicId] && Object.keys(players).length >= SANCTIONS_KEEP) throw ctx.fail(409, 'sanction_list_full');
      const set = (players[publicId] ??= {});
      if (record) set[kind] = record; else delete set[kind];
      if (!Object.keys(set).length) delete players[publicId];
      if (kind === 'ban' && accountId) { if (record) byAccount[accountId] = record; else delete byAccount[accountId]; }
      return { players: { ...players }, accounts: { ...byAccount } };
    },
    list(db: Db) {
      const stored = peek(db, 'adminSanctions');
      return Object.entries(stored.players).flatMap(([id, set]) => (Object.entries(set) as [SanctionKind, SanctionRecord][]).filter(([, record]) => active(record)).map(([kind, record]) => ({ id, kind, ...record })));
    },
    sentence: banSentence,
  };
  if (ctx.checks) { ctx.checks.banned = (publicId, accountId) => service.banned(publicId, accountId); ctx.checks.suspended = (publicId, kind) => service.suspended(publicId, kind); }
  return service;
}
