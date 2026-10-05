/**
 * OWNER: business
 * The operator's side of player-owned shops, under /api/mod/business/. Same access rules as routes/moderation.ts
 * (routes/growth-mod.ts operatorGuard): 404 unless the server was started with MODERATOR_TOKEN, the token only in the
 * `Authorization: Bearer` header. Every change is written to the moderation audit and told to the shop's owner.
 *
 *   GET  /api/mod/business/reports            { reports: [{ id, shop, name, by, reason, at, live, current }], shops }
 *   POST /api/mod/business/rename  { shop, reason? }   replace a stall's name with a plain one
 *   POST /api/mod/business/close   { shop, reason? }   close a stall; its owner is owed the refund of closing by choice
 */
import type { RouteContext, RouteHandler, RouteKey } from '../types.ts';
import { businessService } from '../business/service.ts';
import { moderationService } from '../moderation/service.ts';
import { operatorGuard } from './growth-mod.ts';

export default function businessOperatorRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const operator = operatorGuard(ctx);
  const shops = businessService(ctx), moderation = moderationService(ctx);
  const note = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 200) : '');
  /** An operator write whose notes to the owner go out once it is saved. */
  const change = (run: Parameters<typeof operator>[0]): RouteHandler => async (request) => {
    const result = await operator(run, { write: true })(request);
    if (!result || !result.body) return result;
    const { push, ...body } = result.body as { push?: [string, unknown][] };
    return { ...result, body, after: () => shops.deliver(push ?? []) };
  };
  return {
    'GET /api/mod/business/reports': operator((db) => shops.modReports(db)),
    'POST /api/mod/business/rename': change((db, request, body) => {
      const push: [string, unknown][] = [], done = shops.modRename(db, body.shop, push);
      if (!done) throw ctx.fail(404, 'unknown_shop');
      moderation.audit(db, 'shop-rename', done.by.id, `${done.old}${note(body.reason) ? ` · ${note(body.reason)}` : ''}`, request.ip);
      return { ok: true, code: 'renamed', removed: done.old, by: done.by, push };
    }),
    'POST /api/mod/business/close': change((db, request, body) => {
      const push: [string, unknown][] = [], done = shops.modClose(db, body.shop, push);
      if (!done) throw ctx.fail(404, 'unknown_shop');
      moderation.audit(db, 'shop-close', done.by.id, `${done.name}${note(body.reason) ? ` · ${note(body.reason)}` : ''}`, request.ip);
      return { ok: true, code: 'closed', name: done.name, by: done.by, owed: done.owed, push };
    }),
  };
}
