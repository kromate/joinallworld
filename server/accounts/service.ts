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
 * WHAT A BINDING IS WORTH. A binding lets its browser play the character and sign itself out. Everything that reaches
 * further — ending other browsers' sign-ins, reading the account's address, changing which character is in play,
 * deleting the account — also needs PROOF: a fresh verified ID token for the same account (`prove`), used once.
 * A binding lives 30 days from its last use and never longer than 90 days from when it was made (protocol.ts).
 * WHEN THE REAL OWNER ARRIVES, earlier bindings go: a sign-in that links a character into an account that already
 * existed, or that uses another way of signing in than the account last did, removes every other binding.
 *
 * Every function here runs INSIDE one store transaction and either returns or throws: a throw leaves nothing behind.
 * Each returns what the route must do once the change is saved (which sockets to close, which cookie to send).
 * Portable: no Node imports, no clock of its own.
 */
import { hasLife } from '../host-context.ts';
import { UUID_PATTERN, bindingLive, hash53 } from '../protocol.ts';
import type { AccountAuditRecord, AccountDeviceRecord, AccountEvent, AccountLogCollection, AccountRecord, ArchivedLife, ContextCore, Db, HttpError, ParkedLife, SessionRecord } from '../types.ts';
import type { VerifiedIdentity } from './token.ts';

/** Browsers one account may be signed in on; the one unused longest makes room. */
export const MAX_DEVICES = 10;
/** Characters one account may have set aside. A sign-in that would need another is refused, and nothing changes. */
export const MAX_PARKED = 5;
export const MAX_AUDIT = 2000;
/** Accounts the store holds at most (provisional). At the bound, accounts with no character and no live binding are swept; if none can go, a NEW account is refused. */
export const MAX_ACCOUNTS = 20000;
/** How often a sign-in also sweeps expired bindings and empty accounts. */
export const SWEEP_EVERY_MS = 3600000;
/** Used-token digests kept at most (they expire within minutes; the cap only bounds a flood). */
const MAX_USED = 5000;
/** Welcome messages waiting to be sent or retried, at most. */
export const MAX_WELCOME_QUEUE = 500;
/** An address is welcomed at most once in this long, however often an account for it is deleted and made again. */
export const WELCOMED_FOR_MS = 30 * 86400000;
/** Addresses remembered as welcomed, at most (as salted hashes; the oldest go first). */
export const MAX_WELCOMED = 5000;
/** A claim nobody settled (the host stopped in the middle of a send) is released for ONE more attempt after this long, and abandoned if that one is not settled either. */
export const WELCOME_CLAIM_STALE_MS = 86400000;

export interface AccountDeps {
  now(): number
  ttlMs: number
  /** How long after its issue time a token stops being acceptable anyway (its digest is kept until then). */
  tokenMaxAgeMs: number
  /** A random id for a record key that no browser will hold. */
  newId(): string
  /** A random value fit to be a session cookie. */
  newSecret(): string
  archive: ContextCore['archiveSession']
  fail(status: number, code: string): HttpError
  /** Whether a welcome message can be sent at all (the mailer is configured). When false nothing is queued. */
  welcome?(): boolean
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
  /** Browsers signed in to the account now, this one included. */
  devices: number
  /** Other browsers this sign-in signed out (the owner arrived: see the header). */
  ended: number
  /** A welcome message was queued for this new account (the route sends it once the change is saved). */
  welcome: string | null
}
/** What GET /api/account says about the caller. No token, cookie or subject id. */
export interface AccountView {
  account: { email: string; provider: AccountRecord['provider']; createdAt: number; devices: number } | null
  character: CharacterView | null
  parked: ParkedLife[]
}
/** Who is asking, as the host resolved the request's cookies. `binding` is set only for a cookie that may name a device binding. */
export interface Caller { cookie: string | undefined; binding: string | undefined }

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
function logOf(db: Db, deps: Pick<AccountDeps, 'now' | 'newId'>): AccountLogCollection {
  if (!db.accountLog) db.accountLog = { salt: deps.newId(), seq: 0, audit: [], used: {} };
  return db.accountLog as AccountLogCollection;
}
/** The audit trail's name for an account: stable, and not the provider's subject id. */
const refOf = (log: AccountLogCollection, id: string): string => hash53(`${log.salt}\n${id}`);
function audit(db: Db, deps: Pick<AccountDeps, 'now' | 'newId'>, event: AccountEvent, account: AccountRecord, life?: string): void {
  const log = logOf(db, deps);
  log.seq += 1;
  const line: AccountAuditRecord = { n: log.seq, at: deps.now(), event, ref: refOf(log, account.id), ...(life ? { life } : {}) };
  log.audit.push(line);
  if (log.audit.length > MAX_AUDIT) log.audit.splice(0, log.audit.length - MAX_AUDIT);
}
const viewOf = (record: SessionRecord | undefined): CharacterView | null => (record ? { id: record.publicId, name: record.name } : null);
/** On a host whose store keeps receipts in rows of their own, keyed by public id (the Worker), they stay there; elsewhere they travel with the record. */
const receiptsInline = (db: Db): boolean => !db.$store?.onceCounts;

