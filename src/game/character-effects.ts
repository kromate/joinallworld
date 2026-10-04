/**
 * OWNER: character
 * Applies the plain-data `fx` blocks of traits, lottery outcomes and perks (format documented
 * in content/traits.ts) to the registry modifier keys. Pure helpers shared by
 * systems/onboarding.ts and systems/goals.ts; not a system and holds no state.
 */
import { lagosTime } from './clock.ts';
import { finite } from './util.ts';
import type { LifeContext, LifeState, NeedMap } from '../types/life.ts';
import type { EffectBlock } from '../types/content.ts';
import type { Modifier, ModifierMap } from '../types/registry.ts';

/** An fx block as a source lists it: a state may have none (a trait or perk without effects). */
type FxSource = EffectBlock | null | undefined;
/** The modifier keys the fx blocks apply to. */
type FxKey = 'needs.decayRate' | 'skills.xpRate' | 'activity.cost' | 'activity.reward' | 'travel.fare' | 'shop.price' | 'social.gain' | 'career.performance';

export const NIGHT_START_HOUR = 21; // original beta value
export const NIGHT_END_HOUR = 5; // original beta value

export const isNight = (ms: number | undefined): boolean => { const { hour } = lagosTime(ms ?? NaN); return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR; };

const mult = (value: unknown): number => (finite(value) && value >= 0 ? value : 1);
const tagged = (rule: { tags: string[] } | undefined, def: { tags?: string[] } | undefined): boolean => {
  const defTags = def?.tags;
  return Boolean(rule && Array.isArray(defTags) && rule.tags.some((tag) => defTags.includes(tag)));
};

/** Purchase kinds the `shop` multiplier applies to. */
export const SHOP_KINDS: readonly string[] = Object.freeze(['furniture', 'grocery']);

const FOLDS: { [K in FxKey]: (fx: EffectBlock, data: ModifierMap[K]['data'], ctx?: LifeContext) => number } = {
  'needs.decayRate': (fx, data, ctx) => mult(fx.decay?.all) * mult(fx.decay?.[data?.need]) * (fx.nightDecay && isNight(ctx?.now) ? mult(fx.nightDecay[data?.need]) : 1),
  'skills.xpRate': (fx, data) => mult(fx.xp?.all) * mult(fx.xp?.[data?.skill]),
  'activity.cost': (fx, data) => (tagged(fx.cost, data?.def) ? mult(fx.cost?.mult) : 1),
  'activity.reward': (fx, data) => (tagged(fx.reward, data?.def) ? mult(fx.reward?.mult) : 1),
  'travel.fare': (fx) => mult(fx.fare),
  // The Buy-mode discount covers furniture and groceries only — never cars (data.kind is set by the seller).
  'shop.price': (fx, data) => (SHOP_KINDS.includes(data?.kind) ? mult(fx.shop) : 1),
  'social.gain': (fx) => mult(fx.social),
  'career.performance': (fx) => mult(fx.performance),
};
/** Keys whose multiplier only applies to a gain: a penalty passed through them is left alone. */
const GAIN_ONLY = new Set<string>(['social.gain', 'career.performance']);

// Object.keys is string[]; the keys of FOLDS are exactly the FxKey union.
export const FX_KEYS: readonly FxKey[] = Object.freeze(Object.keys(FOLDS) as FxKey[]);

/** Fold `value` through every fx block in `sources` for one modifier key. Non-numbers pass through. */
export function applyFx<K extends FxKey>(sources: Iterable<FxSource>, key: K, value: number, data: ModifierMap[K]['data'], ctx?: LifeContext): number {
  if (!finite(value) || (GAIN_ONLY.has(key) && value <= 0)) return value;
  let result = value;
  for (const fx of sources) if (fx) result *= FOLDS[key](fx, data, ctx);
  return result;
}

/** A `modifiers` table for a system, given how to list the active fx blocks of a state. */
export function fxModifiers(sourcesOf: (state: LifeState) => Iterable<FxSource>): { [K in FxKey]: Modifier<K> } {
  // Object.fromEntries cannot keep the key-to-modifier pairing: one entry is built per FX_KEYS key, so every FxKey is present.
  return Object.fromEntries(FX_KEYS.map((key) => [key, (value: number, state: LifeState, data: ModifierMap[typeof key]['data'], ctx: LifeContext) => applyFx(sourcesOf(state), key, value, data, ctx)])) as { [K in FxKey]: Modifier<K> };
}

/** Sum of the completion bonuses (`fx.bonus`) that match an activity's tags. */
export function bonusNeeds(sources: Iterable<FxSource>, tags: readonly string[] | undefined): NeedMap {
  const total: Record<string, number> = {};
  for (const fx of sources) {
    if (!fx?.bonus || !Array.isArray(tags) || !fx.bonus.tags.some((tag) => tags.includes(tag))) continue;
    for (const [need, amount] of Object.entries(fx.bonus.needs)) total[need] = (total[need] ?? 0) + amount;
  }
  return total;
}
