/**
 * OWNER: character
 * Character creation (look → personality → dream → birth lottery → home), the wardrobe and
 * the boutique, and the gameplay effects of traits and the lottery outcome.
 *
 * STATE — state.onboarding
 *   done         boolean — the life has moved in. Traits and lottery effects apply only once true.
 *   legacy       boolean — true for a life saved before character creation existed: it is treated
 *                as onboarded with the default look, keeps everything it had, and is never asked
 *                to create a character (it may edit its look in Sim → Profile).
 *   step         0–5: index of the next step in ONBOARDING_STEPS still to be confirmed (5 = done)
 *   seed         cash the life was created with, so the start-cash grant tops the wallet up to
 *                the chosen home's start cash instead of adding to it
 *   look         { body: 'woman'|'man', hair, outfit, fabric, skin, hairColor, outfitColor, bottomsColor }
 *                — every value is an id from content/traits.js APPEARANCE (hair/outfit lists
 *                depend on body; the three colour fields and skin are swatch ids whose hex is in
 *                APPEARANCE). Scene code reads this to draw the avatar.
 *   traits       [traitId, traitId] once chosen (ids of TRAITS), else []
 *   dream        dream id (DREAMS) or null
 *   lottery      { id, at } | null — the birth lottery roll (id of LOTTERY, server ms it was rolled)
 *   house        'mushin' | 'yaba' | 'lekki' | null — the starting home chosen
 *   wardrobe     { hair: [ids], outfit: [ids], fabric: [ids] } — owned styles (basics, the look
 *                chosen at creation, and boutique purchases)
 *   required     boolean — this life must finish creation before it can do anything else. Set only
 *                when the life is created with ctx.requireOnboarding (the server passes it for a
 *                device session opened by a client that declared it can show creation). Lives made
 *                any other way, and every life saved before creation existed, are never forced.
 *   completedAt  server ms the life moved in, or null
 *   bonusAt      server ms a food bonus was last given (so one meal is never counted twice)
 *
 * THE LOTTERY SURVIVES "NEW LIFE"
 *   sanitize() keeps a valid `onboarding.lottery` even when ctx.isNew is true and resets
 *   everything else. A new-life flow keeps the roll by seeding the replacement life with it:
 *     createLife({ name, onboarding: { lottery: oldState.onboarding.lottery } }, { ...ctx, isNew: true })
 *   A life in another city is a separate life and rolls separately unless seeded the same way.
 *
 * ACTIONS (each failure names what is missing in `reason`)
 *   'onboarding.look'    { look } | { shuffle: true }   step 1; shuffle picks a random valid look
 *   'onboarding.traits'  { traits: [id, id] }           step 2; exactly two different traits
 *   'onboarding.dream'   { dream }                      step 3
 *   'onboarding.lottery' {}                             step 4; rolls once with ctx.rng, then repeats the stored roll
 *   'onboarding.home'    { house }                      step 5; completes creation (see below)
 *   'onboarding.set-look'        { look }                       after creation: change look using owned styles; colours are free
 *   'onboarding.boutique-buy'    { kind: 'hair'|'outfit'|'fabric', id }   buy a style with cash and wear it
 * Earlier steps may be redone until 'onboarding.home' succeeds. While `required` is set and the
 * life has not moved in, this system vetoes every action that is not 'onboarding.*' through the
 * 'action.block' modifier (code 'onboarding_required'). Otherwise creation is offered, not enforced.
 *
 * COMPLETION, in order: lottery skill levels are set, needs are set to START_NEEDS, the start
 * cash is credited through the wallet (ledger reason "Start cash · …"), the Sim is placed at
 * Home, then 'life.started' { body, traits, dream, lottery, house } is emitted exactly once.
 * `lottery` is the outcome id ('lapo-baby' is the loan outcome); the event also carries `look`,
 * `loan` ({ principal, weekly, owed } | null), `rent` and `startCash` for convenience.
 *
 * MODIFIERS contributed (from the two traits and the lottery outcome): needs.decayRate,
 * skills.xpRate, activity.cost, activity.reward, travel.fare, shop.price, social.gain,
 * career.performance. Activity tags that earn a trait bonus on completion: 'food', 'party',
 * 'dance', 'workout', 'fitness', 'nightlife'.
 * LISTENS TO 'activity.completed' and 'meal.eaten' (trait completion bonuses).
 */
