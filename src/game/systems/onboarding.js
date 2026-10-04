/**
 * OWNER: character
 * The quick start (a look, then straight into a public venue as a GUEST), settling in (personality →
 * dream → birth lottery → home, whenever the player chooses), the wardrobe and the boutique, and the
 * gameplay effects of traits and the lottery outcome.
 *
 * THE STAGED MODEL
 *   stage 'guest'    a life made by the quick start that has not moved in yet. It plays in public
 *                    venues at once — activities, people, jobs, trips — with the default needs and no
 *                    traits. It has no home, no local government and no house: the 'action.block' modifier refuses going
 *                    Home, every 'home.*' and 'estate.*' action and 'property.house-move' with code 'settle_required', so a guest
 *                    can never reach a state the economy takes as settled (a rent house, the loan, a
 *                    furnished room). Those are created when 'onboarding.home' succeeds, which is
 *                    also when 'life.started' fires — once.
 *   stage 'settled'  everything else: a life that has moved in, a life saved before character creation
 *                    existed (`legacy`), and a life that was never asked to create a character (made
 *                    without ctx.quickStart: the Worker's sessions, scripts and tests). The last kind
 *                    is offered creation and never restricted, exactly as before.
 *   A guest is `required` only until its look has been confirmed (the quick start itself, seconds
 *   long): until then nothing but 'onboarding.*' is accepted and the servers keep the session out of
 *   rooms, people lists and directories — an abandoned sign-up is in nobody's city.
 *   A life the old enforced five-step flow left half-way (saved with required: true, not done) loads
 *   as a guest with every choice it had already made; if its look was confirmed it can play at once.
 *
 * STATE — state.onboarding
 *   stage        'guest' | 'settled' (see above)
 *   done         boolean — the life has moved in. Traits and lottery effects apply only once true.
 *   legacy       boolean — true for a life saved before character creation existed: it is treated
 *                as onboarded with the default look, keeps everything it had, and is never asked
 *                to create a character (it may edit its look in Sim → Profile).
 *   step         0–5: index of the next step in ONBOARDING_STEPS still to be confirmed (5 = done)
 *   seed         cash the life was created with, so the start-cash grant tops the wallet up to
 *                the chosen home's start cash instead of adding to it
 *   look         { body: 'woman'|'man', hair, outfit, fabric, skin, hairColor, outfitColor, bottomsColor }
 *                plus, only when set: accessories [ids] (at most APPEARANCE.accessoryLimit, one per slot),
 *                face and expression (left out when they are the default, so an old look is unchanged)
 *                — every value is an id from content/traits.js APPEARANCE (hair/outfit lists
 *                depend on body; the three colour fields and skin are swatch ids whose hex is in
 *                APPEARANCE). Scene code reads this to draw the avatar.
 *   traits       [traitId, traitId] once chosen (ids of TRAITS), else []
 *   dream        dream id (DREAMS) or null
 *   lottery      { id, at } | null — the birth lottery roll (id of LOTTERY, server ms it was rolled)
 *   house        'mushin' | 'yaba' | 'lekki' | null — the starting home chosen
 *   wardrobe     { hair: [ids], outfit: [ids], fabric: [ids], accessories?: [ids bought] } — owned styles (basics, the look
 *                chosen at creation, and boutique purchases)
 *   required     boolean — a guest whose look is not confirmed yet (see THE STAGED MODEL). Set only
 *                when the life is created with ctx.quickStart (or its older name ctx.requireOnboarding;
 *                the server passes it for a device session opened by a client that declared it shows
 *                the quick start). Lives made any other way are never held.
 *   completedAt  server ms the life moved in, or null
 *   bonusAt      server ms a food bonus was last given (so one meal is never counted twice)
 *   bornAt       server ms a guest life was created | null   } the first-minute timings, all in
 *   playedAt     server ms the quick start was confirmed | null } server time; kept after settling in
 *   firstAt      server ms the first activity finished | null   }
 *   activities   activities finished while a guest (capped) — the UI offers settling in by it
 *   needsSet     the START_NEEDS were handed out (at the quick start, or at move-in: once either way)
 *   joined       the one free arrival at an inviter's venue was used (see 'onboarding.arrive')
 *
 * THE LOTTERY SURVIVES "NEW LIFE"
 *   sanitize() keeps a valid `onboarding.lottery` even when ctx.isNew is true and resets
 *   everything else. A new-life flow keeps the roll by seeding the replacement life with it:
 *     createLife({ name, onboarding: { lottery: oldState.onboarding.lottery } }, { ...ctx, isNew: true })
 *   A life in another city is a separate life and rolls separately unless seeded the same way.
 *
 * ACTIONS (each failure names what is missing in `reason`)
 *   'onboarding.quick-start' { look, joining? }         guests only: confirm the look and start playing. Sets the
 *                                                       START_NEEDS, stands the Sim at the venue's welcome spot
 *                                                       and lifts `required`. Repeating it only changes the look.
 *   'onboarding.arrive' { venue }  SERVER ONLY          a guest who came by an invite is put in the inviter's
 *                                                       public venue: once per life, within JOIN_WINDOW_MS of its
 *                                                       creation, free. The server chooses the venue (server/social).
 *   'onboarding.look'    { look } | { shuffle: true }   step 1 (Boutique-only styles are refused); shuffle picks a random look a new Sim may wear
 *   'onboarding.traits'  { traits: [id, id] }           step 2; exactly two different traits
 *   'onboarding.dream'   { dream }                      step 3
 *   'onboarding.lottery' {}                             step 4; rolls once with ctx.rng, then repeats the stored roll
 *   'onboarding.home'    { lga, via?, stay? }           step 5; completes creation (see below): the life takes the local
 *                        | { house, lga?, via?, stay? }  government `lga` and lives in the free starter house on its own
 *                                                       plot there (no weekly rent; start cash = the outcome's `ownCash`).
 *                                                       With `house` it starts in that rented home instead, as before (the
 *                                                       game's own screens do not offer this at settle-in: renting is the
 *                                                       Houses app; hosts without the world layer and older scripts use it).
 *                                                       `stay: true` moves in without leaving the venue the Sim is in
 *   'onboarding.set-look'        { look }                       after creation: change look using owned styles; colours are free
 *   'onboarding.boutique-buy'    { kind: 'hair'|'outfit'|'fabric'|'accessories', id }   buy a style with cash and wear it
 * Earlier steps may be redone until 'onboarding.home' succeeds. While `required` is set, this
 * system vetoes every action that is not 'onboarding.*' through the 'action.block' modifier (code
 * 'onboarding_required'); for a guest it vetoes the home-only actions (code 'settle_required').
 *
 * COMPLETION, in order: lottery skill levels are set (never lowered), needs are set to START_NEEDS
 * unless the quick start already did, the start cash is credited through the wallet (ledger reason
 * "Start cash · …": the chosen home's start cash minus the seed the life was created with, so what
 * was earned or spent as a guest is neither lost nor counted twice), the Sim is placed at Home
 * (unless `stay`), then 'life.started' { body, traits, dream, lottery, house } is emitted exactly once.
 * `lottery` is the outcome id ('lapo-baby' is the loan outcome); `house` is the rented home's id, or null for a
 * life that lives in its own starter house. The event also carries `look`, `loan` ({ principal, weekly, owed } |
 * null), `rent` (0 in the own house), `startCash`, and — when a local government was chosen — `lga`, `via` and
 * `own` (true: the life lives in its own house; systems/estate.js takes these three).
 *
 * MODIFIERS contributed (from the two traits and the lottery outcome): needs.decayRate,
 * skills.xpRate, activity.cost, activity.reward, travel.fare, shop.price, social.gain,
 * career.performance. Activity tags that earn a trait bonus on completion: 'food', 'party',
 * 'dance', 'workout', 'fitness', 'nightlife'.
 * LISTENS TO 'activity.completed' and 'meal.eaten' (trait completion bonuses).
 */
