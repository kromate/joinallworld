import { normalizeCharacter, swapLegacyLife, legacyLifeCity } from '../character.ts';
/**
 * OWNER: foundation
 * Core routes: device session, life, action and voice configuration. Behaviour is unchanged
 * from the pre-registry server except that POST /api/action also accepts `payload`, and that
 * POST /api/session accepts `onboarding: true` when it CREATES a session: lives of that session
 * start as guests of the quick start — held until their look is confirmed (one action), then
 * playing in public venues until they settle in (see life-service.js settleCity). The field is
 * ignored for an existing session, so a rename can neither add nor remove the rule.
 * A name must pass the text filter (protocol.js validateName → 400 name_not_allowed with a reason).
 * A player an operator has muted cannot rename (403 muted with the reason), and sending the same
 * name again renews the session without writing or re-announcing the name.
 * POST /api/action runs the action through core.playerAct, without the `internal` flag that
 * ctx.act carries, so a server-only action type (src/game/registry.ts) is always refused here.
 */
import type { LifeState } from '../../src/types/life.ts';
import type { ActionRequest, CityId, IceServerConfig, PublicSession } from '../../src/types/protocol.ts';
import type { ActionOutcome, CommandOptions, Db, MuteVerdict, RouteContext, RouteHandler, RouteKey, RouteRequest, SessionRecord } from '../types.ts';
import { hasAction } from '../../src/game/registry.ts';
import { validateName, validateActionPayload, publicSession, isSharedAddress, VOICE_RADIUS, STUN_ONLY_CONFIG, validateVoiceConfig } from '../protocol.ts';
import { companionConfig } from '../companion/gateway.ts';
import { MAX_RECEIPTS, boundedFingerprint } from './once.ts';
import { residenceGate } from './residence.ts';

// The receipt steps themselves live in ./once.js (core.actionOnce), shared with ctx.act.
export { MAX_RECEIPTS, boundedFingerprint };

/**
 * What a player would call an outcome of a settlement. Compared before and after a poll (see GET
 * /api/life): if it changed, the poll is saved before it is answered. Besides money, place and the
 * running action it covers what a settlement can decide by chance or by the clock — falling ill or
 * recovering, a roadside event waiting for an answer, skills, goal progress and stars — so nothing
 * of that kind is shown from a settlement that a crash could compute differently.
 */
export const outcomeKey = (state: LifeState | null | undefined): string => (state ? JSON.stringify([state.cash, state.ledger?.length ?? 0, state.ledger?.at(-1)?.at ?? 0, state.location, state.activeAction?.kind ?? null,
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
export async function executeCommand(ctx: RouteContext, request: RouteRequest, body: ActionRequest, { internal = false, scope, afterAction }: CommandOptions = {}, withRevision = false): Promise<ActionOutcome> {
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
      residenceGate(ctx, session, body);
      const done = internal === true ? ctx.act(state, body) : core.playerAct(state, body);
      if (done.ok && afterAction) {
        const pending: unknown = afterAction({ db, session, result: done });
        if (isThenable(pending)) throw new Error('A command callback must be synchronous');
      }
      return done;
    }, { authority });
    const outcome: ActionOutcome = result.duplicate ? { ok: result.ok, code: result.code, state, duplicate: true as const } : result;
    // POST /api/action answers with the character's revision, so a device can order this answer among its others.
    return { publicId: session.publicId, outcome: withRevision ? { ...outcome, rev: session.rev ?? 0 } : outcome };
  });
  await core.validateMemberships(request.secret, body.cityId, outcome.state, publicId);
  return outcome;
}

const isThenable = (value: unknown): boolean => (typeof value === 'object' || typeof value === 'function') && value !== null && typeof Reflect.get(value, 'then') === 'function';
const errorCode = (error: unknown): unknown => (typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined);
/** The body of POST /api/action once validateActionPayload has accepted its envelope (cityId, a registered type, a timed action id, a plain-object payload). */
function isActionRequest(body: Record<string, unknown>): body is Record<string, unknown> & ActionRequest {
  return typeof body.actionId === 'string' && /^\d+:./.test(body.actionId) && typeof body.cityId === 'string' && hasAction(body.type)
    && (body.payload === undefined || (typeof body.payload === 'object' && body.payload !== null && !Array.isArray(body.payload)));
}
type VoiceBody = { readonly iceServers: readonly IceServerConfig[]; readonly turnConfigured: boolean; readonly mode: string; readonly expiresAt?: number };

