/**
 * OWNER: home
 * The home interior: a grid room sized by the house, placed furniture, Buy mode, the shared
 * kitchen and groceries, and the actions furniture offers.
 *
 * State key `home`
 *   items    [{ id, itemId, x, y, rot }] placed furniture (placement rules: ../home-layout.ts)
 *   storage  { [itemId]: count } furniture that is owned but not placed (it did not fit after a
 *            move, or the player stored it). Storage is never emptied except by placing or selling.
 *   seq      next number for a placed object's id ('f<seq>')
 *   stocked  whether the starter kitchen ingredients have been handed out
 *   custom   whether the player has rearranged anything (a fresh room is re-laid at life.started)
 *   boost    null | { id, mult, done, finished } — bookkeeping for the quality bonus on a
 *            per-second activity (sleep) that is running
 * Which house the player lives in is `state.property.house` (systems/property.ts).
 * Kitchen ingredients are ordinary inventory items (state.inventory; ids in content/food.ts).
 *
 * Actions — all return a code and, when refused, a reason naming what is missing
 *   'home.furniture-buy'   { item, x, y, rot }   at home only; charged when placed, through the wallet
 *                                           ledger, at modify('shop.price', price, { item, kind: 'furniture' })
 *   'home.furniture-move'  { id, x, y, rot }     move / rotate a placed object (free)
 *   'home.furniture-sell'  { id } | { item }     sell a placed object, or one from storage, for
 *                                           SELL_REFUND_RATE of its list price
 *   'home.furniture-store' { id }                put a placed object into storage (free)
 *   'home.furniture-place' { item, x, y, rot }   place an object from storage (free)
 *   'home.grocery-buy'     { id, packs? }        buy ingredient packs anywhere; delivered to the kitchen
 *                                           at once, at modify('shop.price', total, { item, kind: 'grocery' })
 *   'home.kitchen-unpack'  {}                    hand out the starter ingredients if that has not happened
 *
 * Furniture actions run on the shared activity engine. Activity ids are `home-<id>`
 * (content/furniture.ts HOME_ACTIVITIES and content/food.ts RECIPES); each carries
 * `home: { kind, recipe? }` and is attached to a home spot: the ported `kitchen`, `bathroom`
 * and `bedroom`, plus `living` and `study` added here. They are blocked through
 * 'activity.block' with code 'furniture_required' until an object of that kind is placed, and
 * recipes with 'missing_items' naming the ingredients (the engine reports a skill lock first).
 *
 * ORIGINAL RULES (not reference facts)
 *   - Ingredients are used when a meal FINISHES, together with its effects. Cancelling a
 *     recipe, or reloading mid-cook, costs nothing.
 *   - Star rating scales results: positive effects, per-second gains and XP of an action are
 *     multiplied by STAR_MULTIPLIER of the best placed object of that kind (and by POWER_BONUS
 *     for powered kinds while a generator or inverter is placed). A one-star object gives
 *     exactly the listed amounts.
 *   - Selling returns half the list price. Moving house re-fits furniture; whatever does not
 *     fit goes to storage.
 *
 * Emits   'item.bought' { id, item, price, kind: 'furniture' | 'grocery', count? }
 *         'item.sold'   { id, refund }
 *         'meal.eaten'  { id, source: 'home' }   (id is the recipe id, or the activity id for a
 *                                                 ported food activity eaten at home)
 * One kitchen: the ported free "Eat Dry Garri" is the fallback that keeps the never-hungry promise
 * (needs.ts). It is hidden (modifier 'activity.hidden') while the cooler can make Soak Garri &
 * Sugar, so the kitchen never lists the same bowl twice; a save that is mid-way through it still loads.
 * Listens 'life.started' (lay out the starter room for the chosen house, stock the kitchen),
 *         'house.moved' (re-fit furniture), 'travel.arrived' (first arrival home stocks the
 *         kitchen), 'activity.started' / 'activity.completed' / 'action.cancelled'.
 * Modifiers implemented: 'activity.block', 'activity.hidden'.   Modifier called: 'shop.price'.
 */
