import { regularsFor, regularFor, knownRegular, venueFor, jobFor, jobsFor } from '../cities/runtime.ts';
import { cachedCityContent, isCityId } from '../cities/registry.ts';
/**
 * OWNER: social
 * NPC interactions, relationships, family calls and the life-side half of player-to-player
 * features (messaging, presence, invites and the friend graph live in server/routes/social.ts,
 * server/ws/social.ts and server/social/).
 *
 * State key: `social`
 *   rel       { [id]: { p, d, n, npc, name?, friend?, at } }   closeness per NPC id or player public id
 *             p points 0–100 · d Lagos day of the last interaction · n interactions that day
 *   bae       player public id | null
 *   family    { [memberId]: lagosDay }   last day each family member was called
 *   streak    { day, count }             consecutive days with at least one family call
 *   earned    naira earned from paid activities (the ceiling on lifetime gifts)
 *   coupon    { pct, day }   a haggling coupon: pct off the next grocery order on Lagos day `day` (absent unless place actions are on)
 *   transfer  { day, sent, count, total }   gifts sent today / in this life
 *   notices   [{ id, kind, text, at }]   system notices shown in Messages → Updates
 *
 * NPC interactions are ordinary activities ('npc-<npc>-<action>') at the venue's People spot,
 * run by the foundation's activity engine (core 'activity' to start, 'cancel' to stop). Every
 * public venue has its regulars, so every public venue has a People spot.
 * A regular also offers (once the dilemma kit is installed, src/game/features.ts) the place actions of src/game/place-actions.ts
 * (Haggle, Greet with Respect, Join the Queue, …). They count toward the same four-a-day limit, and a regular remembers up to four tags (`rel.tags`).
 *
 * Actions
 *   'social.call'   { id }    phone a family contact (timed action kind 'call'; works anywhere)
 *   'social.sync'   {}        no-op: lets the client re-read the life after a server-side change
 *   'social.server' { op, … } SERVER ONLY (declared `serverOnly`, see registry.ts): refused with
 *                   'server_only' on POST /api/action. Run through ctx.act by
 *                   server/social/service.ts once the server has checked the other player
 *                   (friendship, presence, limits): transfers, friendships, player-to-player
 *                   interactions and Bae.
 *
 * Emits
 *   'npc.greeted'          { npc }
 *   'npc.interacted'       { npc, action, success }
 *   'friend.made'          { id, npc: boolean }
 *   'relationship.changed' { id, value, tier }
 *   'transfer.sent'        { to, amount }
 *   'transfer.received'    { from, amount }
 * Listens to
 *   'activity.completed'   its own NPC activities, and any paid activity (to count earnings)
 *   'notice.posted'        { kind?, text } — any system may emit this to add a line to Updates.
 *                          Posted by economy (rent due / paid / missed, loan paid / missed), career
 *                          (promotion), health (illness, recovery) and civic (Governor news).
 * Modifier keys it calls (other systems contribute; base → adjusted)
 *   'social.gain'     data { id, npc, action }  closeness points about to be granted
 *   'social.success'  data { id, npc, action }  percent chance that a joke lands
 * Modifier it contributes: 'activity.block' (per-person daily limit).
 *
 * Every number here is an original beta value unless content/npcs.ts says it is fixed.
 */
import type {
  ActionFailure, ActionOutcome, ActionSuccess, ActiveKindHandler, AttachedActivity, CallAction, FamilyId, FamilyMember, LifeContext, LifeState, NpcAction, NpcDefinition, NpcSummary,
  PlaceAction, PlayerAction, Relationship, SocialServerOp, SocialServerOpMap, SocialState, SocialView, SystemDefinition, TierDefinition, TransferBlockCode, VenueId,
} from '../../types/index.ts';
import { LEFT_OUT, PLAYS } from '../profile.ts';
import { dilemmaKit, dilemmasEnabled } from '../features.ts';
import { whereabouts } from '../routines-hook.ts';
import { emit, modify } from '../registry.ts';
import { busy, clamp, cleanText, fail, finite, isId, isRecord, naira, ok, safeCount } from '../util.ts';
import { lagosTime } from '../clock.ts';
import { freeOf, spendFree } from './wallet.ts';
import { addMoodlet, addSkillXp, arrive, canAfford, canCredit, changeNeeds, credit, debit, skillLevel } from '../api.ts';
import { repayFromEarnings } from '../relief.ts';
import { arriveInCity } from './estate.ts';
import { cityRules, linksFrom } from '../content/world.ts';
import { venueLabel } from '../content/venues.ts';
import { NPC_ACTIONS, PLAYER_ACTIONS, TIERS, BAE_TIER, BAE_UNLOCK, MAX_CLOSENESS, DAILY_INTERACTIONS, MAX_RELATIONSHIPS,
  JOKE_FORMULA, FAMILY, FAMILY_CALL, TRANSFER_LIMITS, COUPON_MAX_SAVING, MAX_RELATIONSHIP_TAGS } from '../content/npcs.ts';
import { FOLLOW_UPS_KEPT, cleanMemory } from '../memory/facts.ts';
import { AWAY_DAYS, DEED_POINTS, FAVOUR_AFTER, FAVOUR_NEEDS, TEASE_AFTER, gainFactor, isBadDeed, knows, recall, remember, reputation, schedule, settle, startRumour } from '../memory/mind.ts';
import { awayLine, factLine, followUpLine, recollectionLine } from '../memory/lines.ts';

export const MAX_NOTICES = 20;
const FRIEND_INDEX = TIERS.findIndex((tier) => tier.id === 'friend');

/** A tier by index; every index passed is in range (the original read a property of undefined, a TypeError, otherwise). */
const tierAt = (index: number): TierDefinition => {
  const tier = TIERS[index];
  if (!tier) throw new TypeError(`No closeness tier ${index}`);
  return tier;
};
/** An NPC by id; every id passed is a key of NPCS (the original read a property of undefined, a TypeError, otherwise). */
const npcOf = (id: string): NpcDefinition => {
  const npc = knownRegular(id);
  if (!npc) throw new TypeError(`No NPC ${id}`);
  return npc;
};
const isFamilyId = (value: unknown): value is FamilyId => typeof value === 'string' && Object.hasOwn(FAMILY, value);

