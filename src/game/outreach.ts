/**
 * OWNER: growth
 * When the game may reach a player outside the game, as pure functions: the frequency rules, the
 * check of an e-mail address, and the exact words of the consent. No I/O and no clock of its own;
 * the server (server/growth/outreach.ts) supplies the time and does the sending.
 *
 * THE RULES (carried over from the first Allworld's come-back engine)
 *   - nothing without consent, and nothing at all to a player who said they are under 18;
 *   - at most `perDay` message a day and `perWeek` a week, per channel;
 *   - never between `quietFrom` and `quietTo`, Lagos time;
 *   - after a message that brought no visit, wait 1 day, then 3, then 7 before the next;
 *   - after `maxPerAbsence` messages with no visit, stop until the player comes back by themselves;
 *   - one message per period per kind: one "away" message per Lagos day, one "week" per Lagos week.
 */
import { lagosTime } from './clock.ts';
import type { OutreachRules } from '../types/growth.ts';

export const OUTREACH: Readonly<OutreachRules> = Object.freeze({
  perDay: 1, perWeek: 3, quietFrom: 22, quietTo: 7, backoffDays: [1, 3, 7], maxPerAbsence: 4,
  /** Hours with nothing heard before an "away" message may be prepared. */
  awayAfterHours: 24,
  /** The weekly summary: Sunday between these Lagos hours, for a player who played that week. */
  weekly: { weekday: 0, from: 17, to: 21 },
  /** Confirmation e-mails one player may ask for in a day, and how long a confirmation link lasts. */
  confirmsPerDay: 3, confirmHours: 48,
});
const HOUR = 3600000, DAY = 86400000;

/** The consent a player ticks before an address is stored. Shown word for word; also in SECURITY.md. */
export const EMAIL_CONSENT = 'Send me Allworld e-mails at this address: one to confirm it now, then at most one message a day and three a week about my Sim, my friends and events, and a weekly summary. I can stop with one tap in any e-mail or here. I am 18 or older.';
export const PUSH_CONSENT = 'Send notifications to this phone: at most one a day and three a week, never at night, about my Sim, my friends and events. I can switch them off here at any time.';

export const inQuietHours = (now: number, rules: Pick<OutreachRules, 'quietFrom' | 'quietTo'> = OUTREACH): boolean => { const hour = lagosTime(now).hour; return hour >= rules.quietFrom || hour < rules.quietTo; };

/** `seen` is the server ms the player was last here; `sends` is when earlier messages on this channel went out. */
export interface PlanInput {
  now: number
  seen: number
  sends?: number[]
  periods?: { away?: number; week?: number }
  playedThisWeek?: boolean
}
export interface MessagePlan {
  kind: 'away' | 'week' | null
  reason: string
  period?: number
}
/** Decide whether one message may go to one recipient on one channel now. */
export function planMessage({ now, seen, sends = [], periods = {}, playedThisWeek = false }: PlanInput, rules: OutreachRules = OUTREACH): MessagePlan {
  const none = (reason: string): MessagePlan => ({ kind: null, reason });
  if (!Number.isFinite(seen) || seen <= 0) return none('never_seen');
  if (inQuietHours(now, rules)) return none('quiet_hours');
  const times = sends.filter((at) => Number.isFinite(at) && at <= now).sort((a, b) => a - b);
  if (times.filter((at) => now - at < DAY).length >= rules.perDay) return none('day_cap');
  if (times.filter((at) => now - at < 7 * DAY).length >= rules.perWeek) return none('week_cap');
  const unanswered = times.filter((at) => at > seen);
  if (unanswered.length >= rules.maxPerAbsence) return none('stopped');
  if (unanswered.length) {
    // Both lookups are in range (unanswered is not empty); the fallbacks only keep an empty backoff list from waiting.
    const wait = (rules.backoffDays[Math.min(unanswered.length, rules.backoffDays.length) - 1] ?? 0) * DAY;
    if (now - (unanswered.at(-1) ?? 0) < wait) return none('backoff');
  }
  const time = lagosTime(now);
  if (time.weekday === rules.weekly.weekday && time.hour >= rules.weekly.from && time.hour < rules.weekly.to && periods.week !== time.week && playedThisWeek) return { kind: 'week', reason: 'weekly', period: time.week };
  if (now - seen >= rules.awayAfterHours * HOUR && periods.away !== time.day) return { kind: 'away', reason: 'away', period: time.day };
  return none('nothing_due');
}

const DISPOSABLE = ['mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com'];
const TYPOS: Record<string, string> = { 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com', 'gnail.com': 'gmail.com', 'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com',
  'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'iclod.com': 'icloud.com', 'icloud.con': 'icloud.com' };
const LOCAL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/, DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

/**
 * Check an address before anything is sent to it: its shape, a short list of throwaway domains and
 * the common mistypings of the big providers. No lookup, no key, no outside request.
 */
export function checkEmail(value: unknown): { ok: true; email: string } | { ok: false; code: string; reason: string } {
  const text = typeof value === 'string' ? value.trim() : '';
  const at = text.lastIndexOf('@'), local = text.slice(0, at), domain = text.slice(at + 1).toLowerCase();
  const bad = (code: string, reason: string): { ok: false; code: string; reason: string } => ({ ok: false, code, reason });
  if (!text || text.length > 254 || at < 1 || /[\s<>(),;:"\\[\]\u0000-\u001f\u007f]/.test(text) || !LOCAL.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..') || !DOMAIN.test(domain)) return bad('invalid_email', 'That does not look like an e-mail address. Check it and try again.');
  if (Object.hasOwn(TYPOS, domain)) return bad('email_typo', `Did you mean ${local}@${TYPOS[domain]}? Check the address and try again.`);
  if (DISPOSABLE.includes(domain)) return bad('email_disposable', 'That is a throwaway address. Use one you actually read.');
  return { ok: true, email: `${local}@${domain}` };
}

/** "a•••@e•••.com" — what a player is shown of their own stored address. The full value never returns to a browser. */
export function maskEmail(email: unknown): string {
  const [local = '', domain = ''] = String(email ?? '').split('@'), dot = domain.lastIndexOf('.');
  return `${local.slice(0, 1)}•••@${domain.slice(0, 1)}•••${dot > 0 ? domain.slice(dot) : ''}`;
}

/** A WhatsApp Channel link the owner configured, or '' when it is not one. */
export const channelUrl = (value: unknown): string => (typeof value === 'string' && /^https:\/\/(www\.)?whatsapp\.com\/channel\/[A-Za-z0-9]{10,64}$/.test(value.trim()) ? value.trim() : '');
