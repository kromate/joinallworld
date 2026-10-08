import type { Look } from '../../types/life.ts';
import { normalizeAvatarAppearance } from '../../types/avatar.ts';
import type { AvatarAppearance, AvatarLookExtensions, AvatarWearableId } from '../../types/avatar.ts';
import { AVATAR_WEARABLES, AVATAR_WEARABLE_CATALOGUE, LEGACY_ACCESSORY_TO_WEARABLE } from './catalogue.ts';
import { normalizeAvatarWearables } from './rules.ts';

export type AvatarLook = Look & AvatarLookExtensions;

export function avatarLookFields(value: unknown): AvatarLookExtensions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const wearables = normalizeAvatarWearables('wearables' in value ? value.wearables : undefined);
  const appearance = normalizeAvatarAppearance('appearance' in value ? value.appearance : undefined);
  const changed = appearance.height !== 'average' || appearance.build !== 'average' || appearance.ageAppearance !== 'adult';
  return { ...(wearables.length ? { wearables } : {}), ...(changed ? { appearance } : {}) };
}

/** Choosing an explicit layer removes conflicting older accessories as well as newer layers. */
export function chooseAvatarWearable(look: AvatarLook, id: AvatarWearableId): AvatarLook {
  const old = normalizeAvatarWearables(look.wearables);
  const removing = old.includes(id);
  const wearables = removing ? old.filter(item => item !== id) : normalizeAvatarWearables([...old, id]);
  const definition = AVATAR_WEARABLES[id];
  const accessories = removing ? look.accessories : look.accessories?.filter(item => {
    const legacy = LEGACY_ACCESSORY_TO_WEARABLE[item];
    if (!legacy) return true;
    const other = AVATAR_WEARABLE_CATALOGUE[legacy];
    return definition.slot !== other.slot && !definition.blocks.includes(other.slot) && !other.blocks.includes(definition.slot);
  });
  const { wearables: previous, accessories: previousAccessories, ...base } = look;
  return { ...base, ...(accessories?.length ? { accessories } : {}), ...(wearables.length ? { wearables } : {}) };
}

export function removeAvatarWearable(look: AvatarLook, id: string): AvatarLook {
  const wearables = normalizeAvatarWearables(look.wearables).filter(item => item !== id);
  const { wearables: previous, ...base } = look;
  return { ...base, ...(wearables.length ? { wearables } : {}) };
}

/** A later choice of an old accessory wins the same slot, just like a new layer choice. */
export function keepAvatarAccessoryChoice(look: AvatarLook, accessory: string): AvatarLook {
  const legacy = LEGACY_ACCESSORY_TO_WEARABLE[accessory];
  if (!legacy || !look.accessories?.some(id => id === accessory)) return look;
  const item = AVATAR_WEARABLE_CATALOGUE[legacy];
  const wearables = normalizeAvatarWearables(look.wearables).filter(id => {
    const other = AVATAR_WEARABLES[id];
    return item.slot !== other.slot && !item.blocks.includes(other.slot) && !other.blocks.includes(item.slot);
  });
  const { wearables: previous, ...base } = look;
  return { ...base, ...(wearables.length ? { wearables } : {}) };
}

export function chooseAvatarAppearance(look: AvatarLook, field: keyof AvatarAppearance, value: string): AvatarLook {
  const appearance = normalizeAvatarAppearance({ ...normalizeAvatarAppearance(look.appearance), [field]: value });
  const { appearance: previous, ...base } = look;
  return { ...base, ...avatarLookFields({ appearance }) };
}
