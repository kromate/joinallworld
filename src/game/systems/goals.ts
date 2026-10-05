import { dreamFor, dreamsFor } from '../cities/characterContent.ts';
import { contentFor, venueFor, venuesFor, jobFor } from '../cities/runtime.ts';
/**
 * OWNER: character
 * Starter goal chain, the rolling next-step guide, wishes, stars, perks and the lifetime dream.
 * Everything is driven by registry events; perks act through modifiers.
 *
 * STATE — state.goals
 *   started    boolean — the starter chain is running. For a guest of the quick start it runs from
 *              the first moment (the opening goals are played in public, before there is a home).
 *              For any other life it starts on 'life.started', at the first home goal; a life saved
 *              before character creation existed skips the tutorial rewards and goes straight to
 *              the rolling guide.
 *   chain      index in STARTER_GOALS of the current starter goal (STARTER_GOALS.length = finished)
 *   cv         2 — the version of the goal order `chain` counts in. A save without it counted in the
 *              order before the quick start (seven goals, "Eat something" first): its index is
 *              moved past the opening goals when it loads, and those are never paid to it.
 *   seen       [goalId] — later goals whose condition already happened; they pay as soon as the
 *              chain reaches them, so nobody is stuck on a step they did early
 *   stars      unspent stars
 *   perks      [perkId] owned
 *   wishes     [{ id, n, day }] — up to 3 active wishes; n = progress, day = Lagos day n counts for
 *   rerolls    { day, used } — wish re-rolls used on that Lagos day
 *   granted    number of wishes that have come true
 *   dream      dream id | null;  dreamDone  boolean (its reward was paid)
 *   stats      { friends, best, level, levelCap, assets, debt, cchub, funded } — what the dream
 *              formulas measure, collected from other systems' events
 *   besties    [id] — best friends already counted, so a friend reported as 'friend.made'
 *              { best: true }, as 'friend.best' and by every 'relationship.changed' { tier: 'paddy' }
 *              at or above that tier counts once (events that carry
 *              no id — `id`, `friend`, `npc` or `player` — cannot be told apart and each count)
 *   seq, feed  feed = last few [{ n, text }] announcements (goal complete, wish granted, …);
 *              n counts up from seq so the UI can toast each one once
 *
 * ACTIONS
 *   'goals.buy-perk'    { id }     spend stars on a perk
 *   'goals.reroll-wish' { slot }   swap one wish for another (free, WISH_REROLLS_PER_DAY per Lagos day)
 *   'goals.set-dream'   { dream }  only for a life that has no dream yet (one saved before dreams existed)
 *
 * LISTENS TO  activity.completed, meal.eaten, item.bought, job.applied, shift.completed,
 *   promotion { job, level, role, top?, maxLevel? }, loan.paid, npc.greeted,
 *   friend.made { id?, best? }, friend.best { id? }, relationship.changed { id, value, tier }, travel.arrived, venue.visited, wallet.changed, skill.levelup, life.started.
 *   Also registered, with no effect yet: house.moved, car.bought, rent.paid.
 * EMITS  'goal.completed' { id, cash, stars } · 'wish.granted' { id, stars } ·
 *        'perk.bought' { id, cost } · 'dream.completed' { id }
 * MODIFIERS contributed by owned perks: needs.decayRate, skills.xpRate, activity.cost,
 *   activity.reward, travel.fare, shop.price, social.gain, career.performance;
 *   activity.block for the one-off startup pitch; and career.autoCommute, which holds the
 *   automatic commute while the starter chain has not reached "Work a shift" yet, so applying
 *   for a job never whisks a new player away in the middle of the tutorial.
 *
 * Every cash reward goes through the wallet with its own ledger line ("Goal: Freshen up").
 * A starter goal pays exactly once: the chain index moves on before the reward is credited.
 */
import type {
  ActivityDefinition, ActiveWish, ChipTarget, DreamId, GoalChip, GoalsView, LifeContext, LifeState, LotteryId, NeedId, PerkDefinition, PerkId, SpotDefinition,
  StarterGoal, StarterGoalCondition, StarterGoalId, SystemDefinition, VenueId, WishDefinition,
} from '../../types/index.ts';
import { emit, modify, occupiesVenue } from '../registry.ts';
import { cap, fail, finite, isRecord, naira, ok, safeCount } from '../util.ts';
import { lagosTime } from '../clock.ts';
import { blockReason, credit, MAX_LEVEL, NEEDS, skillLevel, spotsOf, xpForLevel } from '../api.ts';
import { fxModifiers } from '../character-effects.ts';
import { GUIDE_LOW_NEED, PERKS, STARTER_GOALS, STARTER_INTRO, WISHES, WISH_REROLLS_PER_DAY, WISH_SLOTS, WISH_STARS } from '../content/goals.ts';
import { DREAMS, DREAM_REWARD, DREAM_TARGETS, LOTTERY } from '../content/traits.ts';

