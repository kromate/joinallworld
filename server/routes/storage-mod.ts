/**
 * OWNER: store
 * The operator's view of how the big collections are stored (docs/STORAGE.md), under /api/mod/store. Same access rules as
 * routes/moderation.ts: 404 unless the server has a MODERATOR_TOKEN, the token only in the `Authorization: Bearer` header.
 *
 *   GET  /api/mod/store              layout, per collection: mode, synced, legacy row, entries; the shadow counters (mismatches, checks, the first differences)
 *   GET  /api/mod/store/compare      entry rows against the legacy value, per collection
 *   GET  /api/mod/store/hashes       a fingerprint of each collection's whole text
 *   POST /api/mod/store/migrate      { collections?: string[] }   make the entry rows from the legacy values and read them back
 *   POST /api/mod/store/layout       { layout: 'legacy' | 'shadow' | 'entries', force?: boolean }
 *   POST /api/mod/store/safety       { action: 'drop' | 'restore', force?: boolean }   the legacy rows kept at the switch
 * Nothing here returns a player's data. A host whose store keeps no entry rows (the Node file) answers 501 `not_supported`.
 */
import { operatorGuard } from './growth-mod.ts';
import { isKeyedCollection } from '../keyed.ts';
import type { RouteContext, RouteHandler, RouteKey, RouteRequest, StoreLayoutTools } from '../types.ts';

export default function storageOperatorRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const guard = operatorGuard(ctx);
  const tools = (): StoreLayoutTools => { const found = ctx.store.layout; if (!found) throw ctx.fail(501, 'not_supported'); return found; };
  const need = <K extends keyof StoreLayoutTools>(name: K): NonNullable<StoreLayoutTools[K]> => { const found = tools()[name]; if (!found) throw ctx.fail(501, 'not_supported'); return found as NonNullable<StoreLayoutTools[K]>; };
  /** A handler that talks to the store itself, not inside a transaction. */
  const direct = (handler: (body: Record<string, unknown>, request: RouteRequest) => Promise<object>): RouteHandler => {
    const gate = guard(() => ({}));
    return async (request) => {
      await gate(request);
      const body: Record<string, unknown> = request.method === 'POST' ? await request.json() : {};
      try { return { body: await handler(body, request), headers: { 'Cache-Control': 'no-store' } }; }
      catch (error) {
        const found = error as { status?: unknown; code?: unknown; message?: unknown };
        if (typeof found.status === 'number' && typeof found.code === 'string' && found.status === 409) throw Object.assign(ctx.fail(409, found.code), { reason: String(found.message ?? '') });
        throw error;
      }
    };
  };
  return {
    'GET /api/mod/store': direct(async () => ({ ok: true, ...(await tools().status()) })),
    'GET /api/mod/store/compare': direct(async () => ({ ok: true, collections: await need('compare')() })),
    'GET /api/mod/store/hashes': direct(async () => ({ ok: true, collections: await need('hashes')() })),
    'POST /api/mod/store/migrate': direct(async (body) => {
      const names = body['collections'];
      if (names !== undefined && (!Array.isArray(names) || !names.every((name) => typeof name === 'string' && isKeyedCollection(name)))) throw ctx.fail(400, 'invalid_collections');
      return { ok: true, moved: await need('migrate')(names as string[] | undefined) };
    }),
    'POST /api/mod/store/layout': direct(async (body) => {
      const next = body['layout'];
      if (next !== 'legacy' && next !== 'shadow' && next !== 'entries') throw ctx.fail(400, 'invalid_layout');
      return { ok: true, ...(await need('setLayout')(next, body['force'] === true)) };
    }),
    'POST /api/mod/store/safety': direct(async (body) => {
      const action = body['action'];
      if (action !== 'drop' && action !== 'restore') throw ctx.fail(400, 'invalid_action');
      return { ok: true, ...(await need('safety')(action, body['force'] === true)) };
    }),
  };
}
