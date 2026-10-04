/**
 * OWNER: foundation
 * Core routes: device session, life, action and voice configuration. Behaviour is unchanged
 * from the pre-registry server except that POST /api/action also accepts `payload`, and that
 * POST /api/session accepts `onboarding: true` when it CREATES a session: lives of that session
 * must finish character creation before any other action (see life-service.js settleCity). The
 * field is ignored for an existing session, so a rename can neither add nor remove the rule.
 * A name must pass the text filter (protocol.js validateName → 400 name_not_allowed with a reason).
 * A player an operator has muted cannot rename (403 muted with the reason), and sending the same
 * name again renews the session without writing or re-announcing the name.
 * POST /api/action runs the action through core.playerAct, without the `internal` flag that
 * ctx.act carries, so a server-only action type (src/game/registry.js) is always refused here.
 */
import { validateName, validateActionPayload, publicSession, VOICE_RADIUS, STUN_ONLY_CONFIG, validateVoiceConfig } from '../protocol.js';
import { MAX_RECEIPTS, boundedFingerprint } from './once.js';

// The receipt steps themselves live in ./once.js (core.actionOnce), shared with ctx.act.
export { MAX_RECEIPTS, boundedFingerprint };

/**
 * What a player would call an outcome of a settlement. Compared before and after a poll (see GET
 * /api/life): if it changed, the poll is saved before it is answered. Besides money, place and the
 * running action it covers what a settlement can decide by chance or by the clock — falling ill or
 * recovering, a roadside event waiting for an answer, skills, goal progress and stars — so nothing
 * of that kind is shown from a settlement that a crash could compute differently.
 */
export const outcomeKey = (state) => (state ? JSON.stringify([state.cash, state.ledger?.length ?? 0, state.ledger?.at(-1)?.at ?? 0, state.location, state.activeAction?.kind ?? null,
  state.activeAction?.id ?? null, state.inventory ?? null, state.job ?? null, state.completedShifts ?? 0, state.message ?? '',
  state.health?.sick ?? false, state.health?.cause ?? null, state.travel?.event ?? null, state.skills ?? null,
  state.goals?.chain ?? 0, state.goals?.stars ?? 0, state.goals?.granted ?? 0, state.goals?.dreamDone ?? false]) : 'none');

