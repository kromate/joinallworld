import type { AvatarWearableId, LegacyAvatarWearableId, ResolvedAvatarWearableId } from '../../types/avatar.ts';
import { isAvatarWearableId } from '../../types/avatar.ts';
export { isAvatarWearableId } from '../../types/avatar.ts';
import { AVATAR_WEARABLES, AVATAR_WEARABLE_CATALOGUE, LEGACY_ACCESSORY_TO_WEARABLE } from './catalogue.ts';
import type { AvatarWearableDefinition } from './catalogue.ts';

export type AvatarWearableErrorCode = 'expected_list' | 'unknown_id' | 'legacy_id' | 'duplicate_id' | 'slot_conflict' | 'blocked';
export type AvatarWearableValidation =
  | { readonly ok: true; readonly ids: AvatarWearableId[] }
  | { readonly ok: false; readonly code: AvatarWearableErrorCode; readonly id?: string; readonly conflictsWith?: string };

/** True only for IDs that may be introduced as new saved/Boutique wearable choices. */

function isLegacyId(value: unknown): value is LegacyAvatarWearableId {
  return typeof value === 'string' && Object.hasOwn(AVATAR_WEARABLE_CATALOGUE, value) && !isAvatarWearableId(value);
}

function conflicts(a: AvatarWearableDefinition, b: AvatarWearableDefinition): 'slot_conflict' | 'blocked' | null {
  if (a.slot === b.slot) return 'slot_conflict';
  if (a.blocks.includes(b.slot) || b.blocks.includes(a.slot)) return 'blocked';
  return null;
}

function resolveIds(input: unknown, allowLegacy: boolean): ResolvedAvatarWearableId[] {
  const selected: ResolvedAvatarWearableId[] = [];
  if (!Array.isArray(input)) return selected;
  for (const value of input) {
    const id = isAvatarWearableId(value) ? value : allowLegacy && isLegacyId(value) ? value : null;
    if (!id) continue;
    const definition = AVATAR_WEARABLE_CATALOGUE[id];
    const survivors = selected.filter((prior) => conflicts(definition, AVATAR_WEARABLE_CATALOGUE[prior]) === null);
    survivors.push(id);
    selected.splice(0, selected.length, ...survivors);
  }
  return selected;
}

/**
 * Normalize an untrusted saved/new list: unknown IDs drop, and the last picked conflicting item wins.
 * @example normalizeAvatarWearables(['hijab-drape', 'gele-fan', 'sneakers'])
 * // ['gele-fan', 'sneakers']
 */
export function normalizeAvatarWearables(input: unknown): AvatarWearableId[] {
  return resolveIds(input, false).filter(isAvatarWearableId);
}

/**
 * Strict boundary check for server `checkLook`: unknowns, duplicate IDs, and conflicts fail.
 * @example validateAvatarWearables(['hijab-drape', 'gele-fan'])
 * // { ok: false, code: 'slot_conflict', id: 'gele-fan', conflictsWith: 'hijab-drape' }
 */
export function validateAvatarWearables(input: unknown): AvatarWearableValidation {
  if (input === undefined || input === null) return { ok: true, ids: [] };
  if (!Array.isArray(input)) return { ok: false, code: 'expected_list' };
  const ids: AvatarWearableId[] = [];
  for (const value of input) {
    if (isLegacyId(value)) return { ok: false, code: 'legacy_id', id: value };
    if (!isAvatarWearableId(value)) return { ok: false, code: 'unknown_id', ...(typeof value === 'string' ? { id: value } : {}) };
    if (ids.includes(value)) return { ok: false, code: 'duplicate_id', id: value };
    const definition = AVATAR_WEARABLES[value];
    for (const prior of ids) {
      const conflict = conflicts(definition, AVATAR_WEARABLES[prior]);
      if (conflict) return { ok: false, code: conflict, id: value, conflictsWith: prior };
    }
    ids.push(value);
  }
  return { ok: true, ids };
}

export interface AvatarWearableSelection {
  readonly accessories?: readonly string[] | null;
  readonly wearables?: unknown;
}

/**
 * Resolve a look for rendering only. Legacy accessories are aliases for their saved appearance;
 * explicit new wearable IDs come last, so they win visual slot conflicts. This never changes Look,
 * Wardrobe ownership, cash, or purchase state.
 * @example resolveAvatarWearablesForRenderer({ accessories: ['cap', 'earrings'], wearables: ['hijab-wrap'] })
 * // ['legacy-earrings', 'hijab-wrap']
 */
export function resolveAvatarWearablesForRenderer(selection: AvatarWearableSelection): ResolvedAvatarWearableId[] {
  const legacy: LegacyAvatarWearableId[] = [];
  for (const accessory of selection.accessories ?? []) {
    const mapped = LEGACY_ACCESSORY_TO_WEARABLE[accessory];
    if (mapped) legacy.push(mapped);
  }
  const explicit = Array.isArray(selection.wearables) ? selection.wearables.filter(isAvatarWearableId) : [];
  return resolveIds([...legacy, ...explicit], true);
}

/** Return regions removed from the skinned base by the resolved render selection. */
export function hiddenAvatarBodyRegions(ids: readonly ResolvedAvatarWearableId[]): Set<AvatarWearableDefinition['hides'][number]> {
  const regions = new Set<AvatarWearableDefinition['hides'][number]>();
  for (const id of ids) for (const region of AVATAR_WEARABLE_CATALOGUE[id].hides) regions.add(region);
  return regions;
}
