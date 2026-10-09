/**
 * OWNER: social
 * Social endpoints under /api/social/. Thin adapters: every rule lives in
 * server/social/service.ts (shared with the socket messages in server/ws/social.ts) and stores
 * only in ctx.collection(db, 'social').
 *
 * Every route requires the device session cookie, runs in one store transaction, is rate
 * limited per public id on top of the host's per-address limit, and answers
 *   (interact, groups and transfers need `clientId` in the form `<unix ms>:<uuid>` and are applied
 *   exactly once per id — ctx.once, server/routes/once.ts; a message's `clientId` is any retry key)
 *   { ok: true, code, … }                       done
 *   { ok: false, code, reason }                 refused for a game reason (HTTP 200, like /api/action)
 *   HTTP 400/401/409/429 { error: code }        malformed, no session, client-id reuse, rate limited
 *
 *   GET  /api/social/me                               overview: friends + presence, requests, updates, conversations, house
 *   GET  /api/social/friends?after=<cursor>           the founder's next page of automatic friends (`friendsMore.next` of /me)
 *   POST /api/social/updates/read        {}
 *   GET  /api/social/people?city=                     who shares my venue room right now
 *   GET  /api/social/search?q=                        find a player by name or public id
 *   GET  /api/social/players/:id                      one player's public card
 *   POST /api/social/players/:id/interact { action, cityId, clientId }
 *   POST /api/social/friends/request     { to, cityId }
 *   POST /api/social/friends/answer      { from, accept, cityId }
 *   POST /api/social/friends/remove      { id, cityId }
 *   POST /api/social/block               { id, cityId }
 *   POST /api/social/unblock             { id }
 *   POST /api/social/reports             { id, reason, text? }
 *   GET  /api/social/conversations?limit=&after=      all of them; with `limit`, one page by last activity and a cursor (`next`)
 *   GET  /api/social/conversations/:id?after=<seq>&before=<seq>&limit=   the newest page, what came after a line, or the page before one (`more`: older lines are kept)
 *   GET  /api/social/everyone?q=&sort=newest|name|online|city&city=&after=&limit=   the Players view: the founder's, or an admin's; anyone else 404 (server/social/pages.ts)
 *   POST /api/social/chats/open          { with }          the direct chat with a player, back in my list if it was dropped from it
 *   POST /api/social/messages/many       { to: [id, up to 20], body, clientId }   the same words to each, as ordinary messages (founder and admins)
 *   POST /api/social/conversations/:id/read { seq? }
 *   POST /api/social/messages            { to | conv, body, clientId }
 *   POST /api/social/groups              { name, members: [id], clientId }
 *   POST /api/social/groups/:id          { op: 'rename' | 'add' | 'remove' | 'leave', name?, id? }
 *   GET  /api/social/friends/search?q=                friends whose name has q in it (for picking group members)
 *   POST /api/social/conversations/:id/prefs { mute?, pin?, hide? }   the caller's own mute, pin, or removal of a chat
 *   POST /api/social/prefs               { groups?, mentions?, pictures?, introductions? }   who may add me to groups, mentions through mute, who may send me pictures, whether regulars may offer to introduce me (off unless on)
 *   POST /api/social/introduction        { to, cityId, answer: 'accept' | 'decline' }   answer a regular's offer to introduce me to a player in this venue; accepting sends the friend request
 *   POST /api/social/images              { to | conv, clientId, type, data (base64), body? }   a message with one picture (server/social/images.ts)
 *   GET  /api/social/images/:id                       the picture's bytes, for members of its conversation only
 *   GET  /api/social/house/:host                      a house's guest list, as seen by me
 *   POST /api/social/join                { host, cityId }   the invite landing: who you are joining and how (service.join)
 *   POST /api/social/house/knock         { host, cityId }
 *   POST /api/social/house/answer        { visitor, answer: 'accept' | 'decline' }
 *   POST /api/social/house/leave         { host, guest? }
 *   POST /api/social/bae/ask             { id, cityId }
 *   POST /api/social/bae/answer          { from, accept, cityId }
 *   POST /api/social/bae/end             { cityId }
 *   POST /api/social/transfers           { to, amount, cityId, clientId }
 * The friends list is part of GET /api/social/me; only the founder's can be longer than that answer carries.
 */
