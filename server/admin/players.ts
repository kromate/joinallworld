/**
 * OWNER: admin
 * Finding players and reading one. READS ONLY: nothing here writes, and nothing returns an address, a token, a cookie or an IP.
 *
 * COST. A search or a list walks every stored session once (on the Node host in memory; on the Worker one read of every session
 * row, no row written) and is limited to the admin read budget. A player's page reads that player's session, the account, the
 * social record and the five admin collections: a few rows. The id lookup is by key.
 */
import { characterCity } from '../character.ts';
import { emailHash } from '../social/founder.ts';
import { lagosTime } from '../../src/game/clock.ts';
import { accountOfSession, playerIsAdmin, shortRef } from './gate.ts';
import { maskEmail, sameText } from './config.ts';
import { peek } from './store.ts';
import { sanctionsOf } from './sanctions.ts';
import { moderationService } from '../moderation/service.ts';
import type { LedgerLine } from '../../src/types/life.ts';
import { scanKeys } from '../keyed.ts';
import type { Db, RouteContext, SessionRecord } from '../types.ts';

export const PAGE_SIZE = 40;
export type PlayerFilter = 'all' | 'online' | 'guests' | 'accounts' | 'new' | 'flagged';
export const FILTERS: readonly PlayerFilter[] = ['all', 'online', 'guests', 'accounts', 'new', 'flagged'];

export interface PlayerRow { id: string; name: string; kind: 'guest' | 'account'; city: string | null; online: boolean; cash: number; lastSeen: number; since: number; flags: string[]; admin: boolean }

/** Visit every stored session once. */
export function eachSession(db: Db, visit: (session: SessionRecord) => void): void {
  if (db.$store) db.$store.scanSessions((record) => { visit(record); return false; });
  else for (const record of Object.values(db.sessions)) visit(record);
}
const stateOf = (session: SessionRecord) => { const city = characterCity(session); return city ? session.cities[city]?.state : undefined; };
/** Server ms a session was last in use: its expiry minus the lifetime a renewal gives it. */
const lastSeenOf = (ctx: RouteContext, session: SessionRecord): number => Math.max(0, session.expiresAt - ctx.config.sessionTtlMs);

