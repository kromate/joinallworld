/**
 * OWNER: accounts
 * WHAT AN ACCOUNT IS, IN THE STORE (design: docs/ACCOUNTS.md).
 *
 * An account is optional. A guest is a session record whose key is the browser's cookie, exactly as before. Signing in
 * adds three things beside the sessions, and changes no existing record's shape:
 *
 *   accounts[<id>]            who the provider says this is (provider, subject, verified address, two times), which
 *                             session record is the account's ACTIVE CHARACTER (`sessionKey`), which browsers are signed
 *                             in (`devices`) and which characters were set aside (`parked`).
 *   accountDevices[<cookie>]  one signed-in browser: the account it belongs to and a sliding expiry. The key is that
 *                             browser's `sid` cookie — a value made by the server at sign-in, never one the browser sent.
 *   accountLog                the audit trail (an event, a time, a salted reference — no token, address or cookie) and
 *                             the digests of ID tokens already used.
 *
 * THE ACTIVE CHARACTER is an ordinary session record with `account` set, filed under a key that is never sent to a
 * browser. A request reaches it only through its device binding (protocol.ts sessionOfCookie), so several browsers can
 * play one character, and removing a binding ends that browser's access without touching the character.
 *
 * NOTHING IS DESTROYED BY SIGNING IN. A played life that cannot be the active character is SET ASIDE: it moves to the
 * existing archive (`archivedLives`, keyed by its public id) marked with the account that may bring it back, and is listed
 * in `account.parked`. Only a session that never had a life — the same rule the expiry archive uses (host-context.ts
 * hasLife) — is dropped.
 *
 * Every function here runs INSIDE one store transaction and either returns or throws: a throw leaves nothing behind.
 * Each returns what the route must do once the change is saved (which sockets to close, which cookie to send).
 * Portable: no Node imports, no clock of its own.
 */
import { hasLife } from '../host-context.ts';
import { UUID_PATTERN, hash53 } from '../protocol.ts';
import type { AccountAuditRecord, AccountDeviceRecord, AccountEvent, AccountLogCollection, AccountRecord, ArchivedLife, ContextCore, Db, HttpError, ParkedLife, SessionRecord } from '../types.ts';
import type { VerifiedIdentity } from './token.ts';

/** Browsers one account may be signed in on; the one unused longest makes room. */
export const MAX_DEVICES = 10;
/** Characters one account may have set aside. A sign-in that would need another is refused, and nothing changes. */
export const MAX_PARKED = 5;
export const MAX_AUDIT = 2000;
/** Used-token digests kept at most (they expire within minutes; the cap only bounds a flood). */
const MAX_USED = 5000;

export interface AccountDeps {
  now(): number
  ttlMs: number
  /** A random id for a record key that no browser will hold. */
  newId(): string
  /** A random value fit to be a session cookie. */
  newSecret(): string
  archive: ContextCore['archiveSession']
  fail(status: number, code: string): HttpError
}
/** What a route does after the transaction is saved. */
export interface AfterChange {
  /** Session keys whose sockets must close (the record moved or is gone). */
  closeKeys: string[]
  /** Device cookies whose sockets must close (the binding is gone). */
  closeDevices: string[]
}
export type SignInOutcome = 'linked' | 'restored' | 'parked' | 'signed_in';
export interface CharacterView { id: string; name: string }
export interface SignInResult extends AfterChange {
  /** The new session cookie of this browser. */
  cookie: string
  outcome: SignInOutcome
  /** The account was made by this sign-in. */
  created: boolean
  character: CharacterView | null
  /** The life of this browser that was set aside, when `outcome` is 'parked'. */
  parked: ParkedLife | null
}
/** What GET /api/account says about the caller. No token, cookie or subject id. */
export interface AccountView {
  account: { email: string; provider: AccountRecord['provider']; createdAt: number; devices: number } | null
  character: CharacterView | null
  parked: ParkedLife[]
}

export const accountId = (subject: string): string => `fb:${subject}`;
/**
 * One record of a keyed collection, read by key alone (never by listing the collection: on the Worker these are rows).
 * Keys are UUIDs or `fb:`-prefixed ids, so none can name something every object inherits; a non-record answers undefined anyway.
 */