import type { ActivityDefinition, Block, FurnitureDefinition, FurnitureKind, IngredientDefinition, RecipeDefinition, ResolvedActivity } from '../../types/content.ts';
import type { PlacementCode } from '../../types/actions.ts';
import type { FurnitureId, HomeState, ItemId, LifeContext, LifeState, PlacedItem, VenueId } from '../../types/life.ts';
import type { SavedInput, SystemDefinition } from '../../types/registry.ts';
import type { HomeView } from '../../types/view.ts';
import { emit, modify } from '../registry.ts';
import { busy, fail, finite, isRecord, naira, ok } from '../util.ts';
import { addItem, addMoodlet, addSkillXp, canAfford, canCredit, changeNeeds, countItem, credit, debit, findActivity, hasItems, removeItems } from '../api.ts';
import { FURNITURE, HOME_ACTIVITIES, HOME_SPOTS, KINDS, PORTED_ACTIVITY_KIND, POWERED_KINDS, POWER_BONUS, SELL_REFUND_RATE, STAR_MULTIPLIER, STARTER_FURNITURE } from '../content/furniture.ts';
import { INGREDIENTS, INGREDIENT_ORDER, MAX_PACKS_PER_ORDER, RECIPES } from '../content/food.ts';
import { HOUSES, DEFAULT_HOUSE, homeOf } from '../content/housing.ts';
import { HOUSE_DESIGNS } from '../content/world.ts';
import type { WantedItem } from '../home-layout.ts';
import { MAX_PLACED, MAX_STORED_PER_ITEM, checkPlacement, doorSlot, fitInto, normalise, starterLayout, windowSlot } from '../home-layout.ts';

const HOME: VenueId = 'home';
const ID_PATTERN = /^f[1-9]\d{0,8}$/;
const SPOT_META: Record<string, { spotLabel?: string; spotIcon?: string }> = { kitchen: {}, bathroom: {}, bedroom: {}, ...Object.fromEntries(Object.entries(HOME_SPOTS).map(([id, spot]) => [id, { spotLabel: spot.label, spotIcon: spot.icon }])) };
/** Ambience: stars of decor, light, comfort and pet items; a pleasant room lifts the mood on arrival (original beta rule). */
const AMBIENCE_CATEGORIES = ['decor', 'light', 'comfort', 'pets'];
const AMBIENCE_MINIMUM = 3;

/** A position of a placed object. */
type Placement = Pick<PlacedItem, 'x' | 'y' | 'rot'>;
/** Kinds that work better with power, as plain strings so any kind name can be looked up. */
const poweredKinds: readonly string[] = POWERED_KINDS;

const itemOf = (id: unknown): FurnitureDefinition | null => (typeof id === 'string' && Object.hasOwn(FURNITURE, id) ? FURNITURE[id] ?? null : null);
const ingredientOf = (id: unknown): IngredientDefinition | null => (typeof id === 'string' && Object.hasOwn(INGREDIENTS, id) ? INGREDIENTS[id] ?? null : null);
// Catalogue entries of ids that are already known to be catalogue keys (placed objects, recipe ingredients, INGREDIENT_ORDER).
const furnitureDef = (id: FurnitureId): FurnitureDefinition => FURNITURE[id]!; // placed and stored ids are catalogue keys: sanitize drops the rest
const ingredientDef = (id: ItemId): IngredientDefinition => INGREDIENTS[id]!; // callers pass INGREDIENT_ORDER ids or recipe ingredient ids
/** The room's size: the rented tier's, or the design's while the player lives in a house they built. */
export const gridOf = (state: LifeState): number => homeOf(state, HOUSE_DESIGNS).grid;
const whole = (value: unknown, fallback: number): number => (finite(value) ? Math.max(0, Math.round(value)) : fallback);
const priceOf = (state: LifeState, item: FurnitureDefinition, ctx: LifeContext): number => whole(modify(state, 'shop.price', item.price, { item, kind: 'furniture' }, ctx), item.price);
const refundOf = (item: FurnitureDefinition): number => Math.floor(item.price * SELL_REFUND_RATE);
/** What `packs` packs of an ingredient cost right now, after every 'shop.price' modifier — the one price the action charges and the Groceries app shows. */
export const groceryPrice = (state: LifeState, item: IngredientDefinition, packs: number, ctx: LifeContext): number => whole(modify(state, 'shop.price', item.price * packs, { item, kind: 'grocery' }, ctx), item.price * packs);
/** Pack counts the Groceries app offers per row. */
export const GROCERY_PACK_OPTIONS = Object.freeze([1, 3]);
const storedCount = (state: LifeState): number => Object.values(state.home.storage).reduce((sum, count) => sum + count, 0);
const placedOfKind = (state: LifeState, kind: string): PlacedItem[] => state.home.items.filter((item) => FURNITURE[item.itemId]?.kind === kind);