import { emit } from '../registry.js';
import { busy, fail, finite, isRecord, makeRng, naira, ok, safeCount } from '../util.js';
import { arrive, canAfford, changeNeeds, credit, debit, moodOf, feelingsOf, setSkillLevel, spotsOf } from '../api.js';
import { bonusNeeds, fxModifiers } from '../character-effects.js';
import { APPEARANCE, BOUTIQUE_PRICES, DEFAULT_LOOK, DREAMS, FEELING_LINES, LOTTERY, MOODS, ONBOARDING_STEPS, START_HOMES, START_NEEDS,
  TRAITS, TRAITS_REQUIRED, WARDROBE_BASICS, ACCESSORY_BASICS } from '../content/traits.js';

import { VENUES } from '../content/venues.js';
import { lgaOf, lgasOf, cityRules } from '../content/world.js';

const DONE_STEP = ONBOARDING_STEPS.length;
/** How long after its creation a guest life may still be put in an inviter's venue (original beta value). */
export const JOIN_WINDOW_MS = 10 * 60 * 1000;
/** Where a new guest stands in a venue: the spot of the first activity the goal chip points at. */
const WELCOME_SPOT = { park: 'trees' };
const ACTIVITY_CAP = 9999;
/** What a guest cannot do at the UNILAG campus (src/campus/unilag): become or be a student. Visiting, the trail, the games and the shuttle stay open. */
export const GUEST_CAMPUS = /^unilag\.(apply|matriculate|change-programme|register-semester|lecture|assignment|test|close-semester|defer|resume|drop|job|hostel\.|election\.)/;
const ENROL_REASON = 'Settle in before you enrol: students need a home of their own. Tap the "Settle in" goal — it takes a minute, and you can still look round the campus as a visitor.';
const SETTLE_REASON = 'Settle in to get your home: choose your traits, your dream and where you live. It takes a minute, and everything you have earned is kept.';
const isGuest = (o) => o?.stage === 'guest' && !o.done;
/** A life of the quick start that has not settled in: it has no home, no local government and no house, and is in no directory. */
export const isGuestLife = (state) => isGuest(state?.onboarding);
/**
 * Server-only actions that deliver something TO a life (a gift or a friendship from another player, a referral gift, a
 * finished table game). They are applied with the server's authority whatever the life is doing — also while it is still
 * held for its look — so the sender's side and the receiver's side can never disagree. Nothing else passes the hold.
 */