/**
 * An ID token is good for one use. Its digest (token.ts: over the signed content, not its spelling) is remembered until
 * the token would be refused as stale anyway; a second presentation is refused exactly like any other bad token.
 */
function consumeToken(db: Db, deps: AccountDeps, identity: VerifiedIdentity): void {
  const log = logOf(db, deps), now = deps.now();
  for (const [key, expires] of Object.entries(log.used)) if (!(expires > now)) delete log.used[key];
  if (Object.hasOwn(log.used, identity.digest) || Object.keys(log.used).length >= MAX_USED) throw deps.fail(401, 'invalid_token');
  log.used[identity.digest] = identity.issuedAt + deps.tokenMaxAgeMs + 60000;
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
    if (device && device.account === account.id && bindingLive(device, now)) return true;
    if (device && device.account === account.id) delete devices[key];
    return false;
  });
}
/** Remove every binding of the account but `keep`. Returns the removed keys. */
function endOthers(db: Db, account: AccountRecord, keep: string | null): string[] {
  const devices = devicesOf(db), others = account.devices.filter(key => key !== keep);
  for (const key of others) delete devices[key];
  account.devices = account.devices.filter(key => key === keep);
  return others;
}
/** The account a cookie is signed in to, or undefined. */
function boundAccount(db: Db, cookie: string | undefined, now: number): { account: AccountRecord; device: AccountDeviceRecord; cookie: string } | undefined {
  if (!cookie || !UUID_PATTERN.test(cookie)) return undefined;
  const device = own(db.accountDevices, cookie);
  if (!device || !bindingLive(device, now)) return undefined;
  const account = own(db.accounts, device.account);
  return account ? { account, device, cookie } : undefined;
}
/** The account a device binding is signed in to (no cookie, no token): for the features that pay or tell an account's owner. */
export function accountOfBinding(db: Db, binding: string | undefined, now: number): AccountRecord | undefined { return boundAccount(db, binding, now)?.account; }
function requireAccount(db: Db, deps: AccountDeps, caller: Caller) {
  const bound = boundAccount(db, caller.binding, deps.now());
  if (!bound) throw deps.fail(409, 'account_required');
  return bound;
}
/** PROOF: the caller is signed in AND has just shown a fresh token for that same account. The token is spent. */
function prove(db: Db, deps: AccountDeps, caller: Caller, identity: VerifiedIdentity) {
  const bound = requireAccount(db, deps, caller);
  if (bound.account.subject !== identity.subject) throw deps.fail(403, 'account_mismatch');
  consumeToken(db, deps, identity);
  return bound;
}

