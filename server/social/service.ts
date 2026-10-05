import { venueFor } from '../../src/game/cities/runtime.ts';
/**
 * OWNER: social
 * All player-to-player logic, shared by the HTTP routes (server/routes/social.ts) and the
 * socket messages (server/ws/social.ts). Portable: it only uses the server context described
 * in server/routes/index.ts (store, collection, settle, act, allow, now, push) plus live presence.
 *
 * HOW IT IS CALLED
 *   Every method runs INSIDE ctx.store.transact(db => …) and takes the caller's stored device
 *   session. Malformed input throws ctx.fail(400, code). A refusal for a game reason returns
 *   { ok: false, code, reason } with a sentence naming the unmet prerequisite. Success returns
 *   { ok: true, code, … }. Results may carry `push: [[publicId, message], …]`; the adapter sends
 *   those only after the transaction has committed (deliver()).
 *
 * STORED COLLECTION  ctx.collection(db, 'social')
 *   players   { [publicId]: { name, first, seen, friends: { id: since }, in: { id: at }, out: { id: at },
 *               blocked: { id: at }, convs: { convId: { read } }, updates: [{ id, kind, text, at, read, data? }],
 *               reports: [{ id, about, name, reason, at, status }], baeIn: { id: { at, cityId } }, bae: id|null,
 *               visiting: hostId|null, recv: { day, amount }, chats: { day, count } } }
 *   convs     { [convId]: { id, kind: 'dm'|'group'|'house', members: [id], name?, owner?, cid?, seq, created,
 *               messages: [{ seq, from: id|null, body, at, cid?, sys? }] } }      (bounded history)
 *   houses    { [hostId]: { knocks: { visitorId: { at, expires, status, cityId } }, guests: { id: { since, expires, cityId } } } }
 *             A visit lasts until it expires, the guest leaves or is removed, either blocks the other,
 *             or the HOST'S LIFE LEAVES HOME (ctx.atHome). homeGuest() is the one answer to "may this
 *             player be in that host's Home room?"; the room module asks it on join and on re-validation.
 *   pending   { [publicId]: [{ n, at, cityId, payload, keep, refund? }] }  life effects owed to a player who was
 *             offline (a gift waiting to be credited, a friendship to record); applied on their next request
 *   (Receipts are not kept here. A gift, an interaction and a new group go through ctx.once — see
 *   server/routes/once.ts — which keeps them in the acting player's own session record.)
 *   reports   [{ id, by, about, aboutName, reason, text, at, status, note?, evidence: [body] }]   for moderators
 *             (read and answered through the operator routes — server/routes/moderation.ts)
 *   seq, sweptAt
 *   founder   { account, id }  and  players[id].founder { id, at }: THE FOUNDER IS EVERY PLAYER'S FIRST FRIEND — who that
 *             is, what is stored and why the founder's own record never grows with it: server/social/founder.ts.
 *             A player meets the founder once (meetFounder, on their first request after arriving in a city); a
 *             friendship made that way is not announced, counts toward no limit and no mission, and is not made
 *             again after either of them ended it.
 *   players[id].invite { by, at }: A PLAYER WHO CAME THROUGH AN INVITE LINK AND THEIR INVITER ARE FRIENDS (meetInviter):
 *             an ordinary friendship in both records, made once without a request, and the inviter is told.
 * Only public ids are stored. The cookie secret never enters this collection or any response.
 *
 * TEXT. Every message body and group name passes the text filter (server/moderation/text.ts) and
 * is refused — never altered — with a reason. A player an operator has muted (ctx.checks.muted)
 * cannot send messages or name groups until the mute ends; everything else still works for them.
 *
 * WHICH LIFE AN EFFECT LANDS IN (lifeCity). A player may have a life in several cities, or none.
 * An effect owed to a player — a gift, a refund, a friendship — carries the city it was sent from.
 * It is applied to that player's life in THAT city if they have one; otherwise to the life they
 * played most recently in another city. It is never applied to a life that does not exist, and no
 * life is ever created to receive it. A gift is refused before the sender is charged when the
 * recipient has no life anywhere; a gift already waiting stays waiting (and goes back to the sender
 * after a week) rather than being dropped.
 *
 * BLOCKS IN MEMORY. Who has blocked whom is also kept in a small in-memory index so the room
 * module can hide two players from each other in a public venue without a store read:
 *   ctx.checks.blocked(a, b) → true when either has blocked the other
 * It is loaded before the server takes requests and updated (committed()) once a block, unblock or
 * removal of an idle player is in the data file — never for a change the store had to undo.
 * committed() raises 'blocks-changed' { a, b }.
 */
import { UUID_PATTERN, venueRoomKey, isDeparting } from '../protocol.ts';
import { lagosTime } from '../../src/game/clock.ts';
import { TRANSFER_LIMITS, PLAYER_ACTIONS } from '../../src/game/content/npcs.ts';
import { venueLabel } from '../../src/game/content/venues.ts';
import { presenceOf, describeRoom } from './presence.ts';
import { screenText } from '../moderation/text.ts';
import { FOUNDER_EMAIL_SHA256, FOUNDER_PAGE, WELCOME_NOTE, autoFriend, emailHash, friendsIn, friendsSince } from './founder.ts';
import type { CityId, PlayerRef } from '../../src/types/protocol.ts';
import type { PlayerReportReceipt, ReportReason, ConversationKind, HouseView, SocialPushFrame, SocialUpdate, SocialUpdateKind, Whereabouts, PresenceStatus } from '../../src/types/social.ts';
import type { LifeState } from '../../src/types/life.ts';
import type { AccountRecord, ConversationRecord, Db, HouseRecord, MessageRecord, PendingEffect, PlayerReportRecord, RouteContext, SessionRecord, SocialCollection, SocialEffectPayload, SocialPlayerRecord, WsConnection } from '../types.ts';

/** A request body or socket frame: every field is untrusted until a validator below has read it. */
export type SocialBody = Record<string, unknown>;
/** [recipient public id, frame]: sent by the adapter only after the transaction has committed (deliver()). */
export type PushList = [string, SocialPushFrame][];
export interface Refused { ok: false; code: string; reason: string }
type BlockChange = ['block' | 'unblock', string, string] | ['forget', string];
type VisitEnd = [string, string];
/** The visits and block changes one transaction made, kept per collection copy (see endedIn). */
interface Ended extends Array<VisitEnd> { blocks: BlockChange[]; material?: boolean; pushes: PushList }
type BlockChanges = BlockChange[] & { applied?: boolean };
type Delivered<R> = R extends { push: unknown } ? Omit<R, 'push'> : R;

/** Original beta limits. */
export const LIMITS = Object.freeze({
  body: 500, history: 200, page: 50, friends: 200, requests: 30, blocked: 200, convs: 100, groups: 20, groupSize: 12, groupName: 32,
  updates: 50, reports: 2000, ownReports: 20, reportText: 300, pending: 50,
  guests: 5, knockMs: 60000, knockCooldownMs: 60000, visitMs: 30 * 60000,
  strangerMessages: 3, newChatsPerDay: 10, searchResults: 10,
  escrowMs: 7 * 86400000, playerIdleMs: 45 * 86400000, sweepMs: 3600000,
});
export const REPORT_REASONS: readonly ReportReason[] = Object.freeze<ReportReason[]>(['harassment', 'spam', 'cheating', 'offensive-name', 'other']);

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const CLIENT_ID = /^[A-Za-z0-9:_-]{8,80}$/;
const CONV_ID = /^(dm|g|h)\.[0-9a-f.-]{1,80}$/;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const naira = (value: unknown): string => `₦${Math.round(Number(value) || 0).toLocaleString('en-NG')}`;
const no = (code: string, reason: string, extra?: object): Refused => ({ ok: false, code, reason, ...extra });
const yes = <C extends string, const E extends object = object>(code: C, extra?: E): { ok: true; code: C } & E => ({ ok: true, code, ...extra } as { ok: true; code: C } & E);
/** The truthiness of `duplicate` on a result that ctx.once may have replayed. */
const repeated = (value: object): boolean => Boolean(Reflect.get(value, 'duplicate'));
const dmId = (a: string, b: string): string => `dm.${[a, b].sort().join('.')}`;
type SocialService = ReturnType<typeof buildService>;
const services = new WeakMap<RouteContext, SocialService>();
const ENDED = Symbol('visits ended by this transaction');
const BLOCKS = Symbol('block changes made by this transaction');
const PUSHES = Symbol('pushes owed by this transaction beside its own result');
/** Set on a result (see finish) when the transaction applied a life effect that was owed to the caller. */
export const MATERIAL = Symbol('this transaction changed a life');

export function socialService(ctx: RouteContext): SocialService {
  const cached = services.get(ctx);
  if (cached) return cached;
  const service = buildService(ctx);
  services.set(ctx, service);
  return service;
}