const INBOUND = ['social.server', 'growth.referral', 'growth.table-result'];
const KINDS = ['hair', 'outfit', 'fabric'];
const COLOUR_FIELDS = { skin: ['skin', 'skin tone'], hairColor: ['hairColours', 'hair colour'], outfitColor: ['outfitColours', 'outfit colour'], bottomsColor: ['outfitColours', 'bottoms colour'] };
const name = (id) => APPEARANCE.labels[id] ?? id;
const list = (ids) => ids.map(name).join(', ');

/** Styles of one kind that the given body can wear: the observed list, then the beta additions. */
const optionsFor = (kind, body) => (kind === 'hair' ? [...(APPEARANCE.hair[body] || []), ...(APPEARANCE.extra.hair[body] || [])]
  : kind === 'outfit' ? [...(APPEARANCE.outfits[body] || []), ...(APPEARANCE.extra.outfits[body] || [])] : APPEARANCE.fabrics);
const ACCESSORIES = new Map(APPEARANCE.accessories.map((item) => [item.id, item]));
/** Bought in the Boutique only: not offered, shuffled or accepted while a character is being created. */
const boutiqueOnly = (kind, id) => APPEARANCE.boutiqueOnly[kind]?.includes(id) === true;
const kindWord = (kind) => (kind === 'hair' ? 'hairstyle' : kind === 'accessories' ? 'accessory' : kind);

/**
 * The accessories of a look: { list } (known ids, no repeats, one per slot, at most the limit) or
 * { reason }. Nothing given means none.
 */
function checkAccessories(value) {
  if (value === undefined || value === null) return { list: [] };
  if (!Array.isArray(value)) return { reason: 'Accessories must be a list.' };
  if (value.length > APPEARANCE.accessoryLimit) return { reason: `Wear at most ${APPEARANCE.accessoryLimit} accessories.` };
  const slots = new Map();
  for (const id of value) {
    const item = typeof id === 'string' ? ACCESSORIES.get(id) : null;
    if (!item) return { reason: `Choose accessories from the list: ${list([...ACCESSORIES.keys()])}.` };
    if (slots.has(item.slot)) return { reason: slots.get(item.slot) === id ? `${name(id)} is listed twice.` : `${name(slots.get(item.slot))} and ${name(id)} cannot be worn together.` };
    slots.set(item.slot, id);
  }
  return { list: [...value] };
}
/** The accessories that are still valid in a saved list (for loading old or damaged saves). */
function tidyAccessories(value) {
  const slots = new Set(), out = [];
  for (const id of Array.isArray(value) ? value.slice(0, 40) : []) {
    const item = typeof id === 'string' ? ACCESSORIES.get(id) : null;
    if (!item || slots.has(item.slot) || out.length >= APPEARANCE.accessoryLimit) continue;
    slots.add(item.slot); out.push(id);
  }
  return out;
}

/**
 * Returns { look } for a fully valid look, or { reason } naming the first invalid field.
 * `accessories`, `face` and `expression` are optional: left out (or the default) they are not
 * stored, so a look without them is exactly the eight fields it always was. With `starter`, styles
 * that are sold only in the Boutique are refused.
 */
export function checkLook(value, { starter = false } = {}) {
  if (!isRecord(value)) return { reason: 'Choose a look: body, hairstyle, outfit, fabric, skin tone and colours.' };
  if (!APPEARANCE.bodies.some((body) => body.id === value.body)) return { reason: 'Choose a body: Woman or Man.' };
  const look = { body: value.body };
  for (const kind of KINDS) {
    const options = optionsFor(kind, value.body);
    if (!options.includes(value[kind])) {
      const what = kind === 'hair' ? 'hairstyle' : kind;
      return { reason: `Choose a ${what}${kind === 'fabric' ? '' : ` for the ${value.body} body`}: ${list(options)}.` };
    }
    if (starter && boutiqueOnly(kind, value[kind])) return { reason: `${name(value[kind])} is sold in the Boutique: you can buy it there once you have moved in.` };
    look[kind] = value[kind];
  }
  for (const [field, [group, label]] of Object.entries(COLOUR_FIELDS)) {
    if (!APPEARANCE[group].some((swatch) => swatch.id === value[field])) return { reason: `Choose a ${label} from the swatches.` };
    look[field] = value[field];
  }
  const worn = checkAccessories(value.accessories);
  if (!worn.list) return { reason: worn.reason };
  const shop = starter ? worn.list.find((id) => boutiqueOnly('accessories', id)) : null;
  if (shop) return { reason: `${name(shop)} is sold in the Boutique: you can buy it there once you have moved in.` };
  if (worn.list.length) look.accessories = worn.list;
  for (const [field, group, label] of [['face', 'faces', 'face shape'], ['expression', 'expressions', 'expression']]) {
    if (value[field] === undefined || value[field] === null) continue;
    if (!APPEARANCE[group].includes(value[field])) return { reason: `Choose a ${label}: ${list(APPEARANCE[group])}.` };
    if (value[field] !== APPEARANCE[group][0]) look[field] = value[field];
  }
  return { look };
}
/** Two looks are the same when every field matches (the accessories in any order). */
const sameLook = (a, b) => [...KINDS, 'body', ...Object.keys(COLOUR_FIELDS), 'face', 'expression'].every((field) => a[field] === b[field])
  && [...(a.accessories ?? [])].sort().join() === [...(b.accessories ?? [])].sort().join();

