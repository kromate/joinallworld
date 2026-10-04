/**
 * OWNER: moderation
 * The operator's surface under /api/mod/. There are no moderator accounts: whoever holds the
 * server's MODERATOR_TOKEN is the operator.
 *
 * ACCESS
 *   - Disabled unless the server was started with MODERATOR_TOKEN (at least 24 characters). While
 *     disabled every path here answers 404, exactly like a route that does not exist.
 *   - `Authorization: Bearer <token>` on every request — a header only; never a cookie, a query
 *     value or a body field. The host compares it in constant time and never logs it.
 *   - Not tied to the page's origin (a header a browser never sends by itself cannot be forged
 *     cross-site), so curl works. No CORS headers are sent, so a web page on another origin
 *     cannot read a response even with the token.
 *   - Rate limited. WITH the right token: 60 requests a minute per address, and nothing else — such
 *     a request skips the host's general per-address limit, so other clients behind the same
 *     address (a proxy without TRUST_PROXY) cannot use up the operator's budget, and it never
 *     touches the failed-attempt counters. WITHOUT the right token: the general per-address limit,
 *     then 10 per address and 100 in total per 10 minutes, after which such requests get 429 until
 *     the window passes. What protects the token is its length (24+ characters); the counters only
 *     keep guessing slow and quiet. Anyone holding the token is the operator: there is no second factor.
 *   - A device session gives no access here, and nothing here reads or returns a session secret.
 *
 * READ (GET)
 *   /api/mod/overview                       counts of open reports, problems, mutes; store counters
 *   /api/mod/reports?status=open|all|…      player reports (reason, text, up to five quoted messages)
 *   /api/mod/problems?status=open|all|…     problem reports with their automatic context
 *   /api/mod/mutes                          active mutes
 *   /api/mod/content?city=                  live ads, announcements and radio shout-outs, with the ids to remove them by
 *   /api/mod/audit                          the last 200 audit lines, newest first
 * ACT (POST, JSON body). Every action writes one audit line.
 *   /api/mod/reports/:id/dismiss   { note? }                          no action taken; the reporter is told
 *   /api/mod/problems/:id/status   { status: reviewing|resolved|dismissed, note? }   the player sees status and note
 *   /api/mod/mutes                 { id, minutes, reason, report? }   mute a public id (1 minute – 30 days); with
 *                                                                     `report` that report is marked actioned
 *   /api/mod/mutes/:id/lift        {}
 *   /api/mod/content/remove        { cityId, kind: 'billboard'|'sea'|'announcement'|'radio', slot? | id?, venue?, reason? }
 * A mute never touches the player's session, life, money or belongings (moderation/service.js).
 * Removing content does not refund what was paid for it; the owner is told in their Updates.
 */
import { UUID_PATTERN } from '../protocol.js';
import { moderationService, LIMITS } from '../moderation/service.js';
import { socialService } from '../social/service.js';
import { supportService, STATUSES } from '../support/service.js';
import { cityOf, emptyCivic } from '../civic/data.js';
import { AD_KINDS, liveAds, takeDown } from '../civic/ads.js';
import { liveShoutouts, removeShoutout } from '../civic/radio.js';
import { removeAnnouncement } from '../civic/elections.js';

const CONTROL = /[\u0000-\u001f\u007f]/;
/** Requests without the right token: per address and in total, per 10 minutes. Requests with it: per address, per minute. */
export const FAILED_PER_ADDRESS = 10, FAILED_TOTAL = 100, FAILED_WINDOW_MS = 600000, OPERATOR_PER_MINUTE = 60;