const FEED_LIMIT = 8;
/** Where the guide sends a player who has to meet someone and is at home: the public venue new players arrive in. */
const BESTIE_LIMIT = 16;
const MAX_STARS = 1000000;
const PITCH_TAG = 'startup-pitch';
const pitchVenueFor = (cityId: string) => { const workplace = jobFor(cityId, 'tech')?.workplace.venue; return (workplace ? venueFor(cityId, workplace) : undefined) ?? venuesFor(cityId).find(venue => venue.scene.kind === 'hub'); };
/** Relationship tiers (ids used by the social system's 'relationship.changed') that count as a best friend. */
const BEST_TIERS: readonly unknown[] = ['paddy', 'bae'];
const perkById: Record<string, PerkDefinition> = Object.fromEntries(PERKS.map((perk) => [perk.id, perk]));
const goalsFor = (state: LifeState) => contentFor(state.estate.city).starterGoals;
const wishesFor = (state: LifeState) => contentFor(state.estate.city).wishes;
const wishTable = (state: LifeState): Record<string, WishDefinition> => Object.fromEntries(wishesFor(state).map(wish => [wish.id, wish]));
const goalIdsFor = (state: LifeState): readonly string[] => goalsFor(state).map(goal => goal.id);
const wishOf = (id: string, state: LifeState): WishDefinition => {
  const wish = wishTable(state)[id];
  if (!wish) throw new TypeError(`No wish ${id}`);
  return wish;
};
const goalAt = (index: number, state: LifeState): StarterGoal => {
  const goal = goalsFor(state)[index];
  if (!goal) throw new TypeError(`No starter goal ${index}`);
  return goal;
};
const isDream = (value: unknown): value is DreamId => typeof value === 'string' && Object.hasOwn(DREAMS, value);
const isLottery = (value: unknown): value is LotteryId => typeof value === 'string' && Object.hasOwn(LOTTERY, value);
/** The part of a context these helpers read: tests and sanitize pass `{ now }` alone. */
interface Clock { now?: number }
/** Event data: read defensively, tests and other owners may emit partial data. */
type Data = Record<string, unknown>
const nowOf = (state: LifeState, ctx?: Clock): number => (finite(ctx?.now) ? ctx.now : state.t);
const today = (state: LifeState, ctx?: Clock): number => lagosTime(nowOf(state, ctx)).day;
const count = (value: unknown, max = Number.MAX_SAFE_INTEGER): number => (safeCount(value) ? Math.min(value, max) : 0);

function note(state: LifeState, text: string): void {
  const g = state.goals;
  g.seq += 1;
  g.feed.push({ n: g.seq, text });
  if (g.feed.length > FEED_LIMIT) g.feed.splice(0, g.feed.length - FEED_LIMIT);
}
function addStars(state: LifeState, amount: number): void { state.goals.stars = Math.min(MAX_STARS, state.goals.stars + amount); }

// ---- starter chain ------------------------------------------------------------------------
function goalMet(state: LifeState, goal: StarterGoal): boolean {
  if (state.goals.seen.includes(goal.id)) return true;
  if (goal.done.hasJob && state.job) return true;
  return Boolean(goal.done.venue) && occupiesVenue(state, goal.done.venue);
}

// Rewards raise wallet events that land back here. The outer loop already pays every goal that
// is due, so nested calls return at once instead of nesting one event deeper per goal.
let chaining = false;
function progressChain(state: LifeState, ctx: LifeContext): void {
  const g = state.goals;
  if (chaining || !g.started) return;
  chaining = true;
  try {
    while (g.chain < goalsFor(state).length && goalMet(state, goalAt(g.chain, state))) {
      const goal = goalAt(g.chain, state);
      g.chain += 1; // move on first: whatever the reward triggers can never pay this goal again
      g.seen = g.seen.filter((id) => goalIdsFor(state).indexOf(id) >= g.chain);
      addStars(state, goal.stars);
      const paid = credit(state, goal.cash, `Goal: ${goal.title}`, ctx);
      note(state, `Goal complete: ${goal.title} · ${paid ? `+${naira(goal.cash)} ` : ''}+${goal.stars}✨`);
      emit(state, 'goal.completed', { id: goal.id, cash: paid ? goal.cash : 0, stars: goal.stars }, ctx);
    }
  } finally { chaining = false; }
}

function markSeen(state: LifeState, test: (done: StarterGoalCondition, goal: StarterGoal) => boolean): void {
  const g = state.goals;
  for (let i = g.chain; i < goalsFor(state).length; i++) {
    const goal = goalAt(i, state);
    if (goal.done.fresh && i !== g.chain) continue; // counts only while it is the current goal
    if (!g.seen.includes(goal.id) && test(goal.done, goal)) g.seen.push(goal.id);
  }
}

/**
 * Did the activity that just finished complete a goal that names one (`done.activity`)? The named activity always does.
 * A goal that is done `here` (wherever the player stands) also accepts the kind of thing its chip points at when the
 * named one cannot be done: away from the goal's venue, or while the named activity cannot be started there (the venue
 * is closed, say) — a free, unpaid pastime that is not work. So the goal is completed by what the chip asked for, a
 * paid gig or a shift never ticks it by accident, and a player is never left with a goal that cannot be met.
 */
