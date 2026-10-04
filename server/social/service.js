/**
 * OWNER: social
 * All player-to-player logic, shared by the HTTP routes (server/routes/social.js) and the
 * socket messages (server/ws/social.js). Portable: it only uses the server context described
 * in server/routes/index.js (store, collection, settle, act, allow, now, push) plus live presence.
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
 *   receipts  { ['<publicId>|<clientId>']: { at, kind, fp, result } }       idempotency for non-message writes
 *   reports   [{ id, by, about, aboutName, reason, text, at, status, note?, evidence: [body] }]   for moderators
 *             (read and answered through the operator routes — server/routes/moderation.js)
 *   seq, sweptAt
 * Only public ids are stored. The cookie secret never enters this collection or any response.
 *
 * TEXT. Every message body and group name passes the text filter (server/moderation/text.js) and
 * is refused — never altered — with a reason. A player an operator has muted (ctx.checks.muted)
 * cannot send messages or name groups until the mute ends; everything else still works for them.
 *
 * BLOCKS IN MEMORY. Who has blocked whom is also kept in a small in-memory index so the room
 * module can hide two players from each other in a public venue without a store read:
 *   ctx.checks.blocked(a, b) → true when either has blocked the other
 * It is loaded before the server takes requests and updated by deliver() after each committed
 * block, unblock or removal of an idle player. deliver() raises 'blocks-changed' { a, b }.
 */
import { UUID_PATTERN, venueRoomKey } from '../protocol.js';
import { lagosTime } from '../../src/game/clock.js';
import { TRANSFER_LIMITS, PLAYER_ACTIONS } from '../../src/game/content/npcs.js';
import { venueLabel } from '../../src/game/content/venues.js';
import { presenceOf, describeRoom } from './presence.js';
import { screenText } from '../moderation/text.js';

/** Original beta limits. */
export const LIMITS = Object.freeze({
  body: 500, history: 200, page: 50, friends: 200, requests: 30, blocked: 200, convs: 100, groups: 20, groupSize: 12, groupName: 32,
  updates: 50, reports: 2000, ownReports: 20, reportText: 300, pending: 50, receipts: 5000,
  guests: 5, knockMs: 60000, knockCooldownMs: 60000, visitMs: 30 * 60000,
  strangerMessages: 3, newChatsPerDay: 10, searchResults: 10,
  receiptMs: 86400000, escrowMs: 7 * 86400000, playerIdleMs: 45 * 86400000, sweepMs: 3600000,
});
export const REPORT_REASONS = Object.freeze(['harassment', 'spam', 'cheating', 'offensive-name', 'other']);

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const CLIENT_ID = /^[A-Za-z0-9:_-]{8,80}$/;
const CONV_ID = /^(dm|g|h)\.[0-9a-f.-]{1,80}$/;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const naira = (value) => `₦${Math.round(Number(value) || 0).toLocaleString('en-NG')}`;
const no = (code, reason, extra) => ({ ok: false, code, reason, ...extra });
const yes = (code, extra) => ({ ok: true, code, ...extra });
const dmId = (a, b) => `dm.${[a, b].sort().join('.')}`;
const services = new WeakMap();
const ENDED = Symbol('visits ended by this transaction');
const BLOCKS = Symbol('block changes made by this transaction');
/** Set on a result (see finish) when the transaction applied a life effect that was owed to the caller. */
export const MATERIAL = Symbol('this transaction changed a life');

