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
 *   /api/mod/overview                       counts of open reports, problems, mutes; store counters; `companion` (the hosted language model's outcomes, today's requests, tokens, estimated cost); how full the host is
 *                                           (`capacity`: sessions held and sockets open beside their caps — docs/CAPACITY.md)
 *   /api/mod/reports?status=open|all|…      player reports (reason, text, up to five quoted messages)
 *   /api/mod/problems?status=open|all|…     problem reports with their automatic context
 *   /api/mod/mutes                          active mutes
 *   /api/mod/content?city=                  live ads, announcements and radio shout-outs, with the ids to remove them by
 *   /api/mod/audit                          the last 200 audit lines, newest first
 * ACT (POST, JSON body). Every action writes one audit line (except the self-test below, which changes nothing).
 *   /api/mod/companion-test        {}                                 one tiny request to the language-model gateway → { ok, model, ms, usedFallback } or { ok: false, error: off|auth|model_not_found|timeout|other, ms }; 6 per 10 minutes
 *   /api/mod/reports/:id/dismiss   { note? }                          no action taken; the reporter is told
 *   /api/mod/problems/:id/status   { status: reviewing|resolved|dismissed, note? }   the player sees status and note
 *   /api/mod/mutes                 { id, minutes, reason, report? }   mute a public id (1 minute – 30 days); with
 *                                                                     `report` that report is marked actioned
 *   /api/mod/mutes/:id/lift        {}
 *   /api/mod/content/remove        { cityId, kind: 'billboard'|'sea'|'announcement'|'radio', slot? | id?, venue?, reason? }
 * A mute never touches the player's session, life, money or belongings (moderation/service.js).
 * Removing content does not refund what was paid for it; the owner is told in their Updates.
 */
import { UUID_PATTERN } from '../protocol.ts';
import { moderationService, LIMITS } from '../moderation/service.ts';
import { socialService } from '../social/service.ts';
import { supportService, STATUSES } from '../support/service.ts';
import { companionService } from '../companion/service.ts';
import { cityOf, emptyCivic } from '../civic/data.ts';
import { AD_KINDS, liveAds, takeDown } from '../civic/ads.ts';
import { liveShoutouts, removeShoutout } from '../civic/radio.ts';
import { removeAnnouncement } from '../civic/elections.ts';
import type { CityId } from '../../src/types/protocol.ts';
import type { AdRecord, AnnouncementRecord, Db, MuteRecord, ShoutoutRecord, RouteContext, RouteHandler, RouteKey, RouteRequest } from '../types.ts';

/** A read handler returns the JSON body; a write may carry the mutes (kept in memory after the commit) and the pushes owed to players. */
type ModBody = Record<string, unknown>;
type ReadHandler = (db: Db, request: RouteRequest, body: ModBody) => object;
type WriteResult = { mutes?: Record<string, MuteRecord> } & Record<string, unknown>;
type WriteHandler = (db: Db, request: RouteRequest, body: ModBody) => WriteResult;

const CONTROL = /[\u0000-\u001f\u007f]/;
/** Requests without the right token: per address and in total, per 10 minutes. Requests with it: per address, per minute. */
export const FAILED_PER_ADDRESS = 10, FAILED_TOTAL = 100, FAILED_WINDOW_MS = 600000, OPERATOR_PER_MINUTE = 60;

