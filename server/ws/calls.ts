/**
 * OWNER: social
 * One-to-one call messages over the social socket. A thin adapter over server/social/calls.ts, which
 * holds every rule; the frames are documented in src/types/calls.ts. Calls are not tied to a venue room:
 * these messages work whether or not the socket has joined one, and across cities.
 *
 * CLIENT -> SERVER   call-invite, call-accept, call-decline, call-cancel, call-hangup, call-signal, call-settings
 * SERVER -> CLIENT   call-incoming, call-state, call-signal, call-settings
 *
 * Nothing here touches the venue room's voice (ws.voice), ws.room or ws.position.
 */
import { callService } from '../social/calls.ts';
import type { RouteContext, WsHandlers } from '../types.ts';

export default function callsSocket(ctx: RouteContext): WsHandlers {
  const service = callService(ctx);
  return {
    close(ws) { service.close(ws); },
    messages: {
      'call-invite': (ws, message) => service.invite(ws, message),
      'call-accept': (ws, message) => service.accept(ws, message),
      'call-decline': (ws, message) => service.leave(ws, message, 'decline'),
      'call-cancel': (ws, message) => service.leave(ws, message, 'cancel'),
      'call-hangup': (ws, message) => service.leave(ws, message, 'hangup'),
      'call-signal': (ws, message) => service.signal(ws, message),
      async 'call-settings'(ws, message) {
        const calls = await service.settings(ws, message);
        ctx.send(ws, { type: 'call-settings', calls });
      },
    },
  };
}