const own = <T>(map: Record<string, T> | undefined, key: string): T | undefined => {
  const value = map && key !== '__proto__' ? map[key] : undefined;
  return value !== null && typeof value === 'object' ? value : undefined;
};
const accountsOf = (db: Db): Record<string, AccountRecord> => { if (!db.accounts) db.accounts = {}; return db.accounts as Record<string, AccountRecord>; };
const devicesOf = (db: Db): Record<string, AccountDeviceRecord> => { if (!db.accountDevices) db.accountDevices = {}; return db.accountDevices as Record<string, AccountDeviceRecord>; };
function logOf(db: Db, deps: AccountDeps): AccountLogCollection {
  if (!db.accountLog) db.accountLog = { salt: deps.newId(), seq: 0, audit: [], used: {} };
  return db.accountLog as AccountLogCollection;
}
/** The audit trail's name for an account: stable, and not the provider's subject id. */
const refOf = (log: AccountLogCollection, id: string): string => hash53(`${log.salt}\n${id}`);
function audit(db: Db, deps: AccountDeps, event: AccountEvent, account: AccountRecord, life?: string): void {
  const log = logOf(db, deps);
  log.seq += 1;
  const line: AccountAuditRecord = { n: log.seq, at: deps.now(), event, ref: refOf(log, account.id), ...(life ? { life } : {}) };
  log.audit.push(line);
  if (log.audit.length > MAX_AUDIT) log.audit.splice(0, log.audit.length - MAX_AUDIT);
}
const viewOf = (record: SessionRecord | undefined): CharacterView | null => (record ? { id: record.publicId, name: record.name } : null);

/**
 * An ID token is good for one use. Its digest is remembered until the token would be refused as stale anyway
 * (`until`); a second presentation is refused exactly like any other bad token.
 */
function consumeToken(db: Db, deps: AccountDeps, digest: string, until: number): void {
  const log = logOf(db, deps), now = deps.now();
  for (const [key, expires] of Object.entries(log.used)) if (!(expires > now)) delete log.used[key];
  if (Object.hasOwn(log.used, digest) || Object.keys(log.used).length >= MAX_USED) throw deps.fail(401, 'invalid_token');
  log.used[digest] = until;
}

/** Remove one device binding. Returns whether there was one. */
function unbind(db: Db, cookie: string): boolean {
  const devices = db.accountDevices, device = own(devices, cookie);
  if (!devices || !device) return false;
  delete devices[cookie];
  const account = own(db.accounts, device.account);
  if (account) account.devices = account.devices.filter(key => key !== cookie);
  return true;
}
/** Forget bindings that have expired or no longer exist. */
function pruneDevices(db: Db, account: AccountRecord, now: number): void {
  const devices = devicesOf(db);
  account.devices = account.devices.filter((key) => {
    const device = own(devices, key);
    if (device && device.account === account.id && device.expiresAt > now) return true;
    if (device && device.account === account.id) delete devices[key];
    return false;
  });
}
/** The account a cookie is signed in to, or undefined. */
function boundAccount(db: Db, cookie: string | undefined, now: number): { account: AccountRecord; device: AccountDeviceRecord; cookie: string } | undefined {
  if (!cookie || !UUID_PATTERN.test(cookie)) return undefined;
  const device = own(db.accountDevices, cookie);
  if (!device || !(device.expiresAt > now)) return undefined;
  const account = own(db.accounts, device.account);
  return account ? { account, device, cookie } : undefined;
}
function requireAccount(db: Db, deps: AccountDeps, cookie: string | undefined) {
  const bound = boundAccount(db, cookie, deps.now());
  if (!bound) throw deps.fail(409, 'account_required');
  return bound;
}