function intended(state: LifeState, goal: StarterGoal, data: Data | undefined, ctx: LifeContext): boolean {
  if (data?.id === goal.done.activity) return true;
  if (!goal.here) return false;
  const def = data?.def;
  if (!isRecord(def) || def.cost || def.reward || def.requiresJob || def.home) return false;
  if (!goal.go) throw new TypeError('A goal done here has a place to go'); // the original read goal.go[0] of undefined
  if (state.location !== goal.go[0]) return true;
  const named = spotsOf(goal.go[0], ctx.cityId).flatMap((spot) => spot.activities).find((item) => item.id === goal.done.activity);
  return !named || Boolean(blockReason(state, named, goal.go[0], ctx));
}

// ---- wishes -------------------------------------------------------------------------------
const wishTarget = (wish: WishDefinition): number => (wish.on === 'earn' ? wish.amount : 'count' in wish ? wish.count ?? 1 : 1);
/** `def` is a whole activity, or the `{ id, tags }` of one that just finished. */
const activityFits = (wish: Extract<WishDefinition, { on: 'activity' }>, def: { id?: unknown; tags?: readonly unknown[] }, spotId: unknown): boolean => Boolean(def) && ((wish.activity && def.id === wish.activity) || (wish.spot && spotId === wish.spot)
  || (Array.isArray(wish.tags) && Array.isArray(def.tags) && wish.tags.some((tag) => def.tags?.includes(tag))));

/** A wish is only handed out while the game actually contains a way to fulfil it. */
function attainable(state: LifeState, wish: WishDefinition): boolean {
  if (wish.on === 'visit') return Boolean(venueFor(state.estate.city, wish.venue)) && state.location !== wish.venue;
  if (wish.on !== 'activity') return true;
  if (!Boolean(venueFor(state.estate.city, wish.venue))) return false;
  return spotsOf(wish.venue, state.estate.city).some((spot) => spot.activities.some((def) => !def.unavailable && activityFits(wish, def, spot.id)));
}

/** Next wish for a free slot: random with `rng`, first in pool order without. Null if the pool is exhausted. */
function pickWish(state: LifeState, rng?: () => number, avoid?: string): ActiveWish | null {
  const active = new Set(state.goals.wishes.map((wish) => wish.id));
  const pool = wishesFor(state).filter((wish) => !active.has(wish.id) && wish.id !== avoid && attainable(state, wish));
  if (!pool.length) return null;
  const wish = rng ? pool[Math.floor(rng() * pool.length) % pool.length] : pool[0];
  if (!wish) return null; // the pool is not empty and the index is in range
  return { id: wish.id, n: 0, day: today(state) };
}

function fillWishes(state: LifeState, ctx: Clock & { rng?: () => number }): void {
  const g = state.goals;
  while (g.wishes.length < WISH_SLOTS) {
    const next = pickWish(state, ctx?.rng);
    if (!next) break;
    next.day = today(state, ctx);
    g.wishes.push(next);
  }
}

function grantWish(state: LifeState, slot: number, ctx: LifeContext): void {
  const g = state.goals, wish = wishOf(g.wishes[slot]?.id ?? '', state); // slot is the index of an active wish
  const stars = WISH_STARS + g.perks.reduce((sum, id) => sum + (perkById[id]?.wishBonus ?? 0), 0);
  addStars(state, stars);
  g.granted = count(g.granted + 1);
  const next = pickWish(state, ctx?.rng, wish.id);
  if (next) { next.day = today(state, ctx); g.wishes[slot] = next; } else g.wishes.splice(slot, 1);
  note(state, `Wish granted: ${wish.label} · +${stars}✨`);
  emit(state, 'wish.granted', { id: wish.id, stars }, ctx);
}

/** Add progress to every active wish that `test` accepts; grant those that reach their target. */
function bumpWishes(state: LifeState, ctx: LifeContext, test: (wish: WishDefinition) => boolean, amount = 1): void {
  const g = state.goals, day = today(state, ctx);
  for (const entry of [...g.wishes]) {
    const wish = wishTable(state)[entry.id];
    if (!wish || !test(wish)) continue;
    if (wish.on === 'earn' && entry.day !== day) { entry.n = 0; entry.day = day; }
    entry.n = count(entry.n + amount);
    const slot = g.wishes.indexOf(entry);
    if (slot >= 0 && entry.n >= wishTarget(wish)) grantWish(state, slot, ctx);
  }
}

// ---- dream --------------------------------------------------------------------------------
function skillFraction(state: LifeState, skill: 'music' | 'coding'): number {
  const xp = state.skills?.[skill] ?? 0, level = skillLevel(state, skill);
  if (level >= MAX_LEVEL) return MAX_LEVEL;
  const floor = xpForLevel(level), next = xpForLevel(level + 1);
  return level + (xp - floor) / (next - floor);
}

