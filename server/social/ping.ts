/**
 * OWNER: social
 * PING: "I am here — come and join me", and THE JOIN that brings a friend to where the pinger is.
 * Rules and numbers: src/game/ping.ts. Wire types: src/types/ping.ts. Routes: server/routes/ping.ts. What leaves the game
 * for a ping (an e-mail, a notification): server/growth/ping-mail.ts. The whole design: docs/COMEBACK-MAIL.md ("Ping").
 *
 * STORED (additive; inside the social collection)
 *   social.pings      { "<from>><to>": { from, to, at, expires, cityId, venue, state, auto? } }   one per pair and direction.
 *                     `venue` is a venue id or 'home' — never an address. A record is dropped once it is over AND the wait
 *                     before the next ping to that friend has passed; at most PING.open are kept.
 *   social.pingJoins  { [publicId]: [ms] }   the journeys to another city a player made free of charge, last 24 hours.
 *   A ping also puts one line in the friend's Updates (kind 'ping'), like every other notice.
 *
 * WHO MAY PING WHOM. Friends only, never across a block (either way), never a muted sender. A player whose friendship with
 * the founder is the automatic one (./founder.ts) cannot ping the founder at all: every player has that friendship, so it
 * would be one notice per player. The founder pinging such a friend is an ordinary ping, under the caps everyone has.
 *
 * WHAT THE PINGER LEARNS. That the friend was told (they are in the game), or that they will see it when they are back
 * (or that it is night). The answer is worked out from the clock and from presence, which a friend sees anyway — never
 * from whether an address or a notification exists, and nothing is sent before the pinger has been answered.
 *
 * THE JOIN LINK is `/j/<token>`: [version, from, to, expires] and an HMAC-SHA-256 over them, with a key this server makes
 * for itself (ctx.keyFile). It names a ping, nothing else: opening it signs nobody in, and it is honoured only for the
 * signed-in player it was made for, while that ping is live. THE JOIN itself needs no token: it is a request by the
 * recipient, checked again against the stored ping, the friendship, the blocks and where the pinger is NOW.
 *
 * Portable: no Node imports. One service per server context.
 */
import { characterCity, fileCharacter } from '../character.ts';
import { UUID_PATTERN, isDeparting } from '../protocol.ts';
import { cityName } from '../../src/game/cities/index.ts';
import { publicArrivalVenue, venueFor } from '../../src/game/cities/runtime.ts';
import { venueLabel } from '../../src/game/content/venues.ts';
import { PING, PING_LIVE_MS, PING_PAIR_MS, nightAt, pingNoteWords, placeWords, waitWords } from '../../src/game/ping.ts';
import { growthOf } from '../growth/data.ts';
import { outreachService } from '../growth/outreach.ts';
import { b64u } from '../growth/webpush.ts';
import { autoFriend } from './founder.ts';
import { presenceOf } from './presence.ts';
import { socialService } from './service.ts';
import type { PingJob } from '../growth/ping-mail.ts';
import type { PingNote } from '../../src/game/ping.ts';
import type { CityId, PlayerRef } from '../../src/types/protocol.ts';
import type { PingBlock, PingControl, PingNotice, PingPlace, PingServerFrame } from '../../src/types/ping.ts';
import type { LifeState } from '../../src/types/life.ts';
import type { Db, PingRecord, RouteContext, SessionRecord, SocialCollection } from '../types.ts';