/** Result multiplier for a furniture kind: best placed star rating, plus the power bonus. 1 when nothing of that kind is placed. */
export function qualityOf(state: LifeState, kind: string): number {
  const placed = placedOfKind(state, kind);
  if (!placed.length) return 1;
  const stars = Math.max(...placed.map((item) => furnitureDef(item.itemId).stars));
  const powered = poweredKinds.includes(kind) && placedOfKind(state, 'power').length > 0;
  // stars is 0–4 and STAR_MULTIPLIER has five entries
  return STAR_MULTIPLIER[stars]! * (powered ? POWER_BONUS : 1);
}

const ambienceOf = (state: LifeState): number => state.home.items.reduce((sum, item) => {
  const def = FURNITURE[item.itemId];
  return sum + (def && AMBIENCE_CATEGORIES.includes(def.category) ? def.stars : 0);
}, 0);

/** The furniture kind an activity depends on (ours carry `home`; two ported ones are mapped by id). */
const isPortedId = (id: unknown): id is keyof typeof PORTED_ACTIVITY_KIND => typeof id === 'string' && Object.hasOwn(PORTED_ACTIVITY_KIND, id);
function kindOf(state: LifeState, def: ActivityDefinition | null | undefined): FurnitureKind | null {
  if (def?.home) return def.home.kind;
  return state.location === HOME && isPortedId(def?.id) ? PORTED_ACTIVITY_KIND[def.id] : null;
}

function stockKitchen(state: LifeState): boolean {
  if (state.home.stocked) return false;
  for (const id of INGREDIENT_ORDER) if (ingredientDef(id).start > 0) addItem(state, id, ingredientDef(id).start);
  state.home.stocked = true;
  return true;
}

function freshHome(grid: number, stocked = false): HomeState {
  return { items: starterLayout(grid), storage: {}, seq: STARTER_FURNITURE.length + 1, stocked, custom: false, boost: null };
}

function store(state: LifeState, itemId: FurnitureId, count = 1): void {
  state.home.storage[itemId] = Math.min(MAX_STORED_PER_ITEM, (state.home.storage[itemId] ?? 0) + count);
}
function unstore(state: LifeState, itemId: FurnitureId): boolean {
  const held = state.home.storage[itemId] ?? 0;
  if (!(held > 0)) return false;
  state.home.storage[itemId] = held - 1;
  if (held - 1 <= 0) delete state.home.storage[itemId];
  return true;
}

/** Re-fit everything into the current house's grid; what does not fit goes to storage. */
function refit(state: LifeState): number {
  const { items, stored } = fitInto(gridOf(state), state.home.items);
  state.home.items = items;
  for (const itemId of stored) store(state, itemId);
  return stored.length;
}

// ---- actions ---------------------------------------------------------------------------------

/** Shared guards for changing the room. */
function guard(state: LifeState, verb: string) {
  const blocked = busy(state, `Finish or cancel your current action before you ${verb} furniture.`);
  if (blocked) return blocked;
  if (state.location !== HOME) return fail(state, 'not_home', `Go home to ${verb} furniture.`);
  return null;
}
function placeable(state: LifeState, def: FurnitureDefinition, payload: Record<string, unknown>, ignoreId?: string): { at?: undefined; why: Block<PlacementCode> } | { at: Placement; why: Block<PlacementCode> | null } {
  const at = normalise(def, payload?.x, payload?.y, payload?.rot ?? 0);
  if (!at) return { why: { code: 'invalid_position', reason: 'Choose a tile inside your room.' } };
  return { at, why: checkPlacement(gridOf(state), state.home.items, def, at.x, at.y, at.rot, ignoreId) };
}
function put(state: LifeState, def: FurnitureDefinition, at: Placement): PlacedItem {
  const placed = { id: `f${state.home.seq}`, itemId: def.id, ...at };
  state.home.seq += 1;
  state.home.items.push(placed);
  state.home.custom = true;
  return placed;
}

