/**
 * OWNER: companion
 * The hosted language-model path of the in-game companion, under /api/companion/. Rules, settings and what is sent: server/companion/.
 *
 *   POST /api/companion/ask   { message, clientId, turnId?, history? [{ role, text }] }
 *                             | { rephrase: true, localText, clientId, turnId? }   (only with COMPANION_AI_REPHRASE=on)
 *     → { ok: true, via: 'primary' | 'fallback' | 'local' | 'filtered', text: string | null, suggest: string[], topic?, turnId? }
 *     via 'local' with text null: the client answers with its own deterministic reply (no key, switched off, a limit, a
 *     failure, an unfit answer, a crisis message). The player is never shown a quota or a gateway error.
 *     suggest: ids already checked against the stored life; the client turns each into a button (suggestToAction).
 * Needs the device session and a started life; guests are allowed. clientId is `<unix ms>:<uuid>`.
 */
import { companionService } from '../companion/service.ts';
import type { RouteContext, RouteHandler, RouteKey } from '../types.ts';

export default function companionRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const service = companionService(ctx);
  return {
    'POST /api/companion/ask': async (request) => ({ body: await service.ask(request), headers: { 'Cache-Control': 'no-store' } }),
  };
}
