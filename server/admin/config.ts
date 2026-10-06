/**
 * OWNER: admin
 * The settings of the admin section and the limits that bound what an admin can do. Portable: no Node imports.
 *
 * WHO IS AN ADMIN. A signed-in ACCOUNT (never a guest) whose verified address hashes to the founder's hash (FOUNDER_EMAIL_SHA256,
 * server/host-context.ts founderEmailHash) or to one of the comma-separated hashes of ADMIN_EMAIL_SHA256S. Only hashes are
 * configured; no address is kept in the source. The founder is the root admin: only the founder may act on an admin.
 *
 * EVERY LIMIT HAS A NAME AND CAN BE REPLACED BY A SETTING OF THE SAME NAME (a whole number inside its bounds; anything else is
 * ignored and the default applies):
 *   ADMIN_MAX_AMOUNT           most naira one credit or debit may move                             default 500000
 *   ADMIN_MAX_PER_TARGET_DAY   most naira (credits plus debits) all admins together may move on one player per Lagos day   default 1000000
 *   ADMIN_MAX_PER_ADMIN_DAY    most naira (credits plus debits) one admin may move per Lagos day   default 5000000
 *   ADMIN_GRANT_EACH_MAX       most naira a world grant may give each player                       default 5000
 *   ADMIN_GRANT_TOTAL_DAY      most naira world grants may give out in all per Lagos day           default 1000000
 *   ADMIN_GRANT_CONFIRM_ABOVE  a world grant reaching more players than this needs the typed confirmation     default 20
 *   ADMIN_MAIL_CONFIRM_ABOVE   an announcement e-mail or push to more people than this needs the typed confirmation   default 50
 *   ADMIN_SCAN_MAX             most stored sessions one economy snapshot reads                       default 20000
 */
import type { RouteContext } from '../types.ts';

/** The settings the admin section reads through ctx.env (added to the host's allowlist: server/host-context.ts OUTREACH_ENV). */
export const ADMIN_ENV = Object.freeze(['ADMIN_EMAIL_SHA256S', 'ADMIN_MAX_AMOUNT', 'ADMIN_MAX_PER_TARGET_DAY', 'ADMIN_MAX_PER_ADMIN_DAY', 'ADMIN_GRANT_EACH_MAX', 'ADMIN_GRANT_TOTAL_DAY', 'ADMIN_GRANT_CONFIRM_ABOVE', 'ADMIN_MAIL_CONFIRM_ABOVE', 'ADMIN_SCAN_MAX']);

export interface AdminLimits { maxAmount: number; perTargetDay: number; perAdminDay: number; grantEach: number; grantTotalDay: number; grantConfirmAbove: number; mailConfirmAbove: number; scanMax: number }
/** [setting, field, default, least, most] */
const LIMIT_SETTINGS: readonly (readonly [string, keyof AdminLimits, number, number, number])[] = [
  ['ADMIN_MAX_AMOUNT', 'maxAmount', 500000, 1, 100000000],
  ['ADMIN_MAX_PER_TARGET_DAY', 'perTargetDay', 1000000, 1, 1000000000],
  ['ADMIN_MAX_PER_ADMIN_DAY', 'perAdminDay', 5000000, 1, 1000000000],
  ['ADMIN_GRANT_EACH_MAX', 'grantEach', 5000, 1, 10000000],
  ['ADMIN_GRANT_TOTAL_DAY', 'grantTotalDay', 1000000, 1, 1000000000],
  ['ADMIN_GRANT_CONFIRM_ABOVE', 'grantConfirmAbove', 20, 0, 1000000],
  ['ADMIN_MAIL_CONFIRM_ABOVE', 'mailConfirmAbove', 50, 0, 1000000],
  ['ADMIN_SCAN_MAX', 'scanMax', 20000, 100, 5000000],
];
export const LIMIT_DEFAULTS: Readonly<AdminLimits> = Object.freeze(Object.fromEntries(LIMIT_SETTINGS.map(([, field, fallback]) => [field, fallback])) as unknown as AdminLimits);

/** The limits in force: the defaults, each replaced by its setting when that is a whole number inside its bounds. */
export function limitsOf(ctx: Pick<RouteContext, 'env'>): AdminLimits {
  const limits: AdminLimits = { ...LIMIT_DEFAULTS };
  for (const [name, field, , least, most] of LIMIT_SETTINGS) {
    const raw = ctx.env(name).trim();
    if (!/^\d{1,10}$/.test(raw)) continue;
    const value = Number(raw);
    if (Number.isSafeInteger(value) && value >= least && value <= most) limits[field] = value;
  }
  return limits;
}

/** Further admins: the well-formed hashes of ADMIN_EMAIL_SHA256S (64 hex characters each, lower-cased, at most 20). */
export function adminHashes(ctx: Pick<RouteContext, 'env'>): string[] {
  const listed = ctx.env('ADMIN_EMAIL_SHA256S').split(',').map((part) => part.trim().toLowerCase()).filter((part) => /^[0-9a-f]{64}$/.test(part));
  return [...new Set(listed)].slice(0, 20);
}
/** The founder's hash ('' = none), which is the root admin. */
export const founderHash = (ctx: Pick<RouteContext, 'config'>): string => ctx.config.founderEmailSha256 ?? '';

/** Compare two texts without stopping at the first difference. */
export function sameText(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
/** Is `hash` one of `list`? Every entry is compared, whatever the answer, so the time says nothing about which matched. */
export function inList(hash: string, list: readonly string[]): boolean {
  let found = false;
  for (const item of list) if (sameText(hash, item) && hash !== '') found = true;
  return found;
}
/** An address with its middle hidden: `a***@e***.com`. Never more than that is shown. */
export function maskEmail(email: unknown): string {
  const text = typeof email === 'string' ? email : '';
  const at = text.lastIndexOf('@');
  if (at < 1) return '';
  const domain = text.slice(at + 1), dot = domain.lastIndexOf('.');
  return `${text.slice(0, 1)}***@${domain.slice(0, 1)}***${dot > 0 ? domain.slice(dot) : ''}`;
}