const nowOf = (state: LifeState, ctx: LifeContext | undefined): number => (finite(ctx?.now) ? ctx.now : state.t);
const dayOf = (state: LifeState, ctx: LifeContext | undefined): number => lagosTime(nowOf(state, ctx)).day;
const round1 = (value: number): number => Math.round(value * 10) / 10;
export const tierIndex = (points: number): number => TIERS.reduce((best, tier, index) => (points >= tier.min ? index : best), 0);
export const tierOf = (points: number): TierDefinition => tierAt(tierIndex(points));
export const activityId = (npcId: string, actionId: string): string => `npc-${npcId}-${actionId}`;

/** Who an interaction is with: an NPC, or a player (whose display name may be sent). */
interface Meta { npc: boolean; name?: unknown; npcDefinition?: NpcDefinition; cityId?: string }

type NpcSnapshot = NonNullable<Relationship['npcSnapshot']>;
const snapshotOf = (npc: NpcDefinition, cityId: string): NpcSnapshot => ({
  city: cityId,
  name: cleanText(npc.name, 24, 'Regular'),
  emoji: cleanText(npc.emoji, 12, '🧑🏾'),
  role: cleanText(npc.role, 48, 'Regular'),
});
const cleanSnapshot = (value: unknown): NpcSnapshot | null => {
  if (!isRecord(value) || !isCityId(value.city)) return null;
  const name = cleanText(value.name, 24), emoji = cleanText(value.emoji, 12), role = cleanText(value.role, 48);
  return name && emoji && role ? { city: value.city, name, emoji, role } : null;
};
const snapshotRegular = (id: string, snapshot: NpcSnapshot): NpcDefinition | undefined => cachedCityContent(snapshot.city)?.regulars.find((item) => item.id === id)?.definition;

function fresh(): SocialState {
  return { rel: {}, bae: null, family: {}, streak: { day: 0, count: 0 }, earned: 0, transfer: { day: 0, sent: 0, count: 0, total: 0 }, notices: [] };
}

/** The relationship record for `id`, created on first contact. Returns null if the book is full of closer people. */
function relation(state: LifeState, id: string, meta: Meta, ctx: LifeContext | undefined): Relationship | null {
  const { npc, name } = meta;
  const book = state.social.rel;
  let entry = book[id];
  if (!entry) {
    const ids = Object.keys(book);
    if (ids.length >= MAX_RELATIONSHIPS) {
      const drop = ids.filter((key) => !book[key]?.friend && state.social.bae !== key).sort((a, b) => (book[a]?.p ?? 0) - (book[b]?.p ?? 0) || (book[a]?.at ?? 0) - (book[b]?.at ?? 0))[0];
      if (!drop) return null;
      delete book[drop];
    }
    entry = book[id] = { p: 0, d: 0, n: 0, npc: Boolean(npc), at: finite(ctx?.now) ? ctx.now : state.t };
  }
  if (!npc && name) entry.name = cleanText(name, 24, 'Player');
  if (npc && meta.npcDefinition && meta.cityId) {
    const snapshot = meta.cityId === 'lagos' ? undefined : snapshotOf(meta.npcDefinition, meta.cityId);
    if (snapshot) entry.npcSnapshot = snapshot; else delete entry.npcSnapshot;
  }
  return entry;
}

const usedToday = (rel: Relationship | undefined, day: number): number => (rel && rel.d === day ? rel.n : 0);
function countInteraction(rel: Relationship, day: number): void {
  if (rel.d !== day) { rel.d = day; rel.n = 0; }
  rel.n += 1;
}

/** Add closeness points through the 'social.gain' modifier and announce the change. */
function gain(state: LifeState, id: string, base: number, meta: Meta & { action: string }, ctx: LifeContext) {
  const rel = relation(state, id, meta, ctx);
  if (!rel) return null;
  const before = tierIndex(rel.p);
  const swayed = PLAYS && meta.npc && meta.npcDefinition
    ? base * gainFactor(reputation(state.social.rumours, districtAt(ctx.cityId)(meta.npcDefinition.venue), districtAt(ctx.cityId), dayOf(state, ctx)))
    : base;
  const amount = Math.max(0, Number(modify(state, 'social.gain', swayed, { id, npc: Boolean(meta.npc), action: meta.action }, ctx)) || 0);
  rel.p = clamp(round1(rel.p + amount), 0, MAX_CLOSENESS);
  const after = tierIndex(rel.p);
  emit(state, 'relationship.changed', { id, value: rel.p, tier: tierAt(after).id }, ctx);
  // NPC friendships are earned by closeness; friendships between players are made by request and accept.
  if (meta.npc && before < FRIEND_INDEX && after >= FRIEND_INDEX) emit(state, 'friend.made', { id, npc: true }, ctx);
  return { amount: round1(amount), tier: tierAt(after), tierUp: after > before };
}

/** Percent chance that a joke lands on this person (original beta formula; see JOKE_FORMULA). */
export function jokeChance(state: LifeState, id: string, action: { id: string; success?: { base: number } }, npc: boolean, ctx: LifeContext): number {
  if (!action.success) throw new TypeError('This action has no success chance');
  const base = action.success.base + skillLevel(state, 'charisma') * JOKE_FORMULA.perCharismaLevel + (state.social.rel[id]?.p ?? 0) * JOKE_FORMULA.perClosenessPoint;
  const adjusted = Number(modify(state, 'social.success', base, { id, npc, action: action.id }, ctx));
  return Math.round(clamp(finite(adjusted) ? adjusted : base, JOKE_FORMULA.min, JOKE_FORMULA.max));
}

/** Shared outcome of an interaction with an NPC or a player. `applyBase` is false when the activity engine already applied def.effects/xp. */
function interact(state: LifeState, id: string, action: NpcAction | PlayerAction, meta: Meta, ctx: LifeContext, applyBase: boolean) {
  const landed = action.success ? ctx.rng() * 100 < jokeChance(state, id, action, meta.npc, ctx) : true;
  if (applyBase) {
    changeNeeds(state, action.effects);
    for (const [skill, amount] of Object.entries(action.xp || {})) addSkillXp(state, skill, amount, ctx);
  }
  const rel = relation(state, id, meta, ctx);
  if (rel) countInteraction(rel, dayOf(state, ctx));
  let result: ReturnType<typeof gain> = null;
  if (landed) {
    changeNeeds(state, action.bonus);
    result = gain(state, id, action.points, { ...meta, action: action.id }, ctx);
  }
  return { landed, result };
}

