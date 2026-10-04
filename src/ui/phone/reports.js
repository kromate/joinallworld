/**
 * What the Phone knows about the player's problem reports without opening the app: how many have
 * an update (a new status or a moderator's note) that has not been read yet. This drives the red
 * badge on "Report a problem".
 *
 * The reports themselves are fetched by the Report a problem app (src/ui/panels/support.js),
 * which hands every list it loads to noteReports() and calls markReportsRead() when the player is
 * looking at them. Nothing here fetches and nothing runs on a timer: until the app has loaded the
 * list once on this device there is simply no badge.
 */
const KEY = 'joinallworld-reports-seen';
let seen = null;       // { [reportId]: updatedAt already read }
let latest = [];       // [{ id, at, updatedAt, note, status }]

function load() {
  if (seen) return seen;
  try { seen = JSON.parse(globalThis.localStorage?.getItem(KEY)) || {}; } catch { seen = {}; }
  if (typeof seen !== 'object' || Array.isArray(seen)) seen = {};
  return seen;
}
const answered = (report) => Boolean(report.note) || report.updatedAt > report.at;

const FILED_KEY = 'joinallworld-reports-filed';
let checking = false, checkedAt = 0;
/** This device has filed a report before, so there may be a reply to show. */
export function noteFiled() { try { globalThis.localStorage?.setItem(FILED_KEY, '1'); } catch { /* the badge then waits for the app to be opened */ } }
/**
 * Called when the player opens the phone (never from a timer): if this device has filed a report,
 * read the list once — at most once a minute — so a moderator's reply can show as a badge.
 */
export function checkReports(api) {
  let filed = false;
  try { filed = globalThis.localStorage?.getItem(FILED_KEY) === '1'; } catch { filed = false; }
  if (!filed || checking || Date.now() - checkedAt < 60000 || !api.view()?.connected) return;
  checking = true;
  api.fetchJson('/api/support/reports').then((reply) => { noteReports(reply.reports); if (reportReplies()) api.refresh(); }, () => {}).finally(() => { checking = false; checkedAt = Date.now(); });
}

/** Remember the newest list the app loaded. */
export function noteReports(reports) { latest = Array.isArray(reports) ? reports : []; }
/** Reports with a reply or a status change the player has not read on this device. */
export function reportReplies() {
  const known = load();
  return latest.filter((report) => answered(report) && (Number(known[report.id]) || 0) < report.updatedAt).length;
}
/** The player is reading the list: everything in it is now read. Returns true when that changed the count. */
export function markReportsRead() {
  const before = reportReplies();
  const known = load();
  for (const report of latest) known[report.id] = report.updatedAt;
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(known)); } catch { /* read for this visit only */ }
  return before > 0;
}