import { emit } from '../registry.js';
import { busy, fail, finite, isRecord, makeRng, naira, ok, safeCount } from '../util.js';
import { arrive, canAfford, changeNeeds, credit, debit, moodOf, feelingsOf, setSkillLevel } from '../api.js';
import { bonusNeeds, fxModifiers } from '../character-effects.js';
import { APPEARANCE, BOUTIQUE_PRICES, DEFAULT_LOOK, DREAMS, FEELING_LINES, LOTTERY, MOODS, ONBOARDING_STEPS, START_HOMES, START_NEEDS,
  TRAITS, TRAITS_REQUIRED, WARDROBE_BASICS } from '../content/traits.js';

const DONE_STEP = ONBOARDING_STEPS.length;
const KINDS = ['hair', 'outfit', 'fabric'];
const COLOUR_FIELDS = { skin: ['skin', 'skin tone'], hairColor: ['hairColours', 'hair colour'], outfitColor: ['outfitColours', 'outfit colour'], bottomsColor: ['outfitColours', 'bottoms colour'] };
const name = (id) => APPEARANCE.labels[id] ?? id;
const list = (ids) => ids.map(name).join(', ');

/** Styles of one kind that the given body can wear. */
const optionsFor = (kind, body) => (kind === 'hair' ? APPEARANCE.hair[body] : kind === 'outfit' ? APPEARANCE.outfits[body] : APPEARANCE.fabrics) || [];

/** Returns { look } for a fully valid look, or { reason } naming the first invalid field. */
export function checkLook(value) {
  if (!isRecord(value)) return { reason: 'Choose a look: body, hairstyle, outfit, fabric, skin tone and colours.' };
  if (!APPEARANCE.bodies.some((body) => body.id === value.body)) return { reason: 'Choose a body: Woman or Man.' };
  const look = { body: value.body };
  for (const kind of KINDS) {
    const options = optionsFor(kind, value.body);
    if (!options.includes(value[kind])) {
      const what = kind === 'hair' ? 'hairstyle' : kind;
      return { reason: `Choose a ${what}${kind === 'fabric' ? '' : ` for the ${value.body} body`}: ${list(options)}.` };
    }
    look[kind] = value[kind];
  }
  for (const [field, [group, label]] of Object.entries(COLOUR_FIELDS)) {
    if (!APPEARANCE[group].some((swatch) => swatch.id === value[field])) return { reason: `Choose a ${label} from the swatches.` };
    look[field] = value[field];
  }
  return { look };
}

function randomLook(rng) {
  const pick = (items) => items[Math.floor(rng() * items.length) % items.length];
  const body = pick(APPEARANCE.bodies).id;
  return { body, hair: pick(APPEARANCE.hair[body]), outfit: pick(APPEARANCE.outfits[body]), fabric: pick(APPEARANCE.fabrics),
    skin: pick(APPEARANCE.skin).id, hairColor: pick(APPEARANCE.hairColours).id, outfitColor: pick(APPEARANCE.outfitColours).id, bottomsColor: pick(APPEARANCE.outfitColours).id };
}