export default function moderationRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const moderation = moderationService(ctx);
  const social = socialService(ctx);
  const support = supportService(ctx);
  const companion = companionService(ctx);
  ctx.startup?.push(moderation.load());

  /** Guard, parse, run inside one transaction, then push what the change told players. */
  /** The checks every operator route starts with; returns the parsed body (empty unless POST). */
  const gate = async (request: RouteRequest): Promise<ModBody> => {
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
    return request.method === 'POST' ? await request.json() : {};
  };
  /** Guard, parse and run a read on a snapshot. */
  const guarded = (handler: ReadHandler): RouteHandler => async (request) => {
    const body = await gate(request);
    return { body: await ctx.store.read((db) => handler(db, request, body)), headers: { 'Cache-Control': 'no-store' } };
  };
  /** Guard, parse, run inside one transaction, then push what the change told players. */
  const mutating = (handler: WriteHandler): RouteHandler => async (request) => {
    const body = await gate(request);
    // The in-memory copies (mutes, blocks) follow the commit itself, not the write that follows it.
    const result = await ctx.store.transact((db) => social.finish(db, handler(db, request, body)),
      { committed: (value) => { if (value?.mutes) moderation.sync(value.mutes); social.committed(value); } });
    if (result?.mutes) moderation.sync(result.mutes);
    const { mutes, ...rest } = social.deliver(result) ?? {};
    return { body: rest };
  };
  const note = (value: unknown, max = 300): string => {
    if (value === undefined || value === '') return '';
    if (typeof value !== 'string' || value.length > max || CONTROL.test(value)) throw ctx.fail(400, 'invalid_note');
    return value.trim();
  };
  const publicId = (value: unknown): string => { if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw ctx.fail(400, 'invalid_player'); return value.toLowerCase(); };
  const statusParam = (request: RouteRequest, allowed: readonly string[]): string => { const value = request.query.get('status') ?? 'open'; if (!['open', 'all', ...allowed].includes(value)) throw ctx.fail(400, 'invalid_status'); return value; };
  const cityParam = (value: unknown): CityId => { const known = ctx.cityIds.find((id) => id === value); if (known === undefined) throw ctx.fail(400, 'invalid_city'); return known; };
  const civicCity = (db: Db, cityId: CityId) => cityOf(ctx.collection(db, 'civic', emptyCivic()), cityId);

  return {
    'GET /api/mod/overview': guarded((db) => ({
      reports: social.modReportCounts(db), problems: support.counts(db), mutes: moderation.mutes(db).length,
      sessions: Object.keys(db.sessions).length, archivedLives: Object.keys(db.archivedLives ?? {}).length,
      // How full the host is: what it holds beside what it takes (server/host-context.ts capacityConfig).
      capacity: { sessions: { held: Object.keys(db.sessions).length, most: ctx.config.maxActiveSessions },
        sockets: { open: ctx.core.sockets().length, most: ctx.config.maxSockets, perAddress: ctx.config.socketsPerAddress, perPlayer: ctx.config.socketsPerPlayer } },
      store: ctx.core.storeStats?.() ?? null, build: ctx.config.buildId,
      // The hosted companion: outcomes, today's requests, tokens and an estimated cost, from memory (server/companion/service.ts).
      companion: companion.overview(),
    })),
    // One tiny real request to the language-model gateway: a wrong key or model id shows up as a short class (auth, model_not_found, timeout, other).
    'POST /api/mod/companion-test': async (request) => {
      await gate(request);
      if (!ctx.allow('mod:companion-test', 6, 600000)) throw ctx.fail(429, 'rate_limited');
      return { body: await companion.selfTest(), headers: { 'Cache-Control': 'no-store' } };
    },
    'GET /api/mod/reports': guarded((db, request) => ({ reports: social.modReports(db, statusParam(request, ['received', 'dismissed', 'actioned'])) })),
    'GET /api/mod/problems': guarded((db, request) => ({ problems: support.list(db, statusParam(request, STATUSES)) })),
    'GET /api/mod/mutes': guarded((db) => ({ mutes: moderation.mutes(db) })),
    'GET /api/mod/audit': guarded((db) => ({ audit: moderation.trail(db) })),
    'GET /api/mod/content': guarded((db, request) => {
      const cityId = cityParam(request.query.get('city')), city = civicCity(db, cityId);
      return { city: cityId, ads: liveAds(city, ctx.now()), radio: liveShoutouts(city, ctx.now()),
        announcements: city.gov.announcements.map((item) => ({ id: item.id, text: item.text, by: { id: item.by.id, name: item.by.name }, at: item.at })) };
    }),

    'POST /api/mod/reports/:id/dismiss': mutating((db, request, body) => {
      const changed = social.modSetReport(db, request.params.id ?? '', 'dismissed', note(body.note));
      if (!changed) throw ctx.fail(404, 'unknown_report');
      moderation.audit(db, 'report-dismiss', changed.report.id, changed.report.note, request.ip);
      return { ok: true, code: 'dismissed', report: changed.report, push: changed.push };
    }),
    'POST /api/mod/problems/:id/status': mutating((db, request, body) => {
      const status = body.status;
      if (typeof status !== 'string' || (status !== 'reviewing' && status !== 'resolved' && status !== 'dismissed')) throw ctx.fail(400, 'invalid_status');
      const report = support.setStatus(db, request.params.id ?? '', status, note(body.note));
      if (!report) throw ctx.fail(404, 'unknown_report');
      moderation.audit(db, `problem-${status}`, report.id, report.note, request.ip);
      const told = social.modKnows(db, report.by) ? social.modNote(db, report.by, `Problem report ${report.id} is now “${status}”.${report.note ? ` Note: ${report.note}` : ''} See Phone → Report a problem.`) : { push: [] };
      return { ok: true, code: 'updated', problem: report, push: told.push };
    }),
    'POST /api/mod/mutes': mutating((db, request, body) => {
      const id = publicId(body.id), reason = note(body.reason, LIMITS.reason);
      const minutes = body.minutes;
      if (typeof minutes !== 'number' || !Number.isSafeInteger(minutes) || minutes < 1 || minutes > LIMITS.maxMinutes) throw ctx.fail(400, 'invalid_minutes');
      const reportId = body.report === undefined ? null : body.report;
      if (reportId !== null && (typeof reportId !== 'string' || !/^R-\d{1,12}$/.test(reportId))) throw ctx.fail(400, 'invalid_report');
      const result = moderation.mute(db, { id, minutes, reason, report: reportId ?? undefined }, request.ip);
      const push: unknown[] = [];
      if (reportId) { const changed = social.modSetReport(db, reportId, 'actioned', `Muted for ${minutes} minutes.`); if (changed) push.push(...changed.push); }
      if (social.modKnows(db, id)) push.push(...social.modNote(db, id, `A moderator has muted you for ${minutes} minutes${reason ? `: ${reason}` : ''}. You can keep playing; you cannot post text until it ends. If this is a mistake, use Phone → Report a problem.`).push);
      return { ok: true, code: 'muted', mute: result.mute, mutes: result.mutes, push };
    }),
    'POST /api/mod/mutes/:id/lift': mutating((db, request) => {
      const result = moderation.lift(db, publicId(request.params.id), request.ip);
      return { ok: true, code: result.lifted ? 'lifted' : 'not_muted', mutes: result.mutes };
    }),
    'POST /api/mod/content/remove': mutating((db, request, body) => {
      const cityId = cityParam(body.cityId), city = civicCity(db, cityId), reason = note(body.reason, LIMITS.reason);
      let removed: AdRecord | AnnouncementRecord | ShoutoutRecord | null = null, what = '';
      if (AD_KINDS.some((item) => item === body.kind)) { removed = takeDown(city, ctx.now(), body.kind, body.slot); what = `your ${body.kind === 'sea' ? 'sea plot' : 'billboard'} ad “${removed?.text}”`; }
      else if (body.kind === 'announcement') { removed = typeof body.id === 'string' ? removeAnnouncement(city, body.id) : null; what = `your announcement “${removed?.text}”`; }
      else if (body.kind === 'radio') { removed = typeof body.venue === 'string' && typeof body.id === 'string' && Object.hasOwn(city.radio.queues, body.venue) ? removeShoutout(city, body.venue, body.id) : null; what = `your shout-out “${removed?.title}”`; }
      else throw ctx.fail(400, 'invalid_kind');
      if (!removed) throw ctx.fail(404, 'nothing_to_remove');
      const label = 'text' in removed ? removed.text : removed.title;
      moderation.audit(db, `remove-${body.kind}`, `${cityId}:${body.slot ?? body.id}`, `${label} · by ${removed.by.id}${reason ? ` · ${reason}` : ''}`, request.ip);
      const told = social.modKnows(db, removed.by.id) ? social.modNote(db, removed.by.id, `A moderator removed ${what}${reason ? `: ${reason}` : ''}. What you paid for it is not refunded.`) : { push: [] };
      return { ok: true, code: 'removed', removed: { kind: body.kind, text: label, by: removed.by }, push: told.push };
    }),
  };
}
