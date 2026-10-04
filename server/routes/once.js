/**
 * OWNER: foundation
 * EXACTLY-ONCE RECEIPTS — the one helper behind every retry-safe write.
 * Not a route module (it is not registered in routes/index.js): the host builds it once and hands
 * it to route and service modules as ctx.once / ctx.onceId, and uses it itself for ctx.act and
 * POST /api/action.
 *
 * WHAT IT GUARANTEES, and what it does not
 *   ctx.once(db, session, { id, kind, fingerprint }, run) calls run() at most once for one
 *   (player, id). The receipt is written to the player's own session record inside the caller's
 *   store transaction, so the receipt and everything run() changed are saved together or not at
 *   all (server/store.js), and a receipt the caller was told about is in the data file: it
 *   survives a restart.
 *     - The id is MANDATORY and has the action-id form `<unix ms>:<uuid>`. Missing → 400
 *       client_id_required; malformed → 400 invalid_client_id.
 *     - The id carries its own time. An id older than the window (24 h, the action window) or more
 *       than 30 s ahead of the server clock is refused with 409 client_id_expired — it is never
 *       run. That is what makes it safe to drop a receipt once its window has passed: the id it
 *       answered for can no longer be accepted. (A client stamps ids with server time; a client
 *       whose clock is off by a day cannot use these routes, exactly as with actions.)
 *     - The same id with a different `kind` or `fingerprint` → 409 client_id_conflict.
 *     - The same id again → the stored result plus `duplicate: true`; run() is not called.
 *     - An unexpired receipt is NEVER evicted. A player holding `perPlayer` unexpired receipts gets
 *       429 receipt_quota, and when `global` unexpired receipts exist on the server everyone gets
 *       503 receipts_full — in both cases BEFORE run(), so nothing is charged, with a reason that
 *       says to try again later.
 *     - Only an outcome that happened is recorded. If run() returns { ok: false } it changed
 *       nothing (that is the convention for a refusal), so no receipt is kept and the same id may
 *       be tried again. If run() throws, the transaction aborts and nothing is kept either.
 *   NOT guaranteed: the same operation sent under two different ids is two operations. A client
 *   that makes a new id for a retry gets no protection from this helper; the per-day and
 *   per-minute limits of each feature are what bound that. Client ids are a retry key, not proof
 *   of anything.
 *
 * STORED   session.once = { [id]: { at, kind, fp, result } }   (public ids only; `result` ≤ 2 KB)
 *          session.actions = { [actionId]: { actionAt, fingerprint, ok, code, type } }   (actions)
 */
import { UUID_PATTERN, canonicalJson, hash53, actionFingerprint, pruneReceipts, parseActionId, protocolError as fail } from '../protocol.js';

/** Every number this helper enforces. */
export const ONCE = Object.freeze({
  perPlayer: 2000,     // unexpired social/civic receipts one player may hold
  global: 200000,      // unexpired social/civic receipts on the whole server
  futureMs: 30000,     // how far ahead of the server clock an id's time may be
  recountMs: 60000,    // how often the server-wide count is taken again from the stored sessions
  resultBytes: 2048,   // largest stored result
  fingerprintMax: 96,  // longest stored fingerprint
});
/** Action receipts kept per session inside the action window; a full history answers 429 until old ones expire. */
export const MAX_RECEIPTS = 10000;

/**
 * The identity stored with a receipt. A payload may be 2 KB, and thousands of receipts of that size
 * would be megabytes for one session, so a long fingerprint is stored as its head, its length and a
 * hash. A reused id with different contents is still refused; the worst a hash collision can do
 * is return the first outcome again, which changes nothing.
 */
export const boundedFingerprint = (text) => (text.length <= ONCE.fingerprintMax ? text : `${text.slice(0, 48)}#${text.length}#${hash53(text)}`);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const reasoned = (status, code, reason) => Object.assign(fail(status, code), { reason });

