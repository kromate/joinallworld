/**
 * OWNER: showcase
 * The operator's side of showcase shops, under /api/mod/showcase. Same access rules as routes/business-mod.ts: 404 unless the
 * server was started with MODERATOR_TOKEN, the token only in the `Authorization: Bearer` header. Every change is audited.
 *
 *   GET  /api/mod/showcase                       { queue: [...], shops }   shops waiting for a first look or again, and shops with a hidden photo
 *   GET  /api/mod/showcase/photo/:id             the bytes of any showcase photo (to look at it before deciding)
 *   POST /api/mod/showcase  { action, shop, photo?, reason? }
 *        action: approve | hide | restore | photo-restore | photo-remove
 */
import { CONTENT_TYPES, PICTURE_LIMITS } from '../social/images.ts';
import { moderationService } from '../moderation/service.ts';
import { showcaseService } from '../showcase/service.ts';
import type { RouteContext, RouteHandler, RouteKey } from '../types.ts';
import { operatorGate, operatorGuard } from './growth-mod.ts';

export default function showcaseOperatorRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const operator = operatorGuard(ctx), gate = operatorGate(ctx);
  const service = showcaseService(ctx), moderation = moderationService(ctx);
  return {
    'GET /api/mod/showcase': operator((db) => service.queue(db)),
    'GET /api/mod/showcase/photo/:id': async (request) => {
      await gate(request);
      const id = request.params.id ?? '', images = ctx.showcaseImages;
      if (!images || !PICTURE_LIMITS.idPattern.test(id)) throw ctx.fail(404, 'unknown_photo');
      const stored = await images.get(id);
      if (!stored) throw ctx.fail(404, 'unknown_photo');
      return { file: { bytes: stored.bytes, type: CONTENT_TYPES[stored.image.type], cache: 'no-store' } };
    },
    'POST /api/mod/showcase': async (request) => {
      const gone: string[] = [];
      const done = await operator((db, req, body) => {
        const result = service.decide(db, body, gone);
        const reason = typeof body.reason === 'string' ? body.reason.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
        moderation.audit(db, `showcase-${result.code}`, result.owner, `${result.name}${reason ? ` · ${reason}` : ''}`, req.ip);
        return { ok: true, code: result.code, status: result.status };
      }, { write: true })(request);
      if (gone.length) await ctx.showcaseImages?.remove(gone).catch(() => {});
      return done;
    },
  };
}
