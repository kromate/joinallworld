// Portable settlement logic shared by the Node server and the Cloudflare worker (no I/O).
import { createLife, advanceLife, dispatch, hasAction, VENUES } from '../src/life.js';

export { VENUES };

/**
 * THE PER-LIFE SECRET SALT
 * Every random outcome in the rules engine comes from a generator seeded with something the
 * client knows — the action ID it chose, or the times of a settlement. On its own that lets a
 * client run the same pure code and pick an action ID whose roll it likes. So each life (one per
 * session per city) has a salt:
 *   - created here, on the server, from the platform's cryptographic random source, the first
 *     time the life is settled (a life stored before salts existed gets one at its next settle);
 *   - stored beside the life (`session.cities[cityId].salt`), never inside the state, so it is
 *     persisted and survives every load, and nothing that sends a state can send it;
 *   - mixed into every seed: creation, every settlement and every action (keyedSeed in
 *     src/game/util.js). The engine's context does not carry it, so no system can leak it.
 * A replay of the same action ID on the same life still rolls the same dice.
 * A state that was NOT settled here has no salt; applyLifeAction then rolls from the platform's
 * random source instead (never from the action ID alone), unless the caller passes its own `rng`.
 *
 * Both hosts get this from settleCity/applyLifeAction without any code of their own. The link
 * from a settled state to its salt is held in memory only (a WeakMap keyed by the state object
 * settleCity returned), so applyLifeAction must be given that same object — which is what both
 * hosts already do.
 */
const SALT_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const serverRandom = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000;
const lives = new WeakMap(); // settled state → { salt, publicId, cityId }

function randomSalt() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  let text = '';
  for (const byte of bytes) text += byte.toString(16).padStart(2, '0');
  return text;
}
let saltSource = randomSalt;
/**
 * TEST-ONLY. Replace where NEW salts come from (an in-process test or script that needs a
 * reproducible roll), or pass nothing to restore the random source. It is not reachable from any
 * request: nothing in server/, deploy/ or src/ calls it (asserted in server/salt.test.js), it
 * cannot change the salt of a life that already has one, and it refuses to run in production.
 */
export function useSaltSourceForTests(source) {
  if (globalThis.process?.env?.NODE_ENV === 'production') throw new Error('useSaltSourceForTests is not available in production');
  saltSource = typeof source === 'function' ? source : randomSalt;
}
function newSalt() {
  const salt = saltSource();
  if (typeof salt !== 'string' || !SALT_PATTERN.test(salt)) throw new Error('Invalid life salt');
  return salt;
}

// ---- watching lives ---------------------------------------------------------------------------
// A host that keeps something in memory about where a player is (the Node room module) is told,
// synchronously, every time a life has been settled or acted on, with the state as it now stands
// inside the caller's transaction. It is a hint to re-check stored state, not the truth: the
// transaction may still be discarded. Watchers are held weakly, so a server that is gone stops
// being called without having to unregister.
const watchers = new Set();
/** watchLives(fn(publicId, cityId, state)). Keep a reference to `fn` for as long as it should be called. */
export function watchLives(fn) {
  if (typeof fn !== 'function') throw new Error('watchLives needs a function');
  watchers.add(new WeakRef(fn));
}
function announce(meta, state) {
  if (!watchers.size || typeof meta?.publicId !== 'string') return;
  for (const ref of watchers) {
    const fn = ref.deref();
    if (!fn) { watchers.delete(ref); continue; }
    try { fn(meta.publicId, meta.cityId, state); } catch { /* a watcher can never break a settlement */ }
  }
}

/**
 * Bring one city's life up to `now` and return it. Creates the life on first use, re-validates
 * the stored state (migrating older saves), then settles the elapsed server time: the timed
 * action progresses and every system's background advance runs.
 *
 * A life created for a session whose record carries `onboarding: true` starts as a GUEST of the
 * quick start (src/game/systems/onboarding.js, THE STAGED MODEL): it must confirm its look before
 * any other action is accepted (state.onboarding.required — seconds, one action), then plays in
 * public venues and settles in when the player chooses. The flag is set only by the host when the
 * session is created; a session without it — every session made before the flag existed, and
 * every session the Cloudflare worker makes — behaves as before.
 */
export function settleCity(session, cityId, now) {
  session.cities ||= {};
  let entry = session.cities[cityId];
  if (!entry) {
    const salt = newSalt();
    entry = session.cities[cityId] = { state: createLife({ name: session.name }, { now, cityId, isNew: true, quickStart: session.onboarding === true, salt }), updatedAt: now, salt };
  }
  if (typeof entry.salt !== 'string' || !SALT_PATTERN.test(entry.salt)) entry.salt = newSalt();
  const { salt } = entry;
  // trustedSave: this is the server's own stored copy, so an action that can no longer run is settled here (src/life.js createLife).
  entry.state = createLife(entry.state, { now, cityId, isNew: false, salt, trustedSave: true });
  const elapsed = Number.isFinite(entry.updatedAt) ? Math.max(0, (now - entry.updatedAt) / 1000) : 0;
  if (elapsed > 0) advanceLife(entry.state, elapsed, { now, cityId, salt });
  entry.state.t = now;
  entry.updatedAt = now;
  entry.state.name = session.name;
  const meta = { salt, publicId: session.publicId, cityId };
  lives.set(entry.state, meta);
  announce(meta, entry.state);
  return entry.state;
}

/**
 * Apply a validated action body to a settled state. The context defaults to the state's own
 * settlement time. For a state that came from settleCity (both hosts) the generator is seeded
 * from the action ID keyed with that life's salt, whatever context the caller passes; a caller
 * cannot supply a salt of its own, and a replay of one action ID rolls the same dice. For any
 * other state the generator is the caller's `ctx.rng`, or the platform's random source.
 */
export function applyLifeAction(state, body, ctx) {
  if (!hasAction(body?.type)) throw new Error('Invalid action type');
  const meta = lives.get(state);
  const given = ctx ?? { now: state.t, cityId: body.cityId, actionId: body.actionId };
  let context = given;
  // A state that did not come from settleCity has no salt (a direct call from a test or a script;
  // neither host does this). It must still never roll from the client-chosen action ID alone: unless
  // the caller hands in its own generator, the roll comes from the platform's random source.
  if (!meta && typeof given.rng !== 'function') context = { ...given, rng: serverRandom };
  if (meta) {
    // The generator is always built here, from the action ID and the life's salt: neither a salt
    // nor a ready-made generator from the caller is used for a stored life.
    const { salt: ignoredSalt, rng: ignoredRng, ...rest } = given;
    context = { ...rest, salt: meta.salt };
  }
  const result = dispatch(state, body, context);
  if (meta) announce(meta, state);
  return result;
}