function randomLook(rng) {
  const pick = (items) => items[Math.floor(rng() * items.length) % items.length];
  const body = pick(APPEARANCE.bodies).id;
  // Only what a new Sim may wear: nothing that is sold in the Boutique.
  const free = (kind) => optionsFor(kind, body).filter((id) => !boutiqueOnly(kind, id));
  return { body, hair: pick(free('hair')), outfit: pick(free('outfit')), fabric: pick(APPEARANCE.fabrics),
    skin: pick(APPEARANCE.skin).id, hairColor: pick(APPEARANCE.hairColours).id, outfitColor: pick(APPEARANCE.outfitColours).id, bottomsColor: pick(APPEARANCE.outfitColours).id };
}

/**
 * Owned styles: the basics, whatever is being worn (`look`, if given), and any valid saved ids.
 * Bought accessories are kept under `accessories` only once there are some, so a wardrobe that
 * has none is exactly the three lists it always was.
 */
function wardrobeOf(saved, look) {
  const wardrobe = {};
  for (const kind of KINDS) {
    const owned = [...WARDROBE_BASICS[kind], ...(isRecord(saved) && Array.isArray(saved[kind]) ? saved[kind].slice(0, 40) : []), look?.[kind]];
    wardrobe[kind] = [...new Set(owned.filter((id) => typeof id === 'string' && Object.hasOwn(BOUTIQUE_PRICES[kind], id)))];
  }
  const extras = [...(isRecord(saved) && Array.isArray(saved.accessories) ? saved.accessories.slice(0, 40) : []), ...(look?.accessories ?? [])];
  const bought = [...new Set(extras.filter((id) => typeof id === 'string' && ACCESSORIES.has(id) && !ACCESSORY_BASICS.includes(id)))];
  if (bought.length) wardrobe.accessories = bought;
  return wardrobe;
}
/** Every accessory the Sim owns: the free ones and the ones bought. */
const ownedAccessories = (o) => [...ACCESSORY_BASICS, ...(o.wardrobe.accessories ?? [])];
/** `list` with `id` put on: it replaces whatever shares its slot, and the oldest gives way at the limit. */
function wearAccessory(worn, id) {
  const slot = ACCESSORIES.get(id).slot;
  const kept = (worn ?? []).filter((other) => other !== id && ACCESSORIES.get(other)?.slot !== slot);
  return [...kept.slice(Math.max(0, kept.length - (APPEARANCE.accessoryLimit - 1))), id];
}

const validLottery = (value) => (isRecord(value) && typeof value.id === 'string' && Object.hasOwn(LOTTERY, value.id)
  ? { id: value.id, at: finite(value.at) && value.at >= 0 ? value.at : 0 } : null);

const outcomeOf = (state) => (state.onboarding.lottery ? LOTTERY[state.onboarding.lottery.id] : null);

/** Active effect blocks: nothing applies until the life has moved in. */
function sources(state) {
  const o = state.onboarding;
  if (!o?.done) return [];
  return [...o.traits.map((id) => TRAITS[id]?.fx), outcomeOf(state)?.fx];
}

/** The mood word for a 0–100 mood score. */
export const moodWord = (score) => MOODS.find((mood) => score >= mood.min) ?? MOODS[MOODS.length - 1];

/** Why a starting home cannot be chosen with the rolled outcome, or null. */
function homeLock(outcome, houseId) {
  if (!outcome) return 'Roll the birth lottery first.';
  if (outcome.locked?.[houseId]) return outcome.locked[houseId];
  return safeCount(outcome.startCash?.[houseId]) ? null : `${START_HOMES[houseId].label} is not available for ${outcome.label}.`;
}

const notDone = (state) => (state.onboarding.done
  ? fail(state, 'already_onboarded', 'Your Sim is already created. Change your look in Sim → Profile, or shop in Phone → Boutique.') : null);
const needStep = (state, step) => (state.onboarding.step < step
  ? fail(state, 'step_required', `Finish the ${ONBOARDING_STEPS[state.onboarding.step].label} step first.`) : null);
const reach = (state, step) => { state.onboarding.step = Math.max(state.onboarding.step, step); };
const mustBeDone = (state) => (state.onboarding.done ? null : fail(state, 'onboarding_required', isGuest(state.onboarding) ? 'Settle in first: tap the "Settle in" goal. The Boutique and your wardrobe open once you have a home.' : 'Finish creating your Sim first: tap the "Create your Sim" goal.'));

function giveBonus(state, tags) {
  const bonus = bonusNeeds(sources(state), tags);
  if (Object.keys(bonus).length) changeNeeds(state, bonus);
}

/** Hand out the starting needs, once per life (at the quick start, or at move-in for a life that had none). */
function startNeeds(state) {
  const o = state.onboarding;
  if (o.needsSet) return;
  o.needsSet = true;
  changeNeeds(state, Object.fromEntries(Object.entries(START_NEEDS).map(([need, value]) => [need, value - state.needs[need]])));
}