/** Bring a set-aside (or expired and archived) character back as the account's active one. Undefined when the archive has none this account may take. */
function fromArchive(db: Db, deps: AccountDeps, account: AccountRecord, publicId: string): SessionRecord | undefined {
  const archive = db.archivedLives, entry = own(archive, publicId);
  // An entry another account set aside is not this account's to take. One with no owner is taken only as the account's own expired character.
  if (!archive || !entry || (entry.account !== undefined ? entry.account !== account.id : account.publicId !== publicId)) return undefined;
  const key = deps.newId();
  const record: SessionRecord = { secret: key, publicId, name: entry.name, expiresAt: deps.now() + deps.ttlMs, cities: structuredClone(entry.cities || {}), actions: entry.actions ? structuredClone(entry.actions) : {}, account: account.id,
    ...(entry.once ? { once: structuredClone(entry.once) } : {}),
    ...(entry.character ? { character: structuredClone(entry.character) } : {}), ...(entry.legacyLives ? { legacyLives: structuredClone(entry.legacyLives) } : {}), ...(entry.legacyLifeCities ? { legacyLifeCities: structuredClone(entry.legacyLifeCities) } : {}), ...(entry.onboarding === true ? { onboarding: true as const } : {}) };
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
/** Set a played life aside: into the archive, marked as this account's, with everything a session record carries — its exactly-once receipts included. */
function park(db: Db, deps: AccountDeps, account: AccountRecord, record: SessionRecord): ParkedLife {
  db.archivedLives ||= {};
  const entry: ArchivedLife = { publicId: record.publicId, name: record.name, cities: structuredClone(record.cities || {}), archivedAt: deps.now(), account: account.id,
    ...(receiptsInline(db) ? { actions: structuredClone({ ...record.actions }), ...(record.once ? { once: structuredClone({ ...record.once }) } : {}) } : {}),
    ...(record.character ? { character: structuredClone(record.character) } : {}), ...(record.legacyLives ? { legacyLives: structuredClone(record.legacyLives) } : {}), ...(record.legacyLifeCities ? { legacyLifeCities: structuredClone(record.legacyLifeCities) } : {}), ...(record.onboarding === true ? { onboarding: true as const } : {}) };
  db.archivedLives[record.publicId] = entry;
  delete db.sessions[record.secret];
  const parked: ParkedLife = { id: record.publicId, name: record.name, at: deps.now() };
  account.parked.push(parked);
  audit(db, deps, 'parked', account, record.publicId);
  return parked;
}

/**
 * Housekeeping, at most hourly, inside a sign-in's transaction: bindings that have expired go, and so does an account
 * that has no live binding, no character (active, archived or set aside) — nothing anyone could come back to.
 */
export function sweepAccounts(db: Db, deps: AccountDeps): { devices: number; accounts: number } {
  const now = deps.now(), devices = devicesOf(db), accounts = accountsOf(db), log = logOf(db, deps);
  let endedDevices = 0, endedAccounts = 0, kept = 0;
  for (const key of Object.keys(devices)) { const device = own(devices, key); if (!device || !bindingLive(device, now) || !own(accounts, device.account)) { delete devices[key]; endedDevices += 1; } }
  for (const id of Object.keys(accounts)) {
    const account = own(accounts, id);
    if (!account) continue;
    account.devices = account.devices.filter(key => own(devices, key) !== undefined);
    const record = account.sessionKey ? db.sessions[account.sessionKey] : undefined;
    const hasCharacter = (record !== undefined && record.account === id) || (account.publicId !== null && own(db.archivedLives, account.publicId) !== undefined) || account.parked.length > 0;
    if (!account.devices.length && !hasCharacter) { delete accounts[id]; endedAccounts += 1; } else kept += 1;
  }
  log.sweptAt = now; log.accounts = kept;
  reviveWelcomes(db, deps);
  return { devices: endedDevices, accounts: endedAccounts };
}

/**
 * SIGN IN — and with it "save your character" and "restore your character", which are the same request.
 * `identity` is what a verified ID token proved; whatever cookie the browser presented is never reused.
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
 * is spent. Refused with nothing changed: a token already used (401), a sixth life to set aside (409 parked_full), or
 * a new account when the store holds as many as it may (503 account_capacity).
 */
export function signIn(db: Db, deps: AccountDeps, input: Caller & { identity: VerifiedIdentity }): SignInResult {
  const now = deps.now(), { identity } = input;
  consumeToken(db, deps, identity);
  const log = logOf(db, deps);
  if (now - (log.sweptAt ?? 0) >= SWEEP_EVERY_MS || now < (log.sweptAt ?? 0)) sweepAccounts(db, deps);
  const accounts = accountsOf(db), devices = devicesOf(db), id = accountId(identity.subject);
  const after: AfterChange = { closeKeys: [], closeDevices: [] };
  // What the browser presented: a binding (removed — a sign-in never keeps a cookie), or a guest session.
  let guest: SessionRecord | undefined;
  if (input.binding && UUID_PATTERN.test(input.binding) && unbind(db, input.binding)) after.closeDevices.push(input.binding);
  else if (input.cookie && UUID_PATTERN.test(input.cookie)) { const direct = db.sessions[input.cookie]; if (direct && direct.account === undefined && direct.expiresAt > now) guest = direct; }
  let account = own(accounts, id), welcome: string | null = null;
  const created = !account;
  if (!account) {
    if ((log.accounts ?? 0) >= MAX_ACCOUNTS) { sweepAccounts(db, deps); if ((log.accounts ?? 0) >= MAX_ACCOUNTS) throw deps.fail(503, 'account_capacity'); }
    // mailOptIn: the creation screen says, next to its button, that the character's e-mails are on until the owner turns them off.
    account = accounts[id] = { v: 1, id, provider: identity.provider, subject: identity.subject, email: identity.email, createdAt: now, lastSeenAt: now, sessionKey: null, publicId: null, devices: [], parked: [], mailOptIn: true };
    log.accounts = (log.accounts ?? 0) + 1;
    audit(db, deps, 'created', account);
    // The welcome message belongs to the creation of the account: it is owed from this transaction on, and only if it can be sent at all.
    if (deps.welcome?.() === true) {
      reviveWelcomes(db, deps);
      const queue = (log.welcome ||= []), welcomed = (log.welcomed ||= {}), address = hash53(`${log.salt}\n${identity.email.toLowerCase()}`);
      for (const [key, at] of Object.entries(welcomed)) if (!(now - at < WELCOMED_FOR_MS)) delete welcomed[key];
      // Deleting an account and making it again does not earn the address a second message.
      if (Object.hasOwn(welcomed, address) || queue.length >= MAX_WELCOME_QUEUE) account.welcome = 'skipped';
      else {
        account.welcome = 'pending';
        queue.push({ id, at: now, tries: 0, nextAt: now }); welcome = id;
        welcomed[address] = now;
        const keys = Object.keys(welcomed);
        if (keys.length > MAX_WELCOMED) for (const key of keys.sort((x, y) => (welcomed[x] ?? 0) - (welcomed[y] ?? 0)).slice(0, keys.length - MAX_WELCOMED)) delete welcomed[key];
      }
    }
  }
  pruneDevices(db, account, now);
  const providerChanged = !created && account.provider !== identity.provider;
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
  // THE OWNER ARRIVED. Whoever was signed in before did not bring this character, or signed in another way: their bindings end.
  let ended = 0;
  if ((outcome === 'linked' && !created) || providerChanged) { const others = endOthers(db, account, null); ended = others.length; after.closeDevices.push(...others); if (ended) audit(db, deps, 'signed_out_everywhere', account); }
  if (mine) mine.expiresAt = now + deps.ttlMs;
  account.provider = identity.provider; account.email = identity.email; account.lastSeenAt = now;
  const cookie = deps.newSecret();
  devices[cookie] = { account: id, createdAt: now, seenAt: now, expiresAt: now + deps.ttlMs };
  account.devices.push(cookie);
  while (account.devices.length > MAX_DEVICES) { const oldest = account.devices.shift(); if (oldest !== undefined) { delete devices[oldest]; after.closeDevices.push(oldest); } }
  if (outcome !== 'parked') audit(db, deps, outcome, account, mine?.publicId);
  return { ...after, cookie, outcome, created, character: viewOf(mine), parked, devices: account.devices.length, ended, welcome };
}

/**
 * POST /api/session has just created `session` for a browser that is signed in to an account with no character
 * (ctx.checks.adoptSession): that record becomes the account's character. Any other caller gets its record back unchanged.
 */
export function adoptNewSession(db: Db, deps: AccountDeps, binding: string | undefined, session: SessionRecord): SessionRecord {
  const bound = boundAccount(db, binding, deps.now());
  if (!bound) return session;
  // The account's character expired between requests and is back from the archive: that is the character; the new record held nothing.
  const existing = activeCharacter(db, deps, bound.account);
  if (existing) { delete db.sessions[session.secret]; return existing; }
  const record = adopt(db, deps, bound.account, session);
  audit(db, deps, 'character_started', bound.account, record.publicId);
  return record;
}

/** With PROOF: make a set-aside character the active one; the one that was active is set aside in its place (or dropped, if it never had a life). */
export function switchCharacter(db: Db, deps: AccountDeps, caller: Caller, identity: VerifiedIdentity, target: unknown): AfterChange & { character: CharacterView; parked: ParkedLife[] } {
  const { account } = prove(db, deps, caller, identity);
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

/** This browser only; a binding is enough for that. The character stays with the account. */
export function signOut(db: Db, deps: AccountDeps, caller: Caller): AfterChange {
  const bound = requireAccount(db, deps, caller);
  unbind(db, bound.cookie);
  audit(db, deps, 'signed_out', bound.account);
  return { closeKeys: [], closeDevices: [bound.cookie] };
}
/** With PROOF: every OTHER browser of the account. This one stays signed in. */
export function signOutEverywhere(db: Db, deps: AccountDeps, caller: Caller, identity: VerifiedIdentity): AfterChange & { ended: number } {
  const bound = prove(db, deps, caller, identity);
  const others = endOthers(db, bound.account, bound.cookie);
  audit(db, deps, 'signed_out_everywhere', bound.account);
  return { closeKeys: [], closeDevices: others, ended: others.length };
}

/** The operator's: end every browser of an account (server/admin). Returns the device bindings that were removed, so their sockets can be closed. */
export function endAllDevices(db: Db, deps: Pick<AccountDeps, 'now' | 'newId'>, account: AccountRecord): string[] {
  const ended = endOthers(db, account, null);
  if (ended.length) audit(db, deps, 'signed_out_everywhere', account);
  return ended;
}

/**
 * With PROOF: delete the account — its record, every device binding and every set-aside character. The active character
 * is the player's choice: `erase: false` hands it back to this browser as a guest session (a new cookie, no account),
 * `erase: true` removes its record. (What other features keep under a character's public id is theirs: docs/ACCOUNTS.md.)
 */
export function deleteAccount(db: Db, deps: AccountDeps, input: Caller & { identity: VerifiedIdentity; erase: boolean }): AfterChange & { cookie: string | null } {
  const { account } = prove(db, deps, input, input.identity);
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
  const log = logOf(db, deps);
  if (log.welcome) log.welcome = log.welcome.filter(item => item.id !== account.id);
  log.accounts = Math.max(0, (log.accounts ?? 1) - 1);
  delete accountsOf(db)[account.id];
  return { ...after, cookie };
}

/** What the caller's session is, account-wise. Read-only. */
export function accountView(db: Db, binding: string | undefined, now: number): AccountView {
  const bound = boundAccount(db, binding, now);
  if (!bound) return { account: null, character: null, parked: [] };
  const { account } = bound;
  const record = account.sessionKey ? db.sessions[account.sessionKey] : undefined;
  return {
    account: { email: account.email, provider: account.provider, createdAt: account.createdAt, devices: account.devices.filter(key => { const device = own(db.accountDevices, key); return device !== undefined && bindingLive(device, now); }).length },
    character: record && record.account === account.id && record.expiresAt > now ? viewOf(record) : null,
    parked: account.parked.map(item => ({ ...item })),
  };
}
/** With PROOF: everything stored about the caller's account, for its owner. No cookie, token or subject id. */
export function exportAccount(db: Db, deps: AccountDeps, caller: Caller, identity: VerifiedIdentity): Record<string, unknown> {
  const bound = prove(db, deps, caller, identity), { account } = bound, now = deps.now();
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

// ---- the welcome message's bookkeeping (the message itself: server/accounts/welcome.ts) ----

/** How long after a failed attempt the next one may be made: 5 minutes, then 20, 80, … at most a day. */
export const welcomeBackoff = (tries: number): number => Math.min(86400000, 300000 * 4 ** Math.max(0, tries - 1));
export const WELCOME_TRIES = 5;
/**
 * CLAIM one owed welcome message before it is attempted. Only a claimed message is sent, and a claim is made at most
 * once at a time: two requests (or a request and the retry tick) can never both send it. Returns what the message
 * needs, or null when there is nothing to send (not owed, already claimed, already sent, not due yet).
 */
export function claimWelcome(db: Db, deps: AccountDeps, id: string): { email: string; name: string; bonus?: { amount: number; paid: boolean } } | null {
  const log = db.accountLog, account = own(db.accounts, id), now = deps.now();
  const entry = log?.welcome?.find(item => item.id === id);
  if (!log || !entry) return null;
  if (!account || account.welcome !== 'pending') { log.welcome = (log.welcome ?? []).filter(item => item !== entry); return null; }
  if (entry.claimedAt !== undefined || entry.nextAt > now) return null;
  entry.claimedAt = now;
  const record = account.sessionKey ? db.sessions[account.sessionKey] : undefined;
  return { email: account.email, name: record && record.account === id ? record.name : '', ...(account.bonus && account.bonus.amount > 0 ? { bonus: { amount: account.bonus.amount, paid: account.bonus.held === undefined } } : {}) };
}
/** Record what became of a claimed attempt: sent (never again), failed for good, or to be tried again later. A message on its one last attempt (`last`) is never tried again. */
export function settleWelcome(db: Db, deps: AccountDeps, id: string, result: { ok: boolean; retry: boolean; counted?: boolean }): void {
  const log = db.accountLog, account = own(db.accounts, id), now = deps.now();
  const entry = log?.welcome?.find(item => item.id === id);
  if (!log || !entry) return;
  const done = (state: number | 'failed'): void => { if (account) account.welcome = state; log.welcome = (log.welcome ?? []).filter(item => item !== entry); };
  if (result.ok) { done(now); return; }
  // Held back without an attempt (the day's allowance is used up, the operator's switch is off): no try is spent.
  if (result.counted !== false) entry.tries += 1;
  if (!result.retry || entry.tries >= WELCOME_TRIES || (entry.last === true && result.counted !== false)) { done('failed'); return; }
  delete entry.claimedAt; entry.nextAt = now + welcomeBackoff(Math.max(1, entry.tries));
}
/**
 * A claim nobody settled is not left in the queue for good (five hundred of them would stop every new account's
 * message). After a day it is released for ONE last attempt; if that one is not settled within a day either, it is
 * abandoned. Never more: a message that may already have gone out is not sent a third time.
 */
export function reviveWelcomes(db: Db, deps: AccountDeps): number {
  const log = db.accountLog, now = deps.now();
  if (!log?.welcome?.length) return 0;
  let changed = 0;
  log.welcome = log.welcome.filter((entry) => {
    if (entry.claimedAt === undefined || now - entry.claimedAt < WELCOME_CLAIM_STALE_MS) return true;
    changed += 1;
    if (entry.last === true) { const account = own(db.accounts, entry.id); if (account && account.welcome === 'pending') account.welcome = 'failed'; return false; }
    entry.last = true; delete entry.claimedAt; entry.nextAt = now;
    return true;
  });
  return changed;
}
/** Ids whose welcome message is owed and due (for the retry tick). A claim nobody settled — the host stopped mid-send — is never retried: better none than two. */
export function dueWelcomes(db: Db, now: number): string[] {
  return (db.accountLog?.welcome ?? []).filter(item => item.claimedAt === undefined && item.nextAt <= now).map(item => item.id).slice(0, 20);
}