/** Bring a set-aside (or expired and archived) character back as the account's active one. Undefined when the archive has none this account may take. */
function fromArchive(db: Db, deps: AccountDeps, account: AccountRecord, publicId: string): SessionRecord | undefined {
  const archive = db.archivedLives, entry = own(archive, publicId);
  // An entry another account set aside is not this account's to take. One with no owner is taken only as the account's own expired character.
  if (!archive || !entry || (entry.account !== undefined ? entry.account !== account.id : account.publicId !== publicId)) return undefined;
  const key = deps.newId();
  const record: SessionRecord = { secret: key, publicId, name: entry.name, expiresAt: deps.now() + deps.ttlMs, cities: structuredClone(entry.cities || {}), actions: {}, account: account.id,
    ...(entry.character ? { character: structuredClone(entry.character) } : {}), ...(entry.legacyLives ? { legacyLives: structuredClone(entry.legacyLives) } : {}), ...(entry.onboarding === true ? { onboarding: true as const } : {}) };
  db.sessions[key] = record;
  delete archive[publicId];
  account.sessionKey = key; account.publicId = publicId;
  return db.sessions[key];
}
/** The account's active character, if it has one that can be played now. An expired one is archived and brought straight back. */
function activeCharacter(db: Db, deps: AccountDeps, account: AccountRecord): SessionRecord | undefined {
  let record = account.sessionKey ? db.sessions[account.sessionKey] : undefined;
  if (record && record.account !== account.id) record = undefined;
  if (record && !(record.expiresAt > deps.now())) { deps.archive(db, record.secret, record); record = undefined; }
  if (record) return record;
  account.sessionKey = null;
  return account.publicId ? fromArchive(db, deps, account, account.publicId) : undefined;
}
/** A guest's session record becomes the account's active character: same record, same public id, a key no browser holds. */
function adopt(db: Db, deps: AccountDeps, account: AccountRecord, record: SessionRecord): SessionRecord {
  const key = deps.newId();
  delete db.sessions[record.secret];
  record.secret = key; record.account = account.id; record.expiresAt = deps.now() + deps.ttlMs;
  db.sessions[key] = record;
  account.sessionKey = key; account.publicId = record.publicId;
  return record;
}
/** Set a played life aside: into the archive, marked as this account's, with everything a session record carries beside its receipts. */
function park(db: Db, deps: AccountDeps, account: AccountRecord, record: SessionRecord): ParkedLife {
  db.archivedLives ||= {};
  const entry: ArchivedLife = { publicId: record.publicId, name: record.name, cities: structuredClone(record.cities || {}), archivedAt: deps.now(), account: account.id,
    ...(record.character ? { character: structuredClone(record.character) } : {}), ...(record.legacyLives ? { legacyLives: structuredClone(record.legacyLives) } : {}), ...(record.onboarding === true ? { onboarding: true as const } : {}) };
  db.archivedLives[record.publicId] = entry;
  delete db.sessions[record.secret];
  const parked: ParkedLife = { id: record.publicId, name: record.name, at: deps.now() };
  account.parked.push(parked);
  audit(db, deps, 'parked', account, record.publicId);
  return parked;
}

/**
 * SIGN IN — and with it "save your character" and "restore your character", which are the same request.
 * `identity` is what a verified ID token proved; `cookie` is whatever the browser presented and is never reused.
 *
 *   this browser            the account             what happens                                        outcome
 *   a guest session         no played character     the guest's record becomes the account's character  linked
 *   a played guest life     a played character      the account's stays active; the guest's is SET ASIDE parked
 *   nothing, or an unplayed a played character      this browser is attached to the account's character  restored
 *     guest session                                 (the unplayed session, having no life, is dropped)
 *   nothing                 no character            signed in; the next POST /api/session starts the     signed_in
 *                                                   account's character (adoptNewSession)
 *
 * In every case the browser gets a NEW cookie (a binding made here), a binding it presented is removed, and the token
 * is spent. Refused with nothing changed: a token already used (401), or a sixth life to set aside (409 parked_full).
 */
