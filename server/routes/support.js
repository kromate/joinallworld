/**
 * OWNER: support
 * "Report a problem" under /api/support/ — rules and stored shape in server/support/service.js.
 *
 *   POST /api/support/reports   { cityId, category, text, clientId } → { ok, code: 'filed', receipt, duplicate? }
 *                               clientId is mandatory, `<unix ms>:<uuid>` (400 client_id_required / invalid_client_id)
 *                                                                    | { ok: false, code, reason }
 *   GET  /api/support/reports                                         → { ok, reports: [receipt], categories, limits }
 *   receipt = { id: 'P-<n>', at, cityId, category, text, status, note, updatedAt }
 *   GET  /api/support/statement?city=                                 → { ok, city, name, statement }
 *       the wallet statement (src/game/systems/wallet.js statementOf): opening balance, every kept
 *       change with reason and time, a summary per day, closing balance, and whether it reconciles
 *
 * Both need the device session and nothing else: no e-mail, no social account. Filing is rate
 * limited per player and per address. The receipt and its status are stored on the server, so
 * they are still there after a reload. Operators read and answer reports through /api/mod/.
 */
import { supportService } from '../support/service.js';
import { statementOf } from '../../src/game/systems/wallet.ts';
import { outcomeKey } from './core.js';

export default function supportRoutes(ctx) {
  const service = supportService(ctx);
  return {
    'POST /api/support/reports': async (request) => {
      const body = await request.json();
      const result = await ctx.store.transact((db) => {
        const session = request.requireSession(db, { renew: true });
        if (!ctx.allow(`support:http:${session.publicId}`, 30)) throw ctx.fail(429, 'rate_limited');
        return service.file(db, session, body, request.ip);
      });
      return { body: result, renew: true };
    },
    // The statement is computed from the server's own copy of the life, settled to now. Like a
    // poll, it is durable before it is answered whenever the settlement produced an outcome.
    'GET /api/support/statement': async (request) => {
      const city = request.query.get('city');
      if (!ctx.cityIds.includes(city)) throw ctx.fail(400, 'invalid_city');
      const result = await ctx.store.transact((db) => {
        const session = request.requireSession(db, { renew: true });
        if (!ctx.allow(`support:statement:${session.publicId}`, 30)) throw ctx.fail(429, 'rate_limited');
        const before = outcomeKey(session.cities?.[city]?.state);
        const state = ctx.settle(session, city);
        return { body: { ok: true, city, name: session.name, statement: statementOf(state) }, material: before !== outcomeKey(state) };
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
  };
}