/** Owned styles: the basics, whatever is being worn (`look`, if given), and any valid saved ids. */
function wardrobeOf(saved, look) {
  const wardrobe = {};
  for (const kind of KINDS) {
    const owned = [...WARDROBE_BASICS[kind], ...(isRecord(saved) && Array.isArray(saved[kind]) ? saved[kind].slice(0, 40) : []), look?.[kind]];
    wardrobe[kind] = [...new Set(owned.filter((id) => typeof id === 'string' && Object.hasOwn(BOUTIQUE_PRICES[kind], id)))];
  }
  return wardrobe;
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
const mustBeDone = (state) => (state.onboarding.done ? null : fail(state, 'onboarding_required', 'Finish creating your Sim first: tap the "Create your Sim" goal.'));

function giveBonus(state, tags) {
  const bonus = bonusNeeds(sources(state), tags);
  if (Object.keys(bonus).length) changeNeeds(state, bonus);
}

const actions = {
  'onboarding.look'(state, payload, ctx) {
    const blocked = notDone(state);
    if (blocked) return blocked;
    const o = state.onboarding;
    if (payload?.shuffle === true) {
      o.look = randomLook(ctx.rng);
      state.message = 'Shuffled your look.';
      return ok(state, 'shuffled');
    }
    const { look, reason } = checkLook(payload?.look);
    if (!look) return fail(state, 'invalid_look', reason);
    o.look = look;
    reach(state, 1);
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
    const blocked = notDone(state) || needStep(state, 4) || busy(state, 'Finish or cancel your current action before moving in.');
    if (blocked) return blocked;
    const o = state.onboarding, outcome = outcomeOf(state);
    const home = typeof payload?.house === 'string' && Object.hasOwn(START_HOMES, payload.house) ? START_HOMES[payload.house] : null;
    if (!home) return fail(state, 'invalid_house', `Choose a starting home: ${Object.values(START_HOMES).map((item) => `${item.label} (${item.district})`).join(', ')}.`);
    const locked = homeLock(outcome, home.id);
    if (locked) return fail(state, 'house_locked', locked);
    if (o.traits.length !== TRAITS_REQUIRED || !o.dream) return fail(state, 'step_required', 'Choose your two traits and a dream before moving in.');
    const startCash = outcome.startCash[home.id];
    const grant = Math.max(0, startCash - o.seed);
    if (!Number.isSafeInteger(state.cash + grant)) return fail(state, 'balance_limit', 'Your saved balance has reached its supported limit.');

    o.house = home.id; o.done = true; o.step = DONE_STEP; o.completedAt = finite(ctx.now) ? ctx.now : state.t;
    o.wardrobe = wardrobeOf(o.wardrobe, o.look);
    for (const [skill, level] of Object.entries(outcome.skills || {})) setSkillLevel(state, skill, level);
    changeNeeds(state, Object.fromEntries(Object.entries(START_NEEDS).map(([need, value]) => [need, value - state.needs[need]])));
    credit(state, grant, `Start cash · ${home.label}, ${home.district}${outcome.loan ? ` (includes ${naira(outcome.loan.principal)} LAPO loan)` : ''}`, ctx);
    arrive(state, 'home', ctx, { mode: null });
    emit(state, 'life.started', { body: o.look.body, traits: [...o.traits], dream: o.dream, lottery: outcome.id, house: home.id,
      look: { ...o.look }, loan: outcome.loan ? { ...outcome.loan } : null, rent: home.rent, startCash }, ctx);
    state.message = `Welcome to ${home.district}. You moved into your ${home.label} with ${naira(state.cash)}.`;
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
    if (Object.keys(look).every((field) => look[field] === o.look[field])) return ok(state, 'unchanged');
    o.look = look;
    state.message = 'Look updated.';
    return ok(state, 'look_saved');
  },
  'onboarding.boutique-buy'(state, payload, ctx) {
    const blocked = mustBeDone(state);
    if (blocked) return blocked;
    const o = state.onboarding, kind = payload?.kind, id = payload?.id;
    if (!KINDS.includes(kind) || typeof id !== 'string' || !Object.hasOwn(BOUTIQUE_PRICES[kind], id)) return fail(state, 'invalid_item', 'Choose a hairstyle, outfit or fabric from the Boutique list.');
    if (!optionsFor(kind, o.look.body).includes(id)) {
      return fail(state, 'wrong_body', `${name(id)} is not made for the ${o.look.body} body. Switch body in Sim → Profile first.`);
    }
    if (o.wardrobe[kind].includes(id)) return fail(state, 'already_owned', `You already own ${name(id)}. Put it on in Sim → Profile.`);
    const price = BOUTIQUE_PRICES[kind][id];
    if (!canAfford(state, price)) return fail(state, 'insufficient_funds', `${name(id)} costs ${naira(price)}; you have ${naira(state.cash)}.`);
    debit(state, price, `Boutique: ${name(id)} ${kind === 'hair' ? 'hairstyle' : kind}`, ctx);
    o.wardrobe[kind].push(id);
    o.look = { ...o.look, [kind]: id };
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
    const base = { done: false, legacy: false, required: false, step: 0, seed: state.cash, look: { ...DEFAULT_LOOK }, traits: [], dream: null, lottery, house: null,
      wardrobe: null, completedAt: null, bonusAt: 0 };
    if (ctx?.isNew) {
      // A brand-new life: only the lottery roll may be carried in (see the header).
      base.required = ctx.requireOnboarding === true;
    } else if (!isRecord(raw) || typeof raw.done !== 'boolean') {
      // Saved before character creation existed: onboarded as-is, nothing taken away.
      Object.assign(base, { done: true, legacy: true, step: DONE_STEP });
    } else {
      base.look = checkLook(raw.look).look ?? base.look;
      base.traits = Array.isArray(raw.traits) ? [...new Set(raw.traits.filter((id) => typeof id === 'string' && Object.hasOwn(TRAITS, id)))].slice(0, TRAITS_REQUIRED) : [];
      base.dream = typeof raw.dream === 'string' && Object.hasOwn(DREAMS, raw.dream) ? raw.dream : null;
      base.house = typeof raw.house === 'string' && Object.hasOwn(START_HOMES, raw.house) ? raw.house : null;
      base.seed = safeCount(raw.seed) ? raw.seed : state.cash;
      base.done = raw.done;
      base.required = raw.required === true;
      base.legacy = raw.done && raw.legacy === true;
      base.completedAt = raw.done && finite(raw.completedAt) && raw.completedAt >= 0 ? raw.completedAt : null;
      base.bonusAt = finite(raw.bonusAt) && raw.bonusAt >= 0 ? raw.bonusAt : 0;
      if (raw.done) base.step = DONE_STEP;
      else {
        // The step can never be ahead of what has actually been chosen.
        const limit = base.traits.length !== TRAITS_REQUIRED ? 1 : !base.dream ? 2 : !lottery ? 3 : 4;
        base.step = Number.isInteger(raw.step) ? Math.min(Math.max(raw.step, 0), limit) : 0;
      }
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
    /** A life that must be created first accepts nothing but the creation steps. */
    'action.block'(value, state, data) {
      const o = state.onboarding;
      if (value || !o?.required || o.done || (typeof data?.type === 'string' && data.type.startsWith('onboarding.'))) return value;
      return { code: 'onboarding_required', reason: `Finish creating your Sim first: you are on the ${ONBOARDING_STEPS[Math.min(o.step, ONBOARDING_STEPS.length - 1)].label} step. Nothing else can be done until you have moved in.` };
    },
  },
  on: {
    'activity.completed'(state, data, ctx) {
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
    return {
      done: o.done, legacy: o.legacy, required: o.required && !o.done, step: o.step, steps: ONBOARDING_STEPS, look: { ...o.look }, traits: [...o.traits], dream: o.dream, house: o.house,
      lottery: outcome ? { id: outcome.id, label: outcome.label, icon: outcome.icon, tagline: outcome.tagline, bullets: outcome.bullets, beta: Boolean(outcome.beta), at: o.lottery.at } : null,
      homes: Object.values(START_HOMES).map((home) => {
        const locked = outcome ? homeLock(outcome, home.id) : null;
        return { ...home, startCash: outcome && !locked ? outcome.startCash[home.id] : null, locked };
      }),
      wardrobe: { hair: [...o.wardrobe.hair], outfit: [...o.wardrobe.outfit], fabric: [...o.wardrobe.fabric] },
      boutique: KINDS.flatMap((kind) => optionsFor(kind, o.look.body).map((id) => {
        const owned = o.wardrobe[kind].includes(id), price = BOUTIQUE_PRICES[kind][id];
        const blocked = !o.done ? 'Finish creating your Sim first.' : owned ? null
          : !canAfford(state, price) ? `Costs ${naira(price)}; you have ${naira(state.cash)}.` : null;
        return { kind, id, label: name(id), price, owned, wearing: o.look[kind] === id, blocked };
      })),
      mood: { word: word.word, tone: word.tone, icon: word.icon, score: mood.score },
      feelings: feelingsOf(state).map((feeling) => ({ ...feeling, line: FEELING_LINES[feeling.id] ?? '' })),
    };
  },
};
