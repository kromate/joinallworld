/**
 * OWNER: telemetry
 * Route module (contract: server/routes/index.js) for the two telemetry endpoints.
 *
 *   GET  /api/telemetry/config    what the browser may load: { enabled: false } when nothing is
 *                                 configured, otherwise the PUBLIC Sentry DSN and PostHog project key,
 *                                 the environment and the release. Never a secret, and no session is
 *                                 read or created.
 *   POST /api/telemetry/consent   { analytics: boolean } — this player's browser said Accept or
 *                                 Reject. Kept in memory only (never written to the data file), so
 *                                 events the server records for the player follow the same choice.
 */
export default function telemetryRoutes(ctx) {
  const telemetry = ctx.telemetry;
  return {
    'GET /api/telemetry/config': () => ({ body: telemetry?.publicConfig?.() ?? { enabled: false } }),
    'POST /api/telemetry/consent': async (request) => {
      const body = await request.json();
      if (typeof body.analytics !== 'boolean') throw ctx.fail(400, 'invalid_consent');
      const session = await ctx.store.read(db => request.requireSession(db));
      if (!ctx.allow(`telemetry:consent:${session.publicId}`, 20)) throw ctx.fail(429, 'rate_limited');
      return { body: { analytics: telemetry?.consent?.(session.publicId, body.analytics) === true } };
    },
  };
}