function buyFurniture(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext) {
  const blocked = guard(state, 'buy');
  if (blocked) return blocked;
  const def = itemOf(payload?.item);
  if (!def) return fail(state, 'invalid_item', 'Choose an item from the Buy catalogue.');
  if (state.home.items.length >= MAX_PLACED) return fail(state, 'room_full', `Your room already holds ${MAX_PLACED} objects. Sell or store one first.`);
  const placement = placeable(state, def, payload);
  if (placement.why) return fail(state, placement.why.code, placement.why.reason);
  const price = priceOf(state, def, ctx);
  if (!canAfford(state, price)) return fail(state, 'insufficient_funds', `${def.label} costs ${naira(price)}; you have ${naira(state.cash)} (${naira(price - state.cash)} short).`);
  debit(state, price, `Bought ${def.label}`, ctx);
  put(state, def, placement.at!); // placeable() returns a null `why` only together with a position
  state.message = `${def.label} placed. ${naira(price)} paid.`;
  emit(state, 'item.bought', { id: def.id, item: def.id, price, kind: 'furniture' }, ctx);
  return ok(state, 'bought');
}

function moveFurniture(state: LifeState, payload: Record<string, unknown>) {
  const blocked = guard(state, 'move');
  if (blocked) return blocked;
  const placed = state.home.items.find((item) => item.id === payload?.id);
  if (!placed) return fail(state, 'invalid_object', 'That object is not in your room.');
  const def = furnitureDef(placed.itemId);
  const { at, why } = placeable(state, def, payload, placed.id);
  if (why) return fail(state, why.code, why.reason);
  Object.assign(placed, at);
  state.home.custom = true;
  state.message = `${def.label} moved.`;
  return ok(state, 'moved');
}

function sellFurniture(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext) {
  const blocked = guard(state, 'sell');
  if (blocked) return blocked;
  const placed = state.home.items.find((item) => item.id === payload?.id);
  const def = placed ? furnitureDef(placed.itemId) : itemOf(payload?.item);
  if (!def || (!placed && !((state.home.storage[def.id] ?? 0) > 0))) return fail(state, 'invalid_object', 'That object is not in your room or your storage.');
  const refund = refundOf(def);
  if (!canCredit(state, refund)) return fail(state, 'balance_limit', 'Your saved balance has reached its supported limit.');
  if (placed) state.home.items = state.home.items.filter((item) => item !== placed);
  else unstore(state, def.id);
  credit(state, refund, `Sold ${def.label}`, ctx);
  state.home.custom = true;
  state.message = `${def.label} sold for ${naira(refund)} (${Math.round(SELL_REFUND_RATE * 100)}% of its price).`;
  emit(state, 'item.sold', { id: def.id, item: def.id, refund }, ctx);
  return ok(state, 'sold');
}

function storeFurniture(state: LifeState, payload: Record<string, unknown>) {
  const blocked = guard(state, 'store');
  if (blocked) return blocked;
  const placed = state.home.items.find((item) => item.id === payload?.id);
  if (!placed) return fail(state, 'invalid_object', 'That object is not in your room.');
  const def = furnitureDef(placed.itemId);
  if ((state.home.storage[def.id] ?? 0) >= MAX_STORED_PER_ITEM) return fail(state, 'storage_full', `Storage already holds ${MAX_STORED_PER_ITEM} of ${def.label}. Sell one first.`);
  state.home.items = state.home.items.filter((item) => item !== placed);
  store(state, def.id);
  state.home.custom = true;
  state.message = `${def.label} moved to storage.`;
  return ok(state, 'stored');
}

