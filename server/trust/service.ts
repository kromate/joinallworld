/**
 * OWNER: trust. Who a player is to strangers: their checked tier, upheld complaints, and what they may post or link to.
 * Portable (no Node imports). The rules are pure (src/game/trust/); this file keeps the record and answers for
 * server/routes/trust.ts, the admin section (server/routes/admin.ts) and venue chat (server/ws/rooms.ts).
 *
 * db.trust = {
 *   v: 1,
 *   players:  { [publicId]: { tier: 'phone' | 'id' | 'business', by: 'admin' | 'provider', ref?, at, admin? } }   checked tiers only
 *   reviewed: { [publicId]: ms }       when a moderator last reviewed a held player (releases the hold)
 *   reports:  [{ id, about, aboutName, by, reason, note, at, status: 'received' | 'upheld' | 'dismissed', decided? }]
 *   seq: number
 * }
 * Only public ids, public names and a provider's reference are stored: never a phone number, ID number, birthday or address.
 * A missing or damaged collection reads as empty; nothing is created by reading.
 *
 * FOR LATER FEATURES (stalls, passports, gigs, classes, meetups): inside your transaction call
 *   trust.postBlock(db, session, kind)   → null | { code, reason }   refuse the post with that reason
 *   trust.badge(db, publicId)            → TrustBadge | null          show it next to the listing; hide listings while `held`
 */
import { COMPLAINT_HOLD_AT, COMPLAINT_WINDOW_MS, TIER_LABELS, TRUST_REPORT_REASONS, isVerifiedTier, outboundLink, postBlock as gate } from '../../src/game/trust/index.ts';
import type { PostKind, PosterFacts, TrustBadge, TrustRefusal, TrustReportReason, TrustTier, VerifiedTier } from '../../src/game/trust/index.ts';
import { accountOfSession } from '../admin/gate.ts';
import { screenText } from '../moderation/text.ts';
import type { TextVerdict } from '../moderation/text.ts';
import type { Db, RouteContext, SessionRecord } from '../types.ts';

export interface TrustPlayer { tier: VerifiedTier; by: 'admin' | 'provider'; ref?: string; at: number; admin?: string; account?: string; adultVerified?: true }
export type TrustReportStatus = 'received' | 'upheld' | 'dismissed';
export interface TrustReport { id: string; about: string; aboutName: string; by: string; reason: TrustReportReason; note: string; at: number; status: TrustReportStatus; decided?: number }
export interface TrustCollection { v: 1; players: Record<string, TrustPlayer>; reviewed: Record<string, number>; reports: TrustReport[]; seq: number }

/** Reports kept; the oldest go first. */
export const TRUST_REPORTS_KEPT = 2000;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const soundPlayer = (value: unknown): value is TrustPlayer => record(value) && isVerifiedTier(value.tier) && whole(value.at);
const soundReport = (value: unknown): value is TrustReport => record(value) && typeof value.id === 'string' && typeof value.about === 'string' && typeof value.by === 'string'
  && whole(value.at) && (TRUST_REPORT_REASONS as readonly unknown[]).includes(value.reason) && ['received', 'upheld', 'dismissed'].includes(String(value.status));

export const emptyTrust = (): TrustCollection => ({ v: 1, players: {}, reviewed: {}, reports: [], seq: 0 });
/** The collection for a write, created or repaired in place (an old save without it, or a damaged one, cannot crash a route). */
export function trustOf(ctx: Pick<RouteContext, 'collection'>, db: Db): TrustCollection {
  const found = ctx.collection(db, 'trust', emptyTrust()) as Partial<TrustCollection>;
  if (!record(found.players)) found.players = {};
  if (!record(found.reviewed)) found.reviewed = {};
  found.reports = Array.isArray(found.reports) ? found.reports.filter(soundReport) : [];
  if (!whole(found.seq)) found.seq = found.reports.length;
  found.v = 1;
  return found as TrustCollection;
}
/** The collection as a read sees it: nothing is created or repaired. */
export function peekTrust(db: Db): TrustCollection {
  const found = db.trust;
  if (!record(found)) return emptyTrust();
  return { v: 1, players: record(found.players) ? found.players as Record<string, TrustPlayer> : {}, reviewed: record(found.reviewed) ? found.reviewed as Record<string, number> : {},
    reports: Array.isArray(found.reports) ? found.reports.filter(soundReport) : [], seq: whole(found.seq) ? found.seq : 0 };
}

