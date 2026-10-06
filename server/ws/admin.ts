/**
 * OWNER: admin
 * Two things a socket is told when it opens, from memory only (nothing is read from storage):
 *   - a banned player's socket is refused at once (the ban itself closed the sockets that were open when it was made);
 *   - the announcements that are running (server/admin/announce.ts), as one `announce` frame.
 * There are no client frames.
 */
import { announceOf } from '../admin/announce.ts';
import { SESSION_CHANGED } from '../routes/auth.ts';
import type { RouteContext, WsHandlers } from '../types.ts';

export default function adminSocket(ctx: RouteContext): WsHandlers {
  const announcements = announceOf(ctx);
  return {
    messages: {},
    open(ws) {
      if (ctx.checks?.banned?.(ws.session.id)) { ctx.core.closeSocket?.(ws, SESSION_CHANGED, 'Session changed'); return; }
      const frame = announcements.forSocket();
      if (frame) ctx.send(ws, frame);
    },
  };
}