function pushNotice(state: LifeState, kind: unknown, text: unknown, ctx: LifeContext | undefined): void {
  const clean = cleanText(text, 160);
  if (!clean) return;
  const list = state.social.notices;
  const last = list.at(-1);
  list.push({ id: (last?.id ?? 0) + 1, kind: isId(kind) ? kind : 'notice', text: clean, at: finite(ctx?.now) ? ctx.now : state.t });
  if (list.length > MAX_NOTICES) list.splice(0, list.length - MAX_NOTICES);
}

// ---- NPC memory, gossip and consequences ---------------------------------------------------------
const districtAt = (cityId: string) => (venue: string): string | undefined => venueFor(cityId, venue)?.district;

/** Gossip stays about the player's own actions and only starts at a public venue with regulars. */
function startTalk(state: LifeState, kind: string, ctx: LifeContext): void {
  const venue = state.location;
  if (!venue || venue === 'home' || !regularsFor(ctx.cityId).some((npc) => npc.venue === venue)) return;
  state.social.rumours = startRumour(state.social.rumours, kind, venue, dayOf(state, ctx));
}

/** A workplace regular can hear the newest dilemma outcome once. */
function newDeed(state: LifeState, npc: NpcDefinition, ctx: LifeContext): string | null {
  const deed = state.career.dilemmas?.memory.at(-1), job = state.job ? jobFor(ctx.cityId, state.job) : undefined;
  return deed && job?.workplace.venue === npc.venue && !knows(state.social.rel[npc.id]?.m, 'deed', deed) ? deed : null;
}

/** Consume due follow-ups once, then pick one work consequence or recollection to open the meeting. */
function meet(state: LifeState, npc: NpcDefinition, ctx: LifeContext): { say: string; extra: string } {
  const day = dayOf(state, ctx), book = state.social, rel = book.rel[npc.id];
  const { due, rest } = settle(book.followUps, npc.id, day);
  let say = '', extra = '';
  if (due.length) {
    if (rest.length) book.followUps = rest; else delete book.followUps;
  }
  for (const item of due) {
    say ||= followUpLine(item.k, day);
    if (item.k === 'favour') { changeNeeds(state, FAVOUR_NEEDS); extra += ` ${npc.name} bought you a drink back.`; }
    if (item.k === 'referral') {
      pushNotice(state, 'tip', `${npc.name} put in a word for you at ${venueLabel(npc.venue, ctx.cityId)}. Open Jobs to apply.`, ctx);
      extra += ' A job tip is in Updates.';
    }
  }
  if (!say && rel && rel.d && tierIndex(rel.p) >= FRIEND_INDEX && day - rel.d >= AWAY_DAYS) say = awayLine(day);
  const deed = newDeed(state, npc, ctx);
  if (!say && deed) say = factLine({ k: 'deed', v: deed, day }, day);
  if (!say) {
    const where = districtAt(ctx.cityId), teller = (venue: string) => regularsFor(ctx.cityId).find((item) => item.venue === venue && item.id !== npc.id)?.name;
    say = recollectionLine(recall(rel?.m, book.rumours, where(npc.venue), where, day), day, (venue) => venueLabel(venue, ctx.cityId), teller);
  }
  return { say, extra };
}

/** Save one observation and schedule any one-time consequence after an NPC interaction. */
function observe(state: LifeState, npc: NpcDefinition, action: NpcAction | PlaceAction, place: PlaceAction | null, landed: boolean, first: boolean, ctx: LifeContext): void {
  const day = dayOf(state, ctx), book = state.social, rel = book.rel[npc.id];
  if (!rel) return;
  const kind = action.id === 'drink' ? 'treat' : action.id === 'joke' ? (landed ? 'laugh' : 'flop')
    : action.id === 'compliment' ? 'praise' : place && landed ? 'place' : null;
  let facts = first ? remember(rel.m, 'met', undefined, day) : rel.m;
  if (kind) facts = remember(facts, kind, kind === 'place' ? place?.grant?.memory ?? action.id : undefined, day);
  const deed = newDeed(state, npc, ctx);
  if (deed) {
    facts = remember(facts, 'deed', deed, day);
    rel.p = clamp(round1(rel.p + (isBadDeed(deed) ? -DEED_POINTS : DEED_POINTS)), 0, MAX_CLOSENESS);
    emit(state, 'relationship.changed', { id: npc.id, value: rel.p, tier: tierOf(rel.p).id }, ctx);
  }
  if (facts) rel.m = facts;
  if (kind === 'treat' || kind === 'laugh') startTalk(state, kind, ctx);
  if (place?.id === 'haggle' && landed) startTalk(state, 'haggle', ctx);
  if (kind === 'treat') book.followUps = schedule(book.followUps, 'favour', npc.id, day + FAVOUR_AFTER);
  if (kind === 'flop') book.followUps = schedule(book.followUps, 'tease', npc.id, day + TEASE_AFTER);
}

// ---- server-only operations ('social.server', reached through ctx.act from server/social/service.ts) ----
const playerId = (value: unknown): string | null => (typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value) ? value : null);

type ServerOps = {
  [Op in SocialServerOp]: (state: LifeState, payload: Record<string, unknown>, ctx: LifeContext) => ActionOutcome<SocialServerOpMap[Op]['ok'], SocialServerOpMap[Op]['fail']>;
};
/**
 * Stand beside a friend who pinged. The server has checked the ping, the friendship and where the friend is; this checks
 * what only the life knows: it is not held for its look, it is not in the middle of something that would be lost, and a
 * life that has not settled in does not leave its city (it could not travel there either). No fare, no trip time, no need
 * cost. Another city is reached through the arrival of a trip between cities (systems/estate.ts): the home left behind is
 * kept, and a life with no home there arrives as a visitor.
 */
