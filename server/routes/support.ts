/**
 * OWNER: support
 * "Report a problem" under /api/support/ — rules and stored shape in server/support/service.ts.
 *
 *   POST /api/support/reports   { cityId, category, text, clientId } → { ok, code: 'filed', receipt, duplicate? }
 *                               clientId is mandatory, `<unix ms>:<uuid>` (400 client_id_required / invalid_client_id)
 *                                                                    | { ok: false, code, reason }
 *   GET  /api/support/reports                                         → { ok, reports: [receipt], categories, limits }
 *   receipt = { id: 'P-<n>', at, cityId, category, text, status, note, updatedAt }
 *   GET  /api/support/statement?city=                                 → { ok, city, name, statement }
 *       the wallet statement (src/game/systems/wallet.ts statementOf): opening balance, every kept
 *       change with reason and time, a summary per day, closing balance, and whether it reconciles
 *
 * Both need the device session and nothing else: no e-mail, no social account. Filing is rate
 * limited per player and per address. The receipt and its status are stored on the server, so
 * they are still there after a reload. Operators read and answer reports through /api/mod/.
 */
import { supportService } from '../support/service.ts';
import { statementOf } from '../../src/game/wallet-statement.ts';
import { outcomeKey } from './core.ts';
import { walletHistory } from '../economy/history.ts';
import type { RouteContext, RouteHandler, RouteKey } from '../types.ts';

export default function supportRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const service = supportService(ctx);
  return {
    'POST /api/support/reports': async (request) => {
      const body = await request.json();
      const result = await ctx.store.transact((db) => {
        const session = request.requireSession(db, { renew: true });
        if (!ctx.allow(`support:http:${session.publicId}`, 30)) throw ctx.fail(429, 'rate_limited');
        return service.file(db, session, { cityId: body.cityId, category: body.category, text: body.text, clientId: body.clientId }, request.ip);
      });
      return { body: result, renew: true };
    },
    // The statement is computed from the server's own copy of the life, settled to now. Like a
    // poll, it is durable before it is answered whenever the settlement produced an outcome.
    'GET /api/support/statement': async (request) => {
      const city = request.query.get('city');
      const cityId = ctx.cityIds.find((id) => id === city);
      if (cityId === undefined) throw ctx.fail(400, 'invalid_city');
      const result = await ctx.store.transact((db) => {
        const session = request.requireSession(db, { renew: true });
        if (!ctx.allow(`support:statement:${session.publicId}`, 30)) throw ctx.fail(429, 'rate_limited');
        const before = outcomeKey(session.cities?.[cityId]?.state);
        const state = ctx.settle(session, cityId);
        return { body: { ok: true, city: cityId, name: session.name, statement: statementOf(state) }, material: before !== outcomeKey(state) };
      }, { durable: (value) => value.material });
      return { body: result.body, renew: true };
    },
    'GET /api/support/reports': async (request) => {
      const result = await ctx.store.read((db) => {
        const session = request.requireSession(db);
        if (!ctx.allow(`support:http:${session.publicId}`, 30)) throw ctx.fail(429, 'rate_limited');
        return service.mine(db, session);
      });
      return { body: result };
    },
    'GET /api/support/history': async (request) => {
      const raw = request.query.get('after'), after = raw === null || raw === '' ? 0 : Number(raw);
      if (!Number.isSafeInteger(after) || after < 0) throw ctx.fail(400, 'invalid_cursor');
      const result = await ctx.store.read((db) => {
        const session = request.requireSession(db);
        if (!ctx.allow(`support:history:${session.publicId}`, 60)) throw ctx.fail(429, 'rate_limited');
        return walletHistory(db, session.publicId, after);
      });
      return { body: result };
    },
  };
}
