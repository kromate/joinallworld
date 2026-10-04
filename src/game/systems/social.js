/**
 * OWNER: social
 * NPC interactions, relationships, family calls and the life-side half of player-to-player
 * features (messaging, presence, invites and the friend graph live in server/routes/social.js,
 * server/ws/social.js and server/social/).
 *
 * State key: `social`
 *   rel       { [id]: { p, d, n, npc, name?, friend?, at } }   closeness per NPC id or player public id
 *             p points 0–100 · d Lagos day of the last interaction · n interactions that day
 *   bae       player public id | null
 *   family    { [memberId]: lagosDay }   last day each family member was called
 *   streak    { day, count }             consecutive days with at least one family call
 *   earned    naira earned from paid activities (the ceiling on lifetime gifts)
 *   transfer  { day, sent, count, total }   gifts sent today / in this life
 *   notices   [{ id, kind, text, at }]   system notices shown in Messages → Updates
 *
 * NPC interactions are ordinary activities ('npc-<npc>-<action>') at the venue's People spot,
 * run by the foundation's activity engine (core 'activity' to start, 'cancel' to stop). Every
 * public venue has its regulars, so every public venue has a People spot.
 *
 * Actions
 *   'social.call'   { id }    phone a family contact (timed action kind 'call'; works anywhere)
 *   'social.sync'   {}        no-op: lets the client re-read the life after a server-side change
 *   'social.server' { op, … } SERVER ONLY (declared `serverOnly`, see registry.js): refused with
 *                   'server_only' on POST /api/action. Run through ctx.act by
 *                   server/social/service.js once the server has checked the other player
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
 * Every number here is an original beta value unless content/npcs.js says it was observed.
 */
import { emit, modify } from '../registry.js';
import { busy, clamp, cleanText, fail, finite, isId, isRecord, naira, ok, safeCount } from '../util.js';
import { lagosTime } from '../clock.js';
import { addMoodlet, addSkillXp, canAfford, canCredit, changeNeeds, credit, debit, skillLevel } from '../api.js';
import { VENUES } from '../content/venues.js';
import { NPCS, NPC_ACTIONS, PLAYER_ACTIONS, TIERS, BAE_TIER, BAE_UNLOCK, MAX_CLOSENESS, DAILY_INTERACTIONS, MAX_RELATIONSHIPS,
  JOKE_FORMULA, FAMILY, FAMILY_CALL, TRANSFER_LIMITS } from '../content/npcs.js';

export const MAX_NOTICES = 20;
const FRIEND_INDEX = TIERS.findIndex((tier) => tier.id === 'friend');

const dayOf = (state, ctx) => lagosTime(finite(ctx?.now) ? ctx.now : state.t).day;
const round1 = (value) => Math.round(value * 10) / 10;
export const tierIndex = (points) => TIERS.reduce((best, tier, index) => (points >= tier.min ? index : best), 0);
export const tierOf = (points) => TIERS[tierIndex(points)];
export const activityId = (npcId, actionId) => `npc-${npcId}-${actionId}`;

function fresh() {
  return { rel: {}, bae: null, family: {}, streak: { day: 0, count: 0 }, earned: 0, transfer: { day: 0, sent: 0, count: 0, total: 0 }, notices: [] };
}

/** The relationship record for `id`, created on first contact. Returns null if the book is full of closer people. */
function relation(state, id, { npc, name }, ctx) {
  const book = state.social.rel;
  if (!book[id]) {
    const ids = Object.keys(book);
    if (ids.length >= MAX_RELATIONSHIPS) {
      const drop = ids.filter((key) => !book[key].friend && state.social.bae !== key).sort((a, b) => book[a].p - book[b].p || book[a].at - book[b].at)[0];
      if (!drop) return null;
      delete book[drop];
    }
    book[id] = { p: 0, d: 0, n: 0, npc: Boolean(npc), at: finite(ctx?.now) ? ctx.now : state.t };
  }
  if (!npc && name) book[id].name = cleanText(name, 24, 'Player');
  return book[id];
}