export function socialService(ctx) {
  const cached = services.get(ctx);
  if (cached) return cached;
  const presence = presenceOf(ctx);
  const now = () => ctx.now();
  // [hostId, guestId] visits ended by the transaction that owns a collection copy. Kept per copy (not
  // in one shared list) because another transaction may run between this one's commit and its
  // deliver(): finish() moves the list onto the result inside the transaction, deliver() announces it.
  const endedOf = new WeakMap();
  const endedIn = (s) => { let list = endedOf.get(s); if (!list) { endedOf.set(s, list = []); list.blocks = []; } return list; };
  // ---- blocks, in memory (see header) ----------------------------------------------------------
  const blockIndex = new Map(); // blocker → Set<blocked>
  const blocked = (a, b) => Boolean(blockIndex.get(a)?.has(b) || blockIndex.get(b)?.has(a));
  function applyBlockChange([op, a, b]) {
    if (op === 'block') { if (!blockIndex.has(a)) blockIndex.set(a, new Set()); blockIndex.get(a).add(b); }
    else if (op === 'unblock') { blockIndex.get(a)?.delete(b); if (!blockIndex.get(a)?.size) blockIndex.delete(a); }
    else if (op === 'forget') blockIndex.delete(a);
  }
  if (ctx.checks) {
    ctx.checks.blocked = blocked;
    ctx.checks.anyBlocks = () => blockIndex.size > 0;
  }
  ctx.startup?.push(ctx.store.read((db) => Object.entries(db.social?.players ?? {}).map(([id, player]) => [id, Object.keys(player?.blocked ?? {})]))
    .then((rows) => { for (const [id, list] of rows) for (const other of list) applyBlockChange(['block', id, other]); }));
  /** null, or the refusal for a muted sender. */
  const mutedRefusal = (id) => { const mute = ctx.checks?.muted?.(id); return mute ? no(mute.code, mute.reason) : null; };
  /** null, or the refusal for text the filter does not accept. */
  const screened = (value, what, contact = false) => { const verdict = screenText(value, { what, contact }); return verdict ? no(verdict.code, verdict.reason) : null; };
  const bad = (code) => ctx.fail(400, code);

  // ---- input validation (throws 400) ---------------------------------------------------------
  const uuid = (value, code = 'invalid_player') => { if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw bad(code); return value.toLowerCase(); };
  const city = (value) => { if (!ctx.cityIds.includes(value)) throw bad('invalid_city'); return value; };
  const clientId = (value) => { if (typeof value !== 'string' || !CLIENT_ID.test(value)) throw bad('invalid_client_id'); return value; };
  function text(value, max, code) {
    const body = typeof value === 'string' ? value.trim() : '';
    if (!body || body.length > max || CONTROL.test(body)) throw bad(code);
    return body;
  }
  const convId = (value) => { if (typeof value !== 'string' || !CONV_ID.test(value)) throw bad('invalid_conversation'); return value; };

  // ---- collection ----------------------------------------------------------------------------
  const dbOf = new WeakMap(); // collection → the db it came from, for ctx.atHome inside pruneHouse
  function col(db) {
    const s = ctx.collection(db, 'social');
    dbOf.set(s, db);
    for (const key of ['players', 'convs', 'houses', 'pending', 'receipts']) if (!isRecord(s[key])) s[key] = {};
    if (!Array.isArray(s.reports)) s.reports = [];
    if (!Number.isSafeInteger(s.seq)) s.seq = 0;
    return s;
  }
  const pub = (s, id) => ({ id, name: s.players[id]?.name ?? 'Former player' });
  const blockedEither = (s, a, b) => Boolean(s.players[a]?.blocked[b] || s.players[b]?.blocked[a]);
  const areFriends = (s, a, b) => Boolean(s.players[a]?.friends[b] && s.players[b]?.friends[a]);

  /** Register/refresh the caller, run housekeeping and apply anything owed to their life. */
  function enter(db, session) {
    // A session whose lives must all still be created has not arrived in any city: it is not
    // registered as a player, so nobody can find, message or befriend it yet.
    const lives = Object.values(session.cities || {}).map((entry) => entry?.state?.onboarding).filter(Boolean);
    if (lives.length ? lives.every((o) => o.required === true && o.done !== true) : session.onboarding === true) throw ctx.fail(403, 'onboarding_required');
    const s = col(db), id = session.publicId, t = now();
    const p = s.players[id] ||= { name: session.name, first: t, seen: t, friends: {}, in: {}, out: {}, blocked: {}, convs: {}, updates: [], reports: [],
      baeIn: {}, bae: null, visiting: null, recv: { day: 0, amount: 0 }, chats: { day: 0, count: 0 } };
    p.name = session.name; p.seen = t;
    sweep(s, t);
    claim(s, session);
    return { s, p, id };
  }
  /** The other player's record, or a refusal. Blocking is reported the same way in both directions. */
  function other(s, me, id, { allowBlocked = false } = {}) {
    if (id === me) return { refusal: no('self', 'That is you.') };
    const target = s.players[id];
    if (!target) return { refusal: no('unknown_player', 'That player was not found. They may not have played yet.') };
    if (!allowBlocked && s.players[me].blocked[id]) return { refusal: no('blocked', `You blocked ${target.name}. Unblock them in People to do this.`) };
    if (!allowBlocked && target.blocked[me]) return { refusal: no('blocked', `${target.name} is not accepting this from you.`) };
    return { target };
  }

  function whereabouts(id, detailed) {
    const status = presence.status(id);
    // `seenAt` is the server time it last heard from that player's connection (a frame or a ping answer).
    if (status.state !== 'online') return { status: status.state };
    if (!status.rooms.length) return { status: 'away', seenAt: status.seenAt };
    if (!detailed) return { status: 'online', seenAt: status.seenAt };
    // Their own venue room says where they are; a socket in someone else's Home room is a visit, not "at home".
    const rooms = status.rooms.map(describeRoom);
    const own = rooms.find((room) => !room.home || room.hostId === id);
    return own ? { status: 'online', seenAt: status.seenAt, cityId: own.cityId, venue: own.venue } : { status: 'online', seenAt: status.seenAt, cityId: rooms[0].cityId, venue: 'visit' };
  }

  function notify(s, to, kind, message, data, push) {
    const target = s.players[to];
    if (!target) return;
    const update = { id: ++s.seq, kind, text: message, at: now(), read: false, ...(data ? { data } : {}) };
    target.updates.push(update);
    if (target.updates.length > LIMITS.updates) target.updates.splice(0, target.updates.length - LIMITS.updates);
    push.push([to, { type: 'social-update', update }]);
  }

  // ---- life effects (through the rules engine only) ------------------------------------------
  // 'social.server' is a server-only action: it runs through ctx.act and is refused on the public
  // /api/action. `actionId` seeds the outcome, so a replayed request rolls the same dice.
  function act(session, cityId, op, payload, actionId) {
    return ctx.act(ctx.settle(session, cityId), { type: 'social.server', cityId, actionId, payload: { ...payload, op } });
  }
  function onlineSession(db, id) {
    for (const ws of presence.sockets(id)) {
      const session = ctx.core.sessionOf(ws, db);
      if (session && session.publicId === id && session.expiresAt > now()) return session;
    }
    return null;
  }
  const runEffect = (session, effect) => act(session, effect.cityId, effect.payload.op, effect.payload, `social|effect|${effect.n}`).ok;
  /** Apply a life effect to another player now if they are connected, otherwise keep it for their next request. */
  function owe(s, db, to, cityId, payload, { keep = false, refund = false } = {}) {
    const effect = { n: ++s.seq, at: now(), cityId, payload, keep, ...(refund ? { refund: true } : {}) };
    const session = onlineSession(db, to);
    if (session && runEffect(session, effect)) return true;
    const queue = s.pending[to] ||= [];
    queue.push(effect);
    // Money (keep) is never dropped; only bookkeeping effects make room.
    while (queue.length > LIMITS.pending) { const drop = queue.findIndex((item) => !item.keep); if (drop < 0) break; queue.splice(drop, 1); }
    return false;
  }
  function claim(s, session) {
    const queue = s.pending[session.publicId];
    if (!queue?.length) return;
    endedIn(s).material = true; // a gift or a friendship reached this life: the request must be durable
    const left = queue.filter((effect) => !runEffect(session, effect) && effect.keep);
    if (left.length) s.pending[session.publicId] = left; else delete s.pending[session.publicId];
  }

  /** Hourly housekeeping: expire receipts, return unclaimed gifts, forget long-idle players. */
  function sweep(s, t) {
    if (t - (s.sweptAt || 0) < LIMITS.sweepMs) return;
    s.sweptAt = t;
    const receipts = Object.entries(s.receipts);
    for (const [key, receipt] of receipts) if (t - receipt.at > LIMITS.receiptMs) delete s.receipts[key];
    for (const [to, queue] of Object.entries(s.pending)) {
      const keep = [];
      for (const effect of queue) {
        const stale = t - effect.at > LIMITS.escrowMs;
        if (!stale) keep.push(effect);
        else if (effect.keep && !effect.refund && s.players[effect.payload.from]) {
          // An unclaimed gift goes back to the sender, as a pending credit of their own.
          (s.pending[effect.payload.from] ||= []).push({ n: ++s.seq, at: t, cityId: effect.cityId, keep: true, refund: true,
            payload: { op: 'transfer-in', from: to, name: s.players[to]?.name ?? 'your friend', amount: effect.payload.amount, refund: true } });
        } else if (effect.keep && effect.refund && s.players[to]) keep.push(effect);
      }
      if (keep.length) s.pending[to] = keep; else delete s.pending[to];
    }
    for (const [id, p] of Object.entries(s.players)) {
      if (t - p.seen <= LIMITS.playerIdleMs || presence.status(id).state === 'online') continue;
      for (const friend of Object.keys(p.friends)) delete s.players[friend]?.friends[id];
      for (const key of Object.keys(p.in)) delete s.players[key]?.out[id];
      for (const key of Object.keys(p.out)) delete s.players[key]?.in[id];
      for (const key of Object.keys(p.convs)) leaveConv(s, s.convs[key], id, true);
      delete s.houses[id]; delete s.players[id];
      endedIn(s).blocks.push(['forget', id]);
    }
    for (const hostId of Object.keys(s.houses)) pruneHouse(s, hostId);
  }

  /** Idempotency for non-message writes: the same client id returns the first outcome; a different request is refused. */
  function receiptFor(s, me, cid, kind, fp) {
    const receipt = s.receipts[`${me}|${cid}`];
    if (!receipt) return null;
    if (receipt.kind !== kind || receipt.fp !== fp) throw ctx.fail(409, 'client_id_conflict');
    return { ...receipt.result, duplicate: true };
  }
  function saveReceipt(s, me, cid, kind, fp, result) {
    const keys = Object.keys(s.receipts);
    if (keys.length >= LIMITS.receipts) for (const key of keys.slice(0, 500)) delete s.receipts[key];
    s.receipts[`${me}|${cid}`] = { at: now(), kind, fp, result };
    return result;
  }

  // ---- conversations -------------------------------------------------------------------------
  function messageView(s, conv, message, viewer) {
    return { seq: message.seq, id: `${conv.id}#${message.seq}`, conv: conv.id, from: message.from ? pub(s, message.from) : null, body: message.body, at: message.at,
      ...(message.sys ? { sys: true } : {}), ...(message.from === viewer && message.cid ? { clientId: message.cid } : {}) };
  }
  const visibleTo = (s, viewer, message) => !message.from || !s.players[viewer]?.blocked[message.from];
  function summary(s, conv, viewer) {
    const read = s.players[viewer]?.convs[conv.id]?.read ?? 0;
    const seen = conv.messages.filter((message) => visibleTo(s, viewer, message));
    const last = seen.at(-1);
    const others = conv.members.filter((id) => id !== viewer);
    return { id: conv.id, kind: conv.kind, name: conv.kind === 'dm' ? pub(s, others[0]).name : conv.kind === 'house' ? `${pub(s, conv.owner).name}’s house` : conv.name,
      members: conv.members.map((id) => pub(s, id)), owner: conv.owner ?? null, with: conv.kind === 'dm' ? others[0] : null,
      last: last ? { seq: last.seq, from: last.from ? pub(s, last.from) : null, body: last.body.slice(0, 80), at: last.at } : null,
      unread: seen.filter((message) => message.seq > read && message.from !== viewer && !message.sys).length };
  }
  function append(s, conv, from, body, cid, sys = false) {
    const message = { seq: ++conv.seq, from, body, at: now(), ...(cid ? { cid } : {}), ...(sys ? { sys: true } : {}) };
    conv.messages.push(message);
    if (conv.messages.length > LIMITS.history) conv.messages.splice(0, conv.messages.length - LIMITS.history);
    if (from && s.players[from]?.convs[conv.id]) s.players[from].convs[conv.id].read = message.seq;
    return message;
  }
  function fanOut(s, conv, message, push, except) {
    for (const member of conv.members) {
      if (member === except || !visibleTo(s, member, message)) continue;
      push.push([member, { type: 'dm', conv: summary(s, conv, member), message: messageView(s, conv, message, member) }]);
    }
  }
  function index(s, id, conv) {
    const p = s.players[id];
    if (!p || p.convs[conv.id]) return;
    const ids = Object.keys(p.convs);
    if (ids.length >= LIMITS.convs) {
      // Make room by dropping the quietest direct chat from this player's list (history stays for the other side).
      const quiet = ids.filter((key) => s.convs[key]?.kind === 'dm').sort((a, b) => (s.convs[a].messages.at(-1)?.at ?? 0) - (s.convs[b].messages.at(-1)?.at ?? 0))[0];
      if (quiet) { delete p.convs[quiet]; collect(s, quiet); }
    }
    p.convs[conv.id] = { read: 0 };
  }
  /** Delete a conversation nobody lists any more. */
  function collect(s, id) {
    const conv = s.convs[id];
    if (conv && !conv.members.some((member) => s.players[member]?.convs[id])) delete s.convs[id];
  }
  function leaveConv(s, conv, id, silent = false) {
    if (!conv) return;
    delete s.players[id]?.convs[conv.id];
    if (conv.kind === 'dm') { collect(s, conv.id); return; }
    conv.members = conv.members.filter((member) => member !== id);
    if (!conv.members.length) { delete s.convs[conv.id]; return; }
    if (conv.kind === 'group' && conv.owner === id) conv.owner = conv.members[0];
    if (!silent) append(s, conv, null, `${pub(s, id).name} left.`, null, true);
  }
  function memberConv(s, me, id) {
    const conv = Object.hasOwn(s.convs, id) ? s.convs[id] : null;
    return conv && conv.members.includes(me) && s.players[me].convs[id] ? conv : null;
  }

  // ---- houses --------------------------------------------------------------------------------
  /** Is the host's stored life at home in the visit's city? Without the host helper (a bare context) visits are not tied to it. */
  function hostAtHome(s, hostId, cityId) {
    const db = dbOf.get(s);
    if (typeof ctx.atHome !== 'function' || !db) return true;
    return cityId ? ctx.atHome(db, hostId, cityId) : ctx.cityIds.some((city) => ctx.atHome(db, hostId, city));
  }
  function pruneHouse(s, hostId) {
    const house = s.houses[hostId];
    if (!house) return null;
    const t = now();
    for (const [visitor, knock] of Object.entries(house.knocks)) {
      if (knock.status === 'pending' ? knock.expires <= t : t - knock.answeredAt > LIMITS.knockCooldownMs) delete house.knocks[visitor];
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
  function syncHouseConv(s, hostId) {
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
  function houseView(s, hostId, viewer) {
    const house = pruneHouse(s, hostId);
    const guests = Object.entries(house?.guests || {}).map(([id, visit]) => ({ ...pub(s, id), since: visit.since, expiresAt: visit.expires }));
    const cityId = house?.guests[viewer]?.cityId ?? Object.values(house?.guests || {})[0]?.cityId ?? null;
    const role = viewer === hostId ? 'host' : house?.guests[viewer] ? 'guest' : 'none';
    const host = presence.status(hostId);
    return { host: pub(s, hostId), capacity: LIMITS.guests, guests, role, cityId, conv: guests.length && role !== 'none' ? `h.${hostId}` : null,
      hostStatus: host.state !== 'online' ? host.state : host.rooms.some((room) => describeRoom(room).hostId === hostId) ? 'home' : 'out',
      knocks: role === 'host' ? Object.entries(house?.knocks || {}).filter(([, knock]) => knock.status === 'pending').map(([id, knock]) => ({ from: pub(s, id), at: knock.at, expiresAt: knock.expires })) : [] };
  }
  function endVisit(s, hostId, guest) {
    const house = s.houses[hostId];
    if (!house?.guests[guest]) return false;
    delete house.guests[guest];
    if (s.players[guest]?.visiting === hostId) s.players[guest].visiting = null;
    endedIn(s).push([hostId, guest]);
    syncHouseConv(s, hostId);
    pruneHouse(s, hostId);
    return true;
  }
  const housePush = (s, hostId, push) => { for (const id of [hostId, ...Object.keys(s.houses[hostId]?.guests || {})]) push.push([id, { type: 'invite-house', house: houseView(s, hostId, id) }]); };

  function cut(s, db, a, b, cityId) {
    const pa = s.players[a], pb = s.players[b];
    const were = Boolean(pa.friends[b] || pb.friends[a]);
    delete pa.friends[b]; delete pb.friends[a];
    for (const [x, y] of [[pa, b], [pb, a]]) { delete x.in[y]; delete x.out[y]; delete x.baeIn[y]; }
    if (pa.bae === b) pa.bae = null;
    if (pb.bae === a) pb.bae = null;
    if (were) for (const [to, about] of [[a, b], [b, a]]) owe(s, db, to, cityId, { op: 'unfriend', id: about });
  }

  const service = {
    LIMITS,
    presence,
    /**
     * Call INSIDE the transaction, last: attaches the visits this transaction ended to its result
     * (hidden from JSON), so deliver() can announce exactly those after the commit.
     */
    finish(db, result) {
      const list = endedOf.get(ctx.collection(db, 'social'));
      if (!list || !result || typeof result !== 'object') return result;
      if (list.material) Object.defineProperty(result, MATERIAL, { value: true, enumerable: false });
      if (list.length) Object.defineProperty(result, ENDED, { value: list.splice(0), enumerable: false });
      if (list.blocks.length) Object.defineProperty(result, BLOCKS, { value: list.blocks.splice(0), enumerable: false });
      return result;
    },
    /**
     * Bring the in-memory block index in line with a transaction that has just COMMITTED. Passed
     * to the store as `committed`, so it runs even if the write that follows fails — otherwise a
     * stored block could go unenforced in venue rooms until a restart. Safe to call twice.
     */
    committed(result) {
      const changes = result?.[BLOCKS];
      if (!changes || changes.applied) return;
      changes.applied = true;
      for (const change of changes) { applyBlockChange(change); if (change[2]) ctx.emit?.('blocks-changed', { a: change[1], b: change[2] }); }
    },
    /** Send the pushes a committed result collected, and strip them from what the caller sees. */
    deliver(result) {
      // Visits that ended in the committed transaction: the room module drops those guests from the host's Home room now.
      for (const [hostId, guestId] of result?.[ENDED] ?? []) ctx.emit?.('visit-ended', { hostId, guestId });
      service.committed(result); // a store without the `committed` hook: apply the block changes now
      if (!result || !Array.isArray(result.push)) return result;
      const { push, ...rest } = result;
      for (const [to, message] of push) ctx.push(to, message);
      return rest;
    },

    // ---- overview --------------------------------------------------------------------------
    me(db, session) {
      const { s, p, id } = enter(db, session);
      const person = (other) => ({ ...pub(s, other), ...whereabouts(other, true) });
      const visit = p.visiting ? houseView(s, p.visiting, id) : null; // prunes first, so an ended visit is never reported
      return yes('ok', {
        me: { id, name: p.name, since: p.first },
        friends: Object.entries(p.friends).map(([other, since]) => ({ ...person(other), since, bae: p.bae === other })).sort((a, b) => a.name.localeCompare(b.name)),
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
    readUpdates(db, session) {
      const { p } = enter(db, session);
      for (const update of p.updates) update.read = true;
      return yes('read');
    },

    // ---- people ----------------------------------------------------------------------------
    /** Who shares the caller's venue room right now, from server presence only. */
    people(db, session, cityId) {
      city(cityId);
      const { s, p, id } = enter(db, session);
      const state = ctx.settle(session, cityId);
      const travelling = state.activeAction?.kind === 'travel';
      const room = venueRoomKey(cityId, state.location, id);
      const joined = !travelling && presence.isIn(id, room);
      // `look` (appearance option ids) and `here` come from the room module's own record of who is in the room.
      const inRoom = new Map(presence.inRoom(room).map((member) => [member.id, member]));
      const card = (member) => ({ ...pub(s, member), friend: areFriends(s, id, member), requested: Boolean(p.out[member]), incoming: Boolean(p.in[member]),
        look: inRoom.get(member)?.look ?? null, here: inRoom.has(member) });
      let players = [];
      if (state.location === 'home') players = Object.keys(pruneHouse(s, id)?.guests || {}).map(card);
      else if (joined) players = [...inRoom.values()].filter((member) => member.id !== id && s.players[member.id] && !blockedEither(s, id, member.id)).map((member) => card(member.id));
      return yes('ok', { cityId, venue: state.location, self: travelling ? 'travelling' : joined ? 'joined' : 'not_joined', players, count: players.length });
    },
    search(db, session, query) {
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
      results.sort((a, b) => b.exact - a.exact || a.name.localeCompare(b.name));
      return yes('ok', { results: results.slice(0, LIMITS.searchResults).map(({ exact, ...rest }) => rest) });
    },
    profile(db, session, rawId) {
      const target = uuid(rawId);
      const { s, p, id } = enter(db, session);
      if (target !== id && (!s.players[target] || s.players[target].blocked[id])) return no('unknown_player', 'That player was not found. They may not have played yet.');
      const friend = areFriends(s, id, target);
      return yes('ok', { player: { ...pub(s, target), self: target === id, friend, requested: Boolean(p.out[target]), incoming: Boolean(p.in[target]), blocked: Boolean(p.blocked[target]),
        bae: p.bae === target, baeAsked: Boolean(s.players[target].baeIn[id]), ...whereabouts(target, friend) } });
    },

    // ---- friends ---------------------------------------------------------------------------
    friendRequest(db, session, body) {
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
      if (Object.keys(p.friends).length >= LIMITS.friends) return no('friends_full', `Your friends list is full (${LIMITS.friends}).`);
      p.out[to] = target.in[id] = now();
      const push = [[to, { type: 'friend-request', from: pub(s, id) }]];
      notify(s, to, 'friend-request', `${p.name} wants to be friends.`, { from: id }, push);
      return yes('requested', { player: pub(s, to), push });
    },
    friendAnswer(db, session, body) {
      const from = uuid(body.from), cityId = city(body.cityId);
      if (typeof body.accept !== 'boolean') throw bad('invalid_answer');
      const { s, p, id } = enter(db, session);
      const asker = s.players[from];
      if (areFriends(s, id, from)) return yes('accepted', { player: pub(s, from), duplicate: true });
      if (!p.in[from] || !asker) return no('no_request', 'That friend request is no longer waiting. It may have been withdrawn or already answered.');
      delete p.in[from]; delete asker.out[id];
      const push = [];
      if (!body.accept) return yes('declined', { player: pub(s, from), push });
      if (Object.keys(p.friends).length >= LIMITS.friends || Object.keys(asker.friends).length >= LIMITS.friends) return no('friends_full', `One of you already has ${LIMITS.friends} friends.`);
      p.friends[from] = asker.friends[id] = now();
      act(session, cityId, 'friend', { id: from, name: asker.name }, `social|friend|${id}|${from}`);
      owe(s, db, from, cityId, { op: 'friend', id, name: p.name });
      push.push([from, { type: 'friend-accepted', by: pub(s, id) }], [from, { type: 'social-sync' }]);
      notify(s, from, 'friend-accepted', `${p.name} accepted your friend request.`, { from: id }, push);
      return yes('accepted', { player: pub(s, from), push });
    },
    friendRemove(db, session, body) {
      const other = uuid(body.id), cityId = city(body.cityId);
      const { s, p, id } = enter(db, session);
      if (!s.players[other] || !(p.friends[other] || p.out[other])) return yes('removed', { duplicate: true });
      cut(s, db, id, other, cityId);
      return yes('removed', { push: [[other, { type: 'social-sync' }]] });
    },

    // ---- block and report ------------------------------------------------------------------
    block(db, session, body) {
      const target = uuid(body.id), cityId = city(body.cityId);
      const { s, p, id } = enter(db, session);
      if (target === id) return no('self', 'You cannot block yourself.');
      if (!s.players[target]) return no('unknown_player', 'That player was not found.');
      if (p.blocked[target]) return yes('blocked', { duplicate: true });
      if (Object.keys(p.blocked).length >= LIMITS.blocked) return no('block_list_full', `Your block list is full (${LIMITS.blocked}). Unblock someone first.`);
      p.blocked[target] = now();
      endedIn(s).blocks.push(['block', id, target]);
      cut(s, db, id, target, cityId);
      const push = [];
      for (const [host, guest] of [[id, target], [target, id]]) if (endVisit(s, host, guest)) { housePush(s, host, push); push.push([guest, { type: 'invite-house', house: houseView(s, host, guest) }]); }
      delete s.houses[id]?.knocks[target]; delete s.houses[target]?.knocks[id];
      return yes('blocked', { push });
    },
    unblock(db, session, body) {
      const target = uuid(body.id);
      const { s, p, id } = enter(db, session);
      if (p.blocked[target]) endedIn(s).blocks.push(['unblock', id, target]);
      delete p.blocked[target];
      return yes('unblocked');
    },
    /** File a report for moderators. The reporter gets a receipt that survives reloads. */
    report(db, session, body) {
      const about = uuid(body.id);
      if (!REPORT_REASONS.includes(body.reason)) throw bad('invalid_reason');
      const detail = body.text === undefined || body.text === '' ? '' : text(body.text, LIMITS.reportText, 'invalid_report_text');
      const { s, p, id } = enter(db, session);
      if (about === id) return no('self', 'You cannot report yourself.');
      if (!s.players[about]) return no('unknown_player', 'That player was not found.');
      const existing = p.reports.find((report) => report.about === about && report.reason === body.reason && now() - report.at < 86400000);
      if (existing) return yes('reported', { receipt: existing, duplicate: true });
      if (!ctx.allow(`social:report:${id}`, 5, 3600000)) return no('rate_limited', 'You have filed several reports this hour. Try again later.');
      const dm = s.convs[dmId(id, about)];
      const report = { id: `R-${++s.seq}`, by: id, about, aboutName: s.players[about].name, reason: body.reason, text: detail, at: now(), status: 'received',
        evidence: (dm?.messages || []).filter((message) => message.from === about).slice(-5).map((message) => message.body) };
      s.reports.push(report);
      if (s.reports.length > LIMITS.reports) s.reports.splice(0, s.reports.length - LIMITS.reports);
      const receipt = { id: report.id, about, name: report.aboutName, reason: report.reason, at: report.at, status: report.status };
      p.reports.push(receipt);
      if (p.reports.length > LIMITS.ownReports) p.reports.shift();
      const push = [];
      notify(s, id, 'report', `Report ${report.id} about ${report.aboutName} was received. A moderator will review it.`, { report: report.id }, push);
      return yes('reported', { receipt, push });
    },

    // ---- messages --------------------------------------------------------------------------
    conversations(db, session) {
      const { s, p, id } = enter(db, session);
      const list = Object.keys(p.convs).map((key) => s.convs[key]).filter((conv) => conv && !(conv.kind === 'dm' && p.blocked[conv.members.find((member) => member !== id)]))
        .map((conv) => summary(s, conv, id)).sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0));
      return yes('ok', { conversations: list, unread: list.reduce((sum, conv) => sum + conv.unread, 0) });
    },
    history(db, session, rawConv, after) {
      const key = convId(rawConv);
      const { s, p, id } = enter(db, session);
      const conv = memberConv(s, id, key);
      if (!conv) return no('not_a_member', 'You are not in that conversation.');
      const from = Number.isSafeInteger(after) && after >= 0 ? after : 0;
      const messages = conv.messages.filter((message) => message.seq > from && visibleTo(s, id, message)).slice(-LIMITS.page).map((message) => messageView(s, conv, message, id));
      return yes('ok', { conv: summary(s, conv, id), messages, read: p.convs[key].read });
    },
    read(db, session, body) {
      const key = convId(body.conv);
      const { s, p, id } = enter(db, session);
      const conv = memberConv(s, id, key);
      if (!conv) return no('not_a_member', 'You are not in that conversation.');
      const seq = Number.isSafeInteger(body.seq) ? Math.max(0, Math.min(body.seq, conv.seq)) : conv.seq;
      p.convs[key].read = Math.max(p.convs[key].read, seq);
      return yes('read', { conv: summary(s, conv, id) });
    },
    /**
     * Send to a player (`to`) or an existing conversation (`conv`). Idempotent on the sender's
     * `clientId`: a retry returns the stored message and nothing is stored or delivered twice.
     */
    send(db, session, body) {
      const cid = clientId(body.clientId), message = text(body.body, LIMITS.body, 'invalid_message');
      const to = body.to !== undefined ? uuid(body.to) : null, key = to ? dmId(session.publicId, to) : convId(body.conv);
      const { s, p, id } = enter(db, session);
      let conv = Object.hasOwn(s.convs, key) ? s.convs[key] : null;
      const sent = conv?.messages.find((item) => item.from === id && item.cid === cid);
      if (sent) {
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
      const push = [];
      fanOut(s, conv, stored, push, null);
      return yes('sent', { conv: summary(s, conv, id), message: messageView(s, conv, stored, id), push });
    },

    // ---- groups ----------------------------------------------------------------------------
    groupCreate(db, session, body) {
      const cid = clientId(body.clientId), name = text(body.name, LIMITS.groupName, 'invalid_group_name');
      if (!Array.isArray(body.members) || body.members.length > LIMITS.groupSize) throw bad('invalid_members');
      const members = [...new Set(body.members.map((member) => uuid(member)))];
      const { s, p, id } = enter(db, session);
      const existing = Object.keys(p.convs).map((key) => s.convs[key]).find((conv) => conv?.kind === 'group' && conv.creator === id && conv.cid === cid);
      if (existing) return yes('created', { conv: summary(s, existing, id), duplicate: true });
      const refused = mutedRefusal(id) ?? screened(name, 'A group name', true);
      if (refused) return refused;
      if (!ctx.allow(`social:group:${id}`, 5, 3600000)) return no('rate_limited', 'You have created several groups this hour. Try again later.');
      if (Object.keys(p.convs).filter((key) => s.convs[key]?.kind === 'group').length >= LIMITS.groups) return no('too_many_groups', `You can be in ${LIMITS.groups} groups. Leave one first.`);
      if (members.length + 1 > LIMITS.groupSize) return no('group_full', `A group holds ${LIMITS.groupSize} people including you.`);
      const stranger = members.find((member) => member === id || !areFriends(s, id, member));
      if (stranger) return no('friends_only', `You can only add friends to a group. ${pub(s, stranger).name} is not your friend yet.`);
      const conv = s.convs[`g.${++s.seq}`] = { id: `g.${s.seq}`, kind: 'group', name, owner: id, creator: id, cid, members: [id, ...members], seq: 0, created: now(), messages: [] };
      for (const member of conv.members) index(s, member, conv);
      const first = append(s, conv, null, `${p.name} created “${name}”.`, null, true);
      const push = [];
      fanOut(s, conv, first, push, id);
      for (const member of members) notify(s, member, 'group-added', `${p.name} added you to the group “${name}”.`, { conv: conv.id }, push);
      return yes('created', { conv: summary(s, conv, id), push });
    },
    /** body: { conv, op: 'rename' | 'add' | 'remove' | 'leave', name?, id? } */
    groupUpdate(db, session, body) {
      const key = convId(body.conv);
      const { s, p, id } = enter(db, session);
      const conv = memberConv(s, id, key);
      if (!conv || conv.kind !== 'group') return no('not_a_member', 'You are not in that group.');
      const push = [];
      const say = (line) => fanOut(s, conv, append(s, conv, null, line, null, true), push, null);
      if (body.op === 'leave') {
        leaveConv(s, conv, id);
        if (s.convs[key]) fanOut(s, conv, conv.messages.at(-1), push, null);
        return yes('left', { push });
      }
      if (conv.owner !== id) return no('owner_only', `Only ${pub(s, conv.owner).name}, who runs this group, can do that.`);
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
        if (Object.keys(s.players[member].convs).filter((item) => s.convs[item]?.kind === 'group').length >= LIMITS.groups) return no('too_many_groups', `${pub(s, member).name} is already in ${LIMITS.groups} groups.`);
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
    homeGuest(db, guestId, hostId, cityId) {
      if (typeof guestId !== 'string' || typeof hostId !== 'string' || guestId === hostId) return false;
      const s = col(db);
      if (!Object.hasOwn(s.players, guestId) || !Object.hasOwn(s.players, hostId) || !Object.hasOwn(s.houses, hostId)) return false;
      const visit = pruneHouse(s, hostId)?.guests[guestId];
      return Boolean(visit) && visit.cityId === cityId;
    },
    /** The host's life left home: end every visit, tell the guests, and return the pushes. */
    closeHouse(db, hostId) {
      const s = col(db);
      const before = Object.keys(s.houses[hostId]?.guests || {});
      if (!before.length) return yes('closed', { push: [] });
      pruneHouse(s, hostId);
      const push = [];
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
    expireVisits(db, hostId) {
      const s = col(db);
      const before = Object.keys(s.houses[hostId]?.guests || {});
      if (!before.length) return yes('ok', { push: [] });
      pruneHouse(s, hostId);
      const push = [];
      for (const guest of before.filter((id) => !s.houses[hostId]?.guests[id])) {
        push.push([guest, { type: 'invite-house', house: houseView(s, hostId, guest) }]);
        notify(s, guest, 'invite-answer', `Your visit to ${pub(s, hostId).name}’s house ended. A visit lasts ${Math.round(LIMITS.visitMs / 60000)} minutes; knock again to come back.`, { host: hostId }, push);
      }
      push.push([hostId, { type: 'invite-house', house: houseView(s, hostId, hostId) }]);
      return yes('ok', { push });
    },

    // ---- operator side (server/routes/moderation.js). Never reachable with a player's session. ----
    modReports(db, status = 'open', limit = 100) {
      const s = col(db);
      return s.reports.filter((report) => status === 'all' || (status === 'open' ? report.status === 'received' : report.status === status)).slice(-limit).reverse()
        .map((report) => ({ ...report, byName: s.players[report.by]?.name ?? 'Former player', aboutNow: s.players[report.about]?.name ?? null }));
    },
    modReportCounts(db) { const s = col(db); return { total: s.reports.length, open: s.reports.filter((report) => report.status === 'received').length }; },
    /** Set a report's status and tell the reporter, whose own receipt shows the same status. */
    modSetReport(db, reportId, status, note = '') {
      const s = col(db);
      const report = s.reports.find((item) => item.id === reportId);
      if (!report) return null;
      report.status = status; report.note = note; report.updatedAt = now();
      const receipt = s.players[report.by]?.reports.find((item) => item.id === reportId);
      if (receipt) receipt.status = status;
      const push = [];
      notify(s, report.by, 'report', `Report ${report.id} about ${report.aboutName}: ${status === 'dismissed' ? 'a moderator reviewed it and took no action' : 'a moderator acted on it'}.${note ? ` Note: ${note}` : ''}`, { report: report.id }, push);
      return { report, push };
    },
    /** A line in one player's Updates feed from the operator (a mute, a removed ad). */
    modNote(db, to, text) {
      const s = col(db), push = [];
      notify(s, to, 'moderation', text, null, push);
      return { push };
    },
    modKnows: (db, id) => Boolean(col(db).players[id]),

    // ---- house invites: knock → let in / not now -----------------------------------------------
    house(db, session, rawHost) {
      const hostId = uuid(rawHost);
      const { s, id } = enter(db, session);
      if (!s.players[hostId] || blockedEither(s, id, hostId)) return no('unknown_player', 'That house was not found.');
      const house = houseView(s, hostId, id);
      const knock = s.houses[hostId]?.knocks[id];
      return yes('ok', { house, knock: knock ? { status: knock.status, expiresAt: knock.expires } : null });
    },
    knock(db, session, body) {
      const hostId = uuid(body.host), cityId = city(body.cityId);
      const { s, p, id } = enter(db, session);
      const { target, refusal } = other(s, id, hostId);
      if (refusal) return refusal.code === 'self' ? no('self', 'This is your own house. Share the link with someone else.') : refusal;
      const house = pruneHouse(s, hostId) || (s.houses[hostId] = { knocks: {}, guests: {} });
      const done = (result) => { pruneHouse(s, hostId); return result; };
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
      const push = [[hostId, { type: 'invite-knock', from: pub(s, id), expiresAt: house.knocks[id].expires }]];
      notify(s, hostId, 'invite-knock', `${p.name} is knocking at your door.`, { from: id }, push);
      return yes('knocking', { expiresAt: house.knocks[id].expires, push });
    },
    /** Host answers a knock. Accepting is applied exactly once; repeating the same answer returns the same outcome. */
    knockAnswer(db, session, body) {
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
      const push = [];
      if (body.answer === 'accept') {
        if (!hostAtHome(s, id, knock.cityId)) return no('host_not_home', 'You are not at home, so nobody can come in. Go home first, then let them in.');
        if (Object.keys(house.guests).length >= LIMITS.guests) return no('house_full', `Your house is full (${LIMITS.guests} guests). Ask someone to leave first.`);
        const visiting = s.players[visitor]?.visiting;
        if (visiting && visiting !== id && endVisit(s, visiting, visitor)) housePush(s, visiting, push);
        house.guests[visitor] = { since: now(), expires: now() + LIMITS.visitMs, cityId: knock.cityId };
        if (s.players[visitor]) s.players[visitor].visiting = id;
        syncHouseConv(s, id);
        fanOut(s, s.convs[`h.${id}`], append(s, s.convs[`h.${id}`], null, `${pub(s, visitor).name} came in.`, null, true), push, null);
      }
      knock.status = answered; knock.answeredAt = now();
      push.push([visitor, { type: 'invite-answer', host: pub(s, id), answer: answered, house: houseView(s, id, visitor) }]);
      notify(s, visitor, 'invite-answer', body.answer === 'accept' ? `${p.name} let you in.` : `${p.name} said not now.`, { host: id }, push);
      housePush(s, id, push);
      return yes(answered, { house: houseView(s, id, id), push });
    },
    /** body: { host, guest? } — a guest leaves (guest omitted) or the host asks a guest to leave. */
    houseLeave(db, session, body) {
      const hostId = uuid(body.host), guest = body.guest === undefined ? null : uuid(body.guest);
      const { s, id } = enter(db, session);
      if (guest && hostId !== id) return no('host_only', 'Only the host can ask a guest to leave.');
      const leaving = guest ?? id;
      const push = [];
      if (!endVisit(s, hostId, leaving)) return yes('left', { duplicate: true });
      const conv = s.convs[`h.${hostId}`];
      if (conv) fanOut(s, conv, append(s, conv, null, `${pub(s, leaving).name} left.`, null, true), push, null);
      push.push([leaving, { type: 'invite-house', house: houseView(s, hostId, leaving) }]);
      housePush(s, hostId, push);
      return yes('left', { push });
    },

    // ---- player-to-player interactions, Bae, transfers -------------------------------------------
    interact(db, session, body) {
      const target = uuid(body.id), cityId = city(body.cityId), cid = clientId(body.clientId);
      const action = PLAYER_ACTIONS.find((item) => item.id === body.action);
      if (!action) throw bad('invalid_interaction');
      const { s, id } = enter(db, session);
      const fp = `${target}|${action.id}|${cityId}`;
      const replay = receiptFor(s, id, cid, 'interact', fp);
      if (replay) return replay;
      const { target: them, refusal } = other(s, id, target);
      if (refusal) return refusal;
      if (!ctx.allow(`social:interact:${id}`, 30)) return no('rate_limited', 'Slow down a little. Try again in a moment.');
      const state = ctx.settle(session, cityId);
      const room = venueRoomKey(cityId, state.location, id);
      if (state.location === 'home' || state.activeAction?.kind === 'travel' || !presence.isIn(id, room)) return no('not_joined', 'You are not in a venue room right now. Go to a public venue and wait for it to connect.');
      if (!presence.isIn(target, room)) return no('not_here', `${them.name} is not at ${venueLabel(state.location, cityId)} with you right now.`);
      const result = act(session, cityId, 'interact', { id: target, name: them.name, action: action.id }, `social|interact|${id}|${cid}`);
      if (!result.ok) return no(result.code, result.reason);
      const push = [[target, { type: 'people-interaction', from: pub(s, id), action: action.id, label: action.label, landed: result.code === 'interacted' }]];
      const outcome = saveReceipt(s, id, cid, 'interact', fp, yes(result.code, { message: result.state.message, closeness: result.state.social.rel[target]?.p ?? 0 }));
      return { ...outcome, push };
    },
    baeAsk(db, session, body) {
      const target = uuid(body.id), cityId = city(body.cityId);
      const { s, p, id } = enter(db, session);
      const { target: them, refusal } = other(s, id, target);
      if (refusal) return refusal;
      if (!areFriends(s, id, target)) return no('friends_only', `Become friends with ${them.name} before asking.`);
      if (p.bae || them.bae) return no('already_have_bae', p.bae ? 'You already have a Bae. End that first.' : `${them.name} is already with someone.`);
      const check = act(session, cityId, 'bae-check', { id: target }, `social|baecheck|${id}`);
      if (!check.ok) return no(check.code, check.reason);
      if (them.baeIn[id]) return yes('asked', { duplicate: true });
      if (!ctx.allow(`social:bae:${id}`, 5, 3600000)) return no('rate_limited', 'You have asked a lot this hour. Give it some time.');
      them.baeIn[id] = { at: now(), cityId };
      const push = [[target, { type: 'social-sync' }]];
      notify(s, target, 'bae-request', `${p.name} asked you to be their Bae.`, { from: id }, push);
      return yes('asked', { push });
    },
    baeAnswer(db, session, body) {
      const from = uuid(body.from), cityId = city(body.cityId);
      if (typeof body.accept !== 'boolean') throw bad('invalid_answer');
      const { s, p, id } = enter(db, session);
      const asker = s.players[from];
      if (p.bae === from && body.accept) return yes('accepted', { duplicate: true });
      if (!p.baeIn[from] || !asker) return no('no_request', 'That request is no longer waiting.');
      delete p.baeIn[from];
      const push = [[from, { type: 'social-sync' }]];
      if (!body.accept) { notify(s, from, 'bae-answer', `${p.name} said no for now.`, { from: id }, push); return yes('declined', { push }); }
      if (p.bae || asker.bae) return no('already_have_bae', p.bae ? 'You already have a Bae. End that first.' : `${asker.name} is already with someone.`);
      const mine = act(session, cityId, 'bae', { id: from, name: asker.name }, `social|bae|${id}|${from}`);
      if (!mine.ok) return no(mine.code, mine.reason);
      p.bae = from; asker.bae = id;
      owe(s, db, from, cityId, { op: 'bae', id, name: p.name });
      notify(s, from, 'bae-answer', `${p.name} said yes. You are together now.`, { from: id }, push);
      return yes('accepted', { push });
    },
    baeEnd(db, session, body) {
      const cityId = city(body.cityId);
      const { s, p, id } = enter(db, session);
      const ex = p.bae;
      if (!ex) return yes('ended', { duplicate: true });
      p.bae = null;
      if (s.players[ex]?.bae === id) s.players[ex].bae = null;
      act(session, cityId, 'bae-end', { id: ex }, `social|baeend|${id}|${++s.seq}`);
      owe(s, db, ex, cityId, { op: 'bae-end', id });
      const push = [[ex, { type: 'social-sync' }]];
      notify(s, ex, 'bae-answer', `${p.name} ended things.`, { from: id }, push);
      return yes('ended', { push });
    },
    /**
     * Gift naira to a friend. One transaction: the sender is debited through the rules engine
     * and the recipient is credited (or, if they are not connected, the credit is stored and
     * applied on their next request). Idempotent on `clientId`.
     */
    transfer(db, session, body) {
      const to = uuid(body.to), cityId = city(body.cityId), cid = clientId(body.clientId), amount = body.amount;
      if (!Number.isSafeInteger(amount) || amount <= 0) throw bad('invalid_amount');
      const { s, p, id } = enter(db, session);
      const fp = `${to}|${amount}|${cityId}`;
      const replay = receiptFor(s, id, cid, 'transfer', fp);
      if (replay) return replay;
      const L = TRANSFER_LIMITS, t = now();
      const { target, refusal } = other(s, id, to);
      if (refusal) return refusal;
      if (!ctx.allow(`social:transfer:${id}`, 5)) return no('rate_limited', 'Too many transfers in a minute. Wait, then try again.');
      if (!areFriends(s, id, to)) return no('friends_only', `You can only send money to friends. Add ${target.name} as a friend first.`);
      const wait = (ms) => { const minutes = Math.ceil(ms / 60000); return minutes >= 60 ? `${Math.ceil(minutes / 60)} h` : `${minutes} min`; };
      if (t - p.first < L.minAccountAgeMs) return no('account_too_new', `Sending money opens 24 hours after you start playing. Try again in ${wait(L.minAccountAgeMs - (t - p.first))}.`);
      const since = Math.max(p.friends[to], target.friends[id]);
      if (t - since < L.minFriendshipMs) return no('friendship_too_new', `You and ${target.name} only just became friends. Try again in ${wait(L.minFriendshipMs - (t - since))}.`);
      const day = lagosTime(t).day;
      if (target.recv.day !== day) target.recv = { day, amount: 0 };
      if (target.recv.amount + amount > L.dailyReceive) return no('recipient_limit', `${target.name} has received the most a player can be given in one day (${naira(L.dailyReceive)}).`);
      if ((s.pending[to]?.length ?? 0) >= LIMITS.pending) return no('recipient_unavailable', `${target.name} has too many gifts waiting. Ask them to log in first.`);
      const sent = act(session, cityId, 'transfer-out', { to, name: target.name, amount }, `social|transfer|${id}|${cid}`);
      if (!sent.ok) return no(sent.code, sent.reason);
      target.recv.amount += amount;
      const credited = owe(s, db, to, cityId, { op: 'transfer-in', from: id, name: p.name, amount }, { keep: true });
      const push = [[to, { type: 'transfer', from: pub(s, id), amount, credited }], [to, { type: 'social-sync' }]];
      notify(s, to, 'transfer', `${p.name} sent you ${naira(amount)}.`, { from: id, amount }, push);
      const result = yes('sent', { amount, to: pub(s, to), credited, balance: sent.state.cash });
      saveReceipt(s, id, cid, 'transfer', fp, result);
      return { ...result, push };
    },
  };
  services.set(ctx, service);
  return service;
}