function placeFromStorage(state: LifeState, payload: Record<string, unknown>) {
  const blocked = guard(state, 'place');
  if (blocked) return blocked;
  const def = itemOf(payload?.item);
  if (!def || !((state.home.storage[def.id] ?? 0) > 0)) return fail(state, 'not_in_storage', 'That item is not in your storage. Buy it from the catalogue instead.');
  if (state.home.items.length >= MAX_PLACED) return fail(state, 'room_full', `Your room already holds ${MAX_PLACED} objects. Sell or store one first.`);
  const placement = placeable(state, def, payload);
  if (placement.why) return fail(state, placement.why.code, placement.why.reason);
  unstore(state, def.id);
  put(state, def, placement.at!); // placeable() returns a null `why` only together with a position
  state.message = `${def.label} placed from storage.`;
  return ok(state, 'placed');
}

function buyGroceries(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext) {
  const item = ingredientOf(payload?.id);
  if (!item) return fail(state, 'invalid_item', 'Choose an ingredient from the Groceries list.');
  const packs = payload?.packs ?? 1;
  if (typeof packs !== 'number' || !Number.isInteger(packs) || packs < 1 || packs > MAX_PACKS_PER_ORDER) return fail(state, 'invalid_quantity', `Order between 1 and ${MAX_PACKS_PER_ORDER} packs at a time.`);
  const count = packs * item.pack;
  const price = groceryPrice(state, item, packs, ctx);
  if (!canAfford(state, price)) return fail(state, 'insufficient_funds', `${packs} × ${item.label} costs ${naira(price)}; you have ${naira(state.cash)} (${naira(price - state.cash)} short).`);
  if (!addItem(state, item.id, count)) return fail(state, 'kitchen_full', `Your kitchen cannot hold more ${item.label}. Cook some first.`);
  debit(state, price, `Groceries: ${count} × ${item.label}`, ctx);
  state.message = `${count} × ${item.label} delivered to your kitchen. ${naira(price)} paid.`;
  emit(state, 'item.bought', { id: item.id, item: item.id, price, kind: 'grocery', count }, ctx);
  return ok(state, 'delivered');
}

function unpackKitchen(state: LifeState) {
  if (!stockKitchen(state)) return fail(state, 'already_unpacked', 'Your starter food is already in the kitchen. Order more in Phone → Groceries.');
  state.message = 'Starter food unpacked into your kitchen.';
  return ok(state, 'unpacked');
}

// ---- activities --------------------------------------------------------------------------------

const furnitureActivities = HOME_ACTIVITIES.map(({ needs, ...def }) => ({
  ...def, id: `home-${def.id}`, cost: 0, tags: [...(def.tags || []), 'home'], beta: true,
  home: { kind: needs }, where: { venue: HOME, spot: KINDS[needs].spot!, ...SPOT_META[KINDS[needs].spot!] }, // every kind with an action has a spot
}));
const recipeActivities = Object.values(RECIPES).map(({ station, ingredients, betaIngredients, ...def }) => ({
  ...def, id: `home-${def.id}`, cost: 0, tags: ['food', 'cooking', 'home'], beta: true,
  home: { kind: station, recipe: def.id }, where: { venue: HOME, spot: 'kitchen' },
}));

function missingIngredients(state: LifeState, recipe: RecipeDefinition): string[] {
  return Object.entries(recipe.ingredients).filter(([id, count]) => countItem(state, id) < count).map(([id]) => INGREDIENTS[id]?.label ?? id);
}

/** Apply the quality bonus on top of the listed completion effects and XP (the engine has already applied those). */
function completionBonus(state: LifeState, def: ResolvedActivity, mult: number, ctx: LifeContext): void {
  if (mult === 1) return;
  for (const [need, amount] of Object.entries(def.effects || {})) if (amount > 0) changeNeeds(state, { [need]: amount * (mult - 1) });
  if (mult > 1) for (const [skill, amount] of Object.entries(def.xp || {})) addSkillXp(state, skill, amount * (mult - 1), ctx);
}

function sanitizeBoost(value: unknown): HomeState['boost'] {
  if (!isRecord(value) || typeof value.id !== 'string' || !findActivity(value.id)?.def.effectsPerSecond) return null;
  if (!finite(value.mult) || value.mult < 0.5 || value.mult > 4 || !finite(value.done) || value.done < 0) return null;
  return { id: value.id, mult: value.mult, done: value.done, finished: value.finished === true };
}

