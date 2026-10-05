/**
 * OWNER: foundation
 * A player who connects while an update notice is running is told at once (server/notice.ts). The announcement itself
 * is sent to the sockets that are open by the route; there are no client frames.
 */
import { noticeOf } from '../notice.ts';
import type { RouteContext, WsHandlers } from '../types.ts';

export default function noticeSocket(ctx: RouteContext): WsHandlers {
  const service = noticeOf(ctx);
  return {
    messages: {},
    open(ws) { const frame = service.frame(); if (frame) ctx.send(ws, frame); },
  };
}
