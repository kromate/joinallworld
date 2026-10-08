/**
 * OWNER: social
 * COMING INTO A HOME, EASILY. The rules for who may walk in, the invitations, the house links and the host's door. The numbers
 * and the button words are in src/game/visit.ts; the signed link is server/social/visit-token.ts; the stored invitations and
 * links are server/social/visit-book.ts. Who is inside a home, the house chat and the Home room are still the social
 * module's (./service.ts houses/knocks/guests and server/ws/rooms.ts): every way in ends in the same `admit`.
 *
 * WHO MAY COME IN. `door.who` is the host's choice (src/game/visit.ts DOOR_CHOICES):
 *   walk     a friend taps Visit home and is inside at once, while the host is home and online. Only an ORDINARY friendship
 *            counts (both listed each other): the founder's automatic one never does, so the founder's home is never open to
 *            everyone. The founder, and a player with more than VISIT.walkFriendsMax friends, are 'knock' whatever they chose.
 *   knock    the visitor knocks, the host answers (as it was before the choice existed: a player who has not chosen is this).
 *   invited  nobody knocks; people come in by an invitation or a house link.
 *   nobody   no door at all, links and invitations too.
 * A new player's record is made with 'walk'; an earlier player has none until they choose, and is offered the choice once.
 * "Friends can visit while I am out" (`door.out`, default off) lets 'walk' friends in without the host; with it off nobody is
 * ever let into an empty home. A link and an invitation need the host at home, always.
 * BLOCKS ALWAYS WIN. A muted player cannot come into other homes. A guest the host asked to leave is barred for a while and can
 * never come back through the same link. A closed door (the host's "Close the door") lets nobody new in; guests inside stay.
 *
 * ONE ROOM, NO TRAVEL. A visit is the guest's social socket standing in the host's Home room (server/ws/rooms.ts); the guest's
 * own life does not move. So visiting a friend in another city costs nothing, needs no journey and no daily allowance, and the
 * guest is exactly where they were when the visit ends. A guest who has only tapped Play can visit; a life still held for its
 * look (Play not tapped) is in no city yet and cannot (enter() refuses it, as for everything social).
 *
 * WHAT IS STORED (additive)
 *   social.players[id].door    { who, out? }       the choice; written only when the player changes it (and at a new record)
 *   social.houses[host].closed / .barred           the door closed until / guests asked to leave until (dropped when over)
 *   db.visits.invites / .links                     ./visit-book.ts
 * Row cost on the Worker, per action (a "row" is a changed part of a collection; reads and room traffic write nothing):
 *   choose who may come in      1  social
 *   invite friends over         2  social (the notices) + visits (the invitations) — one pair for the whole batch
 *   make / end a link           1  visits
 *   walk in, come in by an invitation or by an approved link   2  social (guest list, house chat) + visits (the use)
 *   a link's first use by a new person   2  social (the knock) + nothing else; the host's answer is the 2 above
 *   close the door / end the visit       1  social
 */
import { characterCity } from '../character.ts';
import { readPlot, samePlot, sameStreet } from '../world/street.ts';
import { hasPlace } from '../../src/game/systems/estate.ts';
import { homeOf } from '../../src/game/content/housing.ts';
import { housesFor } from '../../src/game/cities/housingRuntime.ts';
import { HOUSE_DESIGNS } from '../../src/game/content/world.ts';
import type { VisitHomeItem, VisitHomeProjection, VisitHomeResult } from '../../src/types/visit.ts';
import { isDeparting } from '../../src/game/registry.ts';
import { cloneItems, layoutFailure } from '../../src/game/stories/model.ts';
import { UUID_PATTERN } from '../protocol.ts';
import { VISIT, VISIT_MS, isDoorWho } from '../../src/game/visit.ts';
import { houseTokens } from './visit-token.ts';
import type { HouseClaim } from './visit-token.ts';
import { inviteKey, linkState, linksOf, liveInvite, liveLinks, noteLinkUse, openBook, peekBook, sweepBook, invitesBy } from './visit-book.ts';
import { socialService } from './service.ts';
import type { PushList } from './service.ts';
import type { CityId } from '../../src/types/protocol.ts';
import type { Db, HouseLinkRecord, RouteContext, SessionRecord, SocialCollection } from '../types.ts';