export function signIn(db: Db, deps: AccountDeps, input: { cookie: string | undefined; identity: VerifiedIdentity; digest: string; tokenMaxAgeMs: number }): SignInResult {
  const now = deps.now(), { identity } = input;
  consumeToken(db, deps, input.digest, identity.issuedAt + input.tokenMaxAgeMs + 60000);
  const accounts = accountsOf(db), devices = devicesOf(db), id = accountId(identity.subject);
  const after: AfterChange = { closeKeys: [], closeDevices: [] };
  // What the browser presented: a binding (removed — a sign-in never keeps a cookie), or a guest session.
  let guest: SessionRecord | undefined;
  if (input.cookie && UUID_PATTERN.test(input.cookie)) {
    if (unbind(db, input.cookie)) after.closeDevices.push(input.cookie);
    else { const direct = db.sessions[input.cookie]; if (direct && direct.account === undefined && direct.expiresAt > now) guest = direct; }
  }
  let account = own(accounts, id);
  const created = !account;
  if (!account) {
    account = accounts[id] = { v: 1, id, provider: identity.provider, subject: identity.subject, email: identity.email, createdAt: now, lastSeenAt: now, sessionKey: null, publicId: null, devices: [], parked: [] };
    audit(db, deps, 'created', account);
  }
  pruneDevices(db, account, now);
  let mine = activeCharacter(db, deps, account), outcome: SignInOutcome, parked: ParkedLife | null = null;
  if (guest && mine && hasLife(guest) && hasLife(mine)) {
    if (account.parked.length >= MAX_PARKED) throw deps.fail(409, 'parked_full');
    after.closeKeys.push(guest.secret);
    parked = park(db, deps, account, guest);
    outcome = 'parked';
  } else if (guest && (!mine || !hasLife(mine))) {
    // The account has nothing played: the life in hand is the one to keep. An unplayed account character leaves nothing behind.
    if (mine) { after.closeKeys.push(mine.secret); delete db.sessions[mine.secret]; }
    after.closeKeys.push(guest.secret);
    mine = adopt(db, deps, account, guest);
    outcome = 'linked';
  } else if (mine) {
    if (guest) { after.closeKeys.push(guest.secret); delete db.sessions[guest.secret]; }
    outcome = 'restored';
  } else outcome = 'signed_in';
  if (mine) mine.expiresAt = now + deps.ttlMs;
  account.provider = identity.provider; account.email = identity.email; account.lastSeenAt = now;
  const cookie = deps.newSecret();
  devices[cookie] = { account: id, createdAt: now, seenAt: now, expiresAt: now + deps.ttlMs };
  account.devices.push(cookie);
  while (account.devices.length > MAX_DEVICES) { const oldest = account.devices.shift(); if (oldest !== undefined) { delete devices[oldest]; after.closeDevices.push(oldest); } }
  if (outcome !== 'parked') audit(db, deps, outcome, account, mine?.publicId);
  return { ...after, cookie, outcome, created, character: viewOf(mine), parked };
}

/**
 * POST /api/session has just created `session` for a browser that is signed in to an account with no character
 * (ctx.checks.adoptSession): that record becomes the account's character. Any other caller gets its record back unchanged.
 */
export function adoptNewSession(db: Db, deps: AccountDeps, cookie: string | undefined, session: SessionRecord): SessionRecord {
  const bound = boundAccount(db, cookie, deps.now());
  if (!bound) return session;
  // The account's character expired between requests and is back from the archive: that is the character; the new record held nothing.
  const existing = activeCharacter(db, deps, bound.account);
  if (existing) { delete db.sessions[session.secret]; return existing; }
  const record = adopt(db, deps, bound.account, session);
  audit(db, deps, 'character_started', bound.account, record.publicId);
  return record;
}

/** Make a set-aside character the active one; the one that was active is set aside in its place (or dropped, if it never had a life). */
export function switchCharacter(db: Db, deps: AccountDeps, cookie: string | undefined, target: unknown): AfterChange & { character: CharacterView; parked: ParkedLife[] } {
  const { account } = requireAccount(db, deps, cookie);
  const index = account.parked.findIndex(item => item.id === target);
  const wanted = account.parked[index];
  if (!wanted) throw deps.fail(404, 'character_not_found');
  const after: AfterChange = { closeKeys: [], closeDevices: [] };
  const mine = activeCharacter(db, deps, account);
  account.parked.splice(index, 1);
  if (mine) {
    after.closeKeys.push(mine.secret);
    if (hasLife(mine)) park(db, deps, account, mine); else delete db.sessions[mine.secret];
    account.sessionKey = null;
  }
  const record = fromArchive(db, deps, account, wanted.id);
  if (!record) throw deps.fail(409, 'character_unavailable');
  audit(db, deps, 'switched', account, record.publicId);
  return { ...after, character: { id: record.publicId, name: record.name }, parked: [...account.parked] };
}