const actions = {
  'onboarding.quick-start'(state, payload, ctx) {
    const blocked = notDone(state);
    if (blocked) return blocked;
    const o = state.onboarding;
    if (!isGuest(o)) return fail(state, 'not_a_guest', 'This life was not started with the quick start. Tap the "Create your Sim" goal to choose your look.');
    const { look, reason } = checkLook(payload?.look, { starter: true });
    if (!look) return fail(state, 'invalid_look', reason);
    o.look = look;
    reach(state, 1);
    o.required = false;
    if (o.playedAt === null) {
      o.playedAt = finite(ctx.now) ? ctx.now : state.t;
      startNeeds(state);
      const spot = WELCOME_SPOT[state.location];
      if (spot && !state.activeAction && spotsOf(state.location).some((item) => item.id === spot)) state.spot = spot;
    }
    // A visitor who came by a friend's link is welcomed by the one banner that says who they are joining (`joining`).
    state.message = payload?.joining === true ? '' : `Welcome to ${VENUES[state.location]?.label ?? 'the city'}, ${state.name}.`;
    return ok(state, 'playing');
  },
  'onboarding.arrive': { serverOnly: true, refusal: 'Joining a friend is done from their invite link.', run(state, payload, ctx) {
    const o = state.onboarding, now = finite(ctx.now) ? ctx.now : state.t;
    if (!isGuest(o) || o.required) return fail(state, 'not_a_guest', 'Only a brand-new guest is brought to a friend’s venue. Use the Map to go there.');
    if (o.joined) return fail(state, 'already_joined', 'You have already joined a friend once. Use the Map to go there.');
    if (o.bornAt === null || now - o.bornAt > JOIN_WINDOW_MS) return fail(state, 'join_window_closed', 'That invite brings you along only in your first minutes. Use the Map to go there.');
    const venue = typeof payload?.venue === 'string' && payload.venue !== 'home' && Object.hasOwn(VENUES, payload.venue) ? payload.venue : null;
    if (!venue) return fail(state, 'invalid_venue', 'That is not a public venue.');
    const stop = busy(state, 'Finish or cancel your current action first.');
    if (stop) return stop;
    o.joined = true;
    if (state.location !== venue) arrive(state, venue, ctx, { mode: null });
    state.message = ''; // the client's one banner says where they are and whom they joined
    return ok(state, 'joined');
  } },
  'onboarding.look'(state, payload, ctx) {
    const blocked = notDone(state);
    if (blocked) return blocked;
    const o = state.onboarding;
    if (payload?.shuffle === true) {
      o.look = randomLook(ctx.rng);
      state.message = 'Shuffled your look.';
      return ok(state, 'shuffled');
    }
    const { look, reason } = checkLook(payload?.look, { starter: true });
    if (!look) return fail(state, 'invalid_look', reason);
    o.look = look;
    reach(state, 1);
    o.required = false; // the look is confirmed: a guest may play from here
    state.message = 'Look saved.';
    return ok(state, 'look_saved');
  },
  'onboarding.traits'(state, payload) {
    const blocked = notDone(state) || needStep(state, 1);
    if (blocked) return blocked;
    const chosen = Array.isArray(payload?.traits) ? [...new Set(payload.traits.filter((id) => typeof id === 'string' && Object.hasOwn(TRAITS, id)))] : [];
    const sent = Array.isArray(payload?.traits) ? payload.traits.length : 0;
    if (chosen.length !== TRAITS_REQUIRED || sent !== TRAITS_REQUIRED) {
      return fail(state, 'invalid_traits', `Choose exactly ${TRAITS_REQUIRED} different traits (you chose ${Math.min(chosen.length, sent)}).`);
    }
    state.onboarding.traits = chosen;
    reach(state, 2);
    state.message = `Personality saved: ${chosen.map((id) => TRAITS[id].label).join(' + ')}.`;
    return ok(state, 'traits_saved');
  },
  'onboarding.dream'(state, payload) {
    const blocked = notDone(state) || needStep(state, 2);
    if (blocked) return blocked;
    const dream = typeof payload?.dream === 'string' && Object.hasOwn(DREAMS, payload.dream) ? DREAMS[payload.dream] : null;
    if (!dream) return fail(state, 'invalid_dream', `Choose one dream: ${Object.values(DREAMS).map((item) => item.label).join(', ')}.`);
    state.onboarding.dream = dream.id;
    reach(state, 3);
    state.message = `Dream saved: ${dream.label}.`;
    return ok(state, 'dream_saved');
  },
  'onboarding.lottery'(state, payload, ctx) {
    const blocked = notDone(state) || needStep(state, 3);
    if (blocked) return blocked;
    const o = state.onboarding;
    if (o.lottery) {
      reach(state, 4);
      state.message = `You were born ${LOTTERY[o.lottery.id].label}. The birth lottery is only rolled once.`;
      return ok(state, 'already_rolled');
    }
    // ctx.rng is seeded from the client-chosen action ID; the server clock is mixed in so the
    // outcome cannot be picked in advance by choosing an ID. Still uniform, still deterministic.
    const roll = (ctx.rng() + makeRng(`lottery|${ctx.now}|${state.t}`)()) % 1;
    const outcomes = Object.values(LOTTERY);
    const total = outcomes.reduce((sum, outcome) => sum + outcome.odds, 0);
    let mark = roll * total, chosen = outcomes[outcomes.length - 1];
    for (const outcome of outcomes) { if (mark < outcome.odds) { chosen = outcome; break; } mark -= outcome.odds; }
    o.lottery = { id: chosen.id, at: finite(ctx.now) ? ctx.now : state.t };
    reach(state, 4);
    state.message = `Birth lottery: ${chosen.label}.`;
    return ok(state, 'rolled');
  },
  'onboarding.home'(state, payload, ctx) {
    const stay = payload?.stay === true;
    const blocked = notDone(state) || needStep(state, 4) || (stay ? null : busy(state, 'Finish or cancel your current action before moving in.'));
    if (blocked) return blocked;
    const o = state.onboarding, outcome = outcomeOf(state);
    const city = state.estate?.city ?? ctx.cityId;
    const wantsLga = payload?.lga !== undefined && payload?.lga !== null, unit = wantsLga ? lgaOf(city, payload.lga) : null;
    if (wantsLga && !unit) return fail(state, 'invalid_lga', `Choose one of the ${lgasOf(city).length} local governments of ${cityRules(city)?.name ?? 'this city'}.`);
    const rented = payload?.house !== undefined && payload?.house !== null;
    const home = typeof payload?.house === 'string' && Object.hasOwn(START_HOMES, payload.house) ? START_HOMES[payload.house] : null;
    if (rented && !home) return fail(state, 'invalid_house', `Choose a starting home: ${Object.values(START_HOMES).map((item) => `${item.label} (${item.district})`).join(', ')}.`);
    if (!rented && !unit) return fail(state, 'lga_required', 'Choose your local government: your free starter house stands on a plot there.');
    const locked = home ? homeLock(outcome, home.id) : null;
    if (locked) return fail(state, 'house_locked', locked);
    if (o.traits.length !== TRAITS_REQUIRED || !o.dream) return fail(state, 'step_required', 'Choose your two traits and a dream before moving in.');
    const startCash = home ? outcome.startCash[home.id] : outcome.ownCash;
    const grant = Math.max(0, startCash - o.seed);
    if (!Number.isSafeInteger(state.cash + grant)) return fail(state, 'balance_limit', 'Your saved balance has reached its supported limit.');

    o.house = home?.id ?? null; o.done = true; o.stage = 'settled'; o.required = false; o.step = DONE_STEP; o.completedAt = finite(ctx.now) ? ctx.now : state.t;
    o.wardrobe = wardrobeOf(o.wardrobe, o.look);
    for (const [skill, level] of Object.entries(outcome.skills || {})) setSkillLevel(state, skill, level);
    startNeeds(state);
    const where = home ? `${home.label}, ${home.district}` : `Starter house, ${unit.name}`;
    credit(state, grant, `Start cash · ${where}${outcome.loan ? ` (includes ${naira(outcome.loan.principal)} LAPO loan)` : ''}`, ctx);
    if (!stay) arrive(state, 'home', ctx, { mode: null });
    emit(state, 'life.started', { body: o.look.body, traits: [...o.traits], dream: o.dream, lottery: outcome.id, house: home?.id ?? null,
      look: { ...o.look, ...(o.look.accessories ? { accessories: [...o.look.accessories] } : {}) }, loan: outcome.loan ? { ...outcome.loan } : null, rent: home?.rent ?? 0, startCash,
      ...(unit ? { lga: unit.id, via: payload.via === 'device' ? 'device' : 'manual', own: !home } : {}) }, ctx);
    const place = home ? `${home.label} in ${home.district}` : `starter house in ${unit.name}`;
    state.message = stay ? `Your ${place} is ready. Tap Home whenever you want to see it. You have ${naira(state.cash)}.` : `Welcome to ${home ? home.district : unit.name}. You moved into your ${home ? home.label : 'own starter house'} with ${naira(state.cash)}.`;
    return ok(state, 'life_started');
  },
  'onboarding.set-look'(state, payload) {
    const blocked = mustBeDone(state);
    if (blocked) return blocked;
    const o = state.onboarding;
    const { look, reason } = checkLook(payload?.look);
    if (!look) return fail(state, 'invalid_look', reason);
    for (const kind of KINDS) {
      if (!o.wardrobe[kind].includes(look[kind])) {
        return fail(state, 'not_owned', `You do not own the ${name(look[kind])} ${kind === 'hair' ? 'hairstyle' : kind} yet. Buy it in Phone → Boutique for ${naira(BOUTIQUE_PRICES[kind][look[kind]])}.`);
      }
    }
    const missing = (look.accessories ?? []).find((id) => !ownedAccessories(o).includes(id));
    if (missing) return fail(state, 'not_owned', `You do not own the ${name(missing)} yet. Buy it in Phone → Boutique for ${naira(BOUTIQUE_PRICES.accessories[missing])}.`);
    if (sameLook(look, o.look)) return ok(state, 'unchanged');
    o.look = look;
    state.message = 'Look updated.';
    return ok(state, 'look_saved');
  },
  'onboarding.boutique-buy'(state, payload, ctx) {
    const blocked = mustBeDone(state);
    if (blocked) return blocked;
    const o = state.onboarding, kind = payload?.kind, id = payload?.id;
    const extra = kind === 'accessories';
    if (!(KINDS.includes(kind) || extra) || typeof id !== 'string' || !Object.hasOwn(BOUTIQUE_PRICES[kind], id)) return fail(state, 'invalid_item', 'Choose a hairstyle, outfit, fabric or accessory from the Boutique list.');
    if (!extra && !optionsFor(kind, o.look.body).includes(id)) {
      return fail(state, 'wrong_body', `${name(id)} is not made for the ${o.look.body} body. Switch body in Sim → Profile first.`);
    }
    if (extra ? ownedAccessories(o).includes(id) : o.wardrobe[kind].includes(id)) return fail(state, 'already_owned', `You already own ${name(id)}. Put it on in Sim → Profile.`);
    const price = BOUTIQUE_PRICES[kind][id];
    if (!canAfford(state, price)) return fail(state, 'insufficient_funds', `${name(id)} costs ${naira(price)}; you have ${naira(state.cash)}.`);
    debit(state, price, `Boutique: ${name(id)} ${kindWord(kind)}`, ctx);
    if (extra) {
      o.wardrobe.accessories = [...(o.wardrobe.accessories ?? []), id];
      o.look = { ...o.look, accessories: wearAccessory(o.look.accessories, id) };
    } else {
      o.wardrobe[kind].push(id);
      o.look = { ...o.look, [kind]: id };
    }
    state.message = `Bought ${name(id)} for ${naira(price)}. You are wearing it now.`;
    return ok(state, 'bought');
  },
};