// Only a host that plays lives runs it; the browser build leaves it out (src/game/profile.ts).
const joinOp: ServerOps['join'] = PLAYS ? (state, payload, ctx) => {
  const o = state.onboarding, city = payload.city, venue = payload.venue;
  if (o && o.done !== true && o.required === true) return fail(state, 'onboarding_required', 'Choose your look and tap Play first.');
  const blocked = busy(state, 'Finish or cancel what you are doing first, then join them.');
  if (blocked) return blocked;
  const rules = cityRules(city);
  if (!rules || !isCityId(city) || typeof venue !== 'string' || venue === 'home' || !venueFor(city, venue)) return fail(state, 'invalid_place', 'That is not a place you can be brought to.');
  const name = cleanText(payload.name, 24, 'your friend'), label = venueLabel(venue, city);
  if (city === state.estate.city) {
    if (state.location === venue) return ok(state, 'here');
    arrive(state, venue, ctx, { mode: null });
    state.message = `You joined ${name} at ${label}.`;
    return ok(state, 'joined');
  }
  if (o && o.done !== true && o.stage === 'guest') return fail(state, 'settle_required', `${name} is in ${rules.name}. Settle in first: a life that has moved in can go to other cities.`);
  if (rules.status !== 'open') return fail(state, 'city_not_open', `${rules.name} is not open yet.`);
  // The way back is an ordinary paid trip, so there has to be one.
  const from = state.estate.city;
  if (!linksFrom(city).some((link) => link.to === from)) return fail(state, 'no_route', `Nothing runs between ${cityRules(from)?.name ?? 'your city'} and ${rules.name} yet.`);
  arriveInCity(state, { id: rules.id }, ctx, venue);
  // The words of an arrival (systems/estate.ts): a visitor is told where home is, and that is the main home, not the city just left.
  const home = state.estate.home && state.estate.home !== rules.id ? cityRules(state.estate.home)?.name ?? state.estate.home : null;
  state.message = `You joined ${name} at ${label}, ${rules.name}.${state.estate.lga ? (state.estate.home === rules.id ? '' : ' You have a house here.') : ` You are visiting${home ? `: your home is in ${home}` : ''}.`}`;
  return ok(state, 'joined_city');
} : LEFT_OUT;
const serverOps: ServerOps = {
  /** Would a gift of `amount` be allowed right now? Never mutates. */
  'transfer-check'(state, payload, ctx) { return transferBlock(state, payload, ctx) || ok(state, 'allowed'); },
  'transfer-out'(state, payload, ctx) {
    const blocked = transferBlock(state, payload, ctx);
    if (blocked) return blocked;
    const amount = payload.amount, to = playerId(payload.to);
    if (typeof amount !== 'number' || to === null) return fail(state, 'invalid_transfer', 'Choose a friend to send money to.'); // unreachable: transferBlock checked both
    const name = cleanText(payload.name, 24, 'a friend');
    // The unrestricted part first; only the rest is counted against the gift rules (transferBlock checked it).
    const free = Math.min(freeOf(state), amount), ordinary = amount - free;
    spendFree(state, free);
    debit(state, amount, `Transfer to ${name}`, ctx);
    const book = state.social.transfer, day = dayOf(state, ctx);
    if (book.day !== day) { book.day = day; book.sent = 0; book.count = 0; }
    if (ordinary > 0) { book.sent += ordinary; book.count += 1; book.total += ordinary; }
    state.message = `You sent ${naira(amount)} to ${name}.`;
    emit(state, 'transfer.sent', { to, amount }, ctx);
    return ok(state, 'sent');
  },
  'transfer-in'(state, payload, ctx) {
    const amount = payload.amount, from = playerId(payload.from);
    if (!from || typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) return fail(state, 'invalid_transfer', 'That transfer is not valid.');
    if (!canCredit(state, amount)) return fail(state, 'balance_limit', 'Your saved balance has reached its supported limit.');
    const name = cleanText(payload.name, 24, 'a friend');
    credit(state, amount, payload.refund ? `Refund: transfer to ${name}` : `Transfer from ${name}`, ctx);
    if (!payload.refund) repayFromEarnings(state, amount, ctx);
    if (payload.refund) {
      // A returned gift no longer counts against the lifetime ceiling.
      state.social.transfer.total = Math.max(0, state.social.transfer.total - amount);
    } else emit(state, 'transfer.received', { from, amount }, ctx);
    // A received gift is announced by the server's own update to the recipient; only the refund, which has none, is noted here.
    if (payload.refund) pushNotice(state, 'transfer', `${naira(amount)} came back: ${name} could not receive it.`, ctx);
    return ok(state, 'received');
  },
  friend(state, payload, ctx) {
    const id = playerId(payload.id);
    const rel = id && relation(state, id, { npc: false, name: payload.name }, ctx);
    if (!id || !rel) return fail(state, 'invalid_friend', 'That player could not be added.');
    if (rel.friend) return ok(state, 'already_friends');
    rel.friend = true;
    emit(state, 'friend.made', { id, npc: false }, ctx);
    emit(state, 'relationship.changed', { id, value: rel.p, tier: tierOf(rel.p).id }, ctx);
    return ok(state, 'friend_made');
  },
  /** Unfriend or block: the friendship and any Bae status end; closeness is kept. */
  unfriend(state, payload) {
    const target = playerId(payload.id), rel = target ? state.social.rel[target] : null;
    if (rel) delete rel.friend;
    if (state.social.bae === payload.id) state.social.bae = null;
    return ok(state, 'unfriended');
  },
  interact(state, payload, ctx) {
    const id = playerId(payload.id);
    const action = PLAYER_ACTIONS.find((item) => item.id === payload.action);
    if (!id || !action) return fail(state, 'invalid_interaction', 'Choose one of the listed interactions.');
    const name = cleanText(payload.name, 24, 'Player');
    if (usedToday(state.social.rel[id], dayOf(state, ctx)) >= DAILY_INTERACTIONS) {
      return fail(state, 'daily_limit', `You and ${name} have had ${DAILY_INTERACTIONS} interactions today. Come back tomorrow, or just chat.`);
    }
    const { landed, result } = interact(state, id, action, { npc: false, name }, ctx, true);
    if (PLAYS && action.id === 'shade') startTalk(state, 'shade', ctx);
    state.message = landed ? `${action.label}: ${name} liked that.${result?.tierUp ? ` You are now ${result.tier.label}.` : ''}` : `Your joke did not land with ${name}.`;
    return ok(state, landed ? 'interacted' : 'flopped');
  },
  'bae-check'(state, payload) {
    const id = playerId(payload.id), rel = id ? state.social.rel[id] : null;
    if (state.social.bae) return fail(state, 'already_have_bae', state.social.bae === id ? 'You two are already together.' : 'You already have a Bae. End that first.');
    const points = Math.floor(rel?.p ?? 0);
    if (points < BAE_UNLOCK) return fail(state, 'closeness_required', `Ask to be my Bae opens at closeness ${BAE_UNLOCK} (you are at ${points}/${BAE_UNLOCK}). Spend time together first.`);
    return ok(state, 'allowed');
  },
  bae(state, payload, ctx) {
    const id = playerId(payload.id);
    const rel = id && relation(state, id, { npc: false, name: payload.name }, ctx);
    if (!id || !rel) return fail(state, 'invalid_bae', 'That player could not be set as your Bae.');
    if (state.social.bae && state.social.bae !== id) return fail(state, 'already_have_bae', 'You already have a Bae. End that first.');
    state.social.bae = id;
    emit(state, 'relationship.changed', { id, value: rel.p, tier: BAE_TIER.id }, ctx);
    pushNotice(state, 'bae', `You and ${rel.name || 'your Bae'} are now together.`, ctx);
    return ok(state, 'bae');
  },
  'bae-end'(state, payload, ctx) {
    const id = state.social.bae;
    if (!id || (payload.id && payload.id !== id)) return ok(state, 'no_bae');
    state.social.bae = null;
    emit(state, 'relationship.changed', { id, value: state.social.rel[id]?.p ?? 0, tier: tierOf(state.social.rel[id]?.p ?? 0).id }, ctx);
    return ok(state, 'ended');
  },
  join: joinOp,
};