function buildService(ctx: RouteContext) {
  const presence = presenceOf(ctx);
  const now = (): number => ctx.now();
  // [hostId, guestId] visits ended by the transaction that owns a collection copy. Kept per copy (not
  // in one shared list) because another transaction may run between this one's commit and its
  // deliver(): finish() moves the list onto the result inside the transaction, deliver() announces it.
  const endedOf = new WeakMap<SocialCollection, Ended>();
  const endedIn = (s: SocialCollection): Ended => { let list = endedOf.get(s); if (!list) { endedOf.set(s, list = Object.assign([] as VisitEnd[], { blocks: [] as BlockChange[], pushes: [] as PushList })); } return list; };
  // ---- blocks, in memory (see header) ----------------------------------------------------------
  const blockIndex = new Map<string, Set<string>>(); // blocker → Set<blocked>
  const blockedBy = new Map<string, Set<string>>(); // blocked → Set<blocker>, kept in step with blockIndex
  const unlist = (blocker: string, target: string): void => { const set = blockedBy.get(target); if (set) { set.delete(blocker); if (!set.size) blockedBy.delete(target); } };
  const blocked = (a: string, b: string): boolean => Boolean(blockIndex.get(a)?.has(b) || blockIndex.get(b)?.has(a));
  function applyBlockChange(change: BlockChange): void {
    const [op, a, b] = change;
    if (op === 'block') { if (!blockIndex.has(a)) blockIndex.set(a, new Set()); blockIndex.get(a)!.add(b!); if (!blockedBy.has(b!)) blockedBy.set(b!, new Set()); blockedBy.get(b!)!.add(a); }
    else if (op === 'unblock') { blockIndex.get(a)?.delete(b!); if (!blockIndex.get(a)?.size) blockIndex.delete(a); unlist(a, b!); }
    else if (op === 'forget') { for (const target of blockIndex.get(a) ?? []) unlist(a, target); blockIndex.delete(a); }
  }
  if (ctx.checks) {
    ctx.checks.blocked = blocked;
    ctx.checks.anyBlocks = () => blockIndex.size > 0;
    ctx.checks.blockedWith = (id) => new Set([...(blockIndex.get(id) ?? []), ...(blockedBy.get(id) ?? [])]);
  }
  ctx.startup?.push(ctx.store.read((db) => Object.entries(db.social?.players ?? {}).map(([id, player]): [string, string[]] => [id, Object.keys(player?.blocked ?? {})]))
    .then((rows) => { for (const [id, list] of rows) for (const other of list) applyBlockChange(['block', id, other]); }));
  /** null, or the refusal for a muted sender. */
  const mutedRefusal = (id: string): Refused | null => { const mute = ctx.checks?.muted?.(id); return mute ? no(mute.code, mute.reason) : null; };
  /** null, or the refusal for text the filter does not accept. */
  const screened = (value: unknown, what: string, contact = false): Refused | null => { const verdict = screenText(value, { what, contact }); return verdict ? no(verdict.code, verdict.reason) : null; };
  const bad = (code: string) => ctx.fail(400, code);

  // ---- input validation (throws 400) ---------------------------------------------------------
  const uuid = (value: unknown, code = 'invalid_player'): string => { if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw bad(code); return value.toLowerCase(); };
  const city = (value: unknown): CityId => { const found = ctx.cityIds.find((id) => id === value); if (!found) throw bad('invalid_city'); return found; };
  /** A message's client id: any opaque retry key (the message itself is the record). Writes that go through ctx.once need the timed form instead. */
  const clientId = (value: unknown): string => { if (typeof value !== 'string' || !CLIENT_ID.test(value)) throw bad('invalid_client_id'); return value; };
  function text(value: unknown, max: number, code: string): string {
    const body = typeof value === 'string' ? value.trim() : '';
    if (!body || body.length > max || CONTROL.test(body)) throw bad(code);
    return body;
  }
  const convId = (value: unknown): string => { if (typeof value !== 'string' || !CONV_ID.test(value)) throw bad('invalid_conversation'); return value; };

  // ---- collection ----------------------------------------------------------------------------
  const dbOf = new WeakMap<SocialCollection, Db>(); // collection → the db it came from, for ctx.atHome inside pruneHouse
  function col(db: Db): SocialCollection {
    const s = ctx.collection(db, 'social');
    dbOf.set(s, db);
    if (!isRecord(s.players)) s.players = {};
    if (!isRecord(s.convs)) s.convs = {};
    if (!isRecord(s.houses)) s.houses = {};
    if (!isRecord(s.pending)) s.pending = {};
    // Receipts written by earlier builds: their ids are no longer accepted (server/routes/once.ts), so nothing can replay them.
    if (Reflect.get(s, 'receipts') !== undefined) Reflect.deleteProperty(s, 'receipts');
    if (!Array.isArray(s.reports)) s.reports = [];
    if (!Number.isSafeInteger(s.seq)) s.seq = 0;
    return s;
  }
  // ---- the founder (server/social/founder.ts) --------------------------------------------------
  const founderHash = ctx.config?.founderEmailSha256 ?? FOUNDER_EMAIL_SHA256;
  // The last address compared and what came of it: an account's address is hashed once, not on every request.
  let comparedEmail = '', comparedSame = false;
  const isFounderEmail = (email: unknown): boolean => {
    if (typeof email !== 'string' || !email) return false;
    if (email !== comparedEmail) { comparedEmail = email; comparedSame = emailHash(email) === founderHash; }
    return comparedSame;
  };
  /** One account, read by key alone (on the Worker accounts are rows). */
  const accountOf = (db: Db | undefined, key: string | undefined): AccountRecord | undefined => {
    const account = db && typeof key === 'string' && key !== '__proto__' ? db.accounts?.[key] : undefined;
    return account !== null && typeof account === 'object' ? account : undefined;
  };
  /** The founder's character, or null: the noted account still exists, still has that address and still plays that character. */
  function founderId(s: SocialCollection): string | null {
    const noted = s.founder;
    if (!founderHash || !isRecord(noted) || typeof noted.id !== 'string' || !Object.hasOwn(s.players, noted.id)) return null;
    const account = accountOf(dbOf.get(s), noted.account);
    return account && account.publicId === noted.id && isFounderEmail(account.email) ? noted.id : null;
  }
  /** The caller is the character of the founder's account: note it, so everyone else's requests can find it. */
  function noteFounder(s: SocialCollection, db: Db, session: SessionRecord): void {
    if (!founderHash || session.account === undefined) return;
    const account = accountOf(db, session.account);
    if (!account || account.publicId !== session.publicId || !isFounderEmail(account.email)) return;
    if (s.founder?.account !== account.id || s.founder.id !== session.publicId) s.founder = { account: account.id, id: session.publicId };
  }
  /**
   * THE FIRST FRIEND, ONCE. Runs for every caller (a new player's first request, and an earlier player's next one):
   * with no founder yet nothing is marked, so it is tried again later. A block either way is respected, and the
   * marker is still set: it is never tried a second time. The friendship is written on this player's side only,
   * through no request, no update line, no push and no life action (so no mission, goal or reward counts it), and the
   * founder's welcome note is put in this player's Messages alone.
   * A player who still holds the friendship follows the founder to another character of the same account.
   */
  function meetFounder(s: SocialCollection, p: SocialPlayerRecord, id: string): void {
    const founder = founderId(s), t = now();
    if (!founder || founder === id || p.founder?.id === founder) return;
    const them = s.players[founder]!, blockedHere = Boolean(p.blocked[founder] || them.blocked[id]);
    if (p.founder) {
      const held = p.friends[p.founder.id];
      if (held === undefined || blockedHere || s.players[p.founder.id]?.friends[id] !== undefined) return;
      delete p.friends[p.founder.id];
      p.founder = { id: founder, at: p.founder.at };
      if (p.friends[founder] === undefined) p.friends[founder] = held;
      endedIn(s).material = true;
      return;
    }
    p.founder = { id: founder, at: t };
    endedIn(s).material = true;
    if (blockedHere) return;
    if (!areFriends(s, id, founder)) {
      delete p.in[founder]; delete p.out[founder]; delete them.in[id]; delete them.out[id];
      p.friends[founder] = t;
    }
    const key = dmId(id, founder);
    if (Object.hasOwn(s.convs, key)) return; // they have talked before: no note
    const conv: ConversationRecord = s.convs[key] = { id: key, kind: 'dm', members: [id, founder].sort(), seq: 1, created: t, messages: [{ seq: 1, from: founder, body: '', at: t, auto: true }] };
    index(s, id, conv);
  }
  /**
   * A PLAYER WHO CAME THROUGH AN INVITE LINK AND THEIR INVITER BECOME FRIENDS, ONCE. The link itself is the growth
   * module's (server/growth/referral.ts: `ref.by` on the newcomer, `invited` on the inviter); this runs when either
   * of the two makes a social request — so a newcomer is introduced once they have arrived in a city, and an inviter
   * whose friends joined before this existed finds them on their next visit. The marker is on the newcomer and is
   * never cleared: a block either way is respected, and a friendship either of them ended is not made again.
   * It is an ordinary friendship (both records, both lives, the usual limit). With a full list on either side the
   * newcomer's friend request is sent instead, and the inviter's update says so.
   */
  function introduce(s: SocialCollection, db: Db, newcomer: string, inviter: string, cityId: CityId): void {
    const a = s.players[newcomer], b = s.players[inviter], t = now();
    if (!a || !b || a.invite || newcomer === inviter) return;
    a.invite = { by: inviter, at: t };
    const ended = endedIn(s), push = ended.pushes;
    ended.material = true;
    if (blockedEither(s, newcomer, inviter) || areFriends(s, newcomer, inviter)) return;
    const full = friendCount(s, inviter) >= LIMITS.friends ? 'Your' : friendCount(s, newcomer) >= LIMITS.friends ? 'Their' : null;
    if (full) {
      const asked = Boolean(a.out[inviter]) || (!b.out[newcomer] && Object.keys(a.out).length < LIMITS.requests && Object.keys(b.in).length < LIMITS.requests);
      if (asked && !a.out[inviter]) { a.out[inviter] = b.in[newcomer] = t; push.push([inviter, { type: 'friend-request', from: pub(s, newcomer) }]); }
      notify(s, inviter, 'invite-joined', `${a.name} joined through your link. ${full} friends list is full, so ${asked ? 'they are waiting in your friend requests instead' : 'you were not made friends'}.`, { from: newcomer }, push);
      return;
    }
    for (const [x, y] of [[a, inviter], [b, newcomer]] as [SocialPlayerRecord, string][]) { delete x.in[y]; delete x.out[y]; }
    a.friends[inviter] = b.friends[newcomer] = t;
    owe(s, db, newcomer, cityId, { op: 'friend', id: inviter, name: b.name });
    owe(s, db, inviter, cityId, { op: 'friend', id: newcomer, name: a.name });
    notify(s, inviter, 'invite-joined', `${a.name} joined through your link. You are friends now: say hello.`, { from: newcomer }, push);
    push.push([inviter, { type: 'social-sync' }], [newcomer, { type: 'social-sync' }]);
  }
  /** The caller as a newcomer (their inviter) and as an inviter (everyone who joined and has arrived), each pair once. */
  function meetInviter(s: SocialCollection, db: Db, session: SessionRecord, p: SocialPlayerRecord, id: string): void {
    const mine = db.growth?.players?.[id];
    if (!mine) return;
    const cityId = lifeCity(session, ctx.cityIds[0]!) ?? ctx.cityIds[0]!;
    if (!p.invite && mine.ref && typeof mine.ref.by === 'string') introduce(s, db, id, mine.ref.by, cityId);
    for (const other of Object.keys(mine.invited ?? {})) {
      const them = Object.hasOwn(s.players, other) ? s.players[other] : undefined;
      if (them && !them.invite && db.growth?.players?.[other]?.ref?.by === id) introduce(s, db, other, id, cityId);
    }
  }
  /** Friends that count toward LIMITS.friends: the automatic friendship with the founder takes no place. */
  const friendCount = (s: SocialCollection, id: string): number => Object.keys(s.players[id]?.friends ?? {}).filter((other) => !autoFriend(s.players, other, id)).length;
  /**
   * The founder's automatic friends, newest first, FOUNDER_PAGE at a time. They are found by reading the players (the
   * founder's record does not list them); `after` is the `next` of the page before.
   */
  function founderFriends(s: SocialCollection, founder: string, after: string | null): { ids: [string, number][]; total: number; next: string | null } {
    const all: [string, number][] = [];
    for (const other in s.players) if (autoFriend(s.players, founder, other)) all.push([other, s.players[other]!.friends[founder]!]);
    all.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const [sinceText = '', afterId = ''] = (after ?? '').split(':'), since = Number(sinceText);
    const start = after === null ? 0 : all.findIndex(([other, at]) => at < since || (at === since && other > afterId));
    const ids = start < 0 ? [] : all.slice(start, start + FOUNDER_PAGE), last = ids.at(-1);
    return { ids, total: all.length, next: last && start + ids.length < all.length ? `${last[1]}:${last[0]}` : null };
  }
  const bodyOf = (message: MessageRecord): string => (message.auto ? WELCOME_NOTE : message.body);

  const pub = (s: SocialCollection, id: string): PlayerRef => ({ id, name: s.players[id]?.name ?? 'Former player', ...(founderId(s) === id ? { founder: true as const } : {}) });
  const blockedEither = (s: SocialCollection, a: string, b: string): boolean => Boolean(s.players[a]?.blocked[b] || s.players[b]?.blocked[a]);
  const areFriends = (s: SocialCollection, a: string, b: string): boolean => friendsIn(s.players, a, b);

  /** Register/refresh the caller, run housekeeping and apply anything owed to their life. */
  function enter(db: Db, session: SessionRecord): { s: SocialCollection; p: SocialPlayerRecord; id: string } {
    // A session whose lives are all still held for the quick start (state.onboarding.required: Play has not
    // been confirmed) has not arrived in any city: it is not registered as a player, so nobody can find,
    // message or befriend it yet. A guest who has tapped Play is in the city like anyone else.
    const lives = Object.values(session.cities || {}).map((entry) => entry?.state?.onboarding).filter(Boolean);
    if (lives.length ? lives.every((o) => o?.required === true && o.done !== true) : session.onboarding === true) throw ctx.fail(403, 'onboarding_required');
    const s = col(db), id = session.publicId, t = now();
    const p = s.players[id] ||= { name: session.name, first: t, seen: t, friends: {}, in: {}, out: {}, blocked: {}, convs: {}, updates: [], reports: [],
      baeIn: {}, bae: null, visiting: null, recv: { day: 0, amount: 0 }, chats: { day: 0, count: 0 } };
    p.name = session.name; p.seen = t;
    noteFounder(s, db, session);
    sweep(s, t);
    meetInviter(s, db, session, p, id);
    claim(s, session);
    meetFounder(s, p, id);
    return { s, p, id };
  }
  /** The other player's record, or a refusal. Blocking is reported the same way in both directions. */
  function other(s: SocialCollection, me: string, id: string, { allowBlocked = false } = {}): { refusal: Refused; target?: undefined } | { target: SocialPlayerRecord; refusal?: undefined } {
    if (id === me) return { refusal: no('self', 'That is you.') };
    const target = s.players[id];
    if (!target) return { refusal: no('unknown_player', 'That player was not found. They may not have played yet.') };
    if (!allowBlocked && s.players[me]!.blocked[id]) return { refusal: no('blocked', `You blocked ${target.name}. Unblock them in People to do this.`) };
    if (!allowBlocked && target.blocked[me]) return { refusal: no('blocked', `${target.name} is not accepting this from you.`) };
    return { target };
  }

  function whereabouts(id: string, detailed: boolean): Whereabouts {
    const status = presence.status(id);
    // `seenAt` is the server time it last heard from that player's connection (a frame or a ping answer);
    // once they are gone it is when their last connection closed, if this server process saw it.
    if (status.state !== 'online') return { status: status.state, ...(Number.isFinite(status.seenAt) ? { seenAt: status.seenAt } : {}) };
    if (!status.rooms.length) return { status: 'away', seenAt: status.seenAt };
    if (!detailed) return { status: 'online', seenAt: status.seenAt };
    // Their own venue room says where they are; a socket in someone else's Home room is a visit, not "at home".
    const rooms = status.rooms.map(describeRoom);
    const own = rooms.find((room) => !room.home || room.hostId === id);
    return own ? { status: 'online', seenAt: status.seenAt, cityId: own.cityId, venue: own.venue } : { status: 'online', seenAt: status.seenAt, cityId: rooms[0]!.cityId, venue: 'visit' };
  }

  function notify(s: SocialCollection, to: string, kind: SocialUpdateKind, message: string, data: SocialUpdate['data'] | null, push: PushList): void {
    const target = s.players[to];
    if (!target) return;
    const update: SocialUpdate = { id: ++s.seq, kind, text: message, at: now(), read: false, ...(data ? { data } : {}) };
    target.updates.push(update);
    if (target.updates.length > LIMITS.updates) target.updates.splice(0, target.updates.length - LIMITS.updates);
    push.push([to, { type: 'social-update', update }]);
  }

  // ---- life effects (through the rules engine only) ------------------------------------------
  // 'social.server' is a server-only action: it runs through ctx.act and is refused on the public
  // /api/action. `actionId` seeds the outcome, so a replayed request rolls the same dice.
  // `guard` says why a repeat cannot apply twice when the call is not inside ctx.once (see ctx.act in server.js).
  function act(session: SessionRecord, cityId: CityId, op: string, payload: object, actionId: string, guard?: string) {
    return ctx.act(ctx.settle(session, cityId), { type: 'social.server', cityId, actionId, payload: { ...payload, op }, ...(guard ? { stateGuard: guard } : {}) });
  }
  /** Has this session a life in that city that has arrived? (One still held for the quick start does not count; a guest who is playing does.) */
  const hasLife = (session: SessionRecord | null | undefined, cityId: CityId): boolean => {
    const state = session?.cities?.[cityId]?.state;
    return !!state && !(state.onboarding?.required === true && state.onboarding.done !== true);
  };
  /** The city whose life receives an effect sent from `preferred` — see the header. null: this player has no life anywhere. */
  function lifeCity(session: SessionRecord, preferred: CityId): CityId | null {
    if (hasLife(session, preferred)) return preferred;
    const others = ctx.cityIds.filter((cityId) => hasLife(session, cityId)).sort((a, b) => (session.cities[b]!.updatedAt ?? 0) - (session.cities[a]!.updatedAt ?? 0));
    return others[0] ?? null;
  }
  function onlineSession(db: Db, id: string): SessionRecord | null {
    for (const ws of presence.sockets(id)) {
      const session = ctx.core.sessionOf(ws, db);
      if (session && session.publicId === id && session.expiresAt > now()) return session;
    }
    return null;
  }
  /** 'applied' | 'refused' (the rules engine said no) | 'no-life' (nowhere to apply it yet: it waits). */
  function runEffect(session: SessionRecord, effect: PendingEffect): 'applied' | 'refused' | 'no-life' {
    const cityId = lifeCity(session, effect.cityId);
    if (!cityId) return 'no-life';
    return act(session, cityId, effect.payload.op, effect.payload, `social|effect|${effect.n}`, 'an owed effect is applied and taken off the queue in one transaction').ok ? 'applied' : 'refused';
  }
  /** Apply a life effect to another player now if they are connected, otherwise keep it for their next request. */
  function owe(s: SocialCollection, db: Db, to: string, cityId: CityId, payload: SocialEffectPayload, { keep = false, refund = false } = {}): boolean {
    const effect: PendingEffect = { n: ++s.seq, at: now(), cityId, payload, keep, ...(refund ? { refund: true } : {}) };
    const session = onlineSession(db, to);
    if (session && runEffect(session, effect) === 'applied') return true;
    const queue = s.pending[to] ||= [];
    queue.push(effect);
    // Money (keep) is never dropped; only bookkeeping effects make room.
    while (queue.length > LIMITS.pending) { const drop = queue.findIndex((item) => !item.keep); if (drop < 0) break; queue.splice(drop, 1); }
    return false;
  }
  function claim(s: SocialCollection, session: SessionRecord): void {
    const queue = s.pending[session.publicId];
    if (!queue?.length) return;
    const left: PendingEffect[] = [];
    for (const effect of queue) {
      const outcome = runEffect(session, effect);
      // Money (keep) is never dropped. Anything waits while the player has no life to apply it to.
      if (outcome === 'no-life' || (outcome === 'refused' && effect.keep)) left.push(effect);
      else endedIn(s).material = true; // a gift or a friendship reached this life (or was settled): the request must be durable
    }
    if (left.length) s.pending[session.publicId] = left; else delete s.pending[session.publicId];
  }

  /** Hourly housekeeping: return unclaimed gifts, forget long-idle players. */
  function sweep(s: SocialCollection, t: number): void {
    if (t - (s.sweptAt || 0) < LIMITS.sweepMs) return;
    s.sweptAt = t;
    for (const [to, queue] of Object.entries(s.pending)) {
      const keep: PendingEffect[] = [];
      for (const effect of queue) {
        const stale = t - effect.at > LIMITS.escrowMs;
        if (!stale) keep.push(effect);
        else if (effect.keep && !effect.refund && effect.payload.op === 'transfer-in' && s.players[effect.payload.from]) {
          // An unclaimed gift goes back to the sender, as a pending credit of their own.
          (s.pending[effect.payload.from] ||= []).push({ n: ++s.seq, at: t, cityId: effect.cityId, keep: true, refund: true,
            payload: { op: 'transfer-in', from: to, name: s.players[to]?.name ?? 'your friend', amount: effect.payload.amount, refund: true } });
        } else if (effect.keep && effect.refund && s.players[to]) keep.push(effect);
      }
      if (keep.length) s.pending[to] = keep; else delete s.pending[to];
    }
    const founder = founderId(s);
    for (const [id, p] of Object.entries(s.players)) {
      // The founder is kept however long they are away: every player's first friendship points at their record.
      if (t - p.seen <= LIMITS.playerIdleMs || presence.status(id).state === 'online' || id === founder) continue;
      for (const friend of Object.keys(p.friends)) delete s.players[friend]?.friends[id];
      for (const key of Object.keys(p.in)) delete s.players[key]?.out[id];
      for (const key of Object.keys(p.out)) delete s.players[key]?.in[id];
      for (const key of Object.keys(p.convs)) leaveConv(s, s.convs[key], id, true);
      delete s.houses[id]; delete s.players[id];
      endedIn(s).blocks.push(['forget', id]);
    }
    for (const hostId of Object.keys(s.houses)) pruneHouse(s, hostId);
  }

  // ---- conversations -------------------------------------------------------------------------
  function messageView(s: SocialCollection, conv: ConversationRecord, message: MessageRecord, viewer: string) {
    return { seq: message.seq, id: `${conv.id}#${message.seq}`, conv: conv.id, from: message.from ? pub(s, message.from) : null, body: bodyOf(message), at: message.at,
      ...(message.sys ? { sys: true as const } : {}), ...(message.auto ? { auto: true as const } : {}), ...(message.from === viewer && message.cid ? { clientId: message.cid } : {}) };
  }
  const visibleTo = (s: SocialCollection, viewer: string, message: MessageRecord): boolean => !message.from || !s.players[viewer]?.blocked[message.from];
  function summary(s: SocialCollection, conv: ConversationRecord, viewer: string) {
    const read = s.players[viewer]?.convs[conv.id]?.read ?? 0;
    const seen = conv.messages.filter((message) => visibleTo(s, viewer, message));
    const last = seen.at(-1);
    const others = conv.members.filter((id) => id !== viewer);
    return { id: conv.id, kind: conv.kind, name: conv.kind === 'dm' ? pub(s, others[0]!).name : conv.kind === 'house' ? `${pub(s, conv.owner!).name}’s house` : conv.name!,
      members: conv.members.map((id) => pub(s, id)), owner: conv.owner ?? null, with: conv.kind === 'dm' ? others[0]! : null,
      last: last ? { seq: last.seq, from: last.from ? pub(s, last.from) : null, body: bodyOf(last).slice(0, 80), at: last.at } : null,
      unread: seen.filter((message) => message.seq > read && message.from !== viewer && !message.sys).length };
  }
  function append(s: SocialCollection, conv: ConversationRecord, from: string | null, body: string, cid: string | null, sys = false): MessageRecord {
    const message: MessageRecord = { seq: ++conv.seq, from, body, at: now(), ...(cid ? { cid } : {}), ...(sys ? { sys: true as const } : {}) };
    conv.messages.push(message);
    if (conv.messages.length > LIMITS.history) conv.messages.splice(0, conv.messages.length - LIMITS.history);
    if (from && s.players[from]?.convs[conv.id]) s.players[from]!.convs[conv.id]!.read = message.seq;
    return message;
  }
  function fanOut(s: SocialCollection, conv: ConversationRecord, message: MessageRecord, push: PushList, except: string | null): void {
    for (const member of conv.members) {
      if (member === except || !visibleTo(s, member, message)) continue;
      push.push([member, { type: 'dm', conv: summary(s, conv, member), message: messageView(s, conv, message, member) }]);
    }
  }
  function index(s: SocialCollection, id: string, conv: ConversationRecord): void {
    const p = s.players[id];
    if (!p || p.convs[conv.id]) return;
    const ids = Object.keys(p.convs);
    if (ids.length >= LIMITS.convs) {
      // Make room by dropping the quietest direct chat from this player's list (history stays for the other side).
      const quiet = ids.filter((key) => s.convs[key]?.kind === 'dm').sort((a, b) => (s.convs[a]!.messages.at(-1)?.at ?? 0) - (s.convs[b]!.messages.at(-1)?.at ?? 0))[0];
      if (quiet) { delete p.convs[quiet]; collect(s, quiet); }
    }
    p.convs[conv.id] = { read: 0 };
  }
  /** Delete a conversation nobody lists any more. */
  function collect(s: SocialCollection, id: string): void {
    const conv = s.convs[id];
    if (conv && !conv.members.some((member) => s.players[member]?.convs[id])) delete s.convs[id];
  }
  function leaveConv(s: SocialCollection, conv: ConversationRecord | undefined | null, id: string, silent = false): void {
    if (!conv) return;
    delete s.players[id]?.convs[conv.id];
    if (conv.kind === 'dm') { collect(s, conv.id); return; }
    conv.members = conv.members.filter((member) => member !== id);
    if (!conv.members.length) { delete s.convs[conv.id]; return; }
    if (conv.kind === 'group' && conv.owner === id) conv.owner = conv.members[0]!;
    if (!silent) append(s, conv, null, `${pub(s, id).name} left.`, null, true);
  }
  function memberConv(s: SocialCollection, me: string, id: string): ConversationRecord | null {
    const conv = Object.hasOwn(s.convs, id) ? s.convs[id] ?? null : null;
    return conv && conv.members.includes(me) && s.players[me]!.convs[id] ? conv : null;
  }

  // ---- houses --------------------------------------------------------------------------------
  /** Is the host's stored life at home in the visit's city? When that cannot be known (no host helper, no document) the answer is no. */
  function hostAtHome(s: SocialCollection, hostId: string, cityId: CityId | undefined): boolean {
    const db = dbOf.get(s);
    if (typeof ctx.atHome !== 'function' || !db) return false;
    return cityId ? ctx.atHome(db, hostId, cityId) : ctx.cityIds.some((city) => ctx.atHome(db, hostId, city));
  }
  function pruneHouse(s: SocialCollection, hostId: string): HouseRecord | null {
    const house = s.houses[hostId];
    if (!house) return null;
    const t = now();
    for (const [visitor, knock] of Object.entries(house.knocks)) {
      if (knock.status === 'pending' ? knock.expires <= t : t - knock.answeredAt! > LIMITS.knockCooldownMs) delete house.knocks[visitor];
    }
    let changed = false;
    for (const [guest, visit] of Object.entries(house.guests)) {
      // A visit ends when it expires, when either blocks the other, and when the host is no longer at home.
      if (visit.expires > t && s.players[guest] && !blockedEither(s, hostId, guest) && hostAtHome(s, hostId, visit.cityId)) continue;
      delete house.guests[guest]; changed = true;
      if (s.players[guest]?.visiting === hostId) s.players[guest].visiting = null;
      endedIn(s).push([hostId, guest]);
    }
    if (changed) syncHouseConv(s, hostId);
    if (!Object.keys(house.knocks).length && !Object.keys(house.guests).length) { delete s.houses[hostId]; return null; }
    return house;
  }
  /** The house chat has exactly the host and the current guests as members. */
  function syncHouseConv(s: SocialCollection, hostId: string): void {
    const id = `h.${hostId}`, guests = Object.keys(s.houses[hostId]?.guests || {});
    let conv = s.convs[id];
    if (!guests.length) {
      if (conv) { for (const member of conv.members) delete s.players[member]?.convs[id]; delete s.convs[id]; }
      return;
    }
    conv ||= s.convs[id] = { id, kind: 'house', owner: hostId, members: [], seq: 0, created: now(), messages: [] };
    const members = [hostId, ...guests];
    for (const member of conv.members) if (!members.includes(member)) delete s.players[member]?.convs[id];
    conv.members = members;
    for (const member of members) index(s, member, conv);
  }
  function houseView(s: SocialCollection, hostId: string, viewer: string): HouseView {
    const house = pruneHouse(s, hostId);
    const guests = Object.entries(house?.guests || {}).map(([id, visit]) => ({ ...pub(s, id), since: visit.since, expiresAt: visit.expires }));
    const cityId = house?.guests[viewer]?.cityId ?? Object.values(house?.guests || {})[0]?.cityId ?? null;
    const role = viewer === hostId ? 'host' : house?.guests[viewer] ? 'guest' : 'none';
    const host = presence.status(hostId);
    return { host: pub(s, hostId), capacity: LIMITS.guests, guests, role, cityId, conv: guests.length && role !== 'none' ? `h.${hostId}` : null,
      hostStatus: host.state !== 'online' ? host.state : host.rooms.some((room) => describeRoom(room).hostId === hostId) ? 'home' : 'out',
      knocks: role === 'host' ? Object.entries(house?.knocks || {}).filter(([, knock]) => knock.status === 'pending').map(([id, knock]) => ({ from: pub(s, id), at: knock.at, expiresAt: knock.expires })) : [] };
  }
  function endVisit(s: SocialCollection, hostId: string, guest: string): boolean {
    const house = s.houses[hostId];
    if (!house?.guests[guest]) return false;
    delete house.guests[guest];
    if (s.players[guest]?.visiting === hostId) s.players[guest].visiting = null;
    endedIn(s).push([hostId, guest]);
    syncHouseConv(s, hostId);
    pruneHouse(s, hostId);
    return true;
  }
  const housePush = (s: SocialCollection, hostId: string, push: PushList): void => { for (const id of [hostId, ...Object.keys(s.houses[hostId]?.guests || {})]) push.push([id, { type: 'invite-house', house: houseView(s, hostId, id) }]); };

  function cut(s: SocialCollection, db: Db, a: string, b: string, cityId: CityId): void {
    const pa = s.players[a]!, pb = s.players[b]!;
    const were = Boolean(pa.friends[b] || pb.friends[a]);
    // An automatic friendship was never written to either life, so there is nothing to take out of one.
    const automatic = autoFriend(s.players, a, b) || autoFriend(s.players, b, a);
    delete pa.friends[b]; delete pb.friends[a];
    for (const [x, y] of [[pa, b], [pb, a]] as [SocialPlayerRecord, string][]) { delete x.in[y]; delete x.out[y]; delete x.baeIn[y]; }
    if (pa.bae === b) pa.bae = null;
    if (pb.bae === a) pb.bae = null;
    if (were && !automatic) for (const [to, about] of [[a, b], [b, a]] as [string, string][]) owe(s, db, to, cityId, { op: 'unfriend', id: about });
  }

  const service = {
    LIMITS,
    presence,
    /**
     * Call INSIDE the transaction, last: attaches the visits this transaction ended to its result
     * (hidden from JSON), so deliver() can announce exactly those after the commit.
     */
    finish<R>(db: Db, result: R): R {
      const list = endedOf.get(ctx.collection(db, 'social'));
      if (!list || !result || typeof result !== 'object') return result;
      if (list.material) Object.defineProperty(result, MATERIAL, { value: true, enumerable: false });
      if (list.length) Object.defineProperty(result, ENDED, { value: list.splice(0), enumerable: false });
      if (list.blocks.length) Object.defineProperty(result, BLOCKS, { value: list.blocks.splice(0), enumerable: false });
      if (list.pushes.length) Object.defineProperty(result, PUSHES, { value: list.pushes.splice(0), enumerable: false });
      return result;
    },
    /**
     * Bring the in-memory block index in line with a transaction that has just COMMITTED. Passed
     * to the store as `committed`, so it runs even if the write that follows fails — otherwise a
     * stored block could go unenforced in venue rooms until a restart. Safe to call twice.
     */
    committed(result: unknown): void {
      const changes: unknown = typeof result === 'object' && result !== null ? Reflect.get(result, BLOCKS) : undefined;
      if (!Array.isArray(changes) || (changes as BlockChanges).applied) return;
      (changes as BlockChanges).applied = true;
      for (const change of changes as BlockChange[]) { applyBlockChange(change); if (change[2]) ctx.emit?.('blocks-changed', { a: change[1], b: change[2] }); }
    },
    /** Send the pushes a committed result collected, and strip them from what the caller sees. */
    deliver<R>(result: R): Delivered<R> {
      // Visits that ended in the committed transaction: the room module drops those guests from the host's Home room now.
      const ended: unknown = typeof result === 'object' && result !== null ? Reflect.get(result, ENDED) : undefined;
      for (const [hostId, guestId] of (ended ?? []) as VisitEnd[]) ctx.emit?.('visit-ended', { hostId, guestId });
      service.committed(result); // a store without the `committed` hook: apply the block changes now
      // What the transaction owed beside its own answer (an inviter told that a friend joined).
      const owed: unknown = typeof result === 'object' && result !== null ? Reflect.get(result, PUSHES) : undefined;
      for (const [to, message] of (owed ?? []) as PushList) {
        ctx.push(to, message);
        if (message.type === 'social-update' && message.update.kind === 'invite-joined') ctx.emit?.('invite-joined', { inviter: to });
      }
      if (!result || !Array.isArray((result as { push?: unknown }).push)) return result as Delivered<R>;
      const { push, ...rest } = result as R & { push: PushList };
      for (const [to, message] of push) ctx.push(to, message);
      return rest as Delivered<R>;
    },

    // ---- overview --------------------------------------------------------------------------
    me(db: Db, session: SessionRecord) {
      const { s, p, id } = enter(db, session);
      // An offline friend this process never saw connected (it restarted since) still has the stored time of their last request.
      const person = (other: string) => {
        const where = whereabouts(other, true);
        return { ...pub(s, other), ...where, ...(where.status === 'offline' && !Number.isFinite(where.seenAt) && Number.isFinite(s.players[other]?.seen) ? { seenAt: s.players[other]!.seen } : {}) };
      };
      const visit = p.visiting ? houseView(s, p.visiting, id) : null; // prunes first, so an ended visit is never reported
      // A friend whose record is gone (only an automatic friendship can outlive the other side) is dropped here.
      for (const other of Object.keys(p.friends)) if (!Object.hasOwn(s.players, other)) delete p.friends[other];
      const friend = ([other, since]: [string, number]) => ({ ...person(other), since, bae: p.bae === other });
      // The founder is first in everyone's list. The founder's own list is their friends by request, then the newest automatic ones.
      const friends = Object.entries(p.friends).map(friend).sort((a, b) => Number(b.founder === true) - Number(a.founder === true) || a.name.localeCompare(b.name));
      const automatic = founderId(s) === id ? founderFriends(s, id, null) : null;
      return yes('ok', {
        me: { id, name: p.name, since: p.first },
        friends: automatic ? [...friends, ...automatic.ids.map(friend)] : friends,
        ...(automatic ? { friendsMore: { total: automatic.total, next: automatic.next } } : {}),
        requests: { in: Object.entries(p.in).map(([other, at]) => ({ ...pub(s, other), at })), out: Object.entries(p.out).map(([other, at]) => ({ ...pub(s, other), at })) },
        baeRequests: Object.entries(p.baeIn).map(([other, request]) => ({ ...pub(s, other), at: request.at })),
        bae: p.bae ? pub(s, p.bae) : null,
        blocked: Object.entries(p.blocked).map(([other, at]) => ({ ...pub(s, other), at })),
        conversations: service.conversations(db, session).conversations,
        updates: p.updates.slice().reverse(),
        reports: p.reports.slice().reverse(),
        house: houseView(s, id, id),
        visiting: visit?.role === 'guest' ? visit : null,
        invitePath: `/v/${id}`,
        limits: { body: LIMITS.body, groupSize: LIMITS.groupSize, groupName: LIMITS.groupName, guests: LIMITS.guests, reportText: LIMITS.reportText, reasons: REPORT_REASONS },
      });
    },
    /** The founder's next page of automatic friends (`after`: the `next` of the page before). Anyone else has no further page. */
    friendsPage(db: Db, session: SessionRecord, after: unknown) {
      const { s, p, id } = enter(db, session);
      if (typeof after !== 'string' || !/^\d{1,16}:[0-9a-f-]{36}$/.test(after)) throw bad('invalid_cursor');
      if (founderId(s) !== id) return yes('ok', { friends: [], total: 0, next: null });
      const page = founderFriends(s, id, after);
      return yes('ok', { friends: page.ids.map(([other, since]) => ({ ...pub(s, other), ...whereabouts(other, true), since, bae: p.bae === other })), total: page.total, next: page.next });
    },
    readUpdates(db: Db, session: SessionRecord) {
      const { p } = enter(db, session);
      for (const update of p.updates) update.read = true;
      return yes('read');
    },

    // ---- people ----------------------------------------------------------------------------
    /** Who shares the caller's venue room right now, from server presence only. */
    people(db: Db, session: SessionRecord, rawCity: unknown) {
      const cityId = city(rawCity);
      const { s, p, id } = enter(db, session);
      const state = ctx.settle(session, cityId);
      const travelling = isDeparting(state);
      const room = venueRoomKey(cityId, state.location, id);
      const joined = !travelling && presence.isIn(id, room);
      // `look` (appearance option ids) and `here` come from the room module's own record of who is in the room.
      const inRoom = new Map(presence.inRoom(room).map((member) => [member.id, member]));
      const card = (member: string) => ({ ...pub(s, member), friend: areFriends(s, id, member), requested: Boolean(p.out[member]), incoming: Boolean(p.in[member]),
        look: inRoom.get(member)?.look ?? null, here: inRoom.has(member) });
      let players: ReturnType<typeof card>[] = [];
      if (state.location === 'home') players = Object.keys(pruneHouse(s, id)?.guests || {}).map(card);
      else if (joined) players = [...inRoom.values()].filter((member) => member.id !== id && s.players[member.id] && !blockedEither(s, id, member.id)).map((member) => card(member.id));
      return yes('ok', { cityId, venue: state.location, self: travelling ? 'travelling' as const : joined ? 'joined' as const : 'not_joined' as const, players, count: players.length });
    },
    search(db: Db, session: SessionRecord, query: unknown) {
      const { s, id } = enter(db, session);
      const q = typeof query === 'string' ? query.trim().replace(/^@/, '').toLowerCase() : '';
      if (q.length < 2 || q.length > 36 || CONTROL.test(q)) throw bad('invalid_query');
      if (!ctx.allow(`social:search:${id}`, 20)) return no('rate_limited', 'You are searching too quickly. Wait a moment.');
      const results = [];
      for (const [other, player] of Object.entries(s.players)) {
        if (other === id || blockedEither(s, id, other)) continue;
        if (other === q || player.name.toLowerCase().includes(q)) results.push({ ...pub(s, other), friend: areFriends(s, id, other), exact: other === q || player.name.toLowerCase() === q });
        if (results.length >= 200) break;
      }
      results.sort((a, b) => Number(b.exact) - Number(a.exact) || a.name.localeCompare(b.name));
      return yes('ok', { results: results.slice(0, LIMITS.searchResults).map(({ exact, ...rest }) => rest) });
    },
    profile(db: Db, session: SessionRecord, rawId: unknown) {
      const target = uuid(rawId);
      const { s, p, id } = enter(db, session);
      if (target !== id && (!s.players[target] || s.players[target].blocked[id])) return no('unknown_player', 'That player was not found. They may not have played yet.');
      const friend = areFriends(s, id, target);
      return yes('ok', { player: { ...pub(s, target), self: target === id, friend, requested: Boolean(p.out[target]), incoming: Boolean(p.in[target]), blocked: Boolean(p.blocked[target]),
        bae: p.bae === target, baeAsked: Boolean(s.players[target]!.baeIn[id]), ...whereabouts(target, friend) } });
    },

    // ---- friends ---------------------------------------------------------------------------
    friendRequest(db: Db, session: SessionRecord, body: SocialBody) {
      const to = uuid(body.to), cityId = city(body.cityId);
      const { s, p, id } = enter(db, session);
      const { target, refusal } = other(s, id, to);
      if (refusal) return refusal;
      if (areFriends(s, id, to)) return yes('already_friends', { player: pub(s, to) });
      if (p.in[to]) return service.friendAnswer(db, session, { from: to, accept: true, cityId });
      if (p.out[to]) return yes('requested', { player: pub(s, to), duplicate: true });
      if (!ctx.allow(`social:friend:${id}`, 10)) return no('rate_limited', 'You are sending friend requests too quickly. Wait a minute.');
      if (Object.keys(p.out).length >= LIMITS.requests) return no('too_many_requests', `You have ${LIMITS.requests} friend requests waiting. Wait for answers first.`);
      if (Object.keys(target.in).length >= LIMITS.requests) return no('inbox_full', `${target.name} has too many friend requests waiting.`);
      if (friendCount(s, id) >= LIMITS.friends) return no('friends_full', `Your friends list is full (${LIMITS.friends}).`);
      p.out[to] = target.in[id] = now();
      const push: PushList = [[to, { type: 'friend-request', from: pub(s, id) }]];
      notify(s, to, 'friend-request', `${p.name} wants to be friends.`, { from: id }, push);
      return yes('requested', { player: pub(s, to), push });
    },
    friendAnswer(db: Db, session: SessionRecord, body: SocialBody) {
      const from = uuid(body.from), cityId = city(body.cityId);
      if (typeof body.accept !== 'boolean') throw bad('invalid_answer');
      const { s, p, id } = enter(db, session);
      const asker = s.players[from];
      if (areFriends(s, id, from)) return yes('accepted', { player: pub(s, from), duplicate: true });
      if (!p.in[from] || !asker) return no('no_request', 'That friend request is no longer waiting. It may have been withdrawn or already answered.');
      delete p.in[from]; delete asker.out[id];
      const push: PushList = [];
      if (!body.accept) return yes('declined', { player: pub(s, from), push });
      if (friendCount(s, id) >= LIMITS.friends || friendCount(s, from) >= LIMITS.friends) return no('friends_full', `One of you already has ${LIMITS.friends} friends.`);
      p.friends[from] = asker.friends[id] = now();
      act(session, cityId, 'friend', { id: from, name: asker.name }, `social|friend|${id}|${from}`, 'the friendship is written to the social collection in this transaction; a repeat is answered from it');
      owe(s, db, from, cityId, { op: 'friend', id, name: p.name });
      push.push([from, { type: 'friend-accepted', by: pub(s, id) }], [from, { type: 'social-sync' }]);
      notify(s, from, 'friend-accepted', `${p.name} accepted your friend request.`, { from: id }, push);
      return yes('accepted', { player: pub(s, from), push });
    },
    friendRemove(db: Db, session: SessionRecord, body: SocialBody) {
      const other = uuid(body.id), cityId = city(body.cityId);
      const { s, p, id } = enter(db, session);
      if (!s.players[other] || !(areFriends(s, id, other) || p.friends[other] || p.out[other])) return yes('removed', { duplicate: true });
      // A player who removes the founder does not make the founder's client read everything again.
      const quiet = autoFriend(s.players, other, id);
      cut(s, db, id, other, cityId);
      return yes('removed', { push: quiet ? [] : [[other, { type: 'social-sync' }]] });
    },

    // ---- block and report ------------------------------------------------------------------
    block(db: Db, session: SessionRecord, body: SocialBody) {
      const target = uuid(body.id), cityId = city(body.cityId);
      const { s, p, id } = enter(db, session);
      if (target === id) return no('self', 'You cannot block yourself.');
      if (!s.players[target]) return no('unknown_player', 'That player was not found.');
      if (p.blocked[target]) return yes('blocked', { duplicate: true });
      if (Object.keys(p.blocked).length >= LIMITS.blocked) return no('block_list_full', `Your block list is full (${LIMITS.blocked}). Unblock someone first.`);
      p.blocked[target] = now();
      endedIn(s).blocks.push(['block', id, target]);
      cut(s, db, id, target, cityId);
      const push: PushList = [];
      for (const [host, guest] of [[id, target], [target, id]] as [string, string][]) if (endVisit(s, host, guest)) { housePush(s, host, push); push.push([guest, { type: 'invite-house', house: houseView(s, host, guest) }]); }
      delete s.houses[id]?.knocks[target]; delete s.houses[target]?.knocks[id];
      return yes('blocked', { push });
    },
    unblock(db: Db, session: SessionRecord, body: SocialBody) {
      const target = uuid(body.id);
      const { s, p, id } = enter(db, session);
      if (p.blocked[target]) endedIn(s).blocks.push(['unblock', id, target]);
      delete p.blocked[target];
      return yes('unblocked');
    },
    /** File a report for moderators. The reporter gets a receipt that survives reloads. */
    report(db: Db, session: SessionRecord, body: SocialBody) {
      const about = uuid(body.id);
      const reason = REPORT_REASONS.find((item) => item === body.reason);
      if (!reason) throw bad('invalid_reason');
      const detail = body.text === undefined || body.text === '' ? '' : text(body.text, LIMITS.reportText, 'invalid_report_text');
      const { s, p, id } = enter(db, session);
      if (about === id) return no('self', 'You cannot report yourself.');
      if (!s.players[about]) return no('unknown_player', 'That player was not found.');
      const existing = p.reports.find((report) => report.about === about && report.reason === reason && now() - report.at < 86400000);
      if (existing) return yes('reported', { receipt: existing, duplicate: true });
      if (!ctx.allow(`social:report:${id}`, 5, 3600000)) return no('rate_limited', 'You have filed several reports this hour. Try again later.');
      const dm = s.convs[dmId(id, about)];
      const report: PlayerReportRecord = { id: `R-${++s.seq}`, by: id, about, aboutName: s.players[about].name, reason, text: detail, at: now(), status: 'received',
        evidence: (dm?.messages || []).filter((message) => message.from === about).slice(-5).map(bodyOf) };
      s.reports.push(report);
      if (s.reports.length > LIMITS.reports) s.reports.splice(0, s.reports.length - LIMITS.reports);
      const receipt: PlayerReportReceipt = { id: report.id, about, name: report.aboutName, reason: report.reason, at: report.at, status: report.status };
      p.reports.push(receipt);
      if (p.reports.length > LIMITS.ownReports) p.reports.shift();
      const push: PushList = [];
      notify(s, id, 'report', `Report ${report.id} about ${report.aboutName} was received. A moderator will review it.`, { report: report.id }, push);
      return yes('reported', { receipt, push });
    },

    // ---- messages --------------------------------------------------------------------------
    conversations(db: Db, session: SessionRecord) {
      const { s, p, id } = enter(db, session);
      const list = Object.keys(p.convs).map((key) => s.convs[key]).filter((conv): conv is ConversationRecord => Boolean(conv && !(conv.kind === 'dm' && p.blocked[conv.members.find((member) => member !== id)!])))
        .map((conv) => summary(s, conv, id)).sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0));
      return yes('ok', { conversations: list, unread: list.reduce((sum, conv) => sum + conv.unread, 0) });
    },
    history(db: Db, session: SessionRecord, rawConv: unknown, after: unknown) {
      const key = convId(rawConv);
      const { s, p, id } = enter(db, session);
      const conv = memberConv(s, id, key);
      if (!conv) return no('not_a_member', 'You are not in that conversation.');
      const from = typeof after === 'number' && Number.isSafeInteger(after) && after >= 0 ? after : 0;
      const messages = conv.messages.filter((message) => message.seq > from && visibleTo(s, id, message)).slice(-LIMITS.page).map((message) => messageView(s, conv, message, id));
      return yes('ok', { conv: summary(s, conv, id), messages, read: p.convs[key]!.read });
    },
    read(db: Db, session: SessionRecord, body: SocialBody) {
      const key = convId(body.conv);
      const { s, p, id } = enter(db, session);
      const conv = memberConv(s, id, key);
      if (!conv) return no('not_a_member', 'You are not in that conversation.');
      const seq = typeof body.seq === 'number' && Number.isSafeInteger(body.seq) ? Math.max(0, Math.min(body.seq, conv.seq)) : conv.seq;
      p.convs[key]!.read = Math.max(p.convs[key]!.read, seq);
      return yes('read', { conv: summary(s, conv, id) });
    },
    /**
     * Send to a player (`to`) or an existing conversation (`conv`). Idempotent on the sender's
     * `clientId`: a retry returns the stored message and nothing is stored or delivered twice.
     */
    send(db: Db, session: SessionRecord, body: SocialBody) {
      const cid = clientId(body.clientId), message = text(body.body, LIMITS.body, 'invalid_message');
      const to = body.to !== undefined ? uuid(body.to) : null, key = to ? dmId(session.publicId, to) : convId(body.conv);
      const { s, p, id } = enter(db, session);
      let conv = Object.hasOwn(s.convs, key) ? s.convs[key] : null;
      const sent = conv?.messages.find((item) => item.from === id && item.cid === cid);
      if (sent && conv) {
        // A replay is answered only to someone who is still in the conversation: a removed group
        // member or a guest whose visit ended learns nothing about it by resending an old message.
        const still = conv.members.includes(id) && (conv.kind === 'dm' || Boolean(p.convs[key]));
        if (!still) return no('not_a_member', 'You are not in that conversation.');
        if (sent.body !== message) throw ctx.fail(409, 'client_id_conflict');
        return yes('sent', { conv: summary(s, conv, id), message: messageView(s, conv, sent, id), duplicate: true });
      }
      const refused = mutedRefusal(id) ?? screened(message, 'Your message');
      if (refused) return refused;
      if (!ctx.allow(`social:dm:${id}`, 30)) return no('rate_limited', 'You are sending messages too quickly. Wait a moment, then retry.');
      const partner = to ?? (conv?.kind === 'dm' ? conv.members.find((member) => member !== id) : null);
      if (partner) {
        const { target, refusal } = other(s, id, partner);
        if (refusal) return refusal;
        const friends = areFriends(s, id, partner);
        if (!conv) {
          const day = lagosTime(now()).day;
          if (p.chats.day !== day) p.chats = { day, count: 0 };
          if (!friends && p.chats.count >= LIMITS.newChatsPerDay) return no('new_chat_limit', `You can start ${LIMITS.newChatsPerDay} chats with new people a day. Add friends to message freely.`);
          if (!friends) p.chats.count += 1;
          conv = s.convs[key] = { id: key, kind: 'dm', members: [id, partner].sort(), seq: 0, created: now(), messages: [] };
        }
        if (!friends && !conv.messages.some((item) => item.from === partner) && conv.messages.filter((item) => item.from === id).length >= LIMITS.strangerMessages) {
          return no('awaiting_reply', `${target.name} has not replied yet. You can send ${LIMITS.strangerMessages} messages until they do, or become friends first.`);
        }
        index(s, id, conv); index(s, partner, conv);
      } else if (!conv || !memberConv(s, id, key)) return no('not_a_member', 'You are not in that conversation.');
      const stored = append(s, conv, id, message, cid);
      const push: PushList = [];
      fanOut(s, conv, stored, push, null);
      return yes('sent', { conv: summary(s, conv, id), message: messageView(s, conv, stored, id), push });
    },

    // ---- groups ----------------------------------------------------------------------------
    groupCreate(db: Db, session: SessionRecord, body: SocialBody) {
      ctx.onceId(body.clientId);
      const name = text(body.name, LIMITS.groupName, 'invalid_group_name');
      if (!Array.isArray(body.members) || body.members.length > LIMITS.groupSize) throw bad('invalid_members');
      const members = [...new Set(body.members.map((member) => uuid(member)))];
      const { s, p, id } = enter(db, session);
      const push: PushList = [];
      // Exactly once per client id (ctx.once): a retry never makes a second group.
      const outcome = ctx.once(db, session, { id: body.clientId, kind: 'group', fingerprint: [name, [...members].sort()] }, () => {
        const refused = mutedRefusal(id) ?? screened(name, 'A group name', true);
        if (refused) return refused;
        if (!ctx.allow(`social:group:${id}`, 5, 3600000)) return no('rate_limited', 'You have created several groups this hour. Try again later.');
        if (Object.keys(p.convs).filter((key) => s.convs[key]?.kind === 'group').length >= LIMITS.groups) return no('too_many_groups', `You can be in ${LIMITS.groups} groups. Leave one first.`);
        if (members.length + 1 > LIMITS.groupSize) return no('group_full', `A group holds ${LIMITS.groupSize} people including you.`);
        const stranger = members.find((member) => member === id || !areFriends(s, id, member));
        if (stranger) return no('friends_only', `You can only add friends to a group. ${pub(s, stranger).name} is not your friend yet.`);
        const conv = s.convs[`g.${++s.seq}`] = { id: `g.${s.seq}`, kind: 'group', name, owner: id, creator: id, members: [id, ...members], seq: 0, created: now(), messages: [] };
        for (const member of conv.members) index(s, member, conv);
        const first = append(s, conv, null, `${p.name} created “${name}”.`, null, true);
        fanOut(s, conv, first, push, id);
        for (const member of members) notify(s, member, 'group-added', `${p.name} added you to the group “${name}”.`, { conv: conv.id }, push);
        return yes('created', { conv: conv.id });
      });
      if (!outcome.ok) return outcome;
      // The receipt holds the group's id only. Its summary is built now, and only for someone still in it.
      const conv = memberConv(s, id, outcome.conv);
      if (!conv) return no('not_a_member', 'You are no longer in that group.');
      return yes('created', { conv: summary(s, conv, id), ...(repeated(outcome) ? { duplicate: true } : { push }) });
    },
    /** body: { conv, op: 'rename' | 'add' | 'remove' | 'leave', name?, id? } */
    groupUpdate(db: Db, session: SessionRecord, body: SocialBody) {
      const key = convId(body.conv);
      const { s, p, id } = enter(db, session);
      const conv = memberConv(s, id, key);
      if (!conv || conv.kind !== 'group') return no('not_a_member', 'You are not in that group.');
      const push: PushList = [];
      const say = (line: string) => fanOut(s, conv, append(s, conv, null, line, null, true), push, null);
      if (body.op === 'leave') {
        leaveConv(s, conv, id);
        if (s.convs[key]) fanOut(s, conv, conv.messages.at(-1)!, push, null);
        return yes('left', { push });
      }
      if (conv.owner !== id) return no('owner_only', `Only ${pub(s, conv.owner!).name}, who runs this group, can do that.`);
      if (body.op === 'rename') {
        const renamed = text(body.name, LIMITS.groupName, 'invalid_group_name');
        const refused = mutedRefusal(id) ?? screened(renamed, 'A group name', true);
        if (refused) return refused;
        conv.name = renamed;
        say(`${p.name} renamed the group to “${conv.name}”.`);
      } else if (body.op === 'add') {
        const member = uuid(body.id);
        if (conv.members.includes(member)) return yes('updated', { conv: summary(s, conv, id), duplicate: true });
        if (conv.members.length >= LIMITS.groupSize) return no('group_full', `This group is full (${LIMITS.groupSize} people).`);
        if (!areFriends(s, id, member)) return no('friends_only', 'You can only add your friends to a group.');
        if (Object.keys(s.players[member]!.convs).filter((item) => s.convs[item]?.kind === 'group').length >= LIMITS.groups) return no('too_many_groups', `${pub(s, member).name} is already in ${LIMITS.groups} groups.`);
        conv.members.push(member); index(s, member, conv);
        notify(s, member, 'group-added', `${p.name} added you to the group “${conv.name}”.`, { conv: conv.id }, push);
        say(`${p.name} added ${pub(s, member).name}.`);
      } else if (body.op === 'remove') {
        const member = uuid(body.id);
        if (member === id) return no('self', 'Use Leave group to remove yourself.');
        if (!conv.members.includes(member)) return yes('updated', { conv: summary(s, conv, id), duplicate: true });
        conv.members = conv.members.filter((item) => item !== member);
        delete s.players[member]?.convs[key];
        push.push([member, { type: 'social-sync' }]);
        say(`${p.name} removed ${pub(s, member).name}.`);
      } else throw bad('invalid_group_op');
      return yes('updated', { conv: summary(s, conv, id), push });
    },

    /**
     * The room module's question: may `guestId` be in `hostId`'s Home room in `cityId` right now?
     * True only for an accepted visit that has not expired or been ended, between two players who
     * have not blocked each other, while the host's life is at home in that city.
     */
    homeGuest(db: Db, guestId: unknown, hostId: unknown, cityId: CityId): boolean {
      if (typeof guestId !== 'string' || typeof hostId !== 'string' || guestId === hostId) return false;
      const s = col(db);
      if (!Object.hasOwn(s.players, guestId) || !Object.hasOwn(s.players, hostId) || !Object.hasOwn(s.houses, hostId)) return false;
      const visit = pruneHouse(s, hostId)?.guests[guestId];
      return visit !== undefined && visit.cityId === cityId;
    },
    /** The host's life left home: end every visit, tell the guests, and return the pushes. */
    closeHouse(db: Db, hostId: string) {
      const s = col(db);
      const before = Object.keys(s.houses[hostId]?.guests || {});
      if (!before.length) return yes('closed', { push: [] });
      pruneHouse(s, hostId);
      const push: PushList = [];
      for (const guest of before.filter((id) => !s.houses[hostId]?.guests[id])) {
        push.push([guest, { type: 'invite-house', house: houseView(s, hostId, guest) }]);
        notify(s, guest, 'invite-answer', `${pub(s, hostId).name} went out, so your visit ended.`, { host: hostId }, push);
      }
      push.push([hostId, { type: 'invite-house', house: houseView(s, hostId, hostId) }]);
      return yes('closed', { push });
    },

    /**
     * The heartbeat found a guest whose visit is over (it ran out, or the host is no longer home):
     * close the stored visit too and tell both sides, so the house chat and guest list agree with the room.
     */
    expireVisits(db: Db, hostId: string) {
      const s = col(db);
      const before = Object.keys(s.houses[hostId]?.guests || {});
      if (!before.length) return yes('ok', { push: [] });
      pruneHouse(s, hostId);
      const push: PushList = [];
      for (const guest of before.filter((id) => !s.houses[hostId]?.guests[id])) {
        push.push([guest, { type: 'invite-house', house: houseView(s, hostId, guest) }]);
        notify(s, guest, 'invite-answer', `Your visit to ${pub(s, hostId).name}’s house ended. A visit lasts ${Math.round(LIMITS.visitMs / 60000)} minutes; knock again to come back.`, { host: hostId }, push);
      }
      push.push([hostId, { type: 'invite-house', house: houseView(s, hostId, hostId) }]);
      return yes('ok', { push });
    },

    // ---- operator side (server/routes/moderation.ts). Never reachable with a player's session. ----
    modReports(db: Db, status = 'open', limit = 100) {
      const s = col(db);
      return s.reports.filter((report) => status === 'all' || (status === 'open' ? report.status === 'received' : report.status === status)).slice(-limit).reverse()
        .map((report) => ({ ...report, byName: s.players[report.by]?.name ?? 'Former player', aboutNow: s.players[report.about]?.name ?? null }));
    },
    modReportCounts(db: Db) { const s = col(db); return { total: s.reports.length, open: s.reports.filter((report) => report.status === 'received').length }; },
    /** Set a report's status and tell the reporter, whose own receipt shows the same status. */
    modSetReport(db: Db, reportId: string, status: PlayerReportRecord['status'], note = '') {
      const s = col(db);
      const report = s.reports.find((item) => item.id === reportId);
      if (!report) return null;
      report.status = status; report.note = note; report.updatedAt = now();
      const receipt = s.players[report.by]?.reports.find((item) => item.id === reportId);
      if (receipt) receipt.status = status;
      const push: PushList = [];
      notify(s, report.by, 'report', `Report ${report.id} about ${report.aboutName}: ${status === 'dismissed' ? 'a moderator reviewed it and took no action' : 'a moderator acted on it'}.${note ? ` Note: ${note}` : ''}`, { report: report.id }, push);
      return { report, push };
    },
    /** A line in one player's Updates feed from the operator (a mute, a removed ad). */
    modNote(db: Db, to: string, text: string) {
      const s = col(db), push: PushList = [];
      notify(s, to, 'moderation', text, null, push);
      return { push };
    },
    modKnows: (db: Db, id: string): boolean => Boolean(col(db).players[id]),

    // ---- house invites: knock → let in / not now -----------------------------------------------
    house(db: Db, session: SessionRecord, rawHost: unknown) {
      const hostId = uuid(rawHost);
      const { s, id } = enter(db, session);
      if (!s.players[hostId] || blockedEither(s, id, hostId)) return no('unknown_player', 'That house was not found.');
      const house = houseView(s, hostId, id);
      const knock = s.houses[hostId]?.knocks[id];
      return yes('ok', { house, knock: knock ? { status: knock.status, expiresAt: knock.expires } : null });
    },
    /**
     * THE INVITE LANDING. A player opened someone's link (`/v/<publicId>` or `?join=<publicId>`): say who
     * they are joining and how that player can be reached right now, so the client can show one banner.
     *   'joined'    the caller is a brand-new guest (src/game/systems/onboarding.ts) and the inviter is in a
     *               public venue right now — their own venue-room socket says so — so the guest was put
     *               there: free, once per life, only in the life's first minutes ('onboarding.arrive', a
     *               server-only action; the venue is never taken from the request). Answers `venue`.
     *   'here'      they already share that venue. Answers `venue`.
     *   'at_home'   the inviter is at home: the client offers the knock (POST /api/social/house/knock).
     *   'out' | 'offline' | 'reconnecting'   nothing to join right now; the caller stays where they are.
     * WHAT IT DISCLOSES: `hostStatus` is exactly what GET /api/social/house/:host already tells anyone who
     * holds the link. The venue itself is answered only with 'joined' and 'here' — to someone who is, by
     * then, standing in that public room and sees the inviter anyway. Blocked either way: unknown_player.
     */
    join(db: Db, session: SessionRecord, body: SocialBody) {
      const hostId = uuid(body.host), cityId = city(body.cityId);
      const { s, id } = enter(db, session);
      const { refusal } = other(s, id, hostId);
      if (refusal) return refusal.code === 'self' ? no('self', 'That is your own link. Share it with someone else.') : no('unknown_player', 'That player was not found.');
      if (!ctx.allow(`social:join:${id}`, 6)) return no('rate_limited', 'Too many tries. Wait a minute.');
      const host = pub(s, hostId), where = whereabouts(hostId, true);
      if (where.status !== 'online') return yes(where.status === 'reconnecting' ? 'reconnecting' : 'offline', { host, hostStatus: where.status === 'reconnecting' ? 'reconnecting' : 'offline' });
      if (where.venue === 'home' && where.cityId === cityId) return yes('at_home', { host, hostStatus: 'home' });
      if (where.cityId !== cityId || where.venue === 'visit' || where.venue === 'home' || !venueFor(cityId, where.venue)) return yes('out', { host, hostStatus: 'out' });
      const life = ctx.settle(session, cityId);
      if (life.location === where.venue && !isDeparting(life)) return yes('here', { host, hostStatus: 'out', venue: where.venue });
      const moved = ctx.act(life, { type: 'onboarding.arrive', cityId, payload: { venue: where.venue }, stateGuard: 'onboarding.joined: the first arrival sets it and a second is refused' });
      if (!moved.ok) return yes('out', { host, hostStatus: 'out' });
      return yes('joined', { host, hostStatus: 'out', venue: where.venue });
    },
    knock(db: Db, session: SessionRecord, body: SocialBody) {
      const hostId = uuid(body.host), cityId = city(body.cityId);
      const { s, p, id } = enter(db, session);
      const { target, refusal } = other(s, id, hostId);
      if (refusal) return refusal.code === 'self' ? no('self', 'This is your own house. Share the link with someone else.') : refusal;
      const house = pruneHouse(s, hostId) || (s.houses[hostId] = { knocks: {}, guests: {} });
      const done = <R>(result: R): R => { pruneHouse(s, hostId); return result; };
      if (house.guests[id]) return yes('inside', { house: houseView(s, hostId, id), duplicate: true });
      const old = house.knocks[id];
      if (old?.status === 'pending') return yes('knocking', { expiresAt: old.expires, duplicate: true });
      if (old?.status === 'declined') return done(no('knock_cooldown', `${target.name} said not now. You can knock again in a minute.`));
      // Truthful presence: the host must be connected and actually at home, according to the server.
      const host = presence.status(hostId);
      if (host.state === 'offline') return done(no('host_offline', `${target.name} is offline, so nobody can answer the door.`));
      if (host.state === 'reconnecting') return done(no('host_reconnecting', `${target.name} is reconnecting. Try again in a few seconds.`));
      if (!presence.isIn(hostId, venueRoomKey(cityId, 'home', hostId))) return done(no('host_not_home', `${target.name} is online but not at home right now.`));
      if (Object.keys(house.guests).length >= LIMITS.guests) return done(no('house_full', `${target.name}’s house is full (${LIMITS.guests} guests).`));
      if (!ctx.allow(`social:knock:${id}`, 6)) return done(no('rate_limited', 'You are knocking too often. Wait a minute.'));
      house.knocks[id] = { at: now(), expires: now() + LIMITS.knockMs, status: 'pending', cityId };
      const push: PushList = [[hostId, { type: 'invite-knock', from: pub(s, id), expiresAt: house.knocks[id].expires }]];
      notify(s, hostId, 'invite-knock', `${p.name} is knocking at your door.`, { from: id }, push);
      return yes('knocking', { expiresAt: house.knocks[id].expires, push });
    },
    /** Host answers a knock. Accepting is applied exactly once; repeating the same answer returns the same outcome. */
    knockAnswer(db: Db, session: SessionRecord, body: SocialBody) {
      const visitor = uuid(body.visitor);
      if (body.answer !== 'accept' && body.answer !== 'decline') throw bad('invalid_answer');
      const { s, p, id } = enter(db, session);
      const house = pruneHouse(s, id);
      const knock = house?.knocks[visitor];
      const answered = body.answer === 'accept' ? 'accepted' : 'declined';
      if (house?.guests[visitor] && body.answer === 'accept') return yes('accepted', { house: houseView(s, id, id), duplicate: true });
      if (!knock) return no('knock_expired', 'That knock is no longer waiting. Knocks expire after a minute.');
      if (knock.status !== 'pending') {
        return knock.status === answered ? yes(answered, { house: houseView(s, id, id), duplicate: true })
          : no('already_answered', `You already answered that knock (${knock.status === 'accepted' ? 'let them in' : 'not now'}).`);
      }
      const push: PushList = [];
      if (body.answer === 'accept') {
        if (!hostAtHome(s, id, knock.cityId)) return no('host_not_home', 'You are not at home, so nobody can come in. Go home first, then let them in.');
        if (Object.keys(house.guests).length >= LIMITS.guests) return no('house_full', `Your house is full (${LIMITS.guests} guests). Ask someone to leave first.`);
        const visiting = s.players[visitor]?.visiting;
        if (visiting && visiting !== id && endVisit(s, visiting, visitor)) housePush(s, visiting, push);
        house.guests[visitor] = { since: now(), expires: now() + LIMITS.visitMs, cityId: knock.cityId };
        if (s.players[visitor]) s.players[visitor].visiting = id;
        syncHouseConv(s, id);
        fanOut(s, s.convs[`h.${id}`]!, append(s, s.convs[`h.${id}`]!, null, `${pub(s, visitor).name} came in.`, null, true), push, null);
      }
      knock.status = answered; knock.answeredAt = now();
      push.push([visitor, { type: 'invite-answer', host: pub(s, id), answer: answered, house: houseView(s, id, visitor) }]);
      notify(s, visitor, 'invite-answer', body.answer === 'accept' ? `${p.name} let you in.` : `${p.name} said not now.`, { host: id }, push);
      housePush(s, id, push);
      return yes(answered, { house: houseView(s, id, id), push });
    },
    /** body: { host, guest? } — a guest leaves (guest omitted) or the host asks a guest to leave. */
    houseLeave(db: Db, session: SessionRecord, body: SocialBody) {
      const hostId = uuid(body.host), guest = body.guest === undefined ? null : uuid(body.guest);
      const { s, id } = enter(db, session);
      if (guest && hostId !== id) return no('host_only', 'Only the host can ask a guest to leave.');
      const leaving = guest ?? id;
      const push: PushList = [];
      if (!endVisit(s, hostId, leaving)) return yes('left', { duplicate: true });
      const conv = s.convs[`h.${hostId}`];
      if (conv) fanOut(s, conv, append(s, conv, null, `${pub(s, leaving).name} left.`, null, true), push, null);
      push.push([leaving, { type: 'invite-house', house: houseView(s, hostId, leaving) }]);
      housePush(s, hostId, push);
      return yes('left', { push });
    },

    // ---- player-to-player interactions, Bae, transfers -------------------------------------------
    interact(db: Db, session: SessionRecord, body: SocialBody) {
      const target = uuid(body.id), cityId = city(body.cityId), cid = body.clientId;
      ctx.onceId(cid);
      const action = PLAYER_ACTIONS.find((item) => item.id === body.action);
      if (!action) throw bad('invalid_interaction');
      const { s, id } = enter(db, session);
      const push: PushList = [];
      const outcome = ctx.once(db, session, { id: cid, kind: 'interact', fingerprint: [target, action.id, cityId] }, () => {
        const { target: them, refusal } = other(s, id, target);
        if (refusal) return refusal;
        if (!ctx.allow(`social:interact:${id}`, 30)) return no('rate_limited', 'Slow down a little. Try again in a moment.');
        const state = ctx.settle(session, cityId);
        const room = venueRoomKey(cityId, state.location, id);
        if (state.location === 'home' || isDeparting(state) || !presence.isIn(id, room)) return no('not_joined', 'You are not in a venue room right now. Go to a public venue and wait for it to connect.');
        if (!presence.isIn(target, room)) return no('not_here', `${them.name} is not at ${venueLabel(state.location, cityId)} with you right now.`);
        const result = act(session, cityId, 'interact', { id: target, name: them.name, action: action.id }, `social|interact|${id}|${cid}`);
        if (!result.ok) return no(result.code, result.reason!);
        push.push([target, { type: 'people-interaction', from: pub(s, id), action: action.id, label: action.label, landed: result.code === 'interacted' }]);
        return yes(result.code, { message: String(result.state.message ?? '').slice(0, 300), closeness: result.state.social.rel[target]?.p ?? 0 });
      });
      return outcome.ok && !repeated(outcome) ? { ...outcome, push } : outcome;
    },
    baeAsk(db: Db, session: SessionRecord, body: SocialBody) {
      const target = uuid(body.id), cityId = city(body.cityId);
      const { s, p, id } = enter(db, session);
      const { target: them, refusal } = other(s, id, target);
      if (refusal) return refusal;
      if (!areFriends(s, id, target)) return no('friends_only', `Become friends with ${them.name} before asking.`);
      if (p.bae || them.bae) return no('already_have_bae', p.bae ? 'You already have a Bae. End that first.' : `${them.name} is already with someone.`);
      const check = act(session, cityId, 'bae-check', { id: target }, `social|baecheck|${id}`, 'a check: it reads the life and changes nothing');
      if (!check.ok) return no(check.code, check.reason!);
      if (them.baeIn[id]) return yes('asked', { duplicate: true });
      if (!ctx.allow(`social:bae:${id}`, 5, 3600000)) return no('rate_limited', 'You have asked a lot this hour. Give it some time.');
      them.baeIn[id] = { at: now(), cityId };
      const push: PushList = [[target, { type: 'social-sync' }]];
      notify(s, target, 'bae-request', `${p.name} asked you to be their Bae.`, { from: id }, push);
      return yes('asked', { push });
    },
    baeAnswer(db: Db, session: SessionRecord, body: SocialBody) {
      const from = uuid(body.from), cityId = city(body.cityId);
      if (typeof body.accept !== 'boolean') throw bad('invalid_answer');
      const { s, p, id } = enter(db, session);
      const asker = s.players[from];
      if (p.bae === from && body.accept) return yes('accepted', { duplicate: true });
      if (!p.baeIn[from] || !asker) return no('no_request', 'That request is no longer waiting.');
      delete p.baeIn[from];
      const push: PushList = [[from, { type: 'social-sync' }]];
      if (!body.accept) { notify(s, from, 'bae-answer', `${p.name} said no for now.`, { from: id }, push); return yes('declined', { push }); }
      if (p.bae || asker.bae) return no('already_have_bae', p.bae ? 'You already have a Bae. End that first.' : `${asker.name} is already with someone.`);
      const mine = act(session, cityId, 'bae', { id: from, name: asker.name }, `social|bae|${id}|${from}`, 'the pending request is deleted and p.bae is set in this transaction; a repeat is answered from them');
      if (!mine.ok) return no(mine.code, mine.reason!);
      p.bae = from; asker.bae = id;
      owe(s, db, from, cityId, { op: 'bae', id, name: p.name });
      notify(s, from, 'bae-answer', `${p.name} said yes. You are together now.`, { from: id }, push);
      return yes('accepted', { push });
    },
    baeEnd(db: Db, session: SessionRecord, body: SocialBody) {
      const cityId = city(body.cityId);
      const { s, p, id } = enter(db, session);
      const ex = p.bae;
      if (!ex) return yes('ended', { duplicate: true });
      p.bae = null;
      if (s.players[ex]?.bae === id) s.players[ex].bae = null;
      act(session, cityId, 'bae-end', { id: ex }, `social|baeend|${id}|${++s.seq}`, 'p.bae is cleared in this transaction; a repeat finds none and stops before this');
      owe(s, db, ex, cityId, { op: 'bae-end', id });
      const push: PushList = [[ex, { type: 'social-sync' }]];
      notify(s, ex, 'bae-answer', `${p.name} ended things.`, { from: id }, push);
      return yes('ended', { push });
    },
    /**
     * Gift naira to a friend. One transaction: the sender is debited through the rules engine
     * and the recipient is credited (or, if they are not connected, the credit is stored and
     * applied on their next request). Exactly once per `clientId` (ctx.once).
     * The credit goes to the recipient's life in the gift's city if they have one, otherwise to the
     * life they played most recently (lifeCity); with no life anywhere the gift is refused before
     * anything is charged.
     */
    transfer(db: Db, session: SessionRecord, body: SocialBody) {
      const to = uuid(body.to), cityId = city(body.cityId), cid = body.clientId, amount = body.amount;
      ctx.onceId(cid);
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) throw bad('invalid_amount');
      const { s, p, id } = enter(db, session);
      const push: PushList = [];
      const outcome = ctx.once(db, session, { id: cid, kind: 'transfer', fingerprint: [to, amount, cityId] }, () => {
        const L = TRANSFER_LIMITS, t = now();
        const { target, refusal } = other(s, id, to);
        if (refusal) return refusal;
        if (!ctx.allow(`social:transfer:${id}`, 5)) return no('rate_limited', 'Too many transfers in a minute. Wait, then try again.');
        if (!areFriends(s, id, to)) return no('friends_only', `You can only send money to friends. Add ${target.name} as a friend first.`);
        const wait = (ms: number) => { const minutes = Math.ceil(ms / 60000); return minutes >= 60 ? `${Math.ceil(minutes / 60)} h` : `${minutes} min`; };
        if (t - p.first < L.minAccountAgeMs) return no('account_too_new', `Sending money opens 24 hours after you start playing. Try again in ${wait(L.minAccountAgeMs - (t - p.first))}.`);
        const since = friendsSince(s.players, id, to);
        if (t - since < L.minFriendshipMs) return no('friendship_too_new', `You and ${target.name} only just became friends. Try again in ${wait(L.minFriendshipMs - (t - since))}.`);
        const day = lagosTime(t).day;
        if (target.recv.day !== day) target.recv = { day, amount: 0 };
        if (target.recv.amount + amount > L.dailyReceive) return no('recipient_limit', `${target.name} has received the most a player can be given in one day (${naira(L.dailyReceive)}).`);
        if ((s.pending[to]?.length ?? 0) >= LIMITS.pending) return no('recipient_unavailable', `${target.name} has too many gifts waiting. Ask them to log in first.`);
        // Where the money will land, decided before anything is charged. No life anywhere: no gift.
        const theirs = ctx.core.sessionByPublicId(db, to);
        const creditCity = theirs && theirs.expiresAt > t ? lifeCity(theirs, cityId) : null;
        if (!creditCity) return no('recipient_no_life', `${target.name} has no life in any city right now, so there is nowhere to put the money. Nothing was sent.`);
        const sent = act(session, cityId, 'transfer-out', { to, name: target.name, amount }, `social|transfer|${id}|${cid}`);
        if (!sent.ok) return no(sent.code, sent.reason!);
        target.recv.amount += amount;
        const credited = owe(s, db, to, creditCity, { op: 'transfer-in', from: id, name: p.name, amount }, { keep: true });
        push.push([to, { type: 'transfer', from: pub(s, id), amount, credited }], [to, { type: 'social-sync' }]);
        notify(s, to, 'transfer', `${p.name} sent you ${naira(amount)}.`, { from: id, amount }, push);
        return yes('sent', { amount, to: pub(s, to), credited, creditedCity: creditCity, balance: sent.state.cash });
      });
      return outcome.ok && !repeated(outcome) ? { ...outcome, push } : outcome;
    },
  };
  services.set(ctx, service);
  return service;
}
