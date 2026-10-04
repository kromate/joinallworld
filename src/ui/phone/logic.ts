/**
 * The Phone's pure decisions — no DOM, no storage, no clock of their own — so `node --test` can
 * reach them (src/ui/phone/phone.test.ts). The modules that draw (how.js, reports.js, the Governor
 * and Groceries apps) call these and keep nothing clever for themselves.
 */

/** The fields of a player's report that the Phone reads. Every one is optional: the server's list is trusted no further than that. */
export interface ReportLike { id?: string; at?: number | null; updatedAt?: number | null; note?: string; status?: string }

/** Open ids of the "How it works" disclosures after one toggle. Returns the SAME set when nothing changed. */
export function toggled(open: Set<string>, id: string, isOpen: unknown): Set<string> {
  if (open.has(id) === Boolean(isOpen)) return open;
  const next = new Set(open);
  if (isOpen) next.add(id); else next.delete(id);
  return next;
}

/** The lines of a rules list: text only, blanks dropped. */
export const rulesList = (lines: unknown): string[] => (Array.isArray(lines) ? lines : [lines]).map((line) => String(line ?? '').trim()).filter(Boolean);

/**
 * City news that is NEW TO THIS LIFE: posted after the life began in the city (`since`) and after
 * the last time the Governor app was on screen on this device (`readAt`). A brand-new life starts
 * with none, however much happened in the city before it arrived.
 * `since` unknown (no life yet) counts nothing: a badge must never be a guess.
 */
export function unseenNews(notices: unknown, { readAt = 0, since = null }: { readAt?: number; since?: number | null } = {}): number {
  if (!Array.isArray(notices) || typeof since !== 'number' || !Number.isFinite(since)) return 0;
  const read = Number(readAt) || 0;
  // The same line the server draws when it posts news to a life's Updates: nothing from before the life.
  return notices.filter((item: { at?: unknown } | null) => typeof item?.at === 'number' && Number.isFinite(item.at) && item.at >= since && item.at > read).length;
}

/** A report with something the player has not been told: a moderator's note or a status change. */
// Comparison as the original wrote it (`updatedAt > at`): null coerces to 0, an absent (undefined) time is NaN and never compares.
const asTime = (time: number | null | undefined): number => (time === null ? 0 : time ?? NaN);
export const reportAnswered = (report?: ReportLike | null): boolean => Boolean(report?.note) || asTime(report?.updatedAt) > asTime(report?.at);
/** Reports whose answer has not been read on this device. `seen` is { [reportId]: updatedAt already read }. */
export function unreadReports(reports: unknown, seen: Record<string, unknown> | null = {}): number {
  return (Array.isArray(reports) ? (reports as ReportLike[]) : []).filter((report) => reportAnswered(report) && (Number(seen?.[String(report.id)]) || 0) < (report.updatedAt ?? NaN)).length;
}
/** A report a moderator may still answer. */
export const reportOpen = (report?: ReportLike | null): boolean => report?.status !== 'resolved' && report?.status !== 'dismissed';

/**
 * Should opening the phone ask the server for the player's reports?
 *   - never while one request is out, while not connected, or within `gap` ms of the last one;
 *   - the FIRST time the phone opens on this page: yes, once — that is how a reply shows as a
 *     badge without the app ever being opened (also on a device the life was moved to);
 *   - afterwards only while an answer can still arrive: an open report in the last list, or a
 *     report filed from this device since.
 */
export function shouldCheckReports({ connected, checking, checkedAt = 0, triedAt = 0, now, known = null, filed = false, gap = 60000 }: {
  connected: boolean; checking: boolean; checkedAt?: number; triedAt?: number; now: number; known?: readonly ReportLike[] | null; filed?: boolean; gap?: number;
}): boolean {
  if (!connected || checking) return false;
  if (Math.max(checkedAt, triedAt) && now - Math.max(checkedAt, triedAt) < gap) return false;
  if (!checkedAt) return true; // no answer yet on this page (never asked, or the request failed)
  return filed || (Array.isArray(known) && known.some(reportOpen));
}

/**
 * The one-tap "Buy 1" of a grocery card: what it costs and why it cannot be pressed.
 * `quote` is the server's own price for one pack (view.home.groceries[id][1]).
 * Returns { price, blocked } — `blocked` is '' when the tap can be sent.
 */
export function quickBuy({ quote, cash, connected, busy = false, label = 'this' }: {
  quote?: { price?: unknown; list?: unknown } | null; cash: number; connected: boolean; busy?: boolean; label?: string;
}): { price: number; blocked: string } {
  const price = Math.max(0, Math.round(Number(quote?.price) || 0));
  let blocked = '';
  if (!connected) blocked = 'Not connected — ordering needs the server';
  else if (busy) blocked = 'Ordering…';
  else if (!quote || !Number.isFinite(Number(quote.price))) blocked = `No price for ${label} yet`;
  else if (price > cash) blocked = `Need ₦${Math.round(price - cash).toLocaleString("en-NG")} more`;
  return { price, blocked };
}
