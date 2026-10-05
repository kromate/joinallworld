/**
 * OWNER: growth
 * Socket messages for the game tables. Thin adapters over server/growth/tables.ts, which holds
 * every rule. All types are prefixed `table-`.
 *
 * CLIENT → SERVER (cityId and, except for table-list, `table` — a table id — in every message)
 *   table-list    { cityId, venue? }            → tables { cityId, venue, tables: [summary] }; the socket is then
 *                                                 nudged (tables-changed) when a table in that venue changes
 *   table-watch   { cityId, table }             → table-state (and again whenever the table changes)
 *   table-unwatch {}                            stop receiving a table's state
 *   table-sit     { cityId, table }             take a seat (your Sim must be in the table's venue)
 *   table-options { cityId, table, options }    the first to sit sets the table's rules, before a game
 *   table-start   { cityId, table, bots? }      start with the people seated, plus `bots` house players
 *   table-move    { cityId, table, n, move }    play; `n` is the number of moves made when you chose yours
 *   table-leave   { cityId, table }             give up your seat (during a game: forfeit)
 *   table-again   { cityId, table }             after a game: open the table again
 * SERVER → CLIENT
 *   table-state { cityId, table: summary, you: seat | null, host, n, view, log, toMove, clock, result, optionList }
 *       `view` is the game's own view for YOUR seat (or the watcher's view): it never holds another
 *       player's hand. Sent to every socket attached to the table, each with its own view.
 *   tables-changed { cityId, venue }            a table in a venue you listed changed: ask table-list again
 *   error { code, reason }                      a refusal, with a sentence for the player
 * A socket need not have joined a venue room: the service checks the stored life itself.
 */
import { tablesService } from '../growth/tables.ts';
import type { RouteContext, WsHandlers } from '../types.ts';

export default function tablesSocket(ctx: RouteContext): WsHandlers {
  const tables = tablesService(ctx);
  if (ctx.checks) ctx.checks.seated = (id) => tables.isSeated(id);
  return {
    close(ws) { tables.drop(ws); },
    messages: {
      'table-list': async (ws, message) => { ctx.send(ws, tables.list(ws, message)); },
      'table-watch': async (ws, message) => { tables.watch(ws, message); },
      'table-unwatch': async (ws) => { tables.unwatch(ws); },
      'table-sit': async (ws, message) => { await tables.sit(ws, message); },
      'table-options': async (ws, message) => { tables.options(ws, message); },
      'table-start': async (ws, message) => { await tables.start(ws, message); },
      'table-move': async (ws, message) => { await tables.move(ws, message); },
      'table-leave': async (ws, message) => { await tables.leave(ws, message); },
      'table-again': async (ws, message) => { tables.again(ws, message); },
    },
  };
}