/** Dream progress 0–1 (original beta formulas; the completion conditions themselves are fixed). */
export function dreamProgress(state: LifeState): number {
  const g = state.goals, s = g.stats, T = DREAM_TARGETS;
  const table: Record<DreamId, () => number> = {
    'oga-at-the-top': () => s.level / (s.levelCap || T.careerTopLevel),
    'lekki-landlord': () => Math.max(0, state.cash + s.assets - s.debt) / T.netWorth,
    'afrobeats-star': () => skillFraction(state, 'music') / MAX_LEVEL,
    'everybodys-padi': () => (Math.min(T.bestFriends, s.friends) + Math.min(T.bestFriends, s.best)) / (2 * T.bestFriends),
    'yaba-unicorn': () => (s.funded ? 1 : Math.min(0.85, 0.6 * Math.min(1, skillFraction(state, 'coding') / T.codingLevel)
      + 0.2 * Math.min(1, skillLevel(state, 'hustle') / T.hustleLevel) + (s.cchub ? 0.05 : 0))),
  };
  const value = g.dream ? table[g.dream] : undefined;
  return value ? Math.min(1, Math.max(0, value())) : 0;
}

function checkDream(state: LifeState, ctx: LifeContext): void {
  const g = state.goals;
  if (!g.dream || g.dreamDone || dreamProgress(state) < 1) return;
  g.dreamDone = true; // set first: the reward's own wallet event must not pay it again
  addStars(state, DREAM_REWARD.stars);
  const paid = credit(state, DREAM_REWARD.cash, `Dream achieved: ${dreamFor(state.estate.city, g.dream).label}`, ctx);
  note(state, `Dream achieved: ${dreamFor(state.estate.city, g.dream).label} · ${paid ? `+${naira(DREAM_REWARD.cash)} ` : ''}+${DREAM_REWARD.stars}✨`);
  emit(state, 'dream.completed', { id: g.dream }, ctx);
}

// ---- events -------------------------------------------------------------------------------
/** Record the size of the career ladder when an event carries it. Returns true if it did. */
function ladderSize(state: LifeState, data: Data | undefined): boolean {
  if (!safeCount(data?.maxLevel) || data.maxLevel <= 0) return false;
  state.goals.stats.levelCap = Math.min(data.maxLevel, 100);
  return true;
}