export default function moderationRoutes(ctx) {
  const moderation = moderationService(ctx);
  const social = socialService(ctx);
  const support = supportService(ctx);
  ctx.startup?.push(moderation.load());

  /** Guard, parse, run inside one transaction, then push what the change told players. */
  const guarded = (handler, { write = false } = {}) => async (request) => {
    if (!ctx.config.moderation) throw ctx.fail(404, 'not_found');
    if (!request.moderator()) {
      // Requests without the token are counted on their own, so neither guessing nor a hostile page
      // sending tokenless requests from the operator's browser can use up the operator's budget.
      // Per address, and across all addresses together, so guessing from many addresses is bounded too.
      // A request that DOES carry the token never reaches either counter.
      if (!ctx.allow(`mod-fail:${request.ip}`, FAILED_PER_ADDRESS, FAILED_WINDOW_MS) || !ctx.allow('mod-fail:all', FAILED_TOTAL, FAILED_WINDOW_MS)) throw ctx.fail(429, 'rate_limited');
      throw ctx.fail(401, 'moderator_token_required');
    }
    if (!ctx.allow(`mod:${request.ip}`, OPERATOR_PER_MINUTE)) throw ctx.fail(429, 'rate_limited');
    const body = request.method === 'POST' ? await request.json() : {};
    if (!write) return { body: await ctx.store.read((db) => handler(db, request, body)), headers: { 'Cache-Control': 'no-store' } };
    // The in-memory copies (mutes, blocks) follow the commit itself, not the write that follows it.
    const result = await ctx.store.transact((db) => social.finish(db, handler(db, request, body)),
      { committed: (value) => { if (value?.mutes) moderation.sync(value.mutes); social.committed(value); } });
    if (result?.mutes) moderation.sync(result.mutes);
    const { mutes, ...rest } = social.deliver(result) ?? {};
    return { body: rest };
  };
  const note = (value, max = 300) => {
    if (value === undefined || value === '') return '';
    if (typeof value !== 'string' || value.length > max || CONTROL.test(value)) throw ctx.fail(400, 'invalid_note');
    return value.trim();
  };
  const publicId = (value) => { if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw ctx.fail(400, 'invalid_player'); return value.toLowerCase(); };
  const statusParam = (request, allowed) => { const value = request.query.get('status') ?? 'open'; if (!['open', 'all', ...allowed].includes(value)) throw ctx.fail(400, 'invalid_status'); return value; };
  const cityParam = (value) => { if (!ctx.cityIds.includes(value)) throw ctx.fail(400, 'invalid_city'); return value; };
  const civicCity = (db, cityId) => cityOf(ctx.collection(db, 'civic', emptyCivic()), cityId);

  return {
    'GET /api/mod/overview': guarded((db) => ({
      reports: social.modReportCounts(db), problems: support.counts(db), mutes: moderation.mutes(db).length,
      sessions: Object.keys(db.sessions).length, archivedLives: Object.keys(db.archivedLives ?? {}).length,
      store: ctx.core.storeStats?.() ?? null, build: ctx.config.buildId,
    })),
    'GET /api/mod/reports': guarded((db, request) => ({ reports: social.modReports(db, statusParam(request, ['received', 'dismissed', 'actioned'])) })),
    'GET /api/mod/problems': guarded((db, request) => ({ problems: support.list(db, statusParam(request, STATUSES)) })),
    'GET /api/mod/mutes': guarded((db) => ({ mutes: moderation.mutes(db) })),
    'GET /api/mod/audit': guarded((db) => ({ audit: moderation.trail(db) })),
    'GET /api/mod/content': guarded((db, request) => {
      const cityId = cityParam(request.query.get('city')), city = civicCity(db, cityId);
      return { city: cityId, ads: liveAds(city, ctx.now()), radio: liveShoutouts(city, ctx.now()),
        announcements: city.gov.announcements.map((item) => ({ id: item.id, text: item.text, by: { id: item.by.id, name: item.by.name }, at: item.at })) };
    }),

    'POST /api/mod/reports/:id/dismiss': guarded((db, request, body) => {
      const changed = social.modSetReport(db, request.params.id, 'dismissed', note(body.note));
      if (!changed) throw ctx.fail(404, 'unknown_report');
      moderation.audit(db, 'report-dismiss', changed.report.id, changed.report.note, request.ip);
      return { ok: true, code: 'dismissed', report: changed.report, push: changed.push };
    }, { write: true }),
    'POST /api/mod/problems/:id/status': guarded((db, request, body) => {
      if (!['reviewing', 'resolved', 'dismissed'].includes(body.status)) throw ctx.fail(400, 'invalid_status');
      const report = support.setStatus(db, request.params.id, body.status, note(body.note));
      if (!report) throw ctx.fail(404, 'unknown_report');
      moderation.audit(db, `problem-${body.status}`, report.id, report.note, request.ip);
      const told = social.modKnows(db, report.by) ? social.modNote(db, report.by, `Problem report ${report.id} is now “${body.status}”.${report.note ? ` Note: ${report.note}` : ''} See Phone → Report a problem.`) : { push: [] };
      return { ok: true, code: 'updated', problem: report, push: told.push };
    }, { write: true }),
    'POST /api/mod/mutes': guarded((db, request, body) => {
      const id = publicId(body.id), reason = note(body.reason, LIMITS.reason);
      if (!Number.isSafeInteger(body.minutes) || body.minutes < 1 || body.minutes > LIMITS.maxMinutes) throw ctx.fail(400, 'invalid_minutes');
      const reportId = body.report === undefined ? null : body.report;
      if (reportId !== null && (typeof reportId !== 'string' || !/^R-\d{1,12}$/.test(reportId))) throw ctx.fail(400, 'invalid_report');
      const result = moderation.mute(db, { id, minutes: body.minutes, reason, report: reportId }, request.ip);
      const push = [];
      if (reportId) { const changed = social.modSetReport(db, reportId, 'actioned', `Muted for ${body.minutes} minutes.`); if (changed) push.push(...changed.push); }
      if (social.modKnows(db, id)) push.push(...social.modNote(db, id, `A moderator has muted you for ${body.minutes} minutes${reason ? `: ${reason}` : ''}. You can keep playing; you cannot post text until it ends. If this is a mistake, use Phone → Report a problem.`).push);
      return { ok: true, code: 'muted', mute: result.mute, mutes: result.mutes, push };
    }, { write: true }),
    'POST /api/mod/mutes/:id/lift': guarded((db, request) => {
      const result = moderation.lift(db, publicId(request.params.id), request.ip);
      return { ok: true, code: result.lifted ? 'lifted' : 'not_muted', mutes: result.mutes };
    }, { write: true }),
    'POST /api/mod/content/remove': guarded((db, request, body) => {
      const cityId = cityParam(body.cityId), city = civicCity(db, cityId), reason = note(body.reason, LIMITS.reason);
      let removed = null, what = '';
      if (AD_KINDS.includes(body.kind)) { removed = takeDown(city, ctx.now(), body.kind, body.slot); what = `your ${body.kind === 'sea' ? 'sea plot' : 'billboard'} ad “${removed?.text}”`; }
      else if (body.kind === 'announcement') { removed = typeof body.id === 'string' ? removeAnnouncement(city, body.id) : null; what = `your announcement “${removed?.text}”`; }
      else if (body.kind === 'radio') { removed = typeof body.venue === 'string' && typeof body.id === 'string' && Object.hasOwn(city.radio.queues, body.venue) ? removeShoutout(city, body.venue, body.id) : null; what = `your shout-out “${removed?.title}”`; }
      else throw ctx.fail(400, 'invalid_kind');
      if (!removed) throw ctx.fail(404, 'nothing_to_remove');
      moderation.audit(db, `remove-${body.kind}`, `${cityId}:${body.slot ?? body.id}`, `${removed.text ?? removed.title} · by ${removed.by.id}${reason ? ` · ${reason}` : ''}`, request.ip);
      const told = social.modKnows(db, removed.by.id) ? social.modNote(db, removed.by.id, `A moderator removed ${what}${reason ? `: ${reason}` : ''}. What you paid for it is not refunded.`) : { push: [] };
      return { ok: true, code: 'removed', removed: { kind: body.kind, text: removed.text ?? removed.title, by: removed.by }, push: told.push };
    }, { write: true }),
  };
}
