/**
 * OWNER: foundation
 * The "update is coming" announcement (server/notice.ts).
 *
 *   POST /api/notice   { kind: 'update', minutes: 1-15, issuedAt: ms, nonce, sig }
 *        No session and no operator token: the body carries an Ed25519 signature by the release announcer, checked
 *        against a public key. Answers { ok: true, minutes, until }. 400 invalid_notice / notice_stale, 401
 *        notice_unverified, 409 notice_replayed, 429 notice_rate_limited. It stores nothing.
 */
import { noticeOf } from '../notice.ts';
import type { RouteContext, RouteHandler, RouteKey } from '../types.ts';

export default function noticeRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const service = noticeOf(ctx);
  return {
    'POST /api/notice': async (request) => {
      const body: unknown = await request.json();
      const done = await service.announce(body, request.ip);
      return { body: { ok: true, ...done }, headers: { 'Cache-Control': 'no-store' } };
    },
  };
}
