/**
 * What the Phone knows about the player's problem reports without opening the app: how many have
 * an update (a new status or a moderator's note) that has not been read yet. This drives the red
 * badge on "Report a problem".
 *
 * The badge works WITHOUT the app having been opened: the first time the phone is opened on a page
 * checkReports() reads the list once (GET /api/support/reports — the player's own reports, a small
 * response), so a moderator's reply shows as a badge on the home screen. After that it asks again
 * only when the phone is opened while an answer can still arrive (an open report, or one filed from
 * this device), and at most once a minute. Never on a timer, never from a render: mount() in
 * phone.js is the only caller. The decision itself is shouldCheckReports() in ./logic.js.
 *
 * The Report a problem app (src/ui/panels/support.js) hands every list it loads to noteReports()
 * and calls markReportsRead() when the player is looking at them.
 */
import { shouldCheckReports, unreadReports, type ReportLike } from './logic.ts';

/** What checkReports needs of the panel api. */
export interface ReportsApi {
  view(): { connected?: boolean } | null | undefined;
  fetchJson(path: string): Promise<{ reports?: unknown } | null | undefined>;
  refresh(): void;
}

const KEY = 'joinallworld-reports-seen';
let seen: Record<string, number | undefined> | null = null;       // { [reportId]: updatedAt already read }
let latest: ReportLike[] = [];       // [{ id, at, updatedAt, note, status }]

function load(): Record<string, number | undefined> {
  if (seen) return seen;
  let parsed: unknown;
  // String() keeps the original: a missing key parses as null, and an absent storage throws into the catch.
  try { parsed = JSON.parse(String(globalThis.localStorage?.getItem(KEY))) || {}; } catch { parsed = {}; }
  seen = typeof parsed !== 'object' || Array.isArray(parsed) ? {} : (parsed as Record<string, number | undefined>);
  return seen;
}

const FILED_KEY = 'joinallworld-reports-filed';
let checking = false, checkedAt = 0, triedAt = 0, loaded = false;
/** This device has filed a report before, so there may be a reply to show. */
export function noteFiled(): void { try { globalThis.localStorage?.setItem(FILED_KEY, '1'); } catch { /* the badge then waits for the app to be opened */ } }
/**
 * Called when the player opens the phone (never from a timer, never from a render): read the list
 * if shouldCheckReports() says so, so a moderator's reply can show as a badge without the app open.
 * Returns true when a request was started.
 */
export function checkReports(api: ReportsApi, now = Date.now()): boolean {
  let filed = false;
  try { filed = globalThis.localStorage?.getItem(FILED_KEY) === '1'; } catch { filed = false; }
  if (!shouldCheckReports({ connected: Boolean(api.view()?.connected), checking, checkedAt, triedAt, now, known: loaded ? latest : null, filed: filed && !loaded })) return false;
  checking = true; triedAt = now;
  api.fetchJson('/api/support/reports').then((reply) => {
    checkedAt = Date.now();
    noteReports(reply?.reports);
    if (reportReplies()) api.refresh();
  }, () => { /* no badge this time; the next opening of the phone asks again */ }).finally(() => { checking = false; });
  return true;
}

/** Remember the newest list the app loaded. */
export function noteReports(reports: unknown): void { latest = Array.isArray(reports) ? reports : []; loaded = true; }
/** Reports with a reply or a status change the player has not read on this device. */
export function reportReplies(): number {
  return unreadReports(latest, load());
}
/** The player is reading the list: everything in it is now read. Returns true when that changed the count. */
export function markReportsRead(): boolean {
  const before = reportReplies();
  const known = load();
  for (const report of latest) known[String(report.id)] = report.updatedAt ?? 0;
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(known)); } catch { /* read for this visit only */ }
  return before > 0;
}
