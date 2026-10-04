/**
 * OWNER: foundation (core — do not edit from a feature branch)
 * Counted items (ingredients, groceries, collectables).
 *
 * State key: inventory ({ [itemId]: count }, count 1–9999, at most 200 kinds).
 * Use through api.ts: countItem, hasItems, addItem, removeItems.
 * Item ids are lowercase slugs; what an id means is defined by its owner's content file.
 */
import { isId, isRecord, safeCount } from '../util.ts';
import type { SystemDefinition } from '../../types/registry.ts';
import type { LifeState } from '../../types/life.ts';

export const MAX_STACK = 9999;
export const MAX_KINDS = 200;

export const countItem = (state: Pick<LifeState, 'inventory'>, id: string): number => state.inventory[id] ?? 0;
export const hasItems = (state: Pick<LifeState, 'inventory'>, items: Readonly<Record<string, number>> | null | undefined): boolean => Object.entries(items || {}).every(([id, count]) => countItem(state, id) >= count);

/** Add `count` of an item. Returns false if the id/count is invalid or a limit would be exceeded. */
export function addItem(state: Pick<LifeState, 'inventory'>, id: string, count = 1): boolean {
  if (!isId(id) || !Number.isSafeInteger(count) || count <= 0) return false;
  const next = countItem(state, id) + count;
  if (next > MAX_STACK || (!Object.hasOwn(state.inventory, id) && Object.keys(state.inventory).length >= MAX_KINDS)) return false;
  state.inventory[id] = next;
  return true;
}

/** Remove every listed item atomically. Returns false (and changes nothing) if any is missing. */
export function removeItems(state: Pick<LifeState, 'inventory'>, items: Readonly<Record<string, number>> | null | undefined): boolean {
  if (!hasItems(state, items)) return false;
  for (const [id, count] of Object.entries(items || {})) {
    if (!Number.isSafeInteger(count) || count <= 0) continue;
    // The entry exists here: hasItems held and count > 0, so `?? 0` never applies.
    const left = (state.inventory[id] ?? 0) - count;
    state.inventory[id] = left;
    if (left <= 0) delete state.inventory[id];
  }
  return true;
}

export default {
  id: 'inventory',
  stateKeys: ['inventory'],
  sanitize(input, state) {
    state.inventory = {};
    if (!isRecord(input.inventory)) return;
    for (const [id, count] of Object.entries(input.inventory).slice(0, MAX_KINDS)) {
      if (isId(id) && safeCount(count) && count > 0) state.inventory[id] = Math.min(count, MAX_STACK);
    }
  },
  actions: {},
  advance() {},
  view(state) { return { items: { ...state.inventory } }; },
} satisfies SystemDefinition<'inventory'>;
