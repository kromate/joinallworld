/**
 * OWNER: growth
 * The operator's view of the growth features, under /api/mod/growth/. Same access rules as
 * routes/moderation.js: disabled (404) unless the server was started with MODERATOR_TOKEN, the
 * token only ever in the `Authorization: Bearer` header, 60 requests a minute with it, and
 * requests without it counted separately (10 per address and 100 in total per 10 minutes).
 *
 *   GET /api/mod/growth/metrics?days=    daily totals and retention cohorts (server/growth/metrics.ts).
 *                                        Carries no player id, no address and nothing a player typed.
 *   GET /api/mod/growth/outreach         e-mail and push: configured or dry-run, opt-ins, sent today against the cap, the last
 *                                        error, the last 100 log lines and the last dry-run previews. No address, endpoint or id.
 *   POST /api/mod/growth/outreach/switch { channel: 'email' | 'push', off: boolean }   the kill switch of one channel
 *   POST /api/mod/growth/outreach/run    {}   run the schedule now
 */
import { growthOf } from '../growth/data.ts';
import { report } from '../growth/metrics.ts';
import { outreachService } from '../growth/outreach.ts';
import type { Db, RouteContext, RouteHandler, RouteKey, RouteRequest } from '../types.ts';

/** An operator handler: its return value is the JSON body. */
export type OperatorHandler = (db: Db, request: RouteRequest, body: Record<string, unknown>) => object;

const FAILED_PER_ADDRESS = 10, FAILED_TOTAL = 100, FAILED_WINDOW_MS = 600000, OPERATOR_PER_MINUTE = 60;

/** Guard for an operator route: `read` handlers get a snapshot, `write` handlers a transaction. */
export function operatorGuard(ctx: RouteContext) {
  return (handler: OperatorHandler, { write = false }: { write?: boolean } = {}): RouteHandler => async (request) => {
    if (!ctx.config.moderation) throw ctx.fail(404, 'not_found');
    if (!request.moderator()) {
      if (!ctx.allow(`mod-fail:${request.ip}`, FAILED_PER_ADDRESS, FAILED_WINDOW_MS) || !ctx.allow('mod-fail:all', FAILED_TOTAL, FAILED_WINDOW_MS)) throw ctx.fail(429, 'rate_limited');
      throw ctx.fail(401, 'moderator_token_required');
    }
    if (!ctx.allow(`mod:${request.ip}`, OPERATOR_PER_MINUTE)) throw ctx.fail(429, 'rate_limited');
    const body: Record<string, unknown> = request.method === 'POST' ? await request.json() : {};
    const run = (db: Db) => handler(db, request, body);
    return { body: await (write ? ctx.store.transact(run) : ctx.store.read(run)), headers: { 'Cache-Control': 'no-store' } };
  };
}

export default function growthOperatorRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const operator = operatorGuard(ctx);
  const outreach = outreachService(ctx);
  return {
    'GET /api/mod/growth/outreach': operator((db) => outreach.operatorView(growthOf(ctx, db))),
    'POST /api/mod/growth/outreach/switch': operator((db, request, body) => outreach.setSwitch(growthOf(ctx, db), body.channel, body.off), { write: true }),
    // Run the schedule now instead of at the next minute (the same rules, caps and quiet hours apply).
    'POST /api/mod/growth/outreach/run': async (request) => { const guarded = await operator(() => ({}))(request); return { ...guarded, body: await outreach.tick({ force: true }) }; },
    'GET /api/mod/growth/metrics': operator((db, request) => {
      const days = Number(request.query.get('days'));
      // `analytics` says whether product analytics (PostHog) is ALSO running on this server. These first-party numbers do not
      // depend on it and are never mixed with it: they are the same with telemetry configured, unconfigured or refused.
      return { ...report(growthOf(ctx, db), ctx.now(), { days: Number.isSafeInteger(days) && days > 0 ? days : 35 }), analytics: ctx.telemetry?.enabled === true ? 'also-configured' : 'not-configured' };
    }),
  };
}