export function createOnce({ now, windowMs, limits = {} }) {
  const perPlayer = limits.perPlayer ?? ONCE.perPlayer, global = limits.global ?? ONCE.global;
  for (const value of [perPlayer, global]) if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid receipt limits');
  let depth = 0; // > 0 while a run() is executing: ctx.act may spend there
  let counted = { at: -Infinity, total: 0 };

  /** The time inside a client id, or a thrown 400/409. Call it before the transaction to refuse early. */
  function onceId(id) {
    if (id === undefined || id === null || id === '') throw reasoned(400, 'client_id_required', 'This request needs a client id so that a retry cannot repeat it.');
    const parts = typeof id === 'string' ? id.split(':') : [];
    const at = Number(parts[0]);
    if (parts.length !== 2 || !/^\d{1,16}$/.test(parts[0]) || !Number.isSafeInteger(at) || !UUID_PATTERN.test(parts[1])) throw fail(400, 'invalid_client_id');
    if (at < now() - windowMs || at > now() + ONCE.futureMs) throw reasoned(409, 'client_id_expired', 'That request is too old to be retried safely. Nothing was done; start it again.');
    return at;
  }
  const live = (receipt, time) => Number.isFinite(receipt?.at) && receipt.at >= time - windowMs;
  /** Unexpired receipts on the whole server: counted from the stored sessions, then kept current by adding. */
  function total(db) {
    const time = now();
    if (time - counted.at < ONCE.recountMs && time >= counted.at) return counted.total;
    let sum = 0;
    const count = (record) => { if (isRecord(record?.once)) for (const receipt of Object.values(record.once)) if (live(receipt, time)) sum += 1; return false; };
    if (db.$store) db.$store.scanSessions(count); else Object.values(db.sessions).forEach(count);
    counted = { at: time, total: sum };
    return sum;
  }

  function once(db, session, { id, kind, fingerprint }, run) {
    const at = onceId(id), time = now();
    if (typeof kind !== 'string' || !kind) throw new Error('ctx.once needs a kind');
    const fp = boundedFingerprint(typeof fingerprint === 'string' ? fingerprint : canonicalJson(fingerprint ?? null));
    if (!isRecord(session.once)) session.once = {};
    const receipts = session.once;
    // Expired receipts go first. This is safe: onceId() above refuses every id old enough to have one.
    for (const [key, receipt] of Object.entries(receipts)) if (!live(receipt, time)) delete receipts[key];
    const old = Object.hasOwn(receipts, id) ? receipts[id] : null;
    if (old) {
      if (old.kind !== kind || old.fp !== fp) throw fail(409, 'client_id_conflict');
      return { ...old.result, duplicate: true };
    }
    if (Object.keys(receipts).length >= perPlayer) throw reasoned(429, 'receipt_quota', 'You have done this too many times in the last 24 hours. Nothing was charged. Try again later.');
    if (total(db) >= global) throw reasoned(503, 'receipts_full', 'The server is too busy to take this safely right now. Nothing was charged. Try again later.');
    depth += 1;
    let result;
    try { result = run(at); } finally { depth -= 1; }
    if (!isRecord(result)) throw new Error(`ctx.once(${kind}): run() must return an object`);
    if (result.ok === false) return result; // a refusal changed nothing: no receipt, the id may be tried again
    const text = JSON.stringify(result);
    if (text.length > ONCE.resultBytes) throw new Error(`ctx.once(${kind}): the stored result is ${text.length} bytes; keep it under ${ONCE.resultBytes}`);
    receipts[id] = { at, kind, fp, result: JSON.parse(text) };
    counted.total += 1;
    return result;
  }

  /**
   * The receipt steps of an action (`body.actionId`), shared by POST /api/action and by ctx.act
   * when a route forwards a request's action id. Refusals are recorded too, as they always were
   * for actions: the same id returns the same answer. Returns the result of run(), or
   * { ok, code, duplicate: true } for a repeat.
   */
  function action(session, body, run) {
    const actionAt = parseActionId(body.actionId, now(), windowMs);
    if (!isRecord(session.actions)) session.actions = {};
    pruneReceipts(session.actions, now(), windowMs);
    const full = actionFingerprint(body), fingerprint = boundedFingerprint(full);
    const old = Object.hasOwn(session.actions, body.actionId) ? session.actions[body.actionId] : null;
    // A receipt written before fingerprints were bounded holds the full text; accept either form.
    if (old && old.fingerprint !== fingerprint && old.fingerprint !== full) throw fail(409, 'action_id_conflict');
    if (old) return { ok: old.ok, code: old.code, duplicate: true };
    if (Object.keys(session.actions).length >= MAX_RECEIPTS) throw fail(429, 'action_history_full');
    depth += 1;
    let result;
    try { result = run(); } finally { depth -= 1; }
    // `type` is kept so a problem report can list the player's last actions with their results.
    session.actions[body.actionId] = { actionAt, fingerprint, ok: result.ok, code: result.code, type: body.type };
    return result;
  }

  return { once, onceId, action, active: () => depth > 0 };
}
