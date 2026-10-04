/**
 * OWNER: telemetry
 * Route module (contract: server/routes/index.ts) for the two telemetry endpoints.
 *
 *   GET  /api/telemetry/config    what the browser may load: { enabled: false } when nothing is
 *                                 configured, otherwise the PUBLIC Sentry DSN and PostHog project key,
 *                                 the environment and the release. Never a secret. No session is created
 *                                 or renewed; the caller's session, if it has one, is read for one thing
 *                                 only — `under18: true` when that player answered the age question with
 *                                 "under 18" — so the browser never starts analytics for them.
 *   POST /api/telemetry/consent   { analytics: boolean } — this player's browser said Accept or
 *                                 Reject. Kept in memory only (never written to the data file), so
 *                                 events the server records for the player follow the same choice.
 *                                 An Accept from a player who is under 18 is not kept: the answer is
 *                                 { analytics: false, under18: true }.
 *
 * THE AGE ANSWER HAS ONE HOME: the growth collection (POST /api/growth/consent). This module does not
 * store it; it asks through ctx.checks.minor(db, publicId), which the growth routes provide. On a host
 * without the growth module nobody is known to be under 18.
 */
export default function telemetryRoutes(ctx) {
  const telemetry = ctx.telemetry;
  const minor = (db, publicId) => { try { return ctx.checks?.minor?.(db, publicId) === true; } catch { return false; } };
  return {
    'GET /api/telemetry/config': async (request) => {
      const body = telemetry?.publicConfig?.() ?? { enabled: false };
      if (body.enabled !== true) return { body };
      const under18 = await ctx.store.read((db) => { const session = request.session(db); return Boolean(session) && minor(db, session.publicId); });
      if (under18) telemetry?.consent?.(request.publicId, false);
      return { body: under18 ? { ...body, under18: true } : body };
    },
    'POST /api/telemetry/consent': async (request) => {
      const body = await request.json();
      if (typeof body.analytics !== 'boolean') throw ctx.fail(400, 'invalid_consent');
      const { session, under18 } = await ctx.store.read(db => { const found = request.requireSession(db); return { session: found, under18: minor(db, found.publicId) }; });
      if (!ctx.allow(`telemetry:consent:${session.publicId}`, 20)) throw ctx.fail(429, 'rate_limited');
      if (under18) { telemetry?.consent?.(session.publicId, false); return { body: { analytics: false, under18: true } }; }
      return { body: { analytics: telemetry?.consent?.(session.publicId, body.analytics) === true } };
    },
  };
}