import type { Db, RouteContext, RouteHandler, RouteKey, RouteRequest, SessionRecord } from '../types.ts';
import { socialService, MATERIAL, LIMITS } from '../social/service.ts';
import { pageLimit } from '../social/pages.ts';
import { CONTENT_TYPES, FAULT_WORDS, PICTURE_LIMITS, cleanPicture, claimedType, fromBase64, pictureSettings } from '../social/images.ts';
import { inspectVoiceNote, VOICE_POLICY } from '../social/voice-notes.ts';
import { VOICE_NOTE_LIMITS, VOICE_NOTE_MIME } from '../../src/types/voice-note.ts';
import type { ImageRef } from '../types.ts';

type Service = ReturnType<typeof socialService>;
type Outcome = object;
type Call = (db: Db, session: SessionRecord, body: Record<string, unknown>, request: RouteRequest) => Outcome;

export const HTTP_PER_MINUTE = 240;
/** The most a picture upload body may be: 250 kB of picture as base64 and its fields. */
const UPLOAD_BYTES = Math.ceil(PICTURE_LIMITS.bytes / 3) * 4 + 4096;

export default function socialRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const service = socialService(ctx);
  /** Wrap a service call: parse the body, authenticate, rate limit, transact, then push. */
  const route = (call: Call, own = false): RouteHandler => async (request) => {
    const body = request.method === 'POST' ? await request.json() : {};
    // Every POST is durable before it is answered. A GET that only registered the caller need not
    // wait for the disk; one that applied something owed to their life (a gift, a friendship) does.
    // The caller's rooms are re-checked by the route host after every request (core.revalidate, server.js).
    const result = await ctx.store.transact((db) => {
      const session = request.requireSession(db, { renew: true });
      if (!ctx.allow(`social:http:${session.publicId}`, HTTP_PER_MINUTE)) throw ctx.fail(429, 'rate_limited');
      return service.finish(db, call(db, session, body, request));
    }, { durable: (value) => request.method !== 'GET' || typeof value === 'object' && value !== null && Reflect.get(value, MATERIAL) === true, waitForObserved: true, committed: (value) => service.committed(value) });
    const answer = service.deliver(result);
    // One player, several devices: a change the caller made to their own friends, groups, blocks or visits is told to
    // every open socket of theirs, so the other devices read the overview again (docs/DEVICES.md).
    if (own && request.publicId && typeof answer === 'object' && answer !== null && Reflect.get(answer, 'ok') === true) ctx.push(request.publicId, { type: 'social-changed' });
    return { body: answer, renew: true };
  };
  /** The same, for a request that changes what the caller's own overview shows. */
  const mine = (call: Call): RouteHandler => route(call, true);
  const after = (request: RouteRequest): number => { const value = Number(request.query.get('after')); return Number.isSafeInteger(value) ? value : 0; };
  /** A page size asked for in the query: a whole number from 1 to PAGE_MAX, or undefined (no paging: the old answer). */
  const limitOf = (request: RouteRequest, name: string): number | undefined => { const raw = request.query.get(name); return raw === null ? undefined : pageLimit(raw, LIMITS.chatPage); };
  const seqOf = (request: RouteRequest, name: string): number | undefined => { const value = Number(request.query.get(name)); return request.query.get(name) !== null && Number.isSafeInteger(value) && value > 0 ? value : undefined; };
  // ---- pictures ------------------------------------------------------------------------------------------------
  // The bytes are checked and kept outside the social collection (ctx.images); the message holds only their id.
  let storedBytes: number | null = null, trimmedAt = 0;
  /** Keep the store inside its retention time and its size ceiling (at most once an hour, and whenever an upload takes it over the ceiling). */
  async function keepTidy(added: number): Promise<void> {
    const images = ctx.images, settings = pictureSettings((name) => (typeof ctx.env === 'function' ? ctx.env(name) : ''), (key) => ctx.checks?.setting?.(key));
    if (!images) return;
    storedBytes = (storedBytes ?? (await images.stats()).bytes) + added;
    if (ctx.now() - trimmedAt < 3600000 && storedBytes <= settings.ceilingBytes) return;
    trimmedAt = ctx.now();
    await images.trim(ctx.now() - settings.retentionMs, settings.ceilingBytes);
    storedBytes = (await images.stats()).bytes;
  }
  const upload: RouteHandler = async (request) => {
    const body = await request.json(UPLOAD_BYTES);
    const images = ctx.images;
    const claimed = claimedType(body.type), bytes = fromBase64(body.data, PICTURE_LIMITS.bytes + 4);
    if (!claimed || !bytes) throw ctx.fail(400, 'invalid_picture');
    const settings = pictureSettings((name) => (typeof ctx.env === 'function' ? ctx.env(name) : ''), (key) => ctx.checks?.setting?.(key));
    // Who is asking, and which conversation the picture is for, before anything is kept.
    const me = await ctx.store.read((db) => request.requireSession(db).publicId);
    if (!ctx.allow(`social:http:${me}`, HTTP_PER_MINUTE)) throw ctx.fail(429, 'rate_limited');
    if (settings.mode === 'off' || !images) return { body: { ok: false, code: 'pictures_off', reason: 'Pictures are not switched on here.' }, renew: true };
    const cleaned = cleanPicture(bytes, claimed);
    if (!cleaned.ok) return { body: { ok: false, code: 'picture_rejected', reason: FAULT_WORDS[cleaned.fault] }, renew: true };
    const { picture } = cleaned;
    const to = typeof body.to === 'string' ? body.to.toLowerCase() : null;
    const conv = to !== null ? `dm.${[me, to].sort().join('.')}` : typeof body.conv === 'string' ? body.conv : '';
    if (!/^(dm|g|h)\.[0-9a-f.-]{1,80}$/.test(conv)) throw ctx.fail(400, to !== null ? 'invalid_player' : 'invalid_conversation');
    const id = ctx.randomId().replaceAll('-', '');
    if (!PICTURE_LIMITS.idPattern.test(id)) throw ctx.fail(500, 'internal_error');
    const ref: ImageRef = { id, w: picture.width, h: picture.height, n: picture.bytes.length };
    await images.put({ id, conv, at: ctx.now(), size: picture.bytes.length, type: picture.type }, picture.bytes);
    try {
      const result = await ctx.store.transact((db) => {
        const session = request.requireSession(db, { renew: true });
        return service.finish(db, service.send(db, session, body, { ref }));
      }, { durable: () => true, waitForObserved: true, committed: (value) => service.committed(value) });
      const answer = service.deliver(result);
      // A refusal, or a retry of a picture already stored, keeps nothing of this upload.
      if (!answer.ok || 'duplicate' in answer) await images.remove([id]);
      else void keepTidy(picture.bytes.length).catch(() => {});
      return { body: answer, renew: true };
    } catch (error) { await images.remove([id]).catch(() => {}); throw error; }
  };
  const picture: RouteHandler = async (request) => {
    const id = request.params.id ?? '', images = ctx.images;
    if (!images || !PICTURE_LIMITS.idPattern.test(id)) throw ctx.fail(404, 'unknown_picture');
    // Who may see it is decided from the stored conversation on every request. The picture's own row says which conversation it
    // belongs to (so no conversation is searched for it); its bytes are sent only when that conversation lets this player see it.
    await ctx.store.read((db) => {
      const session = request.requireSession(db);
      if (!ctx.allow(`social:img:${session.publicId}`, 240)) throw ctx.fail(429, 'rate_limited');
    });
    const stored = await images.get(id);
    const allowed = stored ? await ctx.store.read((db) => service.pictureAllowed(db, request.requireSession(db), stored.image.conv, id)) : false;
    const found = allowed ? stored : null;
    if (!found) throw ctx.fail(404, 'unknown_picture');
    return { file: { bytes: found.bytes, type: CONTENT_TYPES[found.image.type] } };
  };
  const uploadVoice: RouteHandler = async request => {
    const me = await ctx.store.read(db => request.requireSession(db).publicId);
    if (!ctx.allow(`social:voice-upload:${me}`, 6)) throw ctx.fail(429, 'rate_limited');
    const voices = ctx.voices;
    if (!voices || ctx.env?.('CHAT_VOICE_NOTES')?.trim().toLowerCase() === 'off') return { body: { ok: false, code: 'voice_off', reason: 'Voice notes are not available here.' }, renew: true };
    const body = await request.json(Math.ceil(VOICE_NOTE_LIMITS.bytes / 3) * 4 + 8192);
    const bytes = fromBase64(body.data, VOICE_NOTE_LIMITS.bytes + 4);
    if (!bytes) throw ctx.fail(400, 'invalid_voice');
    const voice = inspectVoiceNote(bytes);
    if (!voice.ok) return { body: { ok: false, code: 'voice_rejected', reason: voice.reason === 'duration' ? 'Record a voice note of up to one minute.' : voice.reason === 'size' ? 'That recording is too large. Try a shorter voice note.' : 'That recording format could not be read. Please record it again.' }, renew: true };
    const to = typeof body.to === 'string' ? body.to.toLowerCase() : null;
    const conv = to !== null ? `dm.${[me, to].sort().join('.')}` : typeof body.conv === 'string' ? body.conv : '';
    if (!/^(dm|g)\.[0-9a-f.-]{1,80}$/.test(conv)) throw ctx.fail(400, 'invalid_conversation');
    const id = ctx.randomId().replaceAll('-', '');
    if (!VOICE_NOTE_LIMITS.idPattern.test(id)) throw ctx.fail(500, 'internal_error');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(voice.bytes).buffer)), byte => byte.toString(16).padStart(2, '0')).join('');
    await voices.put({ id, conv, at: ctx.now(), size: voice.bytes.length, durationMs: voice.durationMs, type: voice.format }, voice.bytes);
    try {
      const result = await ctx.store.transact(db => service.finish(db, service.send(db, request.requireSession(db, { renew: true }), body, { voice: { id, durationMs: voice.durationMs, bytes: voice.bytes.length, hash } })), { durable: () => true, waitForObserved: true, committed: value => service.committed(value) });
      const answer = service.deliver(result);
      if (!answer.ok || 'duplicate' in answer) await voices.remove([id]);
      else { const tidy = voices.trim(ctx.now() - VOICE_POLICY.retentionMs, VOICE_POLICY.ceilingBytes).catch(() => []); ctx.waitUntil?.(tidy); }
      return { body: answer, renew: true };
    } catch (error) { await voices.remove([id]).catch(() => {}); throw error; }
  };
  const readVoice: RouteHandler = async request => {
    const id = request.params.id ?? '', voices = ctx.voices;
    const expectedActor = request.query.get('actor');
    const actor = (db: Db) => {
      const session = request.requireSession(db);
      if (expectedActor !== null && expectedActor !== session.publicId) throw ctx.fail(409, 'actor_changed');
      return session;
    };
    await ctx.store.read(db => { const me = actor(db).publicId; if (!ctx.allow(`social:voice-read:${me}`, 120)) throw ctx.fail(429, 'rate_limited'); });
    if (!voices || !VOICE_NOTE_LIMITS.idPattern.test(id)) throw ctx.fail(404, 'unknown_voice');
    const stored = await voices.get(id);
    if (!stored || !(await ctx.store.read(db => service.voiceAllowed(db, actor(db), stored.voice.conv, id)))) throw ctx.fail(404, 'unknown_voice');
    return { file: { bytes: stored.bytes, type: VOICE_NOTE_MIME[stored.voice.type], cache: 'no-store' } };
  };
  return {
    // `lite=1`: a first page of chats (`conversationsMore` for the rest) and, for the founder, none of the automatic friends (the Players view reads them). Absent: as before, up to LIMITS.convs chats.
    'GET /api/social/me': route((db, session, body, request) => service.me(db, session, { lite: request.query.get('lite') === '1' })),
    'GET /api/social/family': route((db, session) => service.familyView(db, session)),
    'POST /api/social/family': mine((db, session, body) => service.familyChange(db, session, body)),
    'GET /api/social/friends': route((db, session, body, request) => service.friendsPage(db, session, request.query.get('after'))),
    'POST /api/social/updates/read': route((db, session) => service.readUpdates(db, session)),
    'GET /api/social/people': route((db, session, body, request) => service.people(db, session, request.query.get('city'))),
    'GET /api/social/search': route((db, session, body, request) => service.search(db, session, request.query.get('q'))),
    'GET /api/social/players/:id': route((db, session, body, request) => service.profile(db, session, request.params.id)),
    'POST /api/social/players/:id/interact': route((db, session, body, request) => service.interact(db, session, { ...body, id: request.params.id })),
    'POST /api/social/friends/request': mine((db, session, body) => service.friendRequest(db, session, body)),
    'POST /api/social/friends/answer': mine((db, session, body) => service.friendAnswer(db, session, body)),
    'POST /api/social/friends/remove': mine((db, session, body) => service.friendRemove(db, session, body)),
    'POST /api/social/block': mine((db, session, body) => service.block(db, session, body)),
    'POST /api/social/unblock': mine((db, session, body) => service.unblock(db, session, body)),
    'POST /api/social/reports': route((db, session, body) => service.report(db, session, body)),
    'GET /api/social/conversations': route((db, session, body, request) => service.conversations(db, session, { limit: limitOf(request, 'limit'), after: request.query.get('after') })),
    'GET /api/social/conversations/:id': route((db, session, body, request) => service.history(db, session, request.params.id, after(request), { before: seqOf(request, 'before'), limit: limitOf(request, 'limit') })),
    'GET /api/social/everyone': route((db, session, body, request) => service.everyone(db, session, { q: request.query.get('q'), sort: request.query.get('sort'), city: request.query.get('city'), after: request.query.get('after'), limit: request.query.get('limit') })),
    'POST /api/social/chats/open': route((db, session, body) => service.openChat(db, session, body)),
    'POST /api/social/messages/many': route((db, session, body) => service.sendMany(db, session, body)),
    'POST /api/social/conversations/:id/read': route((db, session, body, request) => service.read(db, session, { ...body, conv: request.params.id })),
    'POST /api/social/messages': route((db, session, body) => service.send(db, session, body)),
    'POST /api/social/groups': mine((db, session, body) => service.groupCreate(db, session, body)),
    'POST /api/social/groups/:id': mine((db, session, body, request) => service.groupUpdate(db, session, { ...body, conv: request.params.id })),
    'GET /api/social/friends/search': route((db, session, body, request) => service.friendSearch(db, session, request.query.get('q'))),
    'POST /api/social/conversations/:id/prefs': mine((db, session, body, request) => service.convPrefs(db, session, { ...body, conv: request.params.id })),
    'POST /api/social/conversations/:id/message': route((db, session, body, request) => service.updateMessage(db, session, { ...body, conv: request.params.id })),
    'POST /api/social/conversations/:id/react': route((db, session, body, request) => service.react(db, session, { ...body, conv: request.params.id })),
    'POST /api/social/notify': mine((db, session, body) => service.notifyPrefs(db, session, body)),
    'POST /api/social/prefs': mine((db, session, body) => service.chatPrefs(db, session, body)),
    'POST /api/social/introduction': mine((db, session, body) => service.introduce(db, session, body)),
    'POST /api/social/images': upload,
    'POST /api/social/voice': uploadVoice,
    'GET /api/social/voice/:id': readVoice,
    'GET /api/social/images/:id': picture,
    'GET /api/social/house/:host': route((db, session, body, request) => service.house(db, session, request.params.host)),
    'POST /api/social/join': route((db, session, body) => service.join(db, session, body)),
    'POST /api/social/house/knock': mine((db, session, body) => service.knock(db, session, body)),
    'POST /api/social/house/answer': mine((db, session, body) => service.knockAnswer(db, session, body)),
    'POST /api/social/house/leave': mine((db, session, body) => service.houseLeave(db, session, body)),
    'POST /api/social/bae/ask': mine((db, session, body) => service.baeAsk(db, session, body)),
    'POST /api/social/bae/answer': mine((db, session, body) => service.baeAnswer(db, session, body)),
    'POST /api/social/bae/end': mine((db, session, body) => service.baeEnd(db, session, body)),
    'POST /api/social/transfers': route((db, session, body) => service.transfer(db, session, body)),
  };
}