/**
 * What this life may send as ordinary gifts now: the most one gift can carry under the earned-from-work rule and the daily caps (0 when it may send none).
 * Unrestricted funds (an admin's credit) are on top of it and have no limits: see `sendable`.
 */
export function giftRoom(state: LifeState, ctx: LifeContext): number {
  const L = TRANSFER_LIMITS, book = state.social.transfer, today = book.day === dayOf(state, ctx) ? book : { sent: 0, count: 0 };
  if (state.social.earned < L.minEarned || today.count >= L.dailyCount) return 0;
  const room = Math.min(L.maxPerTransfer, L.dailyAmount - today.sent, state.social.earned - (book.total + (state.business?.spent ?? 0)));
  return room >= L.min ? room : 0;
}
/** The most one gift can be now: the unrestricted part plus the ordinary room, never more than the cash held. */
export const sendable = (state: LifeState, ctx: LifeContext): number => Math.max(0, Math.min(state.cash, freeOf(state) + giftRoom(state, ctx)));

/**
 * Why this life may not send `amount` now, as a failure result, or null. Pure.
 * A gift is drawn FIRST from the unrestricted funds an admin credited; for that part no gift rule applies. Whatever is beyond it follows the ordinary rules, and
 * when the ordinary part would be refused the whole gift is refused (nothing is split behind the player's back) with the exact most that can be sent.
 */
function transferBlock(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext): ActionFailure<TransferBlockCode> | null {
  const L = TRANSFER_LIMITS, amount = payload.amount, book = state.social.transfer;
  if (!playerId(payload.to)) return fail(state, 'invalid_transfer', 'Choose a friend to send money to.');
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < L.min) return fail(state, 'amount_too_small', `The smallest gift is ${naira(L.min)}.`);
  const free = Math.min(freeOf(state), amount), ordinary = amount - free;
  const refuse = (code: TransferBlockCode, reason: string): ActionFailure<TransferBlockCode> => fail(state, code, free > 0 ? `${reason} You can send up to ${naira(sendable(state, ctx))} now (${naira(freeOf(state))} of it has no gift limits).` : reason);
  if (ordinary > 0) {
    if (ordinary > L.maxPerTransfer) return refuse('amount_too_large', `The largest single gift is ${naira(L.maxPerTransfer)}${free > 0 ? ' beyond what has no limits' : ''}.`);
    if (state.social.earned < L.minEarned) return refuse('earn_first', `Earn at least ${naira(L.minEarned)} from paid work before sending more (you have earned ${naira(state.social.earned)}).`);
    // What was spent at other players' shops (systems/business.ts) came out of the same allowance: money earned from work passes to another player once.
    const passed = book.total + (state.business?.spent ?? 0);
    if (passed + ordinary > state.social.earned) return refuse('gift_exceeds_earned', `You can only give away money you have earned from work. You can still give ${naira(Math.max(0, state.social.earned - passed))}.`);
    const today = book.day === dayOf(state, ctx) ? book : { sent: 0, count: 0 };
    if (today.count >= L.dailyCount) return refuse('daily_transfer_limit', `You have sent ${L.dailyCount} gifts today. The limit resets at midnight, Nigerian time.`);
    if (today.sent + ordinary > L.dailyAmount) return refuse('daily_transfer_limit', `You can send ${naira(L.dailyAmount)} a day. ${naira(Math.max(0, L.dailyAmount - today.sent))} is left today.`);
  }
  if (!canAfford(state, amount)) return fail(state, 'insufficient_funds', `You do not have enough cash. You have ${naira(state.cash)}.`);
  return null;
}

/** Run one server-only operation on a settled life (the body of 'social.server'; exported for tests). */
const isOp = (op: unknown): op is SocialServerOp => typeof op === 'string' && Object.hasOwn(serverOps, op);
export function serverOp(state: LifeState, op: unknown, payload: unknown, ctx: LifeContext) {
  if (!isOp(op) || !isRecord(payload)) return fail(state, 'invalid_operation', 'That social operation does not exist.');
  return serverOps[op](state, payload, ctx);
}