const no = <Code extends string, Extra extends object = object>(code: Code, reason: string, extra?: Extra): { ok: false; code: Code; reason: string } & Extra => ({ ok: false, code, reason, ...extra } as { ok: false; code: Code; reason: string } & Extra);
const yes = <Code extends string, const Extra extends object = object>(code: Code, extra?: Extra): { ok: true; code: Code } & Extra => ({ ok: true, code, ...extra } as { ok: true; code: Code } & Extra);

type VisitService = ReturnType<typeof build>;
const services = new WeakMap<RouteContext, VisitService>();
export function visitService(ctx: RouteContext): VisitService {
  const known = services.get(ctx);
  if (known) return known;
  const built = build(ctx);
  services.set(ctx, built);
  return built;
}

function build(ctx: RouteContext) {
  const social = socialService(ctx), kit = social.kit;
  const tokens = houseTokens(ctx);
  const now = (): number => ctx.now();
  const bad = (code: string) => ctx.fail(400, code);
  const uuid = (value: unknown): string => { if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw bad('invalid_player'); return value.toLowerCase(); };
  const capacity = VISIT.guests;

  /** The city of a host's home when they are not standing in it: their one character's main home. */
  function mainHomeCity(db: Db, hostId: string): CityId | null {
    const session = ctx.core.sessionByPublicId?.(db, hostId);
    if (!session || session.expiresAt <= now()) return null;
    const lived = characterCity(session);
    const home = lived ? session.cities[lived]?.state?.estate?.home : undefined;
    return ctx.cityIds.find((id) => id === home) ?? lived;
  }
  /** Where the host is, for the door: at home (and in which city), or not. */
  function hostHome(s: SocialCollection, hostId: string): { state: 'home'; cityId: CityId } | { state: 'out' | 'offline' | 'reconnecting' } {
    const where = kit.whereabouts(hostId, true);
    if (where.status === 'offline' || where.status === 'reconnecting') return { state: where.status };
    const cityId = ctx.cityIds.find((id) => id === where.cityId);
    return where.status === 'online' && where.venue === 'home' && cityId ? { state: 'home', cityId } : { state: 'out' };
  }
  const notHome = (name: string, state: string) => no(state === 'offline' ? 'host_offline' : state === 'reconnecting' ? 'host_reconnecting' : 'host_not_home',
    state === 'offline' ? `${name} is offline, so nobody can answer the door.` : state === 'reconnecting' ? `${name} is reconnecting. Try again in a few seconds.` : `${name} is not home.`);

  /**
   * The checks every automatic way in shares, and the entry. `via` says what permission the visitor holds. Answers 'inside' or a
   * refusal; the pushes and notices are in `push`.
   */
  function letIn(db: Db, s: SocialCollection, id: string, hostId: string, via: 'friend' | 'invite' | 'link', push: PushList, link?: HouseLinkRecord) {
    const target = s.players[hostId]!, t = now(), name = target.name;
    const house = kit.pruneHouse(s, hostId);
    if (house?.guests[id]) return yes('inside', { house: kit.houseView(s, hostId, id), duplicate: true });
    const refusal = ctx.checks?.muted?.(id);
    if (refusal) return no(refusal.code, refusal.reason);
    if (house?.closed !== undefined && house.closed > t) return no('door_shut', `${name} has closed the door for now.`);
    if ((house?.barred?.[id] ?? 0) > t || (link?.removed?.[id] !== undefined)) return no('barred', `${name} asked you to leave. You can knock again later.`);
    if (Object.keys(house?.guests ?? {}).length >= capacity) return no('house_full', `${name}’s home is full (${capacity} friends are inside).`);
    const home = hostHome(s, hostId);
    let cityId: CityId | null = home.state === 'home' ? home.cityId : null;
    if (cityId === null) {
      // A home with nobody in it is open only to a friend of a host who chose "Friends can visit while I am out", and never through a link or an invitation.
      if (via !== 'friend' || target.door?.out !== true || kit.doorFor(s, hostId, id) !== 'walk+') return notHome(name, home.state);
      cityId = mainHomeCity(db, hostId);
      if (cityId === null) return notHome(name, 'out');
    }
    if (!ctx.allow(`visit:in:${id}`, 10)) return no('rate_limited', 'You are going in and out too fast. Wait a minute.');
    kit.admit(s, hostId, id, cityId, push, link?.id);
    if (link) noteLinkUse(db, link.id, id, t);
    // The host hears who came in (a toast, and a line in Updates); the guest is told they are in.
    const who = s.players[id]!.name;
    kit.notify(s, hostId, 'visit', via === 'link' ? `${who} came in through your link.` : `${who} came in.`, { from: id }, push);
    if (via === 'link') kit.notify(s, id, 'visit', `You are visiting ${name}’s home.`, { host: hostId }, push);
    push.push([id, { type: 'invite-answer', host: kit.pub(s, hostId), answer: 'accepted', house: kit.houseView(s, hostId, id) }]);
    kit.housePush(s, hostId, push);
    return yes('inside', { house: kit.houseView(s, hostId, id) });
  }

  function enter(db: Db, session: SessionRecord, body: Record<string, unknown>) {
    const hostId = uuid(body.host);
    const { s, id } = kit.enter(db, session);
    const { refusal } = kit.other(s, id, hostId);
    if (refusal) return refusal.code === 'self' ? no('self', 'This is your own home.') : refusal;
    const target = s.players[hostId]!, push: PushList = [];
    const invite = liveInvite(db, hostId, id, now());
    if (invite) {
      if (target.door?.who === 'nobody') return no('door_closed', `${target.name} is not taking visitors right now.`);
      const done = letIn(db, s, id, hostId, 'invite', push);
      if (done.ok && !('duplicate' in done)) { const book = peekBook(db); if (book) delete book.invites[inviteKey(hostId, id)]; }
      return { ...done, push };
    }
    const how = kit.doorFor(s, hostId, id);
    if (how === 'closed') return no(target.door?.who === 'nobody' ? 'door_closed' : 'door_shut', target.door?.who === 'nobody' ? `${target.name} is not taking visitors right now.` : `${target.name} has closed the door for now.`);
    if (how === 'invited') return no('only_invited', `${target.name} only lets in people they invite.`);
    if (how === 'knock') {
      const home = hostHome(s, hostId);
      if (home.state !== 'home') return notHome(target.name, home.state);
      return social.knock(db, session, { host: hostId, cityId: home.cityId });
    }
    const done = letIn(db, s, id, hostId, 'friend', push);
    return { ...done, push };
  }

  return {
    /** Physical entry never retargets a stale door to a different plot owner. */
    enterPlot(db: Db, session: SessionRecord, body: Record<string, unknown>) {
      const hostId = uuid(body.host), city = ctx.cityIds.find(id => id === body.city);
      if (!city) throw bad('invalid_city');
      const plot = readPlot(body.plot, city);
      if (!plot) throw bad('invalid_plot');
      const { s, id } = kit.enter(db, session), state = session.cities[city]?.state;
      if (characterCity(session) !== city || state?.estate.city !== city || state.location !== 'neighbourhood' || !hasPlace(state) || !sameStreet(state.estate.plot, plot)) return no('not_on_street', 'Go to that street through your own home door first.');
      if (state.activeAction) return no('busy', 'Finish or cancel your current action before visiting a home.');
      const target = ctx.core.sessionByPublicId(db, hostId), home = target?.cities[city]?.state;
      if (!target || target.expiresAt <= now() || home?.estate.city !== city || !hasPlace(home) || !samePlot(home.estate.plot, plot) || db.civic?.prefs[hostId]?.directory === true || kit.blockedEither(s, id, hostId)) return no('door_unavailable', 'That door is no longer available. Refresh the street.');
      const where = hostHome(s, hostId);
      if (where.state === 'home' ? where.cityId !== city : mainHomeCity(db, hostId) !== city) return no('door_unavailable', 'That door is no longer available. Refresh the street.');
      return enter(db, session, { host: hostId });
    },
    /** An accepted guest sees a whitelist of home scene data, never the host's life. */
    homeProjection(db: Db, session: SessionRecord, host: unknown): VisitHomeResult {
      const hostId = uuid(host), { s, id } = kit.enter(db, session);
      const visit = kit.pruneHouse(s, hostId)?.guests[id];
      if (!visit || s.players[id]?.visiting !== hostId || kit.blockedEither(s, id, hostId)) return no('visit_required', 'You need an accepted visit to see this home.');
      const city = visit.cityId, target = ctx.core.sessionByPublicId(db, hostId), state = target?.cities[city]?.state;
      if (!target || target.expiresAt <= now() || !state || state.estate.city !== city || !hasPlace(state)) return no('home_unavailable', 'This home is unavailable.');
      const homeNow = state.location === 'home' && !isDeparting(state) && kit.hostAtHome(s, hostId, city);
      const allowedWhileOut = visit.link === undefined && kit.ordinary(s, hostId, id) && s.players[hostId]?.door?.out === true && kit.doorFor(s, hostId, id) === 'walk+';
      if (!homeNow && !allowedWhileOut) return no('visit_ended', 'The host left home, so this visit has ended.');
      const items: VisitHomeItem[] = state.home.items.map(item => ({ id: item.id, itemId: item.itemId, x: item.x, y: item.y, rot: item.rot, ...('floor' in item && typeof item.floor === 'number' && Number.isInteger(item.floor) && item.floor >= 0 ? { floor: item.floor } : {}) }));
      const home: VisitHomeProjection = { host: { id: hostId, name: target.name }, city, plot: state.estate.plot ? { ...state.estate.plot } : null, owned: state.estate.living === 'own', grid: homeOf(state, HOUSE_DESIGNS, housesFor(city)).grid, style: { ...state.estate.style }, items };
      const run = state.stories?.running, moment = run?.content.moments[run.step];
      if (run && moment && state.location === 'home' && !isDeparting(state) && !layoutFailure(state, run.content.items)) {
        home.items = cloneItems(run.content.items);
        home.story = { title: run.content.title, description: run.content.description, moment: { title: moment.title, prompt: moment.prompt }, step: run.step, total: run.content.moments.length, revision: run.revision };
      }
      return yes('home', { home });
    },
    /** A guest grants or revokes silent scene capture for this accepted visit only. */
    captureConsent(db: Db, session: SessionRecord, body: Record<string, unknown>) {
      const hostId = uuid(body.host), { s, id } = kit.enter(db, session);
      const { visitId: rawVisitId, allow } = body;
      if (typeof rawVisitId !== 'string' || !UUID_PATTERN.test(rawVisitId) || typeof allow !== 'boolean') throw bad('invalid_capture_consent');
      const visitId = rawVisitId.toLowerCase();
      // Build the viewer projection first so an older accepted visit gets a fresh, default-off id.
      kit.houseView(s, hostId, id);
      const house = kit.pruneHouse(s, hostId);
      if (!house) return no('visit_required', 'You need an accepted visit to change capture permission.');
      const visit = house.guests[id];
      if (!visit || s.players[id]?.visiting !== hostId || kit.blockedEither(s, id, hostId)) return no('visit_required', 'You need an accepted visit to change capture permission.');
      if (visit.captureId !== visitId) return no('visit_changed', 'This visit has changed. Refresh before changing permission.');
      if (visit.expires <= now()) return no('visit_ended', 'This visit has ended.');
      const host = hostHome(s, hostId);
      if (host.state !== 'home' || host.cityId !== visit.cityId) return no('host_not_home', 'The host must be home to record this visit.');
      const already = visit.captureConsent === true;
      if (already === allow) return yes(allow ? 'consented' : 'revoked', { house: kit.houseView(s, hostId, id), duplicate: true });
      if (allow) visit.captureConsent = true; else delete visit.captureConsent;
      const previousRevision = house.captureRevision;
      house.captureRevision = Number.isSafeInteger(previousRevision) && (previousRevision ?? 0) >= 0 && (previousRevision ?? 0) < Number.MAX_SAFE_INTEGER ? (previousRevision ?? 0) + 1 : 1;
      const push: PushList = [];
      kit.housePush(s, hostId, push);
      return yes(allow ? 'consented' : 'revoked', { house: kit.houseView(s, hostId, id), push });
    },
    // ---- who may come in -----------------------------------------------------------------------
    /** The caller's own door, for the Home tab and Settings. */
    door(db: Db, session: SessionRecord) {
      const { s, p, id } = kit.enter(db, session);
      const closed = s.houses[id]?.closed;
      return yes('ok', { door: { who: p.door?.who ?? 'knock', out: p.door?.out === true, chosen: p.door !== undefined }, closed: closed !== undefined && closed > now() });
    },
    /** body: { who?, out? } — what the player chose; whichever is left out stays as it was. */
    setDoor(db: Db, session: SessionRecord, body: Record<string, unknown>) {
      const { s, p, id } = kit.enter(db, session);
      if (body.who !== undefined && !isDoorWho(body.who)) throw bad('invalid_door');
      if (body.out !== undefined && typeof body.out !== 'boolean') throw bad('invalid_door');
      const who = isDoorWho(body.who) ? body.who : p.door?.who ?? 'knock', out = typeof body.out === 'boolean' ? body.out : p.door?.out === true;
      p.door = { who, ...(out ? { out: true as const } : {}) };
      const push: PushList = [];
      // "Nobody" shuts the door: what was waiting at it is answered no, and no link or invitation works until the choice changes.
      if (who === 'nobody') { const house = s.houses[id]; if (house) for (const [visitor, knock] of Object.entries(house.knocks)) if (knock.status === 'pending') { knock.status = 'declined'; knock.answeredAt = now(); push.push([visitor, { type: 'invite-answer', host: kit.pub(s, id), answer: 'declined', house: kit.houseView(s, id, visitor) }]); } }
      return yes('ok', { door: { who, out, chosen: true }, push });
    },
    /** The host closes or reopens the door: nobody new comes in while it is closed; those inside stay. body: { closed } */
    closeDoor(db: Db, session: SessionRecord, body: Record<string, unknown>) {
      const { s, id } = kit.enter(db, session);
      if (typeof body.closed !== 'boolean') throw bad('invalid_door');
      const house = s.houses[id] ||= { knocks: {}, guests: {} };
      if (body.closed) house.closed = now() + VISIT_MS.closed; else delete house.closed;
      const push: PushList = [];
      kit.housePush(s, id, push);
      kit.pruneHouse(s, id);
      return yes('ok', { closed: body.closed, house: kit.houseView(s, id, id), push });
    },
    /** The host asks everyone inside to leave ("End visit"). */
    endVisit(db: Db, session: SessionRecord) {
      const { s, p, id } = kit.enter(db, session);
      const house = kit.pruneHouse(s, id), push: PushList = [];
      const guests = Object.keys(house?.guests ?? {});
      for (const guest of guests) {
        kit.endVisit(s, id, guest);
        kit.notify(s, guest, 'invite-answer', `${p.name} ended the visit.`, { host: id }, push);
        push.push([guest, { type: 'invite-house', house: kit.houseView(s, id, guest) }]);
      }
      for (const [visitor, knock] of Object.entries(s.houses[id]?.knocks ?? {})) if (knock.status === 'pending') { knock.status = 'declined'; knock.answeredAt = now(); push.push([visitor, { type: 'invite-answer', host: kit.pub(s, id), answer: 'declined', house: kit.houseView(s, id, visitor) }]); }
      push.push([id, { type: 'invite-house', house: kit.houseView(s, id, id) }]);
      return yes('ended', { count: guests.length, push });
    },

    // ---- one tap: Visit home -------------------------------------------------------------------
    /**
     * body: { host }. What the button on a friend's card does. An invitation the host made is used first; then the host's door:
     * 'walk' puts the caller inside, 'knock' rings (the social module's knock), the rest refuse with a plain sentence.
     */
    enter,

    // ---- invitations -------------------------------------------------------------------------
    /** body: { to: [ids] } (at most VISIT.inviteAll). Each friend is told "<name> invited you over"; it is good for VISIT.inviteMinutes. */
    invite(db: Db, session: SessionRecord, body: Record<string, unknown>) {
      const ids = Array.isArray(body.to) ? [...new Set(body.to.map(uuid))] : null;
      if (!ids || !ids.length || ids.length > VISIT.inviteAll) throw bad('invalid_player');
      const { s, p, id } = kit.enter(db, session), t = now();
      if (p.door?.who === 'nobody') return no('door_closed', 'Your door is shut. Choose who may come in first.');
      const home = hostHome(s, id);
      if (home.state !== 'home') return no('not_home', 'Go home first, then invite people over.');
      if (!ctx.allow(`visit:invite:${id}`, 6)) return no('rate_limited', 'You are inviting too fast. Wait a minute.');
      const book = openBook(db);
      sweepBook(book, t);
      const push: PushList = [], invited: { id: string; name: string }[] = [], skipped: { id: string; name: string; reason: string }[] = [];
      for (const to of ids) {
        const them = s.players[to];
        if (!them || to === id) { skipped.push({ id: to, name: them?.name ?? 'Former player', reason: 'not found' }); continue; }
        if (kit.blockedEither(s, id, to)) { skipped.push({ id: to, name: them.name, reason: 'not accepting' }); continue; }
        if (!kit.ordinary(s, id, to)) { skipped.push({ id: to, name: them.name, reason: 'not a friend' }); continue; }
        if (invitesBy(db, id, t).length >= VISIT.invitesPerHost && !book.invites[inviteKey(id, to)]) { skipped.push({ id: to, name: them.name, reason: 'too many open invitations' }); continue; }
        book.invites[inviteKey(id, to)] = { host: id, guest: to, at: t, expires: t + VISIT_MS.invite, cityId: home.cityId };
        // The host asked them: they are not held out by an earlier "ask to leave".
        const house = s.houses[id];
        if (house?.barred) delete house.barred[to];
        kit.notify(s, to, 'visit', `${p.name} invited you over.`, { host: id }, push);
        push.push([to, { type: 'social-sync' }]);
        invited.push({ id: to, name: them.name });
      }
      return yes('invited', { invited, skipped, expiresAt: t + VISIT_MS.invite, push });
    },

    // ---- house links ------------------------------------------------------------------------
    /** body: { hours?, max?, open? }. The record; the route signs it into a path (tokens.sign). */
    linkMake(db: Db, session: SessionRecord, body: Record<string, unknown>) {
      const { p, id } = kit.enter(db, session), t = now();
      if (p.door?.who === 'nobody') return no('door_closed', 'Your door is shut. Choose who may come in first.');
      const hours = body.hours === undefined ? VISIT.linkHours : Number(body.hours);
      const max = body.max === undefined || body.max === null ? undefined : Number(body.max);
      if (!Number.isFinite(hours) || hours <= 0 || hours > VISIT.linkMaxHours || (max !== undefined && (!Number.isSafeInteger(max) || max < 1 || max > VISIT.linkMaxUses))) throw bad('invalid_link');
      if (body.open !== undefined && typeof body.open !== 'boolean') throw bad('invalid_link');
      if (!ctx.allow(`visit:link:${id}`, 6)) return no('rate_limited', 'You are making links too fast. Wait a minute.');
      const book = openBook(db);
      sweepBook(book, t);
      if (liveLinks(db, id, t).length >= VISIT.linksPerHost) return no('too_many_links', `You have ${VISIT.linksPerHost} links open. End one first.`);
      const record: HouseLinkRecord = { id: tokens.newId(), host: id, at: t, expires: t + Math.round(hours * 3600000), ...(max !== undefined ? { max } : {}), ...(body.open === true ? { open: true as const } : {}), members: {}, log: [] };
      book.links[record.id] = record;
      return yes('made', { link: record });
    },
    /** The host's links, newest first, with how many came in through each. The route adds each one's path. */
    links(db: Db, session: SessionRecord) {
      const { id } = kit.enter(db, session);
      return yes('ok', { links: linksOf(db, id) });
    },
    /** body: { id } — end a link at once. People already inside stay; nobody new comes in through it. */
    linkEnd(db: Db, session: SessionRecord, body: Record<string, unknown>) {
      const { s, id } = kit.enter(db, session);
      const link = typeof body.id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(body.id) ? peekBook(db)?.links[body.id] : undefined;
      if (!link || link.host !== id) return no('unknown_link', 'That link was not found.');
      if (link.ended === true) return yes('ended', { link, duplicate: true });
      link.ended = true;
      const house = s.houses[id], push: PushList = [];
      for (const [visitor, knock] of Object.entries(house?.knocks ?? {})) if (knock.link === link.id && knock.status === 'pending') { knock.status = 'declined'; knock.answeredAt = now(); push.push([visitor, { type: 'invite-answer', host: kit.pub(s, id), answer: 'declined', house: kit.houseView(s, id, visitor) }]); }
      kit.housePush(s, id, push);
      return yes('ended', { link, push });
    },
    /** What a link is, for a browser with no session: only whether it works and the host's display name. Reads only. */
    peek(db: Db, claim: HouseClaim | null) {
      const link = claim ? peekBook(db)?.links[claim.link] : undefined;
      if (!claim || !link || link.host !== claim.host) return yes('ended', {});
      const state = linkState(link, now()), name = db.social?.players?.[claim.host]?.name;
      if (state === 'ended' || state === 'expired' || typeof name !== 'string') return yes(state === 'expired' ? 'expired' : 'ended', {});
      return yes('open', { host: { name } });
    },
    /**
     * Come in through a house link. The signature was checked by the route (`claim`); the record says whether it still works.
     * The host must be home and online. A new person is asked about once, unless the link lets anyone in: the host sees "<name>
     * wants to come in through your link" and answers like a knock. Someone who came in before walks in again.
     */
    linkEnter(db: Db, session: SessionRecord, claim: HouseClaim | null) {
      const { s, id } = kit.enter(db, session), t = now();
      const link = claim ? peekBook(db)?.links[claim.link] : undefined;
      if (!claim || !link || link.host !== claim.host) return no('link_ended', 'That link has ended.');
      const member = link.members[id] !== undefined, state = linkState(link, t);
      if (state === 'ended') return no('link_ended', 'That link has ended.');
      if (state === 'expired') return no('link_expired', 'That link has run out.');
      const hostId = claim.host, target = s.players[hostId];
      if (hostId === id) return no('self', 'That is your own link. Send it to someone else.');
      if (!target || kit.blockedEither(s, id, hostId)) return no('link_ended', 'That link has ended.');
      if (target.door?.who === 'nobody') return no('door_closed', `${target.name} is not taking visitors right now.`);
      if (state === 'full' && !member) return no('link_full', 'That link has been used as many times as it allows.');
      if (link.removed?.[id] !== undefined) return no('barred', `${target.name} asked you to leave.`);
      if (link.log.filter((at) => t - at < 3600000).length >= VISIT.linkPerHour && !member) return no('link_busy', 'A lot of people are using this link. Try again in a little while.');
      const home = hostHome(s, hostId);
      if (home.state !== 'home') return notHome(target.name, home.state);
      const push: PushList = [];
      if (member || link.open === true || kit.ordinary(s, id, hostId)) return { ...letIn(db, s, id, hostId, 'link', push, link), push };
      // A new person: the host is asked once, the way a knock is asked.
      const house = kit.pruneHouse(s, hostId) ?? (s.houses[hostId] = { knocks: {}, guests: {} });
      if (house.closed !== undefined && house.closed > t) return no('door_shut', `${target.name} has closed the door for now.`);
      if ((house.barred?.[id] ?? 0) > t) return no('barred', `${target.name} asked you to leave. You can knock again later.`);
      if (house.guests[id]) return yes('inside', { house: kit.houseView(s, hostId, id), duplicate: true });
      const old = house.knocks[id];
      if (old?.status === 'pending') return yes('knocking', { expiresAt: old.expires, duplicate: true });
      if (old?.status === 'declined') return no('knock_cooldown', `${target.name} said not now. You can try again in a minute.`);
      if (Object.keys(house.guests).length >= capacity) return no('house_full', `${target.name}’s home is full (${capacity} friends are inside).`);
      if (!ctx.allow(`visit:knock:${id}`, 6)) return no('rate_limited', 'You are knocking too often. Wait a minute.');
      house.knocks[id] = { at: t, expires: t + 60000, status: 'pending', cityId: home.cityId, link: link.id };
      push.push([hostId, { type: 'invite-knock', from: kit.pub(s, id), expiresAt: house.knocks[id]!.expires, via: 'link' }]);
      kit.notify(s, hostId, 'invite-knock', `${s.players[id]!.name} wants to come in through your link.`, { from: id }, push);
      return yes('knocking', { expiresAt: house.knocks[id]!.expires, push });
    },
    /** What the route needs to turn a record into a path and to read a token. */
    tokens,
    sweep(db: Db) { const book = peekBook(db); if (book) sweepBook(book, now()); },
  };
}