const usedToday = (rel, day) => (rel && rel.d === day ? rel.n : 0);
function countInteraction(rel, day) {
  if (rel.d !== day) { rel.d = day; rel.n = 0; }
  rel.n += 1;
}

/** Add closeness points through the 'social.gain' modifier and announce the change. */
function gain(state, id, base, meta, ctx) {
  const rel = relation(state, id, meta, ctx);
  if (!rel) return null;
  const before = tierIndex(rel.p);
  const amount = Math.max(0, Number(modify(state, 'social.gain', base, { id, npc: Boolean(meta.npc), action: meta.action }, ctx)) || 0);
  rel.p = clamp(round1(rel.p + amount), 0, MAX_CLOSENESS);
  const after = tierIndex(rel.p);
  emit(state, 'relationship.changed', { id, value: rel.p, tier: TIERS[after].id }, ctx);
  // NPC friendships are earned by closeness; friendships between players are made by request and accept.
  if (meta.npc && before < FRIEND_INDEX && after >= FRIEND_INDEX) emit(state, 'friend.made', { id, npc: true }, ctx);
  return { amount: round1(amount), tier: TIERS[after], tierUp: after > before };
}

/** Percent chance that a joke lands on this person (original beta formula; see JOKE_FORMULA). */
export function jokeChance(state, id, action, npc, ctx) {
  const base = action.success.base + skillLevel(state, 'charisma') * JOKE_FORMULA.perCharismaLevel + (state.social.rel[id]?.p ?? 0) * JOKE_FORMULA.perClosenessPoint;
  const adjusted = Number(modify(state, 'social.success', base, { id, npc, action: action.id }, ctx));
  return Math.round(clamp(finite(adjusted) ? adjusted : base, JOKE_FORMULA.min, JOKE_FORMULA.max));
}

/** Shared outcome of an interaction with an NPC or a player. `applyBase` is false when the activity engine already applied def.effects/xp. */
function interact(state, id, action, meta, ctx, applyBase) {
  const landed = action.success ? ctx.rng() * 100 < jokeChance(state, id, action, meta.npc, ctx) : true;
  if (applyBase) {
    changeNeeds(state, action.effects);
    for (const [skill, amount] of Object.entries(action.xp || {})) addSkillXp(state, skill, amount, ctx);
  }
  const rel = relation(state, id, meta, ctx);
  if (rel) countInteraction(rel, dayOf(state, ctx));
  let result = null;
  if (landed) {
    changeNeeds(state, action.bonus);
    result = gain(state, id, action.points, { ...meta, action: action.id }, ctx);
  }
  return { landed, result };
}

function pushNotice(state, kind, text, ctx) {
  const clean = cleanText(text, 160);
  if (!clean) return;
  const list = state.social.notices;
  const last = list.at(-1);
  list.push({ id: (last?.id ?? 0) + 1, kind: isId(kind) ? kind : 'notice', text: clean, at: finite(ctx?.now) ? ctx.now : state.t });
  if (list.length > MAX_NOTICES) list.splice(0, list.length - MAX_NOTICES);
}

// ---- server-only operations ('social.server', reached through ctx.act from server/social/service.js) ----
const playerId = (value) => (typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value) ? value : null);