// ---- content → activities ------------------------------------------------------------------------
// The cast of every public venue in this build. Their interactions attach at that venue's People
// spot, which the activity engine creates where the venue content does not declare one.
const attachedAction = (npc: NpcDefinition, action: NpcAction): AttachedActivity => ({
  id: activityId(npc.id, action.id), label: `${action.label} · ${npc.name}`, icon: action.icon, duration: action.duration, cost: action.cost || 0,
  effects: action.effects, xp: action.xp, tags: ['social'], beta: Boolean(action.beta || npc.beta), note: action.note,
  social: { npc: npc.id, action: action.id },
  where: { venue: npc.venue, spot: 'people', spotLabel: 'People', spotIcon: '👥' },
});
/** The place actions a regular offers at its venue (none while no dilemma kit is installed). With `now` null the hour is ignored. */
const placeActionsAt = (npc: NpcDefinition, cityId: string, now: number | null): PlaceAction[] => dilemmaKit()?.placeActionsFor(npc, cityId, now) ?? [];
const cityActivities = (cityId: string): AttachedActivity[] => regularsFor(cityId).filter((npc) => npc.venue !== 'home' && venueFor(cityId, npc.venue))
  .flatMap((npc) => [...NPC_ACTIONS, ...placeActionsAt(npc, cityId, null)].map((action) => attachedAction(npc, action)));

/** What a landed place action also gives: a grocery coupon for today (one at a time, never stacked) and something the regular remembers. Returns a sentence about the coupon, or ''. */
function grantPlace(state: LifeState, npcId: string, action: PlaceAction, ctx: LifeContext): string {
  const rel = state.social.rel[npcId], memory = action.grant?.memory, pct = action.grant?.coupon;
  if (rel && isId(memory)) rel.tags = [...(rel.tags ?? []).filter((tag) => tag !== memory), memory].slice(-MAX_RELATIONSHIP_TAGS);
  if (!pct) return '';
  state.social.coupon = { pct, day: dayOf(state, ctx) };
  return ` You got ${pct}% off your next grocery order today (up to ${naira(COUPON_MAX_SAVING)}).`;
}

/** A finished call. The first call to each member per Lagos day is a check-in; later ones are just a quick hello. */
function familyCall(state: LifeState, member: FamilyMember, ctx: LifeContext): void {
  const day = dayOf(state, ctx), book = state.social;
  const first = book.family[member.id] !== day;
  changeNeeds(state, FAMILY_CALL.effects);
  if (first) {
    const calledAnyoneToday = Object.values(book.family).includes(day);
    book.family[member.id] = day;
    changeNeeds(state, FAMILY_CALL.first);
    for (const [skill, amount] of Object.entries(FAMILY_CALL.xp)) addSkillXp(state, skill, amount, ctx);
    addMoodlet(state, FAMILY_CALL.moodlet, ctx);
    if (!calledAnyoneToday) book.streak = { day, count: book.streak.day === day - 1 ? book.streak.count + 1 : 1 };
  }
  const quote = member.quotes[Math.floor(ctx.rng() * member.quotes.length)];
  state.message = `${member.name} (NPC): “${quote}”${first ? '' : ' (You already checked in today.)'}`;
  emit(state, 'npc.interacted', { npc: member.id, action: 'call', success: true }, ctx);
}

function npcSummary(state: LifeState, npc: NpcDefinition, day: number, ctx: LifeContext): NpcSummary {
  const rel = state.social.rel[npc.id];
  const points = rel?.p ?? 0, index = tierIndex(points), next = TIERS[index + 1] || null;
  const left = Math.max(0, DAILY_INTERACTIONS - usedToday(rel, day));
  return {
    id: npc.id, name: npc.name, role: npc.role, emoji: npc.emoji, npc: true, beta: Boolean(npc.beta), at: npc.at ?? null,
    quote: npc.quotes[(day + npc.id.length) % npc.quotes.length] ?? '', // the index is in range
    points, tier: tierAt(index).id, tierLabel: tierAt(index).label, next: next ? { label: next.label, min: next.min } : null, left,
    blocked: left ? null : `${npc.name} has heard enough from you today. Come back tomorrow.`,
    actions: [
      ...NPC_ACTIONS.map((action) => ({ id: action.id, activity: activityId(npc.id, action.id), label: action.label, icon: action.icon, duration: action.duration,
        cost: action.cost || 0, tags: Object.keys({ ...action.effects, ...action.bonus }), chance: action.success ? jokeChance(state, npc.id, action, true, ctx) : null })),
      ...placeActionsAt(npc, ctx.cityId, nowOf(state, ctx)).map((action) => ({ id: action.id, activity: activityId(npc.id, action.id), label: action.label, pcmLabel: action.pcmLabel, icon: action.icon,
        duration: action.duration, cost: action.cost || 0, tags: Object.keys({ ...action.effects, ...action.bonus }), chance: action.success ? jokeChance(state, npc.id, action, true, ctx) : null })),
    ],
  };
}

/**
 * What only a host that plays the game runs: player actions, settling time and event listeners. The browser reads lives, it never plays them,
 * so its build leaves this out (PLAYS is false there: src/game/profile.ts).
 */