export interface ReportView { id: string; about: string; aboutName: string; reason: TrustReportReason; note: string; at: number; status: TrustReportStatus; decided?: number; upheld: number; held: boolean }

export function trustService(ctx: RouteContext) {
  const now = (): number => ctx.now();
  const sessionOf = (db: Db, publicId: string): SessionRecord | undefined => {
    const found = ctx.core.sessionByPublicId?.(db, publicId);
    return found && found.expiresAt > now() ? found : undefined;
  };

  /** Guest without an account; `claimed` with one; the checked tier on top of an account. */
  function tierOf(db: Db, session: SessionRecord): TrustTier {
    const account = accountOfSession(db, session);
    if (!account) return 'guest';
    const stored = peekTrust(db).players[session.publicId];
    return soundPlayer(stored) && (!stored.account || stored.account === account.id) ? stored.tier : 'claimed';
  }
  /** Upheld complaints in the window, and whether that holds the player's listings (until a moderator reviews them). */
  function complaints(db: Db, publicId: string): { count: number; held: boolean } {
    const t = peekTrust(db), since = now() - COMPLAINT_WINDOW_MS;
    const upheld = t.reports.filter((report) => report.about === publicId && report.status === 'upheld' && (report.decided ?? report.at) >= since);
    const latest = Math.max(0, ...upheld.map((report) => report.decided ?? report.at));
    const reviewed = whole(t.reviewed[publicId]) ? t.reviewed[publicId] : 0;
    return { count: upheld.length, held: upheld.length >= COMPLAINT_HOLD_AT && reviewed < latest };
  }
  /** true / false from the age question (server/routes/growth.ts), null when it was not answered. */
  function adult(db: Db, publicId: string): boolean | null {
    if (ctx.checks?.minor?.(db, publicId)) return false;
    return ctx.checks?.adult?.(db, publicId) ? true : null;
  }
  function verifiedAdult(db: Db, publicId: string): boolean {
    const session = sessionOf(db, publicId), account = session && accountOfSession(db, session), stored = peekTrust(db).players[publicId];
    return Boolean(account && soundPlayer(stored) && stored.account === account.id && stored.adultVerified === true);
  }
  function facts(db: Db, session: SessionRecord): PosterFacts {
    const account = accountOfSession(db, session);
    return { tier: tierOf(db, session), adult: adult(db, session.publicId), held: complaints(db, session.publicId).held, now: now(), ...(account ? { accountAt: account.createdAt } : {}) };
  }
  function badge(db: Db, publicId: string): TrustBadge | null {
    const session = sessionOf(db, publicId);
    if (!session) return null;
    const tier = tierOf(db, session), { count, held } = complaints(db, publicId);
    return { id: session.publicId, name: session.name, tier, label: TIER_LABELS[tier], complaints: count, held };
  }
  const postBlock = (db: Db, session: SessionRecord, kind: PostKind): TrustRefusal | null => gate(kind, facts(db, session));

  /**
   * May this venue chat line, which the text filter refused only for its links, go out? Yes when the sender may run a stall
   * (checked phone or better, not held, not too new), has an open stall in this very venue, every link in it is on the
   * allow-list, and what is left without the links passes the filter (so a phone number or handle beside a link is still refused).
   */
  /** For a line the text filter refused only for its links: null when the sender is not a checked stall owner in this
   * venue (the refusal stands), otherwise the verdict on the line with its allowed links taken out (null: it may go out). */
  function vendorLink(db: Db, publicId: string, room: string, body: string): { verdict: TextVerdict | null } | null {
    const session = sessionOf(db, publicId);
    if (!session || postBlock(db, session, 'stall')) return null;
    const shop = record(db.business) && record(db.business.shops) ? db.business.shops[publicId] : undefined;
    if (!record(shop) || shop.status !== 'open' || `${String(shop.city)}:${String(shop.venue)}` !== room) return null;
    const words = body.split(/\s+/);
    if (!words.some((word) => outboundLink(word))) return null;
    return { verdict: screenText(words.filter((word) => !outboundLink(word)).join(' '), { contact: true, what: 'Your message' }) };
  }

  return {
    tierOf, complaints, adult, verifiedAdult, facts, badge, postBlock, vendorLink,
    /** File a complaint. Throws on a malformed request; answers { ok: false, code, reason } for a refusal. */
    report(db: Db, session: SessionRecord, body: Record<string, unknown>) {
      const about = typeof body.about === 'string' ? body.about.toLowerCase() : '';
      const reason = TRUST_REPORT_REASONS.find((item) => item === body.reason);
      if (!reason) throw ctx.fail(400, 'invalid_reason');
      const note = typeof body.note === 'string' ? body.note.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
      if (about === session.publicId) return { ok: false as const, code: 'self', reason: 'You cannot report yourself.' };
      const target = sessionOf(db, about);
      if (!target) throw ctx.fail(404, 'unknown_player');
      const t = trustOf(ctx, db);
      const open = t.reports.find((item) => item.by === session.publicId && item.about === about && item.status === 'received');
      if (open) return { ok: true as const, code: 'reported', id: open.id, duplicate: true };
      if (!ctx.allow(`trust:report:${session.publicId}`, 5, 3600000)) return { ok: false as const, code: 'rate_limited', reason: 'You have sent several reports this hour. Try again later.' };
      const made: TrustReport = { id: `T-${++t.seq}`, about, aboutName: target.name, by: session.publicId, reason, note, at: now(), status: 'received' };
      t.reports.push(made);
      if (t.reports.length > TRUST_REPORTS_KEPT) t.reports.splice(0, t.reports.length - TRUST_REPORTS_KEPT);
      return { ok: true as const, code: 'reported', id: made.id };
    },

    // ---- admin ---------------------------------------------------------------------------------------------------
    modReports(db: Db, status: 'open' | 'all' | TrustReportStatus = 'open', limit = 100): ReportView[] {
      const want = status === 'open' ? 'received' : status;
      return peekTrust(db).reports.filter((report) => want === 'all' || report.status === want).slice(-limit).reverse()
        .map(({ by: _by, ...report }) => ({ ...report, upheld: complaints(db, report.about).count, held: complaints(db, report.about).held }));
    },
    /** Uphold or dismiss a complaint. The third upheld one in 90 days holds the player's listings. */
    modDecide(db: Db, id: string, decision: 'uphold' | 'dismiss'): TrustReport | null {
      const report = trustOf(ctx, db).reports.find((item) => item.id === id);
      if (!report) return null;
      report.status = decision === 'uphold' ? 'upheld' : 'dismissed';
      report.decided = now();
      return report;
    },
    /** Set a checked tier by hand ('none' takes it away). The account is required: a guest cannot be checked. */
    modVerify(db: Db, publicId: string, tier: VerifiedTier | 'none', admin: string): { ok: true; tier: TrustTier } | { ok: false; code: string; reason: string } {
      const session = sessionOf(db, publicId);
      if (!session) throw ctx.fail(404, 'unknown_player');
      if (!accountOfSession(db, session)) return { ok: false, code: 'account_required', reason: 'This player has not claimed an account, so they cannot be checked.' };
      const t = trustOf(ctx, db);
      if (tier === 'none') delete t.players[publicId];
      else t.players[publicId] = { tier, by: 'admin', at: now(), admin };
      return { ok: true, tier: tierOf(db, session) };
    },
    /** A moderator reviewed a held player: the hold lifts until another complaint is upheld. */
    modRelease(db: Db, publicId: string): void { trustOf(ctx, db).reviewed[publicId] = now(); },
  };
}
export type TrustService = ReturnType<typeof trustService>;
