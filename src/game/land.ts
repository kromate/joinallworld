import { ESTATE, OWNING, lgaOf } from './content/world.ts';

export const LAND = Object.freeze({ beta: true, maxExtras: 3, basePrice: 60000, version: 1 });

/** Only the ends of a contiguous compound, never across a street boundary. */
export function adjacentPlots(anchor: number, extras: readonly number[]): number[] {
  if (!Number.isInteger(anchor) || anchor < 0 || anchor >= ESTATE.streets * ESTATE.plots || extras.length > LAND.maxExtras) return [];
  const row = Math.floor(anchor / ESTATE.plots), slots = [anchor, ...extras].sort((a, b) => a - b);
  if (slots.some((p, index) => !Number.isInteger(p) || Math.floor(p / ESTATE.plots) !== row || (index > 0 && p !== slots[index - 1]! + 1))) return [];
  if (extras.length === LAND.maxExtras) return [];
  return [slots[0]! - 1, slots[slots.length - 1]! + 1].filter((p) => p >= 0 && p < ESTATE.streets * ESTATE.plots && Math.floor(p / ESTATE.plots) === row);
}

/** Original beta price, using the same local land factor as house upgrades. */
export function landPrice(city: string, lga: string): number | null {
  const unit = lgaOf(city, lga);
  return unit ? Math.round(LAND.basePrice * (1 + unit.land / OWNING.rateBase) / 100) * 100 : null;
}