const play = PLAYS ? {
  actions: {
    'social.call'(state, payload) {
      const blocked = busy(state, 'Finish or cancel your current action before making a call.');
      if (blocked) return blocked;
      const memberId = payload?.id, member = isFamilyId(memberId) ? FAMILY[memberId] : null;
      if (!member) return fail(state, 'invalid_contact', 'Choose someone from your family list.');
      state.activeAction = { kind: 'call', id: member.id, duration: FAMILY_CALL.duration, remaining: FAMILY_CALL.duration };
      state.message = `Calling ${member.name}…`;
      return ok(state, 'calling');
    },
    'social.sync': (state) => ok(state, 'synced'),
    'social.server': { serverOnly: true, refusal: 'That can only be done through the People and Messages screens.',
      run: (state, payload, ctx) => serverOp(state, payload.op, payload, ctx) },
  },
  on: {
    'city.changed'(state, { from }) {
      for (const [id, rel] of Object.entries(state.social.rel)) {
        if (!rel.npc || rel.npcSnapshot) continue;
        const npc = cachedCityContent(from)?.regulars.find(item => item.id === id)?.definition;
        if (npc) rel.npcSnapshot = snapshotOf(npc, from);
      }
    },
    'activity.completed'(state, { def, cash }, ctx) {
      if (cash > 0) state.social.earned = Math.min(Number.MAX_SAFE_INTEGER, state.social.earned + cash);
      if (!def?.social) return;
      const npc = regularFor(ctx.cityId, def.social.npc) ?? npcOf(def.social.npc), action: NpcAction | PlaceAction | undefined = NPC_ACTIONS.find((item) => item.id === def.social?.action) ?? dilemmaKit()?.placeActionById(def.social.action);
      if (!action) throw new TypeError(`No NPC action ${def.social.action}`); // the original read a property of undefined
      const first = !state.social.rel[npc.id], { say, extra } = meet(state, npc, ctx);
      const { landed, result } = interact(state, npc.id, action, { npc: true, npcDefinition: npc, cityId: ctx.cityId }, ctx, false);
      const quote = npc.quotes[Math.floor(ctx.rng() * npc.quotes.length)];
      const found = dilemmaKit()?.placeActionById(action.id);
      const place = found && found === action ? found : null;
      const granted = landed && place ? grantPlace(state, npc.id, place, ctx) : '';
      observe(state, npc, action, place, landed, first, ctx);
      state.message = landed
        ? `${npc.name} (NPC): “${say || quote}”${result?.tierUp ? ` You and ${npc.name} are now ${result.tier.label}.` : ''}${granted}${extra}`
        : `${say ? `${npc.name} (NPC): “${say}” ` : ''}${place ? `${place.label}: ${npc.name} was not moved this time.` : `Your joke did not land. ${npc.name} just blinked at you.`}${extra}`;
      if (action.id === 'hello') emit(state, 'npc.greeted', { npc: npc.id }, ctx);
      emit(state, 'npc.interacted', { npc: npc.id, action: action.id, success: landed }, ctx);
    },
    'friend.made'(state, { id, npc: isNpc }, ctx) {
      const npc = isNpc ? regularFor(ctx.cityId, id) : undefined;
      if (npc && jobsFor(ctx.cityId).some((job) => job.workplace.venue === npc.venue && job.id !== state.job)) {
        state.social.followUps = schedule(state.social.followUps, 'referral', npc.id, dayOf(state, ctx) + 1);
      }
    },
    'shift.completed'(state, { job }, ctx) {
      const venue = state.location, day = dayOf(state, ctx);
      if (venue === 'home') return;
      startTalk(state, 'shift', ctx);
      for (const npc of regularsFor(ctx.cityId)) {
        const rel = npc.venue === venue ? state.social.rel[npc.id] : undefined;
        if (rel) rel.m = remember(rel.m, 'job', job, day);
      }
    },
    'item.bought'(state, { kind }) {
      if (kind === 'grocery' && state.social.coupon) delete state.social.coupon; // the coupon is for one order
    },
    'notice.posted'(state, data, ctx) { if (isRecord(data)) pushNotice(state, data.kind, data.text, ctx); },
  },
  advance() {},
} satisfies Pick<SystemDefinition<'social'>, 'actions' | 'on' | 'advance'> : LEFT_OUT;