const serverOps = {
  /** Would a gift of `amount` be allowed right now? Never mutates. */
  'transfer-check'(state, payload, ctx) { return transferBlock(state, payload, ctx) || ok(state, 'allowed'); },
  'transfer-out'(state, payload, ctx) {
    const blocked = transferBlock(state, payload, ctx);
    if (blocked) return blocked;
    const name = cleanText(payload.name, 24, 'a friend');
    debit(state, payload.amount, `Transfer to ${name}`, ctx);
    const book = state.social.transfer, day = dayOf(state, ctx);
    if (book.day !== day) { book.day = day; book.sent = 0; book.count = 0; }
    book.sent += payload.amount; book.count += 1; book.total += payload.amount;
    state.message = `You sent ${naira(payload.amount)} to ${name}.`;
    emit(state, 'transfer.sent', { to: payload.to, amount: payload.amount }, ctx);
    return ok(state, 'sent');
  },
  'transfer-in'(state, payload, ctx) {
    const amount = payload.amount;
    if (!playerId(payload.from) || !Number.isSafeInteger(amount) || amount <= 0) return fail(state, 'invalid_transfer', 'That transfer is not valid.');
    if (!canCredit(state, amount)) return fail(state, 'balance_limit', 'Your saved balance has reached its supported limit.');
    const name = cleanText(payload.name, 24, 'a friend');
    credit(state, amount, payload.refund ? `Refund: transfer to ${name}` : `Transfer from ${name}`, ctx);
    if (payload.refund) {
      // A returned gift no longer counts against the lifetime ceiling.
      state.social.transfer.total = Math.max(0, state.social.transfer.total - amount);
    } else emit(state, 'transfer.received', { from: payload.from, amount }, ctx);
    // A received gift is announced by the server's own update to the recipient; only the refund, which has none, is noted here.
    if (payload.refund) pushNotice(state, 'transfer', `${naira(amount)} came back: ${name} could not receive it.`, ctx);
    return ok(state, 'received');
  },
  friend(state, payload, ctx) {
    const id = playerId(payload.id);
    const rel = id && relation(state, id, { npc: false, name: payload.name }, ctx);
    if (!rel) return fail(state, 'invalid_friend', 'That player could not be added.');
    if (rel.friend) return ok(state, 'already_friends');
    rel.friend = true;
    emit(state, 'friend.made', { id, npc: false }, ctx);
    emit(state, 'relationship.changed', { id, value: rel.p, tier: tierOf(rel.p).id }, ctx);
    return ok(state, 'friend_made');
  },
  /** Unfriend or block: the friendship and any Bae status end; closeness is kept. */
  unfriend(state, payload) {
    const rel = playerId(payload.id) ? state.social.rel[payload.id] : null;
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
    state.message = landed ? `${action.label}: ${name} liked that.${result?.tierUp ? ` You are now ${result.tier.label}.` : ''}` : `Your joke did not land with ${name}.`;
    return ok(state, landed ? 'interacted' : 'flopped');
  },
  'bae-check'(state, payload) {
    const id = playerId(payload.id), rel = id && state.social.rel[id];
    if (state.social.bae) return fail(state, 'already_have_bae', state.social.bae === id ? 'You two are already together.' : 'You already have a Bae. End that first.');
    const points = Math.floor(rel?.p ?? 0);
    if (points < BAE_UNLOCK) return fail(state, 'closeness_required', `Ask to be my Bae opens at closeness ${BAE_UNLOCK} (you are at ${points}/${BAE_UNLOCK}). Spend time together first.`);
    return ok(state, 'allowed');
  },
  bae(state, payload, ctx) {
    const id = playerId(payload.id);
    const rel = id && relation(state, id, { npc: false, name: payload.name }, ctx);
    if (!rel) return fail(state, 'invalid_bae', 'That player could not be set as your Bae.');
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
};

/** Why this life may not send `amount` now, as a failure result, or null. Pure. */
function transferBlock(state, payload, ctx) {
  const L = TRANSFER_LIMITS, amount = payload.amount, book = state.social.transfer;
  if (!playerId(payload.to)) return fail(state, 'invalid_transfer', 'Choose a friend to send money to.');
  if (!Number.isSafeInteger(amount) || amount < L.min) return fail(state, 'amount_too_small', `The smallest gift is ${naira(L.min)}.`);
  if (amount > L.maxPerTransfer) return fail(state, 'amount_too_large', `The largest single gift is ${naira(L.maxPerTransfer)}.`);
  if (state.social.earned < L.minEarned) return fail(state, 'earn_first', `Earn at least ${naira(L.minEarned)} from paid work before sending money (you have earned ${naira(state.social.earned)}).`);
  if (book.total + amount > state.social.earned) {
    return fail(state, 'gift_exceeds_earned', `You can only give away money you have earned from work. You can still give ${naira(Math.max(0, state.social.earned - book.total))}.`);
  }
  const today = book.day === dayOf(state, ctx) ? book : { sent: 0, count: 0 };
  if (today.count >= L.dailyCount) return fail(state, 'daily_transfer_limit', `You have sent ${L.dailyCount} gifts today. The limit resets at midnight, Lagos time.`);
  if (today.sent + amount > L.dailyAmount) return fail(state, 'daily_transfer_limit', `You can send ${naira(L.dailyAmount)} a day. ${naira(Math.max(0, L.dailyAmount - today.sent))} is left today.`);
  if (!canAfford(state, amount)) return fail(state, 'insufficient_funds', `You do not have enough cash. You have ${naira(state.cash)}.`);
  return null;
}

/** Run one server-only operation on a settled life (the body of 'social.server'; exported for tests). */
export function serverOp(state, op, payload, ctx) {
  if (typeof op !== 'string' || !Object.hasOwn(serverOps, op) || !isRecord(payload)) return fail(state, 'invalid_operation', 'That social operation does not exist.');
  return serverOps[op](state, payload, ctx);
}

// ---- content → activities ------------------------------------------------------------------------
// The cast of every public venue in this build. Their interactions attach at that venue's People
// spot, which the activity engine creates where the venue content does not declare one.
const cast = Object.values(NPCS).filter((npc) => Object.hasOwn(VENUES, npc.venue) && npc.venue !== 'home');
const activities = cast.flatMap((npc) => NPC_ACTIONS.map((action) => ({
  id: activityId(npc.id, action.id), label: `${action.label} · ${npc.name}`, icon: action.icon, duration: action.duration, cost: action.cost || 0,
  effects: action.effects, xp: action.xp, tags: ['social'], beta: Boolean(action.beta || npc.beta), note: action.note,
  social: { npc: npc.id, action: action.id },
  where: { venue: npc.venue, spot: 'people', spotLabel: 'People', spotIcon: '👥' },
})));

/** A finished call. The first call to each member per Lagos day is a check-in; later ones are just a quick hello. */
function familyCall(state, member, ctx) {
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
  state.message = `${member.name}: “${quote}”${first ? '' : ' (You already checked in today.)'}`;
  emit(state, 'npc.interacted', { npc: member.id, action: 'call', success: true }, ctx);
}

function npcSummary(state, npc, day, ctx) {
  const rel = state.social.rel[npc.id];
  const points = rel?.p ?? 0, index = tierIndex(points), next = TIERS[index + 1] || null;
  const left = Math.max(0, DAILY_INTERACTIONS - usedToday(rel, day));
  return {
    id: npc.id, name: npc.name, role: npc.role, emoji: npc.emoji, npc: true, beta: Boolean(npc.beta), at: npc.at ?? null,
    quote: npc.quotes[(day + npc.id.length) % npc.quotes.length],
    points, tier: TIERS[index].id, tierLabel: TIERS[index].label, next: next ? { label: next.label, min: next.min } : null, left,
    blocked: left ? null : `${npc.name} has heard enough from you today. Come back tomorrow.`,
    actions: NPC_ACTIONS.map((action) => ({ id: action.id, activity: activityId(npc.id, action.id), label: action.label, icon: action.icon, duration: action.duration,
      cost: action.cost || 0, tags: Object.keys({ ...action.effects, ...action.bonus }), chance: action.success ? jokeChance(state, npc.id, action, true, ctx) : null })),
  };
}

export default {
  id: 'social',
  stateKeys: ['social'],

  sanitize(input, state) {
    const saved = isRecord(input.social) ? input.social : {};
    const next = state.social = fresh();
    const entries = Object.entries(isRecord(saved.rel) ? saved.rel : {}).filter(([id, rel]) => isId(id) && isRecord(rel) && finite(rel.p)
      && (rel.npc === true ? Object.hasOwn(NPCS, id) : Boolean(playerId(id)))).slice(0, MAX_RELATIONSHIPS);
    for (const [id, rel] of entries) {
      next.rel[id] = { p: clamp(round1(rel.p), 0, MAX_CLOSENESS), d: safeCount(rel.d) ? rel.d : 0, n: safeCount(rel.n) ? Math.min(rel.n, DAILY_INTERACTIONS) : 0,
        npc: rel.npc === true, at: finite(rel.at) ? rel.at : 0,
        ...(rel.npc !== true ? { name: cleanText(rel.name, 24, 'Player') } : {}), ...(rel.npc !== true && rel.friend === true ? { friend: true } : {}) };
    }
    next.bae = playerId(saved.bae) && next.rel[saved.bae] && !next.rel[saved.bae].npc ? saved.bae : null;
    for (const [id, day] of Object.entries(isRecord(saved.family) ? saved.family : {})) if (Object.hasOwn(FAMILY, id) && safeCount(day)) next.family[id] = day;
    if (isRecord(saved.streak) && safeCount(saved.streak.day) && safeCount(saved.streak.count)) next.streak = { day: saved.streak.day, count: Math.min(saved.streak.count, 100000) };
    next.earned = safeCount(saved.earned) ? saved.earned : 0;
    const book = isRecord(saved.transfer) ? saved.transfer : {};
    for (const key of ['day', 'sent', 'count', 'total']) if (safeCount(book[key])) next.transfer[key] = book[key];
    next.notices = (Array.isArray(saved.notices) ? saved.notices : []).slice(-MAX_NOTICES)
      .filter((item) => isRecord(item) && safeCount(item.id) && finite(item.at) && typeof item.text === 'string')
      .map((item) => ({ id: item.id, kind: isId(item.kind) ? item.kind : 'notice', text: cleanText(item.text, 160, 'Notice'), at: item.at }));
  },

  actions: {
    'social.call'(state, payload) {
      const blocked = busy(state, 'Finish or cancel your current action before making a call.');
      if (blocked) return blocked;
      const member = typeof payload?.id === 'string' && Object.hasOwn(FAMILY, payload.id) ? FAMILY[payload.id] : null;
      if (!member) return fail(state, 'invalid_contact', 'Choose someone from your family list.');
      state.activeAction = { kind: 'call', id: member.id, duration: FAMILY_CALL.duration, remaining: FAMILY_CALL.duration };
      state.message = `Calling ${member.name}…`;
      return ok(state, 'calling');
    },
    'social.sync': (state) => ok(state, 'synced'),
    'social.server': { serverOnly: true, refusal: 'That can only be done through the People and Messages screens.',
      run: (state, payload, ctx) => serverOp(state, payload.op, payload, ctx) },
  },

  active: {
    call: {
      sanitize: (value) => (Object.hasOwn(FAMILY, value.id) && value.duration === FAMILY_CALL.duration ? {} : null),
      complete(state, active, ctx) { familyCall(state, FAMILY[active.id], ctx); },
    },
  },

  activities,

  modifiers: {
    'activity.block'(value, state, { def }, ctx) {
      if (value || !def?.social) return value;
      const npc = NPCS[def.social.npc];
      return usedToday(state.social.rel[npc.id], dayOf(state, ctx)) >= DAILY_INTERACTIONS
        ? { code: 'npc_daily_limit', reason: `${npc.name} has heard enough from you today (${DAILY_INTERACTIONS} interactions). Come back tomorrow.` } : null;
    },
  },

  on: {
    'activity.completed'(state, { def }, ctx) {
      if (def?.reward > 0) {
        const paid = Math.max(0, Math.round(Number(modify(state, 'activity.reward', def.reward, { def }, ctx)) || 0));
        state.social.earned = Math.min(Number.MAX_SAFE_INTEGER, state.social.earned + paid);
      }
      if (!def?.social) return;
      const npc = NPCS[def.social.npc], action = NPC_ACTIONS.find((item) => item.id === def.social.action);
      const { landed, result } = interact(state, npc.id, action, { npc: true }, ctx, false);
      const quote = npc.quotes[Math.floor(ctx.rng() * npc.quotes.length)];
      state.message = landed
        ? `${npc.name}: “${quote}”${result?.tierUp ? ` You and ${npc.name} are now ${result.tier.label}.` : ''}`
        : `Your joke did not land. ${npc.name} just blinked at you.`;
      if (action.id === 'hello') emit(state, 'npc.greeted', { npc: npc.id }, ctx);
      emit(state, 'npc.interacted', { npc: npc.id, action: action.id, success: landed }, ctx);
    },
    'notice.posted'(state, data, ctx) { if (isRecord(data)) pushNotice(state, data.kind, data.text, ctx); },
  },

  advance() {},

  view(state, ctx) {
    const day = dayOf(state, ctx), book = state.social, L = TRANSFER_LIMITS;
    const relationships = Object.entries(book.rel).map(([id, rel]) => {
      const index = tierIndex(rel.p), isBae = book.bae === id, next = TIERS[index + 1] || null;
      return { id, npc: rel.npc, name: rel.npc ? NPCS[id].name : rel.name || 'Player', emoji: rel.npc ? NPCS[id].emoji : '🧑🏾', role: rel.npc ? NPCS[id].role : 'Real player',
        points: rel.p, tier: isBae ? BAE_TIER.id : TIERS[index].id, tierLabel: isBae ? BAE_TIER.label : TIERS[index].label, next: next ? { label: next.label, min: next.min } : null,
        friend: rel.npc ? index >= FRIEND_INDEX : rel.friend === true, left: Math.max(0, DAILY_INTERACTIONS - usedToday(rel, day)) };
    }).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    const today = book.transfer.day === day ? book.transfer : { sent: 0, count: 0 };
    return {
      tiers: TIERS, maxCloseness: MAX_CLOSENESS, baeUnlock: BAE_UNLOCK, bae: book.bae, dailyInteractions: DAILY_INTERACTIONS,
      here: cast.filter((npc) => npc.venue === state.location).map((npc) => npcSummary(state, npc, day, ctx)),
      relationships,
      friends: relationships.filter((rel) => rel.friend),
      paddyCount: relationships.filter((rel) => rel.points >= BAE_UNLOCK).length,
      playerActions: PLAYER_ACTIONS.map((action) => ({ id: action.id, label: action.label, icon: action.icon, tags: Object.keys({ ...action.effects, ...action.bonus }), success: Boolean(action.success) })),
      family: Object.values(FAMILY).map((member) => ({ id: member.id, name: member.name, relation: member.relation, emoji: member.emoji, line: member.line, contact: Boolean(member.contact),
        calledToday: book.family[member.id] === day })),
      familyCall: { duration: FAMILY_CALL.duration, social: FAMILY_CALL.effects.social + FAMILY_CALL.first.social, mood: FAMILY_CALL.moodlet.value },
      streak: book.streak.day >= day - 1 ? book.streak.count : 0,
      calling: state.activeAction?.kind === 'call' ? state.activeAction.id : null,
      transfer: { ...L, earned: book.earned, sentToday: today.sent, countToday: today.count,
        leftToday: Math.max(0, Math.min(L.dailyAmount - today.sent, book.earned - book.transfer.total)), giftsLeftToday: Math.max(0, L.dailyCount - today.count) },
      notices: book.notices.slice().reverse(),
    };
  },
};
