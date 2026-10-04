/**
 * OWNER: foundation
 * Core routes: device session, life, action and voice configuration. Behaviour is unchanged
 * from the pre-registry server except that POST /api/action also accepts `payload`, and that
 * POST /api/session accepts `onboarding: true` when it CREATES a session: lives of that session
 * must finish character creation before any other action (see life-service.js settleCity). The
 * field is ignored for an existing session, so a rename can neither add nor remove the rule.
 * A name must pass the text filter (protocol.js validateName → 400 name_not_allowed with a reason),
 * and a player an operator has muted cannot rename (403 muted with the reason).
 * POST /api/action runs the action through core.playerAct, without the `internal` flag that
 * ctx.act carries, so a server-only action type (src/game/registry.js) is always refused here.
 */
import { validateName, validateActionPayload, publicSession, actionFingerprint, pruneReceipts, hash53, VOICE_RADIUS, STUN_ONLY_CONFIG, validateVoiceConfig } from '../protocol.js';

/** Receipts kept per session inside the 24-hour action window; a full history answers 429 until old ones expire. */
export const MAX_RECEIPTS = 10000;
const FINGERPRINT_MAX = 96;
/**
 * The identity stored with a receipt. A payload may be 2 KB, and 10,000 receipts of that size
 * would be 20 MB for one session, so a long fingerprint is stored as its head, its length and a
 * hash. A reused action id with different contents is still refused; the worst a hash collision
 * can do is return the first outcome again, which changes nothing.
 */
export const boundedFingerprint = (text) => (text.length <= FINGERPRINT_MAX ? text : `${text.slice(0, 48)}#${text.length}#${hash53(text)}`);

/** What a player would call an outcome of a settlement. Compared before and after a poll (see GET /api/life). */
export const outcomeKey = (state) => (state ? JSON.stringify([state.cash, state.ledger?.length ?? 0, state.ledger?.at(-1)?.at ?? 0, state.location, state.activeAction?.kind ?? null,
  state.activeAction?.id ?? null, state.inventory ?? null, state.job ?? null, state.completedShifts ?? 0, state.message ?? '']) : 'none');

export default function coreRoutes(ctx) {
  const { store, now, fail, allow, settle, core, config } = ctx;
  return {
    'POST /api/session': async (request) => {
      const body = await request.json();
      const name = validateName(body.name);
      const result = await store.transact(db => {
        for (const secret of core.expiredSessionKeys(db)) core.archiveSession(db, secret, db.sessions[secret]);
        let current = request.session(db);
        if (!current) {
          if (Object.keys(db.sessions).length >= config.maxActiveSessions) throw fail(503, 'device_capacity');
          const { secret, publicId } = core.newIdentity();
          current = db.sessions[secret] = { secret, publicId, name, expiresAt: now() + config.sessionTtlMs, cities: {}, actions: {}, ...(body.onboarding === true ? { onboarding: true } : {}) };
        }
        // A muted player cannot put text in front of others by renaming either. The session itself is renewed as usual.
        const mute = current.name !== name ? ctx.checks?.muted?.(current.publicId) : null;
        if (mute) throw Object.assign(fail(403, 'muted'), { reason: mute.reason });
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
          // The player's own venue room, or a host's Home room they are still a guest of.
          return core.roomStillValid(ws, db, current, city, state);
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
      // A quiet poll acknowledges nothing — it only moves the clock — so it does not wait for the
      // disk (store.js, lazy transactions). A poll whose settlement produced an outcome (cash moved,
      // the timed action ended, the player arrived somewhere, an item appeared) is durable before it
      // is answered, exactly like an action: a crash can never take back something a player was shown.
      const { state, publicId } = await store.transact(db => {
        const session = request.requireSession(db, { renew: true });
        const before = outcomeKey(session.cities?.[city]?.state);
        const state = settle(session, city);
        return { state, publicId: session.publicId, material: before !== outcomeKey(state) };
      }, { durable: result => result.material });
      await core.validateMemberships(request.secret, city, state, publicId);
      return { body: { state }, renew: true };
    },
    'POST /api/action': async (request) => {
      const body = await request.json();
      const actionAt = validateActionPayload(body, now(), config.actionWindowMs);
      let publicId;
      const outcome = await store.transact(db => {
        const session = request.requireSession(db, { renew: true });
        publicId = session.publicId;
        validateActionPayload(body, now(), config.actionWindowMs);
        pruneReceipts(session.actions, now(), config.actionWindowMs);
        const state = settle(session, body.cityId);
        const fingerprint = boundedFingerprint(actionFingerprint(body));
        const old = session.actions[body.actionId];
        // A receipt written before fingerprints were bounded holds the full text; accept either form.
        if (old && old.fingerprint !== fingerprint && old.fingerprint !== actionFingerprint(body)) throw fail(409, 'action_id_conflict');
        if (old) return { ok: old.ok, code: old.code, state, duplicate: true };
        if (Object.keys(session.actions).length >= MAX_RECEIPTS) throw fail(429, 'action_history_full');
        const result = core.playerAct(state, body); // never ctx.act: a player's request carries no server authority
        // `type` is kept so a problem report can list the player's last actions with their results.
        session.actions[body.actionId] = { actionAt, fingerprint, ok: result.ok, code: result.code, type: body.type };
        return result;
      });
      await core.validateMemberships(request.secret, body.cityId, outcome.state, publicId);
      return { body: outcome, renew: true };
    },
  };
}
