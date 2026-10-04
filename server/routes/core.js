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

/**
 * ctx.command — the authenticated, saved, retry-safe boundary for a route that runs ONE game action
 * for the caller (documented in routes/index.js). Everything happens in a single store transaction:
 * the session check, the settlement, the action, the optional `afterAction` step and the receipt.
 * So they are all saved or none is; a repeat of the same action id returns the first outcome
 * ({ ok, code, state, duplicate: true }) without running anything again; the same id with other
 * contents, with other authority or under another scope is 409 action_id_conflict; and an id older
 * than the action window is 409 action_expired, so it can never run after its receipt was dropped.
 * Options come from server code only — never forward them from a request:
 *   internal     true → the action runs with server authority (ctx.act), so server-only types work
 *   scope        a fixed name for the calling route ('civic.queue'); required with afterAction
 *   afterAction  ({ db, session, result }) => void, called once after a SUCCESSFUL action and before
 *                the receipt is written (never on a repeat). For the counterparty or queue write
 *                that belongs to the charge: throw and the charge, the receipt and every other change
 *                are discarded together. It must be synchronous and must not send anything.
 */
export async function executeCommand(ctx, request, body, { internal = false, scope, afterAction } = {}) {
  const { store, now, settle, core, config } = ctx;
  if (scope !== undefined && (typeof scope !== 'string' || !/^[a-z][a-z0-9_.-]{0,63}$/.test(scope))) throw new Error('A command scope is a fixed server string');
  if (afterAction !== undefined && (typeof afterAction !== 'function' || scope === undefined)) throw new Error('A command callback requires a fixed server scope');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw ctx.fail(400, 'invalid_action');
  validateActionPayload(body, now(), config.actionWindowMs);
  const authority = `${scope ? `scope:${scope}:` : ''}${internal === true ? 'internal:' : ''}`;
  const { outcome, publicId } = await store.transact(db => {
    const session = request.requireSession(db, { renew: true });
    validateActionPayload(body, now(), config.actionWindowMs);
    ctx.checks?.cityGate?.(session, body.cityId);
    const state = settle(session, body.cityId);
    const result = core.actionOnce(session, body, () => {
      const done = internal === true ? ctx.act(state, body) : core.playerAct(state, body);
      if (done.ok && afterAction) {
        const pending = afterAction({ db, session, result: done });
        if (pending && typeof pending.then === 'function') throw new Error('A command callback must be synchronous');
      }
      return done;
    }, { authority });
    return { publicId: session.publicId, outcome: result.duplicate ? { ok: result.ok, code: result.code, state, duplicate: true } : result };
  });
  await core.validateMemberships(request.secret, body.cityId, outcome.state, publicId);
  return outcome;
}

export default function coreRoutes(ctx) {
  const { store, now, fail, allow, settle, core, config } = ctx;
  /** For a request that only reads: when the renewal could not be saved, answer from the stored data instead. */
  const unsaved = (fallback) => (error) => { if (error?.code !== 'storage_unavailable') throw error; return fallback(); };
  /**
   * The caller's OWN session as the session routes answer it: the public identity plus `cities`,
   * the ids of the cities this session has a life in — so a returning player is recognised on any
   * device (the country map offers a "coming soon" city only to someone who already lives there).
   * It is about the caller only and goes to the caller only: publicSession() — what sockets, chat
   * and every other player see — is unchanged and never carries it.
   */
  const ownSession = (session) => ({ ...publicSession(session), cities: ctx.cityIds.filter(id => Boolean(session.cities?.[id]?.state)) });
  return {
    // Which build is serving, for a local preview or a deploy check. No session is read or created.
    'GET /api/health': () => ({ body: { ok: true, build: config.buildId } }),
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
        if (mute) return { secret: current.secret, session: publicSession(current), own: ownSession(current), mute, refused: current.name !== name };
        current.name = name;
        return { secret: current.secret, session: publicSession(current), own: ownSession(current) };
      });
      if (result.refused) throw Object.assign(fail(403, 'muted'), { reason: result.mute.reason });
      return { body: { session: result.own }, headers: { 'Set-Cookie': core.cookieHeader(request, result.secret) }, ...(result.mute ? {} : { after: () => core.refreshNames(result.session) }) };
    },
    'GET /api/session': async (request) => {
      let renewed = true;
      const session = await store.transact(db => request.session(db, { renew: true }))
        .catch(unsaved(() => { renewed = false; return store.read(db => request.session(db)); }));
      if (!session) throw fail(401, 'device_session_required');
      return { body: { session: ownSession(session) }, renew: renewed };
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
      const { state, publicId } = await store.transact(db => {
        const session = request.requireSession(db, { renew: true });
        // A character that travelled to another city has no life left in this one (server/world/service.js).
        ctx.checks?.cityGate?.(session, city);
        const before = outcomeKey(session.cities?.[city]?.state);
        const state = settle(session, city);
        return { state, publicId: session.publicId, material: before !== outcomeKey(state) };
      }, { durable: result => result.material, waitForObserved: true });
      // The settlement is saved: rooms are told with the state it produced. When it could not be saved
      // (or the request was refused) the route host re-checks the rooms against the stored life instead
      // — core.revalidate(publicId), after every API request (server.js).
      await core.validateMemberships(request.secret, city, state, publicId);
      return { body: { state }, renew: true };
    },
    'POST /api/action': async (request) => {
      const body = await request.json();
      validateActionPayload(body, now(), config.actionWindowMs);
      // A player's own request: no server authority, no scope (see executeCommand above). Once it is
      // saved the rooms are told with the state it produced (a repeat is checked like a first answer).
      // A rejected or unsaved action changed nothing: the route host then re-checks the rooms against
      // the stored life (core.revalidate, server.js).
      return { body: await executeCommand(ctx, request, body), renew: true };
    },
  };
}