export default function coreRoutes(ctx) {
  const { store, now, fail, allow, settle, core, config } = ctx;
  /** For a request that only reads: when the renewal could not be saved, answer from the stored data instead. */
  const unsaved = (fallback) => (error) => { if (error?.code !== 'storage_unavailable') throw error; return fallback(); };
  return {
    'POST /api/session': async (request) => {
      const body = await request.json();
      const name = validateName(body.name);
      const result = await store.transact(db => {
        for (const secret of core.expiredSessionKeys(db)) core.archiveSession(db, secret, db.sessions[secret]);
        let current = request.session(db), created = false;
        if (!current) {
          if (Object.keys(db.sessions).length >= config.maxActiveSessions) throw fail(503, 'device_capacity');
          const { secret, publicId } = core.newIdentity();
          current = db.sessions[secret] = { secret, publicId, name, expiresAt: now() + config.sessionTtlMs, cities: {}, actions: {}, ...(body.onboarding === true ? { onboarding: true } : {}) };
          created = true;
        }
        current.expiresAt = now() + config.sessionTtlMs;
        // A muted player keeps their session — it is renewed here like any other — but cannot put a
        // name in front of other players: a different name is refused, and the SAME name is not
        // written or announced again either.
        const mute = created ? null : ctx.checks?.muted?.(current.publicId) ?? null;
        if (mute) return { secret: current.secret, session: publicSession(current), mute, refused: current.name !== name };
        current.name = name;
        return { secret: current.secret, session: publicSession(current) };
      });
      if (result.refused) throw Object.assign(fail(403, 'muted'), { reason: result.mute.reason });
      return { body: { session: result.session }, headers: { 'Set-Cookie': core.cookieHeader(request, result.secret) }, ...(result.mute ? {} : { after: () => core.refreshNames(result.session) }) };
    },
    'GET /api/session': async (request) => {
      let renewed = true;
      const session = await store.transact(db => request.session(db, { renew: true }))
        .catch(unsaved(() => { renewed = false; return store.read(db => request.session(db)); }));
      if (!session) throw fail(401, 'device_session_required');
      return { body: { session: publicSession(session) }, renew: renewed };
    },
    'GET /api/voice-config': async (request) => {
      const check = (renew) => (db) => {
        const current = request.requireSession(db, { renew });
        const live = core.sockets().some(ws => {
          if (ws.session.id !== current.publicId || !core.isOpen(ws) || !ws.room || ws.expiresAt <= now()) return false;
          const city = ws.room.split(':')[0];
          const state = settle(current, city);
          // The player's own venue room, or a host's Home room they are still a guest of.
          return core.roomStillValid(ws, db, current, city, state);
        });
        if (!live) throw fail(403, 'room_membership_required');
        return current;
      };
      let renewed = true;
      const session = await store.transact(check(true)).catch(unsaved(() => { renewed = false; return store.read(check(false)); }));
      if (!allow(`voice-config:${session.publicId}`, 6)) throw fail(429, 'voice_config_rate_limited');
      let voice = STUN_ONLY_CONFIG;
      if (config.voiceConfigProvider) {
        try { voice = validateVoiceConfig(await config.voiceConfigProvider(publicSession(session)), now()); }
        catch { throw fail(503, 'voice_config_unavailable'); }
      }
      return { body: { ...voice, radius: VOICE_RADIUS }, renew: renewed };
    },
    'GET /api/life': async (request) => {
      const city = request.query.get('city');
      if (!ctx.cityIds.includes(city)) throw fail(400, 'invalid_city');
      // A quiet poll acknowledges nothing — it only moves the clock — so it does not wait for its own
      // write (store.js, lazy transactions). A poll whose settlement produced an outcome (see
      // outcomeKey) is in the data file before it is answered, exactly like an action. Either way the
      // poll waits for other requests' unsaved outcomes it may have seen (waitForObserved), so it
      // never shows a player something that a failed write then takes back.
      let known = null;
      try {
        const { state, publicId } = await store.transact(db => {
          const session = request.requireSession(db, { renew: true });
          const before = outcomeKey(session.cities?.[city]?.state);
          const state = settle(session, city);
          return { state, publicId: session.publicId, material: before !== outcomeKey(state) };
        }, { durable: result => result.material, waitForObserved: true });
        known = { city, state, publicId };
        return { body: { state }, renew: true };
      } finally {
        // ROOM REVALIDATION SEAM (see core.revalidate in server.js): always, also when the settlement
        // could not be saved — the rooms are then checked against the stored life.
        await core.revalidate(request.secret, known);
      }
    },
    'POST /api/action': async (request) => {
      const body = await request.json();
      validateActionPayload(body, now(), config.actionWindowMs);
      let known = null;
      try {
        const { outcome, publicId } = await store.transact(db => {
          const session = request.requireSession(db, { renew: true });
          validateActionPayload(body, now(), config.actionWindowMs);
          const state = settle(session, body.cityId);
          // never ctx.act: a player's request carries no server authority
          const result = core.actionOnce(session, body, () => core.playerAct(state, body));
          return { publicId: session.publicId, outcome: result.duplicate ? { ok: result.ok, code: result.code, state, duplicate: true } : result };
        });
        known = { city: body.cityId, state: outcome.state, publicId };
        return { body: outcome, renew: true };
      } finally {
        // ROOM REVALIDATION SEAM: always. A rejected action changed nothing, so the stored life is
        // what the rooms are checked against; a repeat (duplicate) is checked like a first answer.
        await core.revalidate(request.secret, known);
      }
    },
  };
}