export default function coreRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const { store, now, fail, allow, settle, core, config } = ctx;
  /** For a request that only reads: when the renewal could not be saved, answer from the stored data instead. */
  const isCityId = (value: unknown): value is CityId => ctx.cityIds.some(id => id === value);
  const unsaved = <T>(fallback: () => T | Promise<T>) => (error: unknown): T | Promise<T> => { if (errorCode(error) !== 'storage_unavailable') throw error; return fallback(); };
  /**
   * The caller's OWN session as the session routes answer it: the public identity plus `cities`,
   * the ids of the cities this session has a life in — so a returning player is recognised on any
   * device (the country map offers a "coming soon" city only to someone who already lives there).
   * It is about the caller only and goes to the caller only: publicSession() — what sockets, chat
   * and every other player see — is unchanged and never carries it.
   */
  const ownSession = (session: SessionRecord): PublicSession & { cities: CityId[] } => ({ ...publicSession(session), cities: ctx.cityIds.filter(id => Boolean(session.cities?.[id]?.state)) });
  return {
    // Which build is serving, for a local preview or a deploy check. No session is read or created. `relay`: the call relay is configured; `companionAi`: the hosted companion is configured (booleans only; nothing of any key).
    'GET /api/health': () => ({ body: { ok: true, build: config.buildId, relay: ctx.callRelay?.configured === true, companionAi: companionConfig((name) => ctx.env(name)) !== null } }),
    'POST /api/session': async (request) => {
      type Answer = { secret: string; session: PublicSession; own: PublicSession & { cities: CityId[] }; mute?: MuteVerdict; refused?: boolean };
      // The cookie to send back. A character that belongs to an account is filed under a key no browser may hold: its
      // browser keeps the cookie it presented (its device binding). Every other session's cookie is its record's key.
      const cookieOf = (session: SessionRecord): string => (session.account !== undefined && request.cookie ? request.cookie : session.secret);
      const body = await request.json();
      const name = validateName(body.name);
      const result = await store.transact((db): Answer => {
        let current = request.session(db), created = false;
        // Sessions that have run out are archived here. A host on which looking for them costs something is told whether
        // a session is about to be made (it then looks at once, so the places counted below are live ones) or the caller
        // already has one (it then looks now and then: renaming must not be a way to make the host search).
        for (const secret of core.expiredSessionKeys(db, !current)) { const stale = db.sessions[secret]; if (stale) core.archiveSession(db, secret, stale); }
        if (!current) {
          // A NEW SESSION COSTS ITS MAKER NOTHING and takes one of the places every player shares, for as long as a session
          // lasts. One network address may make config.newSessionsPerAddress an hour; an address many people are behind without the
          // server being able to tell them apart (a proxy without TRUST_PROXY, a LAN) is not counted. A visitor who is turned
          // away is told why and when to come back: the address may be a whole campus or a mobile network, not one person.
          if (!isSharedAddress(request.ip) && !allow(`session:new:${request.ip}`, config.newSessionsPerAddress, 3600000)) {
            const seconds = Math.min(3600, Math.max(60, Math.ceil((ctx.retryIn?.(`session:new:${request.ip}`) || 3600000) / 1000)));
            throw Object.assign(fail(429, 'rate_limited'), { retryAfter: seconds,
              reason: `Too many new players have started from your network in the last hour (a shared Wi-Fi or mobile network counts as one). Nothing is lost: try again in about ${Math.ceil(seconds / 60)} minute${seconds > 60 ? 's' : ''}.` });
          }
          // EVERY PLACE IS TAKEN: the visitor is asked to wait (the page says so and tries again). Nobody who has a session is affected.
          if (Object.keys(db.sessions).length >= config.maxActiveSessions) throw Object.assign(fail(503, 'device_capacity'), { retryAfter: 30, reason: 'The world is full right now. Your place is not lost: try again in a moment.' });
          const { secret, publicId } = core.newIdentity();
          current = db.sessions[secret] = { secret, publicId, name, expiresAt: now() + config.sessionTtlMs, cities: {}, actions: {}, ...(body.onboarding === true ? { onboarding: true as const } : {}) };
          // A browser signed in to an account that has no character yet: this new session is that character (server/accounts/service.ts).
          // (If that account's own character came back from the archive instead, the caller is an existing player: `created` stays false.)
          const fresh = current.publicId;
          current = ctx.checks?.adoptSession?.(db, request.binding, current) ?? current;
          created = current.publicId === fresh;
        }
        current.expiresAt = now() + config.sessionTtlMs;
        // A muted player keeps their session — it is renewed here like any other — but cannot put a
        // name in front of other players: a different name is refused, and the SAME name is not
        // written or announced again either.
        const mute = created ? null : ctx.checks?.muted?.(current.publicId) ?? null;
        if (mute) return { secret: cookieOf(current), session: publicSession(current), own: ownSession(current), mute, refused: current.name !== name };
        current.name = name;
        return { secret: cookieOf(current), session: publicSession(current), own: ownSession(current) };
      });
      if (result.refused && result.mute) throw Object.assign(fail(403, 'muted'), { reason: result.mute.reason });
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
      const check = (renew: boolean) => (db: Db): SessionRecord => {
        const current = request.requireSession(db, { renew });
        const live = core.sockets().some(ws => {
          if (ws.session.id !== current.publicId || !core.isOpen(ws) || !ws.room || ws.expiresAt <= now()) return false;
          const city = ws.room.split(':')[0];
          if (!isCityId(city)) return false;
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
      let voice: VoiceBody = STUN_ONLY_CONFIG;
      if (config.voiceConfigProvider) {
        try { voice = validateVoiceConfig(await config.voiceConfigProvider(publicSession(session)), now()); }
        catch { throw fail(503, 'voice_config_unavailable'); }
      }
      return { body: { ...voice, radius: VOICE_RADIUS }, renew: renewed };
    },
    'GET /api/characters': async (request) => ({ body: await store.transact(db => {
      const session = request.requireSession(db);
      normalizeCharacter(session);
      return { active: session.character?.city ?? null, legacy: Object.entries(session.legacyLives ?? {}).map(([id, entry]) => ({ id, city: legacyLifeCity(session, id, entry), cash: entry.state.cash, updatedAt: entry.updatedAt })) };
    }) }),
    'POST /api/characters/switch': async (request) => {
      const body = await request.json();
      if (typeof body.id !== 'string') throw fail(400, 'invalid_character');
      const id = body.id;
      return { body: await store.transact(db => {
        const session = request.requireSession(db, { renew: true });
        return ctx.once(db, session, { id: body.clientId, kind: 'character.switch', fingerprint: { id } }, () => {
          const swapped = swapLegacyLife(session, id);
          // Another life is in play: a later answer than any before it, and the character's other devices are told.
          session.rev = (session.rev ?? 0) + 1;
          core.lifeChanged?.(session.publicId, session.rev);
          return swapped;
        });
      }), renew: true };
    },
    'GET /api/life': async (request) => {
      const city = request.query.get('city');
      if (!isCityId(city)) throw fail(400, 'invalid_city');
      // A quiet poll acknowledges nothing — it only moves the clock — so it does not wait for its own
      // write (store.js, lazy transactions). A poll whose settlement produced an outcome (see
      // outcomeKey) is in the data file before it is answered, exactly like an action. Either way the
      // poll waits for other requests' unsaved outcomes it may have seen (waitForObserved), so it
      // never shows a player something that a failed write then takes back.
      const { state, publicId, rev } = await store.transact(db => {
        const session = request.requireSession(db, { renew: true });
        // A character that travelled to another city has no life left in this one (server/world/service.ts).
        ctx.checks?.cityGate?.(session, city);
        const before = outcomeKey(session.cities?.[city]?.state);
        const filing = JSON.stringify([session.character, Object.keys(session.cities), Object.keys(session.legacyLives ?? {})]);
        const state = settle(session, city);
        return { state, publicId: session.publicId, rev: session.rev ?? 0, material: before !== outcomeKey(state) || filing !== JSON.stringify([session.character, Object.keys(session.cities), Object.keys(session.legacyLives ?? {})]) };
      }, { durable: result => result.material, waitForObserved: true });
      // The settlement is saved: rooms are told with the state it produced. When it could not be saved
      // (or the request was refused) the route host re-checks the rooms against the stored life instead
      // — core.revalidate(publicId), after every API request (server.js).
      await core.validateMemberships(request.secret, city, state, publicId);
      return { body: { state, rev }, renew: true };
    },
    'POST /api/action': async (request) => {
      const body = await request.json();
      validateActionPayload(body, now(), config.actionWindowMs);
      if (!isActionRequest(body)) throw fail(400, 'invalid_action');
      // A player's own request: no server authority, no scope (see executeCommand above). Once it is
      // saved the rooms are told with the state it produced (a repeat is checked like a first answer).
      // A rejected or unsaved action changed nothing: the route host then re-checks the rooms against
      // the stored life (core.revalidate, server.js).
      return { body: await executeCommand(ctx, request, body, {}, true), renew: true };
    },
  };
}
