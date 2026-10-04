/**
 * OWNER: foundation
 * Core routes: device session, life, action and voice configuration. Behaviour is unchanged
 * from the pre-registry server except that POST /api/action also accepts `payload`, and that
 * POST /api/session accepts `onboarding: true` when it CREATES a session: lives of that session
 * must finish character creation before any other action (see life-service.js settleCity). The
 * field is ignored for an existing session, so a rename can neither add nor remove the rule.
 */
import { validateName, validateActionPayload, publicSession, canJoinVenue, actionFingerprint, pruneReceipts, readReceipt, VOICE_RADIUS, STUN_ONLY_CONFIG, validateVoiceConfig, venueRoomKey } from '../protocol.js';

export default function coreRoutes(ctx) {
  const { store, now, fail, allow, settle, core, config } = ctx;
  return {
    'POST /api/session': async (request) => {
      const body = await request.json();
      const name = validateName(body.name);
      const result = await store.transact(db => {
        for (const [secret, record] of Object.entries(db.sessions)) if (record.expiresAt <= now()) core.archiveSession(db, secret, record);
        let current = request.session(db);
        if (!current) {
          if (Object.keys(db.sessions).length >= config.maxActiveSessions) throw fail(503, 'device_capacity');
          const { secret, publicId } = core.newIdentity();
          current = db.sessions[secret] = { secret, publicId, name, expiresAt: now() + config.sessionTtlMs, cities: {}, actions: {}, ...(body.onboarding === true ? { onboarding: true } : {}) };
        }
        current.name = name;
        current.expiresAt = now() + config.sessionTtlMs;
        return { secret: current.secret, session: publicSession(current) };
      });
      return { body: { session: result.session }, headers: { 'Set-Cookie': core.cookieHeader(request, result.secret) }, after: () => core.refreshNames(result.session) };
    },
    'GET /api/session': async (request) => {
      const session = await store.transact(db => request.session(db, { renew: true }));
      if (!session) throw fail(401, 'device_session_required');
      return { body: { session: publicSession(session) }, renew: true };
    },
    'GET /api/voice-config': async (request) => {
      const session = await store.transact(db => {
        const current = request.requireSession(db, { renew: true });
        const live = core.sockets().some(ws => {
          if (ws.session.id !== current.publicId || !core.isOpen(ws) || !ws.room || ws.expiresAt <= now()) return false;
          const city = ws.room.split(':')[0];
          const state = settle(current, city);
          return canJoinVenue(state, state.location) && ws.room === venueRoomKey(city, state.location, current.publicId);
        });
        if (!live) throw fail(403, 'room_membership_required');
        return current;
      });
      if (!allow(`voice-config:${session.publicId}`, 6)) throw fail(429, 'voice_config_rate_limited');
      let voice = STUN_ONLY_CONFIG;
      if (config.voiceConfigProvider) {
        try { voice = validateVoiceConfig(await config.voiceConfigProvider(publicSession(session)), now()); }
        catch { throw fail(503, 'voice_config_unavailable'); }
      }
      return { body: { ...voice, radius: VOICE_RADIUS }, renew: true };
    },
    'GET /api/life': async (request) => {
      const city = request.query.get('city');
      if (!ctx.cityIds.includes(city)) throw fail(400, 'invalid_city');
      const state = await store.transact(db => settle(request.requireSession(db, { renew: true }), city));
      await core.validateMemberships(request.secret, city, state);
      return { body: { state }, renew: true };
    },
    'POST /api/action': async (request) => {
      const body = await request.json();
      const actionAt = validateActionPayload(body, now(), config.actionWindowMs);
      const outcome = await store.transact(db => {
        const session = request.requireSession(db, { renew: true });
        validateActionPayload(body, now(), config.actionWindowMs);
        pruneReceipts(session.actions, now(), config.actionWindowMs);
        const state = settle(session, body.cityId);
        const fingerprint = actionFingerprint(body);
        const old = readReceipt(session.actions, body);
        if (old) return { ok: old.ok, code: old.code, state, duplicate: true };
        if (Object.keys(session.actions).length >= 10000) throw fail(429, 'action_history_full');
        const result = ctx.act(state, body);
        session.actions[body.actionId] = { actionAt, fingerprint, ok: result.ok, code: result.code };
        return result;
      });
      await core.validateMemberships(request.secret, body.cityId, outcome.state);
      return { body: outcome, renew: true };
    },
  };
}