const friendKey = (data: Data | undefined): string | null => [data?.id, data?.friend, data?.npc, data?.player].find((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 80) ?? null;
/** Count one best friend; the same friend id is never counted twice. */
function countBest(state: LifeState, data: Data | undefined): void {
  const g = state.goals, key = friendKey(data);
  if (key) {
    if (g.besties.includes(key)) return;
    if (g.besties.length < BESTIE_LIMIT) g.besties.push(key);
  }
  g.stats.best = count(g.stats.best + 1, 999);
}

const EARNING_EXCLUDED = /^(Refund|Start cash)/;

function arrived(state: LifeState, venue: unknown, ctx: LifeContext): void {
  if (typeof venue !== 'string') return;
  if (venue === pitchVenueFor(ctx.cityId)?.id) state.goals.stats.cchub = true;
  markSeen(state, (done) => done.venue === venue);
  bumpWishes(state, ctx, (wish) => wish.on === 'visit' && wish.venue === venue);
}

type Handler = (state: LifeState, data: Data, ctx: LifeContext) => void;
const HANDLERS: Record<string, Handler | undefined> = {
  'activity.completed'(state, data, ctx) {
    const tags: unknown[] = Array.isArray(data?.tags) ? data.tags : [];
    const def = { id: data?.id, tags };
    markSeen(state, (done, goal) => typeof done.activity === 'string' && intended(state, goal, data, ctx));
    markSeen(state, (done) => Array.isArray(done.tags) && done.tags.some((tag) => tags.includes(tag)));
    bumpWishes(state, ctx, (wish) => wish.on === 'activity' && state.location === wish.venue && activityFits(wish, def, state.spot));
    if (tags.includes(PITCH_TAG) && !state.goals.stats.funded) {
      state.goals.stats.funded = true;
      const paid = credit(state, DREAM_TARGETS.funding, `Startup funding from ${pitchVenueFor(ctx.cityId)?.label ?? 'the local hub'}`, ctx);
      note(state, `Your startup is funded${paid ? ` · +${naira(DREAM_TARGETS.funding)}` : ''}`);
    }
  },
  'promotion'(state, data) {
    const s = state.goals.stats;
    if (safeCount(data?.level)) s.level = Math.max(s.level, Math.min(data.level, 100));
    if (!ladderSize(state, data) && data?.top === true && s.level > 0) s.levelCap = s.level;
  },
  'shift.completed'(state, data) {
    const s = state.goals.stats;
    if (safeCount(data?.level)) s.level = Math.max(s.level, Math.min(data.level, 100));
    ladderSize(state, data);
  },
  'job.applied'(state, data) { ladderSize(state, data); },
  'item.bought'(state, data) {
    const s = state.goals.stats;
    if (safeCount(data?.price) && Number.isSafeInteger(s.assets + data.price)) s.assets += data.price;
  },
  'loan.paid'(state, data) { if (safeCount(data?.left)) state.goals.stats.debt = data.left; },
  'friend.made'(state, data) {
    const s = state.goals.stats;
    s.friends = count(s.friends + 1, 999);
    if (data?.best === true) countBest(state, data);
  },
  'friend.best'(state, data) { countBest(state, data); },
  // The social system reports closeness with the tier it has reached: Paddy Mi (or Bae) is a best friend.
  'relationship.changed'(state, data) { if (BEST_TIERS.includes(data?.tier)) countBest(state, data); },
  'travel.arrived'(state, data, ctx) { arrived(state, data?.venue, ctx); },
  'venue.visited'(state, data, ctx) { arrived(state, data?.venue, ctx); },
  'wallet.changed'(state, data, ctx) {
    if (!safeCount(data?.amount) || data.amount <= 0 || EARNING_EXCLUDED.test(String(data.reason ?? ''))) return;
    bumpWishes(state, ctx, (wish) => wish.on === 'earn', data.amount);
  },
  // Stars another system awards (missions, the stamp card): bounded per grant, counted like any other star.
  'stars.granted'(state, data) { if (safeCount(data?.amount) && data.amount <= 50) addStars(state, data.amount); },
  'life.started'(state, data) {
    const g = state.goals;
    // A life that was never a guest starts its chain here, at the first home goal (the opening goals are the quick start's).
    if (!g.started) { g.started = true; g.chain = Math.max(g.chain, STARTER_INTRO); }
    if (isDream(data?.dream)) g.dream = data.dream;
    const loan = data?.loan, lottery = data?.lottery;
    const owed = (isRecord(loan) ? loan.owed : undefined) ?? (isLottery(lottery) ? LOTTERY[lottery].loan?.owed : undefined);
    if (safeCount(owed)) g.stats.debt = owed;
  },
};
const EVENTS = ['activity.completed', 'meal.eaten', 'item.bought', 'house.moved', 'car.bought', 'job.applied', 'shift.completed', 'promotion', 'rent.paid',
  'loan.paid', 'npc.greeted', 'friend.made', 'friend.best', 'relationship.changed', 'travel.arrived', 'venue.visited', 'wallet.changed', 'skill.levelup', 'life.started', 'stars.granted'];

function handle(event: string, state: LifeState, data: Data, ctx: LifeContext): void {
  HANDLERS[event]?.(state, data, ctx);
  markSeen(state, (done) => Array.isArray(done.events) && done.events.includes(event));
  bumpWishes(state, ctx, (wish) => wish.on === 'event' && wish.event === event);
  progressChain(state, ctx);
  checkDream(state, ctx);
}

// ---- the chip: current starter goal, then a rolling next step -----------------------------
const NEED_STEP: Record<NeedId, [icon: string, title: string]> = { hunger: ['🍲', 'Eat something'], energy: ['🛏️', 'Get some rest'], fun: ['🎉', 'Have some fun'], social: ['💬', 'Talk to someone'],
  hygiene: ['🫧', 'Freshen up'], bladder: ['🚽', 'Use the toilet'] };

/** The free, startable activity that raises `need` the most: Home first, then any other venue. */
interface Recovery { venue: VenueId; spot: SpotDefinition; fix: ActivityDefinition }
function recovery(state: LifeState, need: NeedId, ctx: LifeContext): Recovery | null {
  const gain = (def: ActivityDefinition): number => (def.effects?.[need] ?? 0) + (def.effectsPerSecond?.[need] ?? 0) * (def.duration ?? 0);
  const venues: VenueId[] = ['home', ...venuesFor(state.estate.city).map(venue => venue.id).filter((id): id is VenueId => id !== 'home')]; // the keys of VENUES are venue ids
  for (const venue of venues) {
    let best: Recovery | null = null;
    for (const spot of spotsOf(venue, ctx.cityId)) {
      for (const def of spot.activities) {
        if (def.unavailable || def.cost || def.requiresJob || def.requiresSkill || def.choices
          || Object.keys(def.minimumNeeds || {}).length || gain(def) <= 0) continue;
        // Never point at something that cannot be started or is not listed: no furniture for it, a closed venue, a cooldown…
        if (blockReason(state, def, venue, ctx) || modify(state, 'activity.hidden', false, { def }, ctx) === true) continue;
        if (!best || gain(def) > gain(best.fix)) best = { venue, spot, fix: def };
      }
    }
    if (best) return best;
  }
  return null;
}
/** The shortest free activity that can be started right now in the venue the player is in, or null. */
function quickest(state: LifeState, ctx: LifeContext): { spot: SpotDefinition; def: ActivityDefinition } | null {
  let best: { spot: SpotDefinition; def: ActivityDefinition } | null = null;
  for (const spot of spotsOf(state.location, ctx.cityId)) {
    for (const def of spot.activities) {
      if (def.unavailable || def.cost || def.reward || def.requiresJob || def.requiresSkill || def.choices || def.home || Object.keys(def.minimumNeeds || {}).length || !(def.duration > 0)) continue;
      if (blockReason(state, def, state.location, ctx) || modify(state, 'activity.hidden', false, { def }, ctx) === true) continue;
      if (!best || def.duration < best.def.duration) best = { spot, def };
    }
  }
  return best;
}
const workplaceOf = (state: LifeState): ChipTarget | null => { const at = state.job && state.career.city === state.estate.city ? jobFor(state.estate.city, state.job)?.workplace : undefined; return typeof at?.venue === 'string' ? [at.venue, at.spot] : null; };
const homeSpot = (id: string | undefined, cityId: string): ChipTarget => (spotsOf('home', cityId).some((spot) => spot.id === id) ? ['home', id] : ['home']);

function chipOf(state: LifeState, ctx: LifeContext): GoalChip {
  const g = state.goals;
  if (state.onboarding && !state.onboarding.done && state.onboarding.stage !== 'guest') {
    return { kind: 'create', icon: '✨', title: 'Create your Sim', hint: 'Choose your look, personality, dream and home', open: 'onboarding' };
  }
  const goal = g.started ? goalsFor(state)[g.chain] : null;
  if (goal) {
    const chip: Extract<GoalChip, { kind: 'goal' }> = { kind: 'goal', id: goal.id, icon: goal.icon, title: goal.title, hint: goal.hint, reward: `+${naira(goal.cash)} +${goal.stars}✨`,
      step: g.chain + 1, of: goalsFor(state).length };
    if (goal.here) {
      // Wherever the guest stands: the goal's own spot at its venue, otherwise the quickest free thing to do right here.
      if (!goal.go) throw new TypeError('A goal done here has a place to go'); // the original read goal.go[0] of undefined
      if (state.location === goal.go[0]) return { ...chip, go: goal.go, activity: goal.activity };
      const near = quickest(state, ctx);
      return near ? { ...chip, title: 'Do something fun', hint: `${near.spot.label} → ${near.def.label} · takes ${near.def.duration} seconds`, go: [state.location, near.spot.id], activity: near.def.id } : { ...chip, go: goal.go };
    }
    const workplace = workplaceOf(state);
    if (goal.workplace) return { ...chip, ...(workplace ? { go: workplace } : { open: 'jobs' }) };
    if (goal.open === 'buy' && state.location !== 'home') return { ...chip, go: ['home'] };
    // A goal that needs other people cannot be met at home (a player who settled in before saying hello is standing there):
    // the one line of guidance says so and points at the way out, instead of opening a list with nobody in it.
    const content = contentFor(state.estate.city);
    const meeting = content.venues.find(venue => venue.id !== 'home' && content.regulars.some(person => person.venueId === venue.id));
    if (goal.open === 'people' && state.location === 'home' && meeting) return { ...chip, hint: `Nobody else is at home: go out to ${meeting.name} and tap a person`, open: 'map', params: { destination: meeting.id } };
    if (goal.open) return { ...chip, open: goal.open, ...(goal.params ? { params: goal.params } : {}) };
    return goal.go ? { ...chip, go: goal.go[0] === 'home' && goal.go.length > 1 ? homeSpot(goal.go[1], state.estate.city) : goal.go } : chip;
  }
  const low = NEEDS.filter((need) => state.needs[need] < GUIDE_LOW_NEED).sort((a, b) => state.needs[a] - state.needs[b])[0];
  if (low) {
    const fix = recovery(state, low, ctx), [icon, title] = NEED_STEP[low];
    return { kind: 'guide', icon, title, hint: fix ? `${venueFor(state.estate.city, fix.venue)?.label ?? fix.venue} → ${fix.spot.label} → ${fix.fix.label}` : `${cap(low)} is low (${Math.floor(state.needs[low])}%)`,
      ...(fix ? { go: [fix.venue, fix.spot.id] } : {}) };
  }
  const perk = PERKS.filter((item) => !g.perks.includes(item.id) && item.cost <= g.stars).sort((a, b) => a.cost - b.cost)[0];
  if (perk) return { kind: 'guide', icon: '✨', title: 'Spend your stars', hint: `${perk.label} costs ${perk.cost}✨ — you have ${g.stars}✨`, open: 'goals' };
  if (!state.job) return { kind: 'guide', icon: '💼', title: 'Find a job', hint: 'Open Phone → Jobs', open: 'jobs' };
  const firstWish = g.wishes[0], wish = firstWish ? wishTable(state)[firstWish.id] : undefined;
  if (wish) return { kind: 'guide', icon: wish.icon, title: wish.label, hint: `${wish.hint} · +${WISH_STARS}✨`, open: 'goals' };
  if (g.dream && !g.dreamDone) return { kind: 'guide', icon: DREAMS[g.dream].icon, title: dreamFor(state.estate.city, g.dream).label, hint: `${Math.floor(dreamProgress(state) * 100)}% · ${dreamFor(state.estate.city, g.dream).goal}`, open: 'goals' };
  const workplace = workplaceOf(state);
  return { kind: 'guide', icon: '💼', title: 'Work a shift', hint: 'Earn towards your next upgrade', ...(workplace ? { go: workplace } : { open: 'jobs' }) };
}

function rerollsOf(state: LifeState, ctx: LifeContext) {
  const r = state.goals.rerolls, used = r.day === today(state, ctx) ? r.used : 0;
  return { used, left: Math.max(0, WISH_REROLLS_PER_DAY - used), max: WISH_REROLLS_PER_DAY };
}

const actions = {
  'goals.buy-perk'(state, payload, ctx) {
    // Own keys only: 'constructor' or '__proto__' must not resolve to something on Object.prototype
    // (that used to spend "undefined" stars and leave the star count as NaN until the next reload).
    const g = state.goals, perk = typeof payload?.id === 'string' && Object.hasOwn(perkById, payload.id) ? perkById[payload.id] : null;
    if (!perk) return fail(state, 'invalid_perk', 'Choose a perk from the Goals tab.');
    if (g.perks.includes(perk.id)) return fail(state, 'already_owned', `You already own ${perk.label}.`);
    if (g.stars < perk.cost) {
      return fail(state, 'insufficient_stars', `${perk.label} costs ${perk.cost}✨; you have ${g.stars}✨. Earn stars from goals (+1) and wishes (+${WISH_STARS}).`);
    }
    g.stars -= perk.cost;
    g.perks.push(perk.id);
    state.message = `Perk unlocked: ${perk.label} — ${perk.effect}.`;
    emit(state, 'perk.bought', { id: perk.id, cost: perk.cost }, ctx);
    return ok(state, 'perk_bought');
  },
  'goals.reroll-wish'(state, payload, ctx) {
    const g = state.goals, slot = payload?.slot;
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot >= g.wishes.length) return fail(state, 'invalid_wish', 'Choose one of your active wishes to re-roll.');
    if (rerollsOf(state, ctx).left <= 0) {
      return fail(state, 'no_rerolls', `You have used all ${WISH_REROLLS_PER_DAY} wish re-rolls for today. They reset at midnight, Lagos time.`);
    }
    const current = g.wishes[slot], old = current ? wishTable(state)[current.id] : undefined; // slot is in range
    const next = pickWish(state, ctx?.rng, old?.id);
    if (!next) return fail(state, 'no_other_wish', 'No other wish is available right now. Finish one of your wishes to see new ones.');
    next.day = today(state, ctx);
    g.wishes[slot] = next;
    g.rerolls = { day: today(state, ctx), used: rerollsOf(state, ctx).used + 1 };
    state.message = `New wish: ${wishOf(next.id, state).label}.`;
    return ok(state, 'rerolled');
  },
  'goals.set-dream'(state, payload, ctx) {
    const g = state.goals;
    if (g.dream) return fail(state, 'dream_already_chosen', `Your dream is already ${dreamFor(state.estate.city, g.dream).label}. A dream is chosen once per life.`);
    const dreamId = payload?.dream, dream = isDream(dreamId) ? dreamFor(state.estate.city, dreamId) : null;
    if (!dream) return fail(state, 'invalid_dream', `Choose one dream: ${dreamsFor(state.estate.city).map((item) => item.label).join(', ')}.`);
    g.dream = dream.id;
    state.message = `Dream chosen: ${dream.label}.`;
    checkDream(state, ctx);
    return ok(state, 'dream_saved');
  },
} satisfies NonNullable<SystemDefinition<'goals'>['actions']>;