export default {
  id: 'social',
  stateKeys: ['social'],

  sanitize(input, state) {
    const saved: Record<string, unknown> = isRecord(input.social) ? input.social : {};
    const next = state.social = fresh();
    const entries = Object.entries(isRecord(saved.rel) ? saved.rel : {}).slice(0, MAX_RELATIONSHIPS);
    for (const [id, rel] of entries) {
      if (!isId(id) || !isRecord(rel) || !finite(rel.p)) continue;
      const isNpc = rel.npc === true, snapshot = isNpc ? cleanSnapshot(rel.npcSnapshot) : null;
      let authoritative: NpcDefinition | undefined;
      if (isNpc && snapshot) {
        const origin = cachedCityContent(snapshot.city);
        authoritative = origin ? snapshotRegular(id, snapshot) : undefined;
        if (origin && !authoritative) continue;
      } else if (isNpc) authoritative = knownRegular(id);
      if (isNpc ? !authoritative && !snapshot : !playerId(id)) continue;
      const canonicalSnapshot = isNpc && authoritative
        ? snapshot ? snapshotOf(authoritative, snapshot.city)
          : state.estate.city !== 'lagos' && cachedCityContent('lagos')?.regulars.some(item => item.id === id) ? snapshotOf(authoritative, 'lagos') : null
        : snapshot;
      const tags = isNpc && Array.isArray(rel.tags) ? [...new Set(rel.tags.filter(isId))].slice(-MAX_RELATIONSHIP_TAGS) : [];
      const memory = isNpc ? cleanMemory(rel.m) : [];
      next.rel[id] = { p: clamp(round1(rel.p), 0, MAX_CLOSENESS), d: safeCount(rel.d) ? rel.d : 0, n: safeCount(rel.n) ? Math.min(rel.n, DAILY_INTERACTIONS) : 0,
        npc: isNpc, at: finite(rel.at) ? rel.at : 0,
        ...(tags.length ? { tags } : {}),
        ...(memory.length ? { m: memory } : {}),
        ...(isNpc && canonicalSnapshot ? { npcSnapshot: canonicalSnapshot } : {}),
        ...(!isNpc ? { name: cleanText(rel.name, 24, 'Player') } : {}), ...(!isNpc && rel.friend === true ? { friend: true } : {}) };
    }
    const bae = playerId(saved.bae);
    next.bae = bae && next.rel[bae] && !next.rel[bae].npc ? bae : null;
    for (const [id, day] of Object.entries(isRecord(saved.family) ? saved.family : {})) if (isFamilyId(id) && safeCount(day)) next.family[id] = day;
    if (isRecord(saved.streak) && safeCount(saved.streak.day) && safeCount(saved.streak.count)) next.streak = { day: saved.streak.day, count: Math.min(saved.streak.count, 100000) };
    next.earned = safeCount(saved.earned) ? saved.earned : 0;
    if (safeCount(saved.free) && saved.free > 0) next.free = saved.free;
    if (isRecord(saved.coupon) && Number.isInteger(saved.coupon.pct) && (saved.coupon.pct as number) >= 1 && (saved.coupon.pct as number) <= 50 && safeCount(saved.coupon.day)) next.coupon = { pct: saved.coupon.pct as number, day: saved.coupon.day };
    const book = isRecord(saved.transfer) ? saved.transfer : {};
    for (const key of ['day', 'sent', 'count', 'total'] as const) if (safeCount(book[key])) next.transfer[key] = book[key];
    next.notices = (Array.isArray(saved.notices) ? saved.notices : []).slice(-MAX_NOTICES)
      .filter((item): item is Record<string, unknown> & { id: number; at: number; text: string } => isRecord(item) && safeCount(item.id) && finite(item.at) && typeof item.text === 'string')
      .map((item) => ({ id: item.id, kind: isId(item.kind) ? item.kind : 'notice', text: cleanText(item.text, 160, 'Notice'), at: item.at }));
    const rumours = cleanMemory(saved.rumours), followUps = cleanMemory(saved.followUps, FOLLOW_UPS_KEPT);
    if (rumours.length) next.rumours = rumours;
    if (followUps.length) next.followUps = followUps;
  },

  active: {
    call: {
      moves: false,
      sanitize: (value) => (Object.hasOwn(FAMILY, value.id) && value.duration === FAMILY_CALL.duration ? {} : null),
      ...(PLAYS ? { complete(state, active, ctx) { familyCall(state, FAMILY[active.id], ctx); } } satisfies Pick<ActiveKindHandler<CallAction>, 'complete'> : LEFT_OUT),
    },
  },

  activitiesFor: cityActivities,

  modifiers: {
    'activity.block'(value, state, { def }, ctx) {
      if (value || !def?.social) return value;
      const npc = regularFor(ctx.cityId, def.social.npc) ?? npcOf(def.social.npc);
      const present = whereabouts(npc, nowOf(state, ctx), ctx.cityId);
      if (!present.here) return { code: 'not_now', reason: present.refusal };
      if (usedToday(state.social.rel[npc.id], dayOf(state, ctx)) >= DAILY_INTERACTIONS) {
        return { code: 'npc_daily_limit', reason: `${npc.name} has heard enough from you today (${DAILY_INTERACTIONS} interactions). Come back tomorrow.` };
      }
      // After-service greetings only make sense just after a service (the catalogue lists them always; the hour is checked here).
      const kit = dilemmaKit();
      if (kit?.placeActionById(def.social.action)?.afterService && !kit.isAfterService(kit.placeKindOf(ctx.cityId, npc.venue), nowOf(state, ctx))) {
        return { code: 'not_now', reason: `${npc.name} is not greeting people right now. Come back just after a service ends.` };
      }
      return null;
    },
    // A haggling coupon takes a percentage off the grocery order it is spent on, up to COUPON_MAX_SAVING, on the day it was earned.
    'shop.price'(value, state, data, ctx) {
      const coupon = state.social.coupon;
      if (!dilemmasEnabled() || !coupon || data?.kind !== 'grocery' || coupon.day !== dayOf(state, ctx) || !finite(value)) return value;
      return Math.max(0, value - Math.min(COUPON_MAX_SAVING, Math.floor((value * coupon.pct) / 100)));
    },
  },

  view(state, ctx) {
    const day = dayOf(state, ctx), book = state.social, L = TRANSFER_LIMITS, there = (npc: NpcDefinition) => whereabouts(npc, nowOf(state, ctx), ctx.cityId);
    const relationships = Object.entries(book.rel).map(([id, rel]) => {
      const index = tierIndex(rel.p), isBae = book.bae === id, next = TIERS[index + 1] || null;
      const snapshot = rel.npcSnapshot, loaded = snapshot ? snapshotRegular(id, snapshot) : undefined, npc = rel.npc ? loaded ?? (snapshot ? undefined : knownRegular(id)) : undefined;
      return { id, npc: rel.npc, name: rel.npc ? npc?.name ?? snapshot?.name ?? 'Regular' : rel.name || 'Player', emoji: rel.npc ? npc?.emoji ?? snapshot?.emoji ?? '🧑🏾' : '🧑🏾', role: rel.npc ? npc?.role ?? snapshot?.role ?? 'Regular' : 'Real player',
        points: rel.p, tier: isBae ? BAE_TIER.id : tierAt(index).id, tierLabel: isBae ? BAE_TIER.label : tierAt(index).label, next: next ? { label: next.label, min: next.min } : null,
        friend: rel.npc ? index >= FRIEND_INDEX : rel.friend === true, left: Math.max(0, DAILY_INTERACTIONS - usedToday(rel, day)),
        where: npc ? there(npc).line : '' };
    }).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    const today = book.transfer.day === day ? book.transfer : { sent: 0, count: 0 };
    const cast = regularsFor(ctx.cityId).filter((npc) => npc.venue === state.location);
    return {
      tiers: TIERS, maxCloseness: MAX_CLOSENESS, baeUnlock: BAE_UNLOCK, bae: book.bae, dailyInteractions: DAILY_INTERACTIONS,
      here: cast.filter((npc) => there(npc).here).map((npc) => npcSummary(state, npc, day, ctx)),
      away: cast.flatMap((npc) => there(npc).here ? [] : [there(npc).away]),
      relationships,
      friends: relationships.filter((rel) => rel.friend),
      paddyCount: relationships.filter((rel) => rel.points >= BAE_UNLOCK).length,
      playerActions: PLAYER_ACTIONS.map((action) => ({ id: action.id, label: action.label, icon: action.icon, tags: Object.keys({ ...action.effects, ...action.bonus }), success: Boolean(action.success) })),
      family: Object.values(FAMILY).map((member) => ({ id: member.id, name: member.name, relation: member.relation, emoji: member.emoji, line: member.line, contact: Boolean(member.contact),
        calledToday: book.family[member.id] === day })),
      familyCall: { duration: FAMILY_CALL.duration, social: (FAMILY_CALL.effects.social ?? 0) + (FAMILY_CALL.first.social ?? 0), mood: FAMILY_CALL.moodlet.value },
      streak: book.streak.day >= day - 1 ? book.streak.count : 0,
      calling: state.activeAction?.kind === 'call' ? state.activeAction.id : null,
      transfer: { ...L, earned: book.earned, sentToday: today.sent, countToday: today.count,
        leftToday: Math.max(0, Math.min(L.dailyAmount - today.sent, book.earned - book.transfer.total - (state.business?.spent ?? 0))), giftsLeftToday: Math.max(0, L.dailyCount - today.count),
        free: freeOf(state) },
      notices: book.notices.slice().reverse(),
    };
  },
  ...play,
} satisfies SystemDefinition<'social'>;
