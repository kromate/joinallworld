/**
 * OWNER: world
 * No message types of its own: this module only tells the world service (server/world/service.ts)
 * when a player's connection opens and closes, so "online now" per local government is a count the
 * server already holds — never a scan of residents. It also tells the pulse (server/pulse.ts), which counts who is online
 * and pushes the counts to the open sockets when they change.
 */
import { worldOf } from '../world/service.ts';
import { characterCity } from '../character.ts';
import { pulseOf } from '../pulse.ts';
import type { RouteContext, WsHandlers } from '../types.ts';

export default function worldSocket(ctx: RouteContext): WsHandlers {
  const world = worldOf(ctx), pulse = pulseOf(ctx);
  return {
    messages: {
      // The page asks once per connection; the answer is the current counts, and they follow when they change.
      'pulse-watch': async (ws) => {
        if (!ctx.allow(`pulse:watch:${ws.session.id}`, 30)) throw Error('rate_limited');
        const city = await ctx.store.read((db) => { const session = ctx.core.sessionOf(ws, db); return session && session.publicId === ws.session.id ? characterCity(session) : null; });
        pulse.watch(ws, city);
      },
    },
    open: (ws) => { world.open(ws); pulse.opened(ws); },
    close: (ws) => { world.close(ws); pulse.closed(ws); },
    restore: (ws) => { world.open(ws); pulse.opened(ws); },
  };
}
