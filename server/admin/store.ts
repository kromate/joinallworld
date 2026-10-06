/**
 * OWNER: admin
 * What the admin section keeps, each in a collection of its own (never inside `social` or `moderation`), each bounded:
 *
 *   adminAudit      { seq, totals: { credit, debit, grant }, lines }       append-only; the last AUDIT_KEEP lines. `totals` are
 *                   whole-life sums of the money admins moved, so trimming the lines never loses them.
 *   adminSanctions  { players: { [publicId]: { ban?, pictures?, calls? } }, accounts: { [accountId]: ban } }   time-boxed or permanent; an ended one is dropped on the next write; at most SANCTIONS_KEEP players
 *   adminAnnounce   { seq, items }                                          the last ANNOUNCE_KEEP announcements, stored once each
 *   adminSettings   { values: { [key]: { value, at, by } } }                runtime settings, only those that differ from the environment
 *   adminNotes      { players: { [publicId]: { at, by, text }[] } }         private notes: NOTES_PER_PLAYER each, NOTES_PLAYERS players
 *   adminDaily      { first, days: { [lagosDay]: number[] } }               one row of a dozen whole numbers per Lagos day, the last DAILY_KEEP days (server/admin/history.ts)
 *
 * A collection is created by the first write to it; reading one writes nothing. On the Worker each is one row (or a few
 * rows when it passes the chunk size), rewritten only when it changed.
 */
import type { Db, RouteContext } from '../types.ts';

export const AUDIT_KEEP = 5000, SANCTIONS_KEEP = 2000, ANNOUNCE_KEEP = 200, NOTES_PER_PLAYER = 20, NOTES_PLAYERS = 2000, DAILY_KEEP = 400;

export type AuditAction = string;
export interface AuditLine {
  n: number
  at: number
  /** The admin's account id. */
  admin: string
  /** The admin's character name at the time. */
  adminName: string
  action: AuditAction
  /** A public id, a city id or ''. */
  target: string
  targetName: string
  /** What the request asked for, small. */
  params: Record<string, string | number | boolean | null>
  /** "before → after", in words. */
  summary: string
  reason: string
  /** Naira actually moved by a money action (negative for a debit), else absent. */
  amount?: number
}
export interface AuditCollection { seq: number; totals: { credit: number; debit: number; grant: number }; lines: AuditLine[] }

export type SanctionKind = 'ban' | 'pictures' | 'calls';
export interface SanctionRecord { at: number; /** Server ms it ends, or 0 for no end. */ until: number; reason: string; by: string }
export type SanctionSet = Partial<Record<SanctionKind, SanctionRecord>>;
export interface SanctionsCollection { players: Record<string, SanctionSet>; /** Bans by account id. */ accounts: Record<string, SanctionRecord> }

export type AnnounceAudience = 'everyone' | 'city' | 'online';
export type AnnounceAction = 'map' | 'missions' | 'business' | 'invite';
export interface AnnouncementRecord {
  id: string
  title: string
  body: string
  action: AnnounceAction | null
  audience: AnnounceAudience
  city: string | null
  /** Server ms. `at` is when it is to go out; `sentAt` when it did (0: not yet). */
  at: number
  sentAt: number
  expiresAt: number
  by: string
  createdAt: number
  cancelledAt: number
  /** Players with an open connection when it went out (the in-game banner), and every counted channel. */
  reach: { sockets: number }
  mail: { wanted: boolean; push: boolean; email: boolean; state: 'none' | 'queued' | 'sending' | 'done'; total: number; sent: number; failed: number; cursor: string }
}
export interface AnnounceCollection { seq: number; items: AnnouncementRecord[] }

export interface SettingsCollection { values: Record<string, { value: boolean | number; at: number; by: string }> }
export interface NotesCollection { players: Record<string, { at: number; by: string; text: string }[]> }

export interface DailyCollection { /** The Lagos day number of the first row ever written (the history starts there). */ first: number; days: Record<string, number[]> }
export interface AdminCollections { adminAudit: AuditCollection; adminSanctions: SanctionsCollection; adminAnnounce: AnnounceCollection; adminSettings: SettingsCollection; adminNotes: NotesCollection; adminDaily: DailyCollection }
const INITIAL: { [K in keyof AdminCollections]: () => AdminCollections[K] } = {
  adminAudit: () => ({ seq: 0, totals: { credit: 0, debit: 0, grant: 0 }, lines: [] }),
  adminSanctions: () => ({ players: {}, accounts: {} }),
  adminAnnounce: () => ({ seq: 0, items: [] }),
  adminSettings: () => ({ values: {} }),
  adminNotes: () => ({ players: {} }),
  adminDaily: () => ({ first: 0, days: {} }),
};
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** One of the six collections, made on first use and repaired if it was damaged. Call it inside a transaction only to write; to read use peek(). */
export function collectionOf<K extends keyof AdminCollections>(ctx: Pick<RouteContext, 'collection'>, db: Db, name: K): AdminCollections[K] {
  const found = ctx.collection(db, name, INITIAL[name]()) as unknown as AdminCollections[K];
  const fresh = INITIAL[name]() as unknown as Record<string, unknown>, target = found as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(fresh)) if (typeof target[key] !== typeof value || Array.isArray(target[key]) !== Array.isArray(value) ) target[key] = value;
  return found;
}
/** The collection if it exists, else an empty one that is not stored: for reads, which must write nothing. */
export function peek<K extends keyof AdminCollections>(db: Db, name: K): AdminCollections[K] {
  const found = Object.hasOwn(db, name) ? db[name] : undefined;
  return (isRecord(found) ? found : INITIAL[name]()) as unknown as AdminCollections[K];
}

/** Append one audit line (inside a transaction). Returns it. */
export function audit(ctx: Pick<RouteContext, 'collection' | 'now'>, db: Db, line: Omit<AuditLine, 'n' | 'at'>): AuditLine {
  const log = collectionOf(ctx, db, 'adminAudit');
  const made: AuditLine = { n: ++log.seq, at: ctx.now(), ...line };
  made.params = clipParams(made.params);
  made.summary = made.summary.slice(0, 240); made.reason = made.reason.slice(0, 200);
  log.lines.push(made);
  if (log.lines.length > AUDIT_KEEP) log.lines.splice(0, log.lines.length - AUDIT_KEEP);
  if (typeof made.amount === 'number') { if (line.action === 'grant') log.totals.grant += Math.abs(made.amount); else if (made.amount > 0) log.totals.credit += made.amount; else log.totals.debit += -made.amount; }
  return made;
}
/** Params stay small: scalars only, text cut, and no more than 400 characters of JSON in all. */
function clipParams(params: AuditLine['params']): AuditLine['params'] {
  const out: AuditLine['params'] = {};
  for (const [key, value] of Object.entries(params).slice(0, 12)) out[key.slice(0, 24)] = typeof value === 'string' ? value.slice(0, 120) : value;
  return JSON.stringify(out).length > 400 ? { note: 'params too long to keep' } : out;
}
