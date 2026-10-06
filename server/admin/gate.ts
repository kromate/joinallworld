/**
 * OWNER: admin
 * WHO MAY USE THE ADMIN SECTION, decided on EVERY request from the server's own records and nothing the client sends:
 *
 *   session cookie -> the stored session -> the ACCOUNT it belongs to (a guest has none: never an admin, on any device)
 *   -> the account's verified address -> its SHA-256 -> compared, in constant time, with the founder's hash and with
 *   ADMIN_EMAIL_SHA256S (server/admin/config.ts).
 *
 * Nothing is remembered between requests: an account whose address changed, a session signed out or a binding that was
 * removed is not an admin on its very next request. A request that is not an admin's is answered 404 `not_found`, exactly
 * as a route that does not exist, so the section cannot be told apart from its absence; refused attempts are counted per
 * address under a protected limiter key (`admin-fail:`) and, past the limit, answered 429.
 *
 * The founder (the account the built-in or configured founder hash names) is the ROOT admin. Another admin, and the
 * founder, can be acted on only by the founder.
 */
import { emailHash } from '../social/founder.ts';
import { addressBucket } from '../host-context.ts';
import { UUID_PATTERN } from '../protocol.ts';
import { adminHashes, founderHash, inList } from './config.ts';
import type { AccountRecord, Db, RouteContext, RouteRequest, SessionRecord } from '../types.ts';

export interface Admin { accountId: string; publicId: string; name: string; root: boolean; session: SessionRecord }
/** Requests per window, per class of key. Failures are counted per address and in total, like the operator guard. */
export const RATE = Object.freeze({ readPerMinute: 120, writePerMinute: 30, addressPerMinute: 180, failedPerAddress: 10, failedTotal: 100, failedWindowMs: 600000 });

const own = <T>(map: Record<string, T> | undefined, key: string | undefined): T | undefined => {
  const value = map && typeof key === 'string' && key !== '__proto__' ? map[key] : undefined;
  return value !== null && typeof value === 'object' ? value : undefined;
};
/** The account behind a stored session, when the two agree about each other. */
export function accountOfSession(db: Db, session: SessionRecord | undefined): AccountRecord | undefined {
  if (!session || session.account === undefined) return undefined;
  const account = own(db.accounts, session.account);
  return account && account.id === session.account && account.publicId === session.publicId ? account : undefined;
}
/** Is this account an admin by its address as stored now? `root` when it is the founder's. */
export function standing(ctx: RouteContext, account: AccountRecord | undefined): 'root' | 'admin' | null {
  const hash = emailHash(account?.email);
  if (!hash) return null;
  const founder = founderHash(ctx);
  const root = founder !== '' && inList(hash, [founder]), admin = inList(hash, adminHashes(ctx));
  return root ? 'root' : admin ? 'admin' : null;
}
/** The admin behind this request, or null. Reads only. */
export function adminOf(ctx: RouteContext, db: Db, request: RouteRequest): Admin | null {
  const session = request.session(db);
  const account = accountOfSession(db, session);
  const level = standing(ctx, account);
  if (!session || !account || !level || request.binding === undefined) return null;
  return { accountId: account.id, publicId: session.publicId, name: session.name, root: level === 'root', session };
}
/** Is the player with this public id an admin (or the founder)? A guest never is. */
export function playerIsAdmin(ctx: RouteContext, db: Db, session: SessionRecord | undefined): boolean {
  return standing(ctx, accountOfSession(db, session)) !== null;
}
/** Only the founder may act on an admin. Throws 403 `protected_target`. */
export function mayAct(ctx: RouteContext, db: Db, admin: Admin, target: SessionRecord): void {
  if (!admin.root && playerIsAdmin(ctx, db, target)) throw Object.assign(ctx.fail(403, 'protected_target'), { reason: 'Only the founder can act on an admin.' });
}

/** The same refusal for every way of not being an admin. */
export const notFound = (ctx: Pick<RouteContext, 'fail'>) => ctx.fail(404, 'not_found');

/** A short stable reference for an id, for display (never the id itself). */
export function shortRef(id: string): string {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) >>> 0;
  return h.toString(36).padStart(6, '0').slice(-6);
}
export const isPublicId = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);

/**
 * The limiter's work for one request, BEFORE anything is read: the address's budget. Admin requests are then counted per account
 * (reads and writes apart) once the account is known. Keys start with `admin` and are protected (server/limiter.ts): never dropped to make room.
 */
export function addressBudget(ctx: RouteContext, request: RouteRequest): void {
  if (!ctx.allow(`admin-ip:${addressBucket(request.ip)}`, RATE.addressPerMinute)) throw ctx.fail(429, 'rate_limited');
}
export function countFailure(ctx: RouteContext, request: RouteRequest): void {
  if (!ctx.allow(`admin-fail:${addressBucket(request.ip)}`, RATE.failedPerAddress, RATE.failedWindowMs) || !ctx.allow('admin-fail:all', RATE.failedTotal, RATE.failedWindowMs)) throw ctx.fail(429, 'rate_limited');
}
export function accountBudget(ctx: RouteContext, admin: Admin, write: boolean): void {
  const ok = write ? ctx.allow(`admin-w:${admin.accountId}`, RATE.writePerMinute) : ctx.allow(`admin-r:${admin.accountId}`, RATE.readPerMinute);
  if (!ok) throw Object.assign(ctx.fail(429, 'rate_limited'), { reason: 'Too many admin requests. Wait a minute.' });
}