export default {
  id: 'onboarding',
  stateKeys: ['onboarding'],
  sanitize(input, state, ctx) {
    const raw = input.onboarding;
    const lottery = validLottery(isRecord(raw) ? raw.lottery : null);
    const base = { stage: 'settled', done: false, legacy: false, required: false, step: 0, seed: state.cash, look: { ...DEFAULT_LOOK }, traits: [], dream: null, lottery, house: null,
      wardrobe: null, completedAt: null, bonusAt: 0, bornAt: null, playedAt: null, firstAt: null, activities: 0, needsSet: false, joined: false };
    const time = (value) => (finite(value) && value >= 0 ? value : null);
    if (ctx?.isNew) {
      // A brand-new life: only the lottery roll may be carried in (see the header).
      if (ctx.quickStart === true || ctx.requireOnboarding === true) Object.assign(base, { stage: 'guest', required: true, bornAt: time(ctx.now) });
    } else if (!isRecord(raw) || typeof raw.done !== 'boolean') {
      // Saved before character creation existed: onboarded as-is, nothing taken away.
      Object.assign(base, { done: true, legacy: true, step: DONE_STEP, needsSet: true });
    } else {
      // A saved look keeps everything that is still valid: an unknown accessory, face or expression is dropped, not the whole look.
      base.look = checkLook(isRecord(raw.look) ? { ...raw.look, accessories: tidyAccessories(raw.look.accessories),
        face: APPEARANCE.faces.includes(raw.look.face) ? raw.look.face : undefined, expression: APPEARANCE.expressions.includes(raw.look.expression) ? raw.look.expression : undefined } : raw.look).look ?? base.look;
      base.traits = Array.isArray(raw.traits) ? [...new Set(raw.traits.filter((id) => typeof id === 'string' && Object.hasOwn(TRAITS, id)))].slice(0, TRAITS_REQUIRED) : [];
      base.dream = typeof raw.dream === 'string' && Object.hasOwn(DREAMS, raw.dream) ? raw.dream : null;
      base.house = typeof raw.house === 'string' && Object.hasOwn(START_HOMES, raw.house) ? raw.house : null;
      base.seed = safeCount(raw.seed) ? raw.seed : state.cash;
      base.done = raw.done;
      // A guest: saved as one, or left half-way by the old enforced flow (required, not done).
      if (!raw.done && (raw.stage === 'guest' || raw.required === true)) base.stage = 'guest';
      base.legacy = raw.done && raw.legacy === true;
      base.completedAt = raw.done && finite(raw.completedAt) && raw.completedAt >= 0 ? raw.completedAt : null;
      base.bonusAt = finite(raw.bonusAt) && raw.bonusAt >= 0 ? raw.bonusAt : 0;
      if (raw.done) base.step = DONE_STEP;
      else {
        // The step can never be ahead of what has actually been chosen.
        const limit = base.traits.length !== TRAITS_REQUIRED ? 1 : !base.dream ? 2 : !lottery ? 3 : 4;
        base.step = Number.isInteger(raw.step) ? Math.min(Math.max(raw.step, 0), limit) : 0;
      }
      // Held only until the look is confirmed; never for a life that was not made by the quick start.
      base.required = base.stage === 'guest' && raw.required === true && base.step < 1;
      base.bornAt = time(raw.bornAt); base.playedAt = time(raw.playedAt); base.firstAt = time(raw.firstAt);
      base.activities = safeCount(raw.activities) ? Math.min(raw.activities, ACTIVITY_CAP) : 0;
      base.needsSet = raw.done || raw.needsSet === true;
      base.joined = raw.joined === true;
      base.wardrobe = raw.wardrobe;
    }
    // Until the life has moved in nothing is owned but the basics, however many looks were tried on.
    base.wardrobe = base.done ? wardrobeOf(base.wardrobe, base.look) : wardrobeOf(null, null);
    state.onboarding = base;
  },
  actions,
  advance() {},
  modifiers: {
    ...fxModifiers(sources),
    /**
     * A guest whose look is not confirmed accepts nothing but the creation steps; a guest who is
     * playing is refused only what needs a home (see THE STAGED MODEL in the header).
     */
    'action.block'(value, state, data) {
      const o = state.onboarding, type = typeof data?.type === 'string' ? data.type : '';
      if (value || !o || o.done || type.startsWith('onboarding.')) return value;
      if (data.internal === true && INBOUND.includes(type)) return value;
      if (o.required) return { code: 'onboarding_required', reason: 'Choose your look and tap Play first. Nothing else can be done until then.' };
      if (!isGuest(o)) return value;
      // A guest has no home, no local government and no house: everything that needs one waits for settling in.
      if (type.startsWith('home.') || type.startsWith('estate.') || type === 'property.house-move' || (type === 'travel' && data.payload?.id === 'home')) return { code: 'settle_required', reason: SETTLE_REASON };
      // The campus is open to visitors, but a student needs a life of their own: enrolment, study, the hostel, campus jobs and the student vote wait too.
      if (GUEST_CAMPUS.test(type)) return { code: 'settle_required', reason: ENROL_REASON };
      return value;
    },
  },
  on: {
    'activity.completed'(state, data, ctx) {
      const o = state.onboarding;
      if (isGuest(o)) {
        if (o.firstAt === null) o.firstAt = finite(ctx?.now) ? ctx.now : state.t;
        o.activities = Math.min(ACTIVITY_CAP, o.activities + 1);
      }
      let tags = Array.isArray(data?.tags) ? data.tags : [];
      if (tags.includes('food')) {
        const now = finite(ctx?.now) ? ctx.now : state.t;
        // Another system may already have reported this meal through 'meal.eaten'.
        if (state.onboarding.bonusAt === now) tags = tags.filter((tag) => tag !== 'food');
        state.onboarding.bonusAt = now;
      }
      giveBonus(state, tags);
    },
    'meal.eaten'(state, data, ctx) {
      const now = finite(ctx?.now) ? ctx.now : state.t;
      if (state.onboarding.bonusAt === now) return; // the same meal already counted as a food activity
      state.onboarding.bonusAt = now;
      giveBonus(state, ['food']);
    },
  },
  view(state) {
    const o = state.onboarding, outcome = outcomeOf(state), mood = moodOf(state);
    const word = moodWord(mood.score);
    const notYet = isGuest(o) ? 'Settle in first.' : 'Finish creating your Sim first.';
    return {
      stage: o.stage, guest: isGuest(o), done: o.done, legacy: o.legacy, required: o.required && !o.done, step: o.step,
      /** The first-minute timings in server ms (null until they happen) and what a guest has done so far. */
      timing: { bornAt: o.bornAt, playedAt: o.playedAt, firstAt: o.firstAt, settledAt: o.completedAt }, activities: o.activities,
      settleReason: isGuest(o) ? SETTLE_REASON : null, steps: ONBOARDING_STEPS, look: { ...o.look }, traits: [...o.traits], dream: o.dream, house: o.house,
      lottery: outcome ? { id: outcome.id, label: outcome.label, icon: outcome.icon, tagline: outcome.tagline, bullets: outcome.bullets, beta: Boolean(outcome.beta), at: o.lottery.at } : null,
      /** The start a new life is offered: its own starter house, free, in the local government it chooses. */
      own: { startCash: outcome ? outcome.ownCash : null, rent: 0 },
      homes: Object.values(START_HOMES).map((home) => {
        const locked = outcome ? homeLock(outcome, home.id) : null;
        return { ...home, startCash: outcome && !locked ? outcome.startCash[home.id] : null, locked };
      }),
      wardrobe: { hair: [...o.wardrobe.hair], outfit: [...o.wardrobe.outfit], fabric: [...o.wardrobe.fabric], accessories: ownedAccessories(o) },
      boutique: KINDS.flatMap((kind) => optionsFor(kind, o.look.body).map((id) => {
        const owned = o.wardrobe[kind].includes(id), price = BOUTIQUE_PRICES[kind][id];
        const blocked = !o.done ? notYet : owned ? null
          : !canAfford(state, price) ? `Costs ${naira(price)}; you have ${naira(state.cash)}.` : null;
        return { kind, id, label: name(id), price, owned, wearing: o.look[kind] === id, blocked };
      })).concat(APPEARANCE.accessories.map(({ id, slot }) => {
        const owned = ownedAccessories(o).includes(id), price = BOUTIQUE_PRICES.accessories[id];
        const blocked = !o.done ? notYet : owned ? null
          : !canAfford(state, price) ? `Costs ${naira(price)}; you have ${naira(state.cash)}.` : null;
        return { kind: 'accessories', id, slot, label: name(id), price, owned, wearing: (o.look.accessories ?? []).includes(id), blocked };
      })),
      mood: { word: word.word, tone: word.tone, icon: word.icon, score: mood.score },
      feelings: feelingsOf(state).map((feeling) => ({ ...feeling, line: FEELING_LINES[feeling.id] ?? '' })),
    };
  },
};