/** This browser only. The character stays with the account. */
export function signOut(db: Db, deps: AccountDeps, cookie: string | undefined): AfterChange {
  const bound = requireAccount(db, deps, cookie);
  unbind(db, bound.cookie);
  audit(db, deps, 'signed_out', bound.account);
  return { closeKeys: [], closeDevices: [bound.cookie] };
}
/** Every OTHER browser of the account. This one stays signed in. */
export function signOutEverywhere(db: Db, deps: AccountDeps, cookie: string | undefined): AfterChange & { ended: number } {
  const bound = requireAccount(db, deps, cookie), devices = devicesOf(db);
  const others = bound.account.devices.filter(key => key !== bound.cookie);
  for (const key of others) delete devices[key];
  bound.account.devices = [bound.cookie];
  audit(db, deps, 'signed_out_everywhere', bound.account);
  return { closeKeys: [], closeDevices: others, ended: others.length };
}

/**
 * Delete the account: its record, every device binding and every set-aside character. `identity` is a FRESH verified
 * token for the same account — a cookie alone cannot delete an account. The active character is the player's choice:
 * `erase: false` hands it back to this browser as a guest session (a new cookie, no account), `erase: true` removes it.
 */
export function deleteAccount(db: Db, deps: AccountDeps, input: { cookie: string | undefined; identity: VerifiedIdentity; digest: string; tokenMaxAgeMs: number; erase: boolean }): AfterChange & { cookie: string | null } {
  const { account } = requireAccount(db, deps, input.cookie);
  if (account.subject !== input.identity.subject) throw deps.fail(403, 'account_mismatch');
  consumeToken(db, deps, input.digest, input.identity.issuedAt + input.tokenMaxAgeMs + 60000);
  const devices = devicesOf(db), after: AfterChange = { closeKeys: [], closeDevices: [...account.devices] };
  const mine = activeCharacter(db, deps, account);
  for (const key of account.devices) delete devices[key];
  for (const item of account.parked) { const entry = own(db.archivedLives, item.id); if (entry && entry.account === account.id && db.archivedLives) delete db.archivedLives[item.id]; }
  let cookie: string | null = null;
  if (mine) {
    after.closeKeys.push(mine.secret);
    delete db.sessions[mine.secret];
    if (!input.erase) {
      cookie = deps.newSecret();
      mine.secret = cookie; delete mine.account; mine.expiresAt = deps.now() + deps.ttlMs;
      db.sessions[cookie] = mine;
    }
  }
  audit(db, deps, 'deleted', account);
  delete accountsOf(db)[account.id];
  return { ...after, cookie };
}

/** What the caller's session is, account-wise. Read-only. */
export function accountView(db: Db, cookie: string | undefined, now: number): AccountView {
  const bound = boundAccount(db, cookie, now);
  if (!bound) return { account: null, character: null, parked: [] };
  const { account } = bound;
  const record = account.sessionKey ? db.sessions[account.sessionKey] : undefined;
  return {
    account: { email: account.email, provider: account.provider, createdAt: account.createdAt, devices: account.devices.length },
    character: record && record.account === account.id && record.expiresAt > now ? viewOf(record) : null,
    parked: account.parked.map(item => ({ ...item })),
  };
}
/** Everything stored about the caller's account, for its owner. Read-only. No cookie, token or subject id. */
export function exportAccount(db: Db, deps: AccountDeps, cookie: string | undefined): Record<string, unknown> {
  const bound = requireAccount(db, deps, cookie), { account } = bound, now = deps.now();
  const log = db.accountLog, ref = log ? refOf(log, account.id) : '';
  const record = account.sessionKey ? db.sessions[account.sessionKey] : undefined;
  return {
    account: { provider: account.provider, email: account.email, createdAt: account.createdAt, lastSeenAt: account.lastSeenAt },
    devices: account.devices.flatMap((key) => { const device = own(db.accountDevices, key); return device ? [{ signedInAt: device.createdAt, lastSeenAt: device.seenAt, expiresAt: device.expiresAt, thisDevice: key === bound.cookie }] : []; }),
    character: record && record.account === account.id && record.expiresAt > now ? { id: record.publicId, name: record.name, cities: Object.keys(record.cities || {}) } : null,
    setAside: account.parked.map(item => ({ ...item })),
    history: (log?.audit ?? []).filter(line => line.ref === ref).map(line => ({ at: line.at, event: line.event, ...(line.life ? { character: line.life } : {}) })),
  };
}