const pitchReady = (state: LifeState): boolean => skillLevel(state, 'hustle') >= DREAM_TARGETS.hustleLevel;

export default {
  id: 'goals',
  stateKeys: ['goals'],
  sanitize(input, state, ctx) {
    const raw: Record<string, unknown> = isRecord(input.goals) ? input.goals : {};
    const stats: Record<string, unknown> = isRecord(raw.stats) ? raw.stats : {};
    const ids = <T extends string>(value: unknown, valid: (id: string) => id is T, max: number): T[] => [...new Set((Array.isArray(value) ? value.slice(0, 100) : []).filter((id): id is T => typeof id === 'string' && valid(id)))].slice(0, max);
    const guest = state.onboarding?.stage === 'guest';
    // A chain saved in the order before the quick start counts from "Eat something": move it past the opening goals.
    const shift = raw.cv === 2 || raw.started !== true ? 0 : STARTER_INTRO;
    const chain = typeof raw.chain === 'number' && Number.isInteger(raw.chain) ? Math.min(Math.max(raw.chain, 0) + shift, goalsFor(state).length) : 0;
    const dream = isDream(raw.dream) ? raw.dream : state.onboarding?.done ? state.onboarding.dream ?? null : null;
    const seq = count(raw.seq);
    state.goals = {
      started: raw.started === true || guest,
      chain,
      cv: 2,
      seen: ids(raw.seen, (id): id is StarterGoalId => goalIdsFor(state).indexOf(id) >= chain, goalsFor(state).length),
      stars: count(raw.stars, MAX_STARS),
      perks: ids(raw.perks, (id): id is PerkId => Object.hasOwn(perkById, id), PERKS.length),
      wishes: [],
      rerolls: isRecord(raw.rerolls) && typeof raw.rerolls.day === 'number' && Number.isInteger(raw.rerolls.day) && safeCount(raw.rerolls.used) ? { day: raw.rerolls.day, used: Math.min(raw.rerolls.used, WISH_REROLLS_PER_DAY) } : { day: 0, used: 0 },
      granted: count(raw.granted),
      dream,
      dreamDone: Boolean(dream) && raw.dreamDone === true,
      stats: { friends: count(stats.friends, 999), best: count(stats.best, 999), level: count(stats.level, 100), levelCap: count(stats.levelCap, 100),
        assets: count(stats.assets), debt: count(stats.debt), cchub: stats.cchub === true, funded: stats.funded === true },
      besties: ids(raw.besties, (id): id is string => id.length > 0 && id.length <= 80, BESTIE_LIMIT),
      seq,
      feed: (Array.isArray(raw.feed) ? raw.feed.slice(-FEED_LIMIT) : []).filter((item): item is Record<string, unknown> & { n: number; text: string } => isRecord(item) && safeCount(item.n) && item.n <= seq && typeof item.text === 'string')
        .map((item) => ({ n: item.n, text: item.text.slice(0, 160) })),
    };
    const seenWish = new Set<string>();
    for (const item of Array.isArray(raw.wishes) ? raw.wishes.slice(0, WISH_SLOTS * 4) : []) {
      if (!isRecord(item) || typeof item.id !== 'string' || !Object.hasOwn(wishTable(state), item.id) || seenWish.has(item.id) || state.goals.wishes.length >= WISH_SLOTS) continue;
      seenWish.add(item.id);
      state.goals.wishes.push({ id: item.id, n: count(item.n), day: typeof item.day === 'number' && Number.isInteger(item.day) ? item.day : today(state, ctx) });
    }
    // First wishes are the first attainable ones in pool order (no randomness), so every new life starts alike.
    fillWishes(state, { now: ctx?.now });
  },
  actions,
  advance(state, dt, ctx) {
    fillWishes(state, ctx);
    progressChain(state, ctx);
    checkDream(state, ctx);
  },
  on: { ...Object.fromEntries(EVENTS.map((event) => [event, (state: LifeState, data: Data, ctx: LifeContext) => handle(event, state, data, ctx)])),
    'city.changed': (state, _data, ctx) => { state.goals.wishes = state.goals.wishes.filter(wish => Boolean(wishTable(state)[wish.id])); fillWishes(state, ctx); },
  },
  modifiers: {
    ...fxModifiers((state: LifeState) => state.goals.perks.map((id) => perkById[id]?.fx)),
    'career.autoCommute'(value, state) {
      const g = state.goals;
      return value && !(g.started && g.chain < goalsFor(state).findIndex((goal) => goal.workplace));
    },
    'activity.block'(value, state, data) {
      if (value || !data?.def?.tags?.includes(PITCH_TAG)) return value;
      if (state.goals.stats.funded) return { code: 'already_funded', reason: 'Your startup is already funded. Investors only write the first cheque once.' };
      return pitchReady(state) ? null : { code: 'skill_required', reason: `Requires Hustle level ${DREAM_TARGETS.hustleLevel} (yours is ${skillLevel(state, 'hustle')}) as well as Coding level ${DREAM_TARGETS.codingLevel}.` };
    },
  },
  activitiesFor: (cityId) => { const hub = pitchVenueFor(cityId); return hub ? [{
    id: 'dream-startup-pitch', label: 'Pitch your startup', icon: '🦄', duration: 20, cost: 0, requiresSkill: { id: 'coding', level: DREAM_TARGETS.codingLevel },
    tags: [PITCH_TAG], beta: true, note: 'Original beta activity: a one-off pitch that funds your startup.',
    where: { venue: hub.id, spot: 'pitch-room', spotLabel: 'Pitch room', spotIcon: '🦄' },
  }] : []; },
  view(state, ctx) {
    const g = state.goals, day = today(state, ctx), rerolls = rerollsOf(state, ctx), goal = (g.started && goalsFor(state)[g.chain]) || null;
    const progress = dreamProgress(state);
    return {
      chip: chipOf(state, ctx),
      chain: { started: g.started, index: g.chain, total: goalsFor(state).length, finished: g.started && g.chain >= goalsFor(state).length,
        current: goal ? { id: goal.id, title: goal.title, hint: goal.hint, icon: goal.icon, cash: goal.cash, stars: goal.stars } : null },
      stars: g.stars,
      perks: PERKS.map((perk) => {
        const owned = g.perks.includes(perk.id);
        return { id: perk.id, label: perk.label, icon: perk.icon, cost: perk.cost, effect: perk.effect, beta: Boolean(perk.beta), owned,
          blocked: owned ? 'Owned' : g.stars < perk.cost ? `Needs ${perk.cost}✨ — you have ${g.stars}✨ (${perk.cost - g.stars} more)` : null };
      }),
      wishes: g.wishes.map((entry, slot) => {
        const wish = wishOf(entry.id, state), target = wishTarget(wish);
        const n = wish.on === 'earn' && entry.day !== day ? 0 : Math.min(entry.n, target);
        return { slot, id: wish.id, label: wish.label, hint: wish.hint, icon: wish.icon, stars: WISH_STARS, progress: n, target, money: wish.on === 'earn', beta: Boolean(wish.beta) };
      }),
      rerolls: { ...rerolls, blocked: rerolls.left > 0 ? null : `No re-rolls left today (${WISH_REROLLS_PER_DAY} a day). They reset at midnight, Lagos time.` },
      granted: g.granted,
      dream: g.dream ? { ...dreamFor(state.estate.city, g.dream), progress, percent: Math.floor(progress * 100), done: g.dreamDone, reward: DREAM_REWARD } : null,
      dreams: g.dream ? [] : dreamsFor(state.estate.city),
      feed: g.feed.map((item) => ({ ...item })),
      seq: g.seq,
    };
  },} satisfies SystemDefinition<'goals'>;