export function playersService(ctx: RouteContext) {
  const sanctions = sanctionsOf(ctx), moderation = moderationService(ctx);
  const row = (db: Db, session: SessionRecord, flagged: Set<string>): PlayerRow => {
    const state = stateOf(session), flags: string[] = [];
    if (sanctions.banned(session.publicId, session.account)) flags.push('banned');
    if (moderation.muted(session.publicId)) flags.push('muted');
    if (sanctions.suspended(session.publicId, 'pictures')) flags.push('pictures');
    if (sanctions.suspended(session.publicId, 'calls')) flags.push('calls');
    if (flagged.has(session.publicId)) flags.push('reported');
    return { id: session.publicId, name: session.name, kind: session.account === undefined ? 'guest' : 'account', city: characterCity(session), online: ctx.online(session.publicId), cash: state?.cash ?? 0,
      lastSeen: lastSeenOf(ctx, session), since: Number.isFinite(state?.civic?.since) ? state?.civic?.since ?? 0 : 0, flags, admin: playerIsAdmin(ctx, db, session) };
  };
  /** Public ids with an open report against them. */
  const reported = (db: Db): Set<string> => new Set((db.social?.reports ?? []).filter((report) => report.status === 'received').map((report) => report.about));

  return {
    /**
     * q: a display name (any part, any case), a public id (whole, or its first 8 characters or more), or the 64-hex SHA-256 of an
     * address (admin only: an exact match of the stored, verified address). Pages are PAGE_SIZE rows, newest activity first.
     */
    list(db: Db, { q = '', filter = 'all', city = '', page = 0 }: { q?: string; filter?: PlayerFilter; city?: string; page?: number }) {
      const text = q.trim().toLowerCase().slice(0, 64), flagged = reported(db), now = ctx.now();
      let byHash: string | null = null;
      if (/^[0-9a-f]{64}$/.test(text)) {
        for (const account of Object.values(db.accounts ?? {})) if (account && sameText(emailHash(account.email), text)) { byHash = account.publicId; break; }
        if (byHash === null) return { rows: [] as PlayerRow[], total: 0, page: 0, pageSize: PAGE_SIZE, scanned: 0 };
      }
      const hits: PlayerRow[] = [];
      let scanned = 0;
      eachSession(db, (session) => {
        scanned += 1;
        if (!(session.expiresAt > now)) return;
        if (byHash !== null) { if (session.publicId !== byHash) return; }
        else if (text) {
          const idMatch = text.length >= 8 && /^[0-9a-f-]+$/.test(text) && session.publicId.startsWith(text);
          if (!idMatch && !session.name.toLowerCase().includes(text)) return;
        }
        if (city && characterCity(session) !== city) return;
        const made = row(db, session, flagged);
        if (filter === 'online' && !made.online) return;
        if (filter === 'guests' && made.kind !== 'guest') return;
        if (filter === 'accounts' && made.kind !== 'account') return;
        if (filter === 'new' && !(made.since > 0 && lagosTime(made.since).day >= lagosTime(now).day - 1)) return;
        if (filter === 'flagged' && !made.flags.length) return;
        hits.push(made);
      });
      hits.sort((a, b) => Number(b.online) - Number(a.online) || b.lastSeen - a.lastSeen);
      const last = Math.max(0, Math.ceil(hits.length / PAGE_SIZE) - 1), at = Math.min(Math.max(0, Math.floor(page)), last);
      return { rows: hits.slice(at * PAGE_SIZE, (at + 1) * PAGE_SIZE), total: hits.length, page: at, pageSize: PAGE_SIZE, scanned };
    },

    /** One player's page. `undefined` when no live session has this id (an archived life is not played and cannot be acted on). */
    detail(db: Db, id: string, adminRef: (accountId: string) => string = shortRef) {
      const session = ctx.core.sessionByPublicId?.(db, id);
      if (!session || !(session.expiresAt > ctx.now())) return undefined;
      const account = accountOfSession(db, session), state = stateOf(session), social = db.social?.players[id];
      const city = characterCity(session), flagged = reported(db);
      const ledger: LedgerLine[] = state ? state.ledger.slice(-50).reverse() : [];
      const sanc = peek(db, 'adminSanctions').players[id] ?? {};
      const mute = moderation.mutes(db).find((item) => item.id === id) ?? null;
      const audit = peek(db, 'adminAudit').lines.filter((line) => line.target === id).slice(-12).reverse().map((line) => ({ n: line.n, at: line.at, action: line.action, by: adminRef(line.admin), byName: line.adminName, summary: line.summary, reason: line.reason }));
      const reports = (db.social?.reports ?? []).filter((report) => report.about === id || report.by === id);
      const shops = Object.entries(db.business?.shops ?? {}).filter(([, shop]) => shop.by.id === id).map(([shopId, shop]) => ({ id: shopId, name: shop.name, city: shop.city, status: shop.status }));
      const invited = db.social?.players ? scanKeys(db.social.players, 'socialPlayer', { jIncludes: `"i":${JSON.stringify(id)}` }).length : 0;
      return {
        profile: row(db, session, flagged),
        account: account ? { ref: shortRef(account.id), email: maskEmail(account.email), provider: account.provider, createdAt: account.createdAt, lastSeenAt: account.lastSeenAt, devices: account.devices.length, parked: account.parked.length } : null,
        life: state ? {
          city, location: state.location, spot: state.spot ?? null, cash: state.cash, needs: state.needs, job: state.job, homeCity: state.estate?.home ?? null, awayHomes: Object.keys(state.estate?.away ?? {}),
          activeAction: state.activeAction?.kind ?? null, stateAt: state.t, cities: Object.keys(session.cities), shops: state.business?.opened ?? 0, earned: state.social?.earned ?? 0, message: state.message.slice(0, 200),
        } : null,
        ledger,
        shops,
        social: { friends: Object.keys(social?.friends ?? {}).length, invitedBy: social?.invite?.by ? { id: social.invite.by, name: db.social?.players[social.invite.by]?.name ?? 'Former player' } : null, invited, updates: social?.updates.length ?? 0 },
        sanctions: { ban: sanc.ban ?? null, pictures: sanc.pictures ?? null, calls: sanc.calls ?? null, mute },
        reports: reports.slice(-20).reverse().map((report) => ({ id: report.id, about: report.about === id, reason: report.reason, status: report.status, at: report.at, other: report.about === id ? (db.social?.players[report.by]?.name ?? 'Former player') : report.aboutName })),
        audit,
        notes: (peek(db, 'adminNotes').players[id] ?? []).slice().reverse().map((note) => ({ at: note.at, by: adminRef(note.by), text: note.text })),
        protected: playerIsAdmin(ctx, db, session),
      };
    },
  };
}
