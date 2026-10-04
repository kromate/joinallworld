/**
 * OWNER: character
 * Applies the plain-data `fx` blocks of traits, lottery outcomes and perks (format documented
 * in content/traits.js) to the registry modifier keys. Pure helpers shared by
 * systems/onboarding.js and systems/goals.js; not a system and holds no state.
 */
import { lagosTime } from './clock.js';
import { finite } from './util.js';

export const NIGHT_START_HOUR = 21; // original beta value
export const NIGHT_END_HOUR = 5; // original beta value

export const isNight = (ms) => { const { hour } = lagosTime(ms); return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR; };

const mult = (value) => (finite(value) && value >= 0 ? value : 1);
const tagged = (rule, def) => Boolean(rule && Array.isArray(def?.tags) && rule.tags.some((tag) => def.tags.includes(tag)));

/** Purchase kinds the `shop` multiplier applies to. */
export const SHOP_KINDS = Object.freeze(['furniture', 'grocery']);

const FOLDS = {
  'needs.decayRate': (fx, data, ctx) => mult(fx.decay?.all) * mult(fx.decay?.[data?.need]) * (fx.nightDecay && isNight(ctx?.now) ? mult(fx.nightDecay[data?.need]) : 1),
  'skills.xpRate': (fx, data) => mult(fx.xp?.all) * mult(fx.xp?.[data?.skill]),
  'activity.cost': (fx, data) => (tagged(fx.cost, data?.def) ? mult(fx.cost.mult) : 1),
  'activity.reward': (fx, data) => (tagged(fx.reward, data?.def) ? mult(fx.reward.mult) : 1),
  'travel.fare': (fx) => mult(fx.fare),
  // The Buy-mode discount covers furniture and groceries only — never cars (data.kind is set by the seller).
  'shop.price': (fx, data) => (SHOP_KINDS.includes(data?.kind) ? mult(fx.shop) : 1),
  'social.gain': (fx) => mult(fx.social),
  'career.performance': (fx) => mult(fx.performance),
};
/** Keys whose multiplier only applies to a gain: a penalty passed through them is left alone. */
const GAIN_ONLY = new Set(['social.gain', 'career.performance']);

export const FX_KEYS = Object.freeze(Object.keys(FOLDS));

/** Fold `value` through every fx block in `sources` for one modifier key. Non-numbers pass through. */
export function applyFx(sources, key, value, data, ctx) {
  if (!finite(value) || (GAIN_ONLY.has(key) && value <= 0)) return value;
  let result = value;
  for (const fx of sources) if (fx) result *= FOLDS[key](fx, data, ctx);
  return result;
}

/** A `modifiers` table for a system, given how to list the active fx blocks of a state. */
export function fxModifiers(sourcesOf) {
  return Object.fromEntries(FX_KEYS.map((key) => [key, (value, state, data, ctx) => applyFx(sourcesOf(state), key, value, data, ctx)]));
}

/** Sum of the completion bonuses (`fx.bonus`) that match an activity's tags. */
export function bonusNeeds(sources, tags) {
  const total = {};
  for (const fx of sources) {
    if (!fx?.bonus || !Array.isArray(tags) || !fx.bonus.tags.some((tag) => tags.includes(tag))) continue;
    for (const [need, amount] of Object.entries(fx.bonus.needs)) total[need] = (total[need] ?? 0) + amount;
  }
  return total;
}