export default {
  id: 'home',
  stateKeys: ['home'],

  sanitize(input: SavedInput, state: LifeState): void {
    const grid = gridOf(state);
    const saved = isRecord(input.home) ? input.home : null;
    if (!saved || !Array.isArray(saved.items)) { state.home = freshHome(grid, saved?.stocked === true); return; }
    const seen = new Set<string>();
    const wanted: WantedItem[] = []; // an id of '' is a placeholder, replaced below
    for (const raw of saved.items.slice(0, MAX_PLACED)) {
      if (!isRecord(raw) || typeof raw.itemId !== 'string' || !itemOf(raw.itemId)) continue;
      const id = typeof raw.id === 'string' && ID_PATTERN.test(raw.id) && !seen.has(raw.id) ? raw.id : '';
      if (id) seen.add(id);
      wanted.push({ id, itemId: raw.itemId, x: raw.x, y: raw.y, rot: raw.rot });
    }
    let seq = typeof saved.seq === 'number' && Number.isSafeInteger(saved.seq) && saved.seq > 0 && saved.seq < 1e9 ? saved.seq : 1;
    for (const id of seen) seq = Math.max(seq, Number(id.slice(1)) + 1);
    for (const entry of wanted) if (!entry.id) { entry.id = `f${seq}`; seq += 1; }
    const { items, stored } = fitInto(grid, wanted);
    state.home = { items, storage: {}, seq, stocked: saved.stocked === true, custom: saved.custom === true, boost: sanitizeBoost(saved.boost) };
    if (isRecord(saved.storage)) {
      for (const [itemId, count] of Object.entries(saved.storage)) {
        if (itemOf(itemId) && typeof count === 'number' && Number.isSafeInteger(count) && count > 0) state.home.storage[itemId] = Math.min(count, MAX_STORED_PER_ITEM);
      }
    }
    for (const itemId of stored) store(state, itemId);
  },

  actions: {
    'home.furniture-buy': buyFurniture,
    'home.furniture-move': moveFurniture,
    'home.furniture-sell': sellFurniture,
    'home.furniture-store': storeFurniture,
    'home.furniture-place': placeFromStorage,
    'home.grocery-buy': buyGroceries,
    'home.kitchen-unpack': unpackKitchen,
  },

  activities: [...furnitureActivities, ...recipeActivities],

  modifiers: {
    /** The legacy free garri is only listed while the cooler cannot make the real thing. */
    'activity.hidden'(value, state, data) {
      if (value || data?.def?.id !== 'garri') return value;
      const soak = RECIPES['soak-garri']!; // a content entry
      return placedOfKind(state, soak.station).length > 0 && !missingIngredients(state, soak).length;
    },
    'activity.block'(value, state, data) {
      const home = data?.def?.home;
      if (value || !home) return value;
      if (!placedOfKind(state, home.kind).length) {
        return { code: 'furniture_required', reason: `Needs ${KINDS[home.kind].needs} in your room. Open Buy to place one.` };
      }
      if (home.recipe) {
        const missing = missingIngredients(state, RECIPES[home.recipe]!); // a recipe id set by this file's own recipeActivities
        if (missing.length) return { code: 'missing_items', reason: `Need ${missing.join(', ')}. Order in Phone → Groceries.` };
      }
      return null;
    },
  },

  on: {
    'life.started'(state) {
      if (!state.home.custom) state.home = freshHome(gridOf(state), state.home.stocked);
      else refit(state);
      stockKitchen(state);
    },
    'house.moved'(state) {
      const stored = refit(state);
      if (stored) state.message = `${state.message} ${stored} ${stored === 1 ? 'object' : 'objects'} did not fit and went to storage — re-place or sell from Buy → Storage.`;
    },
    'travel.arrived'(state, data, ctx) {
      if (data?.venue !== HOME) return;
      stockKitchen(state);
      const ambience = ambienceOf(state);
      if (ambience >= AMBIENCE_MINIMUM) addMoodlet(state, { id: 'lovely-home', label: 'Lovely Home', value: Math.min(10, 2 + Math.floor(ambience / 3)), duration: 1800 }, ctx);
    },
    'activity.started'(state, data) {
      const def = data?.def;
      const kind = kindOf(state, def);
      state.home.boost = null;
      if (!kind || !def.effectsPerSecond) return;
      const mult = qualityOf(state, kind);
      if (mult !== 1) state.home.boost = { id: def.id, mult, done: 0, finished: false };
    },
    'activity.completed'(state, data, ctx) {
      const def = data?.def;
      if (!def) return;
      const recipe = def.home?.recipe ? RECIPES[def.home.recipe] : null;
      if (recipe) {
        // Ingredients leave the kitchen only now, with the meal's effects already applied.
        if (hasItems(state, recipe.ingredients)) {
          removeItems(state, recipe.ingredients);
          state.message = `${state.message} Used ${Object.entries(recipe.ingredients).map(([id, count]) => `${count} × ${ingredientDef(id).label}`).join(', ')}.`;
        }
        emit(state, 'meal.eaten', { id: recipe.id, source: 'home' }, ctx);
      } else if (state.location === HOME && !def.home && data.tags?.includes('food')) {
        emit(state, 'meal.eaten', { id: def.id ?? data.id, source: 'home' }, ctx);
      }
      const kind = kindOf(state, def);
      if (kind) completionBonus(state, def, qualityOf(state, kind), ctx);
      if (state.home.boost && state.home.boost.id === def.id) state.home.boost.finished = true;
    },
    'action.cancelled'(state, data) {
      state.home.boost = null;
      // Stopping sleep early is waking up, not cancelling: the rest already gained is kept.
      const def = data?.kind === 'activity' ? findActivity(data.id)?.def : null;
      if (def?.tags?.includes('sleep')) state.message = `${state.name} woke up. The rest you got is kept.`;
    },
  },

  /** Pays out the quality bonus of a running per-second activity for the seconds just settled. */
  advance(state) {
    const boost = state.home.boost;
    if (!boost) return;
    const def = findActivity(boost.id)?.def;
    const active = state.activeAction;
    const running = active?.kind === 'activity' && active.id === boost.id;
    if (!def || (!running && !boost.finished)) { state.home.boost = null; return; }
    const upto = running ? active.duration - active.remaining : def.duration;
    const seconds = Math.max(0, upto - boost.done);
    for (const [need, rate] of Object.entries(def.effectsPerSecond || {})) if (rate > 0) changeNeeds(state, { [need]: rate * (boost.mult - 1) * seconds });
    boost.done = upto;
    if (!running) state.home.boost = null;
  },

  view(state: LifeState, ctx: LifeContext): HomeView {
    const grid = gridOf(state);
    const quality: Record<string, number> = {};
    for (const [kind, info] of Object.entries(KINDS)) if (info.spot) quality[kind] = placedOfKind(state, kind).length ? qualityOf(state, kind) : 0;
    return {
      house: state.property?.house ?? DEFAULT_HOUSE,
      grid, window: windowSlot(grid), door: doorSlot(grid),
      atHome: state.location === HOME,
      placed: state.home.items.length,
      stored: storedCount(state),
      stocked: state.home.stocked,
      refundRate: SELL_REFUND_RATE,
      ambience: ambienceOf(state),
      /** Price of every catalogue item after discounts (list price is FURNITURE[id].price). */
      prices: Object.fromEntries(Object.values(FURNITURE).map((item): [string, number] => [item.id, priceOf(state, item, ctx)])),
      /** What the server will charge for each offered pack count of every ingredient: { [id]: { [packs]: { price, list } } }. */
      groceries: Object.fromEntries(INGREDIENT_ORDER.map((id): [string, Record<number, { price: number; list: number }>] => [id, Object.fromEntries(GROCERY_PACK_OPTIONS.map((packs): [number, { price: number; list: number }] => [packs, { price: groceryPrice(state, ingredientDef(id), packs, ctx), list: ingredientDef(id).price * packs }]))])),
      /** What the kitchen holds, in the catalogue's order. */
      kitchen: INGREDIENT_ORDER.filter((id) => countItem(state, id) > 0).map((id) => ({ id, label: ingredientDef(id).label, icon: ingredientDef(id).icon, count: countItem(state, id) })),
      /** Result multiplier per furniture kind (0 = none placed). */
      quality,
    };
  },
} satisfies SystemDefinition<'home'>;