const HOUR = 3600000, DAY = 86400000;
const TOKEN_VERSION = 1, BODY_BYTES = 39, BODY_CHARS = 52, TOKEN_CHARS = 95;
const TOKEN = /^[A-Za-z0-9_-]{95}$/;
const PURPOSE = new TextEncoder().encode('allworld-ping-join|');
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const no = <Code extends string, Extra extends object = object>(code: Code, reason: string, extra?: Extra): { ok: false; code: Code; reason: string } & Extra => ({ ok: false, code, reason, ...extra } as { ok: false; code: Code; reason: string } & Extra);
const repeated = (value: object): boolean => Boolean(Reflect.get(value, 'duplicate'));
const held = (state: LifeState): boolean => state.onboarding?.required === true && state.onboarding.done !== true;
const keyOf = (from: string, to: string): string => `${from}>${to}`;
const uuidBytes = (id: string): Uint8Array => Uint8Array.from((id.replace(/-/g, '').match(/../g) ?? []).map((pair) => parseInt(pair, 16)));
const bytesUuid = (bytes: Uint8Array): string => { const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(''); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`; };

/** What a join link says, once its signature has been checked. */
export interface PingClaim { from: string; to: string; expires: number }
type PingPush = [string, PingServerFrame][];
type PingService = ReturnType<typeof build>;
const services = new WeakMap<RouteContext, PingService>();
export function pingService(ctx: RouteContext): PingService {
  const known = services.get(ctx);
  if (known) return known;
  const built = build(ctx);
  services.set(ctx, built);
  return built;
}

function build(ctx: RouteContext) {
  const social = socialService(ctx), { enter, other, notify, pub, areFriends } = social.kit;
  const presence = presenceOf(ctx);
  const mailer = outreachService(ctx).pingMail;
  const now = (): number => ctx.now();
  const bad = (code: string) => ctx.fail(400, code);
  const uuid = (value: unknown): string => { if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw bad('invalid_player'); return value.toLowerCase(); };
  /** In memory only: the pingers whose pings are open, so a heartbeat can end them when their owner has left the game. */
  const watched = new Map<string, number>();
  let sweptAt = 0;

  // ---- the join link ---------------------------------------------------------------------------------
  type SigningKey = Awaited<ReturnType<typeof globalThis.crypto.subtle.importKey>>;
  let signing: Promise<SigningKey> | null = null;
  const signingKey = (): Promise<SigningKey> => (signing ??= (async () => {
    const stored = await ctx.keyFile('ping-signing', () => ({ key: b64u.encode(globalThis.crypto.getRandomValues(new Uint8Array(32))) }));
    return globalThis.crypto.subtle.importKey('raw', b64u.decode(stored.key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  })().catch((error: unknown) => { signing = null; throw error; }));
  const signed = (body: Uint8Array): Uint8Array<ArrayBuffer> => { const out = new Uint8Array(PURPOSE.length + body.length); out.set(PURPOSE, 0); out.set(body, PURPOSE.length); return out; };
  /** The join link of one ping, as a path. The same ping always has the same link. */
  async function linkFor(from: string, to: string, expires: number): Promise<string> {
    const body = new Uint8Array(BODY_BYTES);
    body[0] = TOKEN_VERSION; body.set(uuidBytes(from), 1); body.set(uuidBytes(to), 17);
    for (let i = 0; i < 6; i++) body[33 + i] = Math.floor(expires / 2 ** (8 * (5 - i))) % 256;
    return `/j/${b64u.encode(body)}${b64u.encode(await globalThis.crypto.subtle.sign('HMAC', await signingKey(), signed(body)))}`;
  }
  /** What a token says, or null: a wrong shape, a wrong signature, another version, or past its time. */
  async function readToken(value: unknown): Promise<PingClaim | null> {
    if (typeof value !== 'string' || value.length !== TOKEN_CHARS || !TOKEN.test(value)) return null;
    try {
      const body = b64u.decode(value.slice(0, BODY_CHARS)), signature = b64u.decode(value.slice(BODY_CHARS));
      // One spelling only: the last character of a base64 text has bits that mean nothing, and a link is not accepted in a second form.
      if (body.length !== BODY_BYTES || body[0] !== TOKEN_VERSION || `${b64u.encode(body)}${b64u.encode(signature)}` !== value) return null;
      if (!(await globalThis.crypto.subtle.verify('HMAC', await signingKey(), signature, signed(body)))) return null;
      let expires = 0;
      for (let i = 0; i < 6; i++) expires = expires * 256 + (body[33 + i] ?? 0);
      const from = bytesUuid(body.slice(1, 17)), to = bytesUuid(body.slice(17, 33));
      if (!UUID_PATTERN.test(from) || !UUID_PATTERN.test(to) || !(expires > now())) return null;
      return { from, to, expires };
    } catch { return null; }
  }

  // ---- stored pings ----------------------------------------------------------------------------------
  function book(s: SocialCollection): Record<string, PingRecord> { if (!isRecord(s.pings)) s.pings = {}; return s.pings; }
  const wellFormed = (record: unknown): record is PingRecord => isRecord(record) && typeof record.from === 'string' && typeof record.to === 'string' && typeof record.at === 'number' && typeof record.expires === 'number' && typeof record.venue === 'string' && typeof record.cityId === 'string';
  /** One pair's record, read defensively: a damaged one is as good as none. Never creates the book. */
  const recordAt = (s: SocialCollection, from: string, to: string): PingRecord | undefined => { const found = isRecord(s.pings) ? s.pings[keyOf(from, to)] : undefined; return wellFormed(found) ? found : undefined; };
  const records = (s: SocialCollection): PingRecord[] => (isRecord(s.pings) ? Object.values(s.pings).filter(wellFormed) : []);
  const live = (record: PingRecord | undefined, t: number): record is PingRecord => record !== undefined && record.state === 'open' && record.expires > t;
  /** Drop what is over and can no longer hold back the next ping; keep at most PING.open. Every few minutes at most. */
  function sweep(s: SocialCollection, t: number): void {
    if (t - sweptAt < 5 * 60000 && t >= sweptAt) return;
    sweptAt = t;
    const all = book(s);
    for (const [key, record] of Object.entries(all)) if (!wellFormed(record) || (t >= record.expires && t - record.at >= PING_PAIR_MS)) delete all[key];
    const keys = Object.keys(all);
    if (keys.length > PING.open) for (const key of keys.sort((a, b) => (all[a]?.at ?? 0) - (all[b]?.at ?? 0)).slice(0, keys.length - PING.open)) delete all[key];
    if (isRecord(s.pingJoins)) for (const [id, times] of Object.entries(s.pingJoins)) { const kept = Array.isArray(times) ? times.filter((at) => t - at < DAY) : []; if (kept.length) s.pingJoins[id] = kept; else delete s.pingJoins[id]; }
  }

  // ---- where a player is ------------------------------------------------------------------------------
  /** Where a player's stored life is: the city of their one character and the venue it is recorded at. null: no life that has arrived. */
  function whereIs(db: Db, id: string): { cityId: CityId; venue: string; home: boolean; moving: boolean } | null {
    const session = ctx.core.sessionByPublicId(db, id);
    const cityId = session && session.expiresAt > now() ? characterCity(session) : null;
    const state = cityId ? session?.cities?.[cityId]?.state : undefined;
    if (!cityId || !state || held(state)) return null;
    return { cityId, venue: state.location, home: state.location === 'home', moving: isDeparting(state) };
  }
  /** A place as a friend is told it. A home is its city and nothing more. */
  function placeOf(cityId: CityId, venue: string): PingPlace {
    const home = venue === 'home', city = cityName(cityId) ?? cityId;
    return { cityId, cityName: city, venue: home ? 'home' : venue, home, label: placeWords({ home, venueLabel: home ? '' : venueLabel(venue, cityId), cityName: city }) };
  }
  function noticeOf(s: SocialCollection, record: PingRecord): PingNotice {
    return { from: pub(s, record.from), at: record.at, expiresAt: record.expires, place: placeOf(record.cityId, record.venue), ...(record.auto ? { invite: true as const } : {}) };
  }
  const blockedEither = (s: SocialCollection, a: string, b: string): boolean => Boolean(s.players[a]?.blocked[b] || s.players[b]?.blocked[a]);

  /** Why `id` may not ping `to` right now, or null. Everything except the hourly and daily count, which only a real ping uses up. */
  function blockOf(db: Db, s: SocialCollection, session: SessionRecord, id: string, to: string): { code: PingBlock; reason: string; again?: number } | null {
    const { target, refusal } = other(s, id, to);
    if (refusal) return { code: refusal.code === 'self' ? 'self' : refusal.code === 'blocked' ? 'blocked' : 'unknown_player', reason: refusal.reason };
    const name = target.name;
    if (!areFriends(s, id, to)) return { code: 'not_friends', reason: `Add ${name} as a friend to ping them.` };
    // Every player holds the automatic friendship with the founder: across it, a ping would be a notice per player.
    if (autoFriend(s.players, to, id)) return { code: 'founder', reason: `${name} is everyone’s first friend, so they cannot be pinged. Send them a message instead.` };
    if (ctx.checks?.muted?.(id)) return { code: 'muted', reason: 'You cannot send pings right now.' };
    const cityId = characterCity(session), state = cityId ? session.cities?.[cityId]?.state : undefined;
    if (state && isDeparting(state)) return { code: 'travelling', reason: 'You are on the way somewhere. Ping when you have arrived, so there is a place to join you.' };
    if (presence.status(id).state === 'offline') return { code: 'not_live', reason: 'Live updates are off, so nobody could join you. Reconnect, then ping.' };
    const t = now(), earlier = recordAt(s, id, to);
    if (earlier && !earlier.auto && t - earlier.at < PING_PAIR_MS && t >= earlier.at) {
      const again = earlier.at + PING_PAIR_MS;
      return { code: 'cooldown', reason: `You pinged ${name} a moment ago. You can ping again ${waitWords(again - t)}.`, again };
    }
    return null;
  }

  // ---- the pinger left the game ----------------------------------------------------------------------
  /** End the open pings of players who are gone, and tell the friends who were looking at them. One write, only when it happens. */
  async function endFor(gone: readonly string[]): Promise<void> {
    const push: PingPush = [];
    await ctx.store.transact((db) => {
      push.length = 0;
      const s = ctx.collection(db, 'social'), t = now();
      for (const record of records(s)) if (live(record, t) && gone.includes(record.from)) { record.state = 'ended'; push.push([record.to, { type: 'ping-ended', from: record.from }]); }
    }, { durable: () => push.length > 0 });
    for (const [to, frame] of push) ctx.push(to, frame);
  }
  ctx.on?.('heartbeat', () => {
    if (!watched.size) return;
    const t = now(), gone: string[] = [];
    for (const [id, until] of watched) {
      if (until <= t) watched.delete(id);
      else if (presence.status(id).state === 'offline') { watched.delete(id); gone.push(id); }
    }
    if (gone.length) ctx.waitUntil?.(endFor(gone).catch(() => {}));
  });
  /**
   * A NEW PLAYER ARRIVED THROUGH SOMEONE'S INVITE LINK and the two are friends now (./service.ts introduce): the inviter is
   * told where the newcomer is, with the same Join a ping gives — for the next hour, while the newcomer is in the game.
   * Nobody pressed Ping, so nothing leaves the game for it: the inviter's own "joined through your link" notice and mail
   * are what they were.
   */
  ctx.on?.('invite-joined', ({ inviter, newcomer }) => {
    if (typeof newcomer !== 'string' || newcomer === inviter) return;
    let frame: PingServerFrame | null = null;
    const work = ctx.store.transact((db) => {
      frame = null;
      const s = ctx.collection(db, 'social'), t = now();
      if (!isRecord(s.players) || !s.players[newcomer] || !s.players[inviter] || !areFriends(s, newcomer, inviter) || blockedEither(s, newcomer, inviter)) return;
      if (presence.status(newcomer).state !== 'online') return;
      const where = whereIs(db, newcomer);
      if (!where || where.home || where.moving || live(recordAt(s, newcomer, inviter), t)) return;
      sweep(s, t);
      const record: PingRecord = book(s)[keyOf(newcomer, inviter)] = { from: newcomer, to: inviter, at: t, expires: t + PING_LIVE_MS, cityId: where.cityId, venue: where.venue, state: 'open', auto: true };
      frame = { type: 'ping-incoming', notice: noticeOf(s, record) };
    }, { durable: () => frame !== null }).then(() => { if (frame) { watched.set(newcomer, now() + PING_LIVE_MS); ctx.push(inviter, frame); } }, () => {});
    ctx.waitUntil?.(work);
  });

  return {
    linkFor, readToken,

    /** The live pings waiting for the caller. A ping whose owner has left the game ends here. */
    list(db: Db, session: SessionRecord) {
      const { s, id } = enter(db, session), t = now();
      const incoming: PingNotice[] = [];
      for (const record of records(s)) {
        if (record.to !== id || !live(record, t)) continue;
        if (!s.players[record.from] || blockedEither(s, id, record.from) || !areFriends(s, id, record.from)) continue;
        if (presence.status(record.from).state === 'offline') { record.state = 'ended'; continue; }
        incoming.push(noticeOf(s, record));
      }
      return { ok: true as const, code: 'ok' as const, incoming: incoming.sort((a, b) => b.at - a.at).slice(0, 10) };
    },

    /** The Ping control for one player. Says nothing about how, or whether, that player can be reached. */
    control(db: Db, session: SessionRecord, rawTo: unknown): { ok: true; code: 'ok'; control: Omit<PingControl, 'live'> & { live: { at: number; expiresAt: number } | null } } {
      const to = uuid(rawTo);
      const { s, id } = enter(db, session), t = now();
      const blocked = blockOf(db, s, session, id, to), mine = recordAt(s, id, to);
      return { ok: true, code: 'ok', control: { can: blocked === null, code: blocked?.code ?? null, reason: blocked?.reason ?? null, again: blocked?.again ?? null, live: live(mine, t) && !mine.auto ? { at: mine.at, expiresAt: mine.expires } : null } };
    },

    /**
     * Tell a friend the caller is here. Exactly once per `clientId` (ctx.once). `job` is what leaves the game for it, to be
     * sent after the transaction is saved; `push` the frames for the friend's open sockets.
     */
    send(db: Db, session: SessionRecord, body: Record<string, unknown>) {
      const to = uuid(body.to), cid = body.clientId;
      ctx.onceId(cid);
      const { s, p, id } = enter(db, session);
      const push: PingPush = [];
      let job: PingJob | null = null;
      const result = ctx.once(db, session, { id: cid, kind: 'ping', fingerprint: [to] }, () => {
        const t = now(), blocked = blockOf(db, s, session, id, to);
        if (blocked) return no(blocked.code, blocked.reason, blocked.again ? { again: blocked.again } : {});
        const cityId = characterCity(session);
        if (!cityId) return no('not_live', 'Finish creating your character first.');
        // The same count for everyone, the founder included: a ping is one friend at a time.
        if (!ctx.allow(`ping:hour:${id}`, PING.perHour, HOUR)) return no('rate_limited', `You have pinged ${PING.perHour} times this hour. Try again later.`);
        if (!ctx.allow(`ping:day:${id}`, PING.perDay, DAY)) return no('rate_limited', `You have pinged ${PING.perDay} times today. Try again tomorrow.`);
        const state = ctx.settle(session, cityId), target = s.players[to]!;
        if (isDeparting(state)) return no('travelling', 'You are on the way somewhere. Ping when you have arrived, so there is a place to join you.');
        sweep(s, t);
        const record: PingRecord = book(s)[keyOf(id, to)] = { from: id, to, at: t, expires: t + PING_LIVE_MS, cityId, venue: state.location === 'home' ? 'home' : state.location, state: 'open' };
        const place = placeOf(record.cityId, record.venue), there = presence.status(to).state;
        const note: PingNote = there === 'online' ? 'told' : nightAt(t) ? 'night' : 'later';
        // One line in the friend's Updates, for when they are back; the frame below is what a connected friend sees now.
        notify(s, to, 'ping', `${p.name} is ${place.label} and pinged you to come.`, { from: id }, []);
        push.push([to, { type: 'ping-incoming', notice: noticeOf(s, record) }]);
        job = mailer.claim(db, growthOf(ctx, db), { from: id, fromName: p.name, to, place: place.label, link: '', online: there !== 'offline' });
        return { ok: true as const, code: 'pinged' as const, to: pub(s, to), note, words: pingNoteWords(note, target.name), at: t, expiresAt: record.expires, again: t + PING_PAIR_MS, place };
      });
      const fresh = result.ok && !repeated(result);
      if (fresh) watched.set(id, now() + PING_LIVE_MS);
      return { result, push: fresh ? push : [], job: fresh ? job : null };
    },

    /** Take a ping back. The friend's notice goes away; the wait before the next ping to them stays. */
    cancel(db: Db, session: SessionRecord, body: Record<string, unknown>) {
      const to = uuid(body.to);
      const { s, id } = enter(db, session), record = recordAt(s, id, to);
      if (!live(record, now())) return { result: { ok: true as const, code: 'cancelled' as const, duplicate: true as const }, push: [] as PingPush };
      record.state = 'ended';
      return { result: { ok: true as const, code: 'cancelled' as const }, push: [[to, { type: 'ping-ended', from: id }]] as PingPush };
    },

    /** A join link was opened by the caller's browser. Changes nothing, and signs nobody in. */
    open(db: Db, session: SessionRecord, claim: PingClaim) {
      const { s, id } = enter(db, session), t = now();
      // Made for somebody else: nothing is said about whose it was, and nothing is done to this life.
      if (claim.to !== id) return { ok: true as const, code: 'other' as const };
      const record = recordAt(s, claim.from, id);
      if (!s.players[claim.from] || blockedEither(s, id, claim.from)) return no('invalid_link', 'That link does not work any more.');
      const open = live(record, t) && areFriends(s, id, claim.from) && presence.status(claim.from).state !== 'offline';
      return { ok: true as const, code: 'yours' as const, from: pub(s, claim.from), notice: open ? noticeOf(s, record) : null };
    },

    /**
     * THE JOIN. The caller goes to the friend who pinged them, to where that friend is NOW. Everything is checked again here,
     * against stored state: the ping, the friendship, the blocks, that the pinger is still in the game, and what the
     * caller's own life allows (src/game/systems/social.ts 'join'). Exactly once per `clientId`.
     */
    join(db: Db, session: SessionRecord, body: Record<string, unknown>) {
      const from = uuid(body.from), cid = body.clientId;
      ctx.onceId(cid);
      const { s, p, id } = enter(db, session);
      const push: PingPush = [];
      const result = ctx.once(db, session, { id: cid, kind: 'ping-join', fingerprint: [from] }, () => {
        const t = now(), them = s.players[from];
        if (from === id || !them) return no('unknown_player', 'That player was not found.');
        if (!ctx.allow(`ping:join:${id}`, 12)) return no('rate_limited', 'Too many tries. Wait a minute.');
        const who: PlayerRef = pub(s, from), record = recordAt(s, from, id);
        const left = () => no('left', `${them.name} has left. You can message them.`, { from: who });
        // A block always wins, and says no more than "left".
        if (blockedEither(s, id, from)) { if (record) record.state = 'ended'; return no('left', 'That invitation is no longer open.'); }
        if (!live(record, t)) return left();
        if (!areFriends(s, id, from)) { record.state = 'ended'; return no('not_friends', `You and ${them.name} are not friends any more.`, { from: who }); }
        const there = presence.status(from).state;
        if (there === 'offline') { record.state = 'ended'; return left(); }
        if (there === 'reconnecting') return no('reconnecting', `${them.name} is reconnecting. Try again in a few seconds.`, { from: who });
        const where = whereIs(db, from), cityId = characterCity(session);
        if (!where) { record.state = 'ended'; return left(); }
        if (where.moving) return no('travelling', `${them.name} is on the way somewhere. Try again when they have arrived.`, { from: who });
        if (!cityId) return no('settle_required', 'Finish creating your character first.');
        const life = ctx.settle(session, cityId), sameCity = where.cityId === cityId;
        const place = placeOf(where.cityId, where.venue);
        // A home is entered through its own door (the knock, ./service.ts): the join only ever brings a friend to the city.
        const venue = where.home ? (sameCity ? null : publicArrivalVenue(where.cityId).id) : where.venue;
        if (venue !== null && !venueFor(where.cityId, venue)) return left();
        const joins = (isRecord(s.pingJoins) ? s.pingJoins[id] ?? [] : []).filter((at) => t - at < DAY && at <= t);
        if (!sameCity && joins.length >= PING.freeJoinsPerDay) return no('join_cap', `You have joined friends in other cities ${PING.freeJoinsPerDay} times today. You can travel to ${place.cityName} from the Map, or join again tomorrow.`, { from: who });
        let moved: 'none' | 'venue' | 'city' = 'none';
        if (venue !== null) {
          const done = ctx.act(life, { type: 'social.server', cityId, payload: { op: 'join', city: where.cityId, venue, name: them.name } });
          if (!done.ok) return no(done.code, done.reason ?? 'You cannot join them right now.', { from: who });
          moved = done.code === 'joined_city' ? 'city' : done.code === 'joined' ? 'venue' : 'none';
          if (moved === 'city') {
            if (!isRecord(s.pingJoins)) s.pingJoins = {};
            s.pingJoins[id] = [...joins, t];
            // The life is in another city now: it is filed under that city, as after a trip.
            fileCharacter(session, cityId, t);
          }
        }
        record.state = 'joined';
        const present = presence.status(from).state === 'online';
        const words = where.home ? `${them.name} is ${place.label}. Knock to come in.` : `You joined ${them.name} ${place.label}.`;
        notify(s, from, 'ping', `${p.name} joined you ${place.label}.`, { from: id }, []);
        push.push([from, { type: 'ping-joined', by: pub(s, id), place, present: presence.status(id).state !== 'offline' }]);
        return { ok: true as const, code: where.home ? 'at_home' as const : moved === 'none' ? 'here' as const : 'joined' as const, from: who, place, moved, knock: where.home, present, words };
      });
      return { result, push: result.ok && !repeated(result) ? push : [] };
    },
  };
}
