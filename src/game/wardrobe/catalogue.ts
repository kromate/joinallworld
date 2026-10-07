import type { AvatarWearableId, LegacyAvatarWearableId, ResolvedAvatarWearableId } from '../../types/avatar.ts';

export type AvatarWearableSlot = 'head' | 'hair' | 'neck' | 'ears' | 'wrist' | 'face' | 'top' | 'bottom' | 'full' | 'shoes' | 'carry';
export type AvatarBodyRegion = 'hair' | 'head' | 'neck' | 'torso' | 'upperarms' | 'forearms' | 'hips' | 'legs' | 'feet';

export interface AvatarWearableDefinition {
  readonly label: string;
  readonly slot: AvatarWearableSlot;
  /** Other occupied slots this item excludes. Same-slot items always conflict. */
  readonly blocks: readonly AvatarWearableSlot[];
  /** Body regions the renderer hides while this item is active. */
  readonly hides: readonly AvatarBodyRegion[];
  /** `legacy` entries are render aliases only and must never be purchasable/equippable as new IDs. */
  readonly source: 'catalogue' | 'legacy';
}

const define = (
  label: string,
  slot: AvatarWearableSlot,
  hides: readonly AvatarBodyRegion[] = [],
  blocks: readonly AvatarWearableSlot[] = [],
  source: AvatarWearableDefinition['source'] = 'catalogue',
): AvatarWearableDefinition => ({ label, slot, blocks, hides, source });

/** New catalogue items. IDs are declared only in src/types/avatar.ts. */
export const AVATAR_WEARABLES = {
  'hijab-drape': define('Hijab · drape', 'head', ['hair', 'neck'], ['hair']),
  'hijab-wrap': define('Hijab · wrap', 'head', ['hair', 'neck'], ['hair']),
  turban: define('Turban', 'head', ['hair'], ['hair']),
  'gele-fan': define('Gele · fan tie', 'head', ['hair'], ['hair']),
  'gele-rose': define('Gele · rose tie', 'head', ['hair'], ['hair']),
  'neck-scarf': define('Neck scarf', 'neck', ['neck']),
  'shoulder-wrap': define('Shoulder wrap', 'neck', ['neck']),
  'chain-thin': define('Thin chain', 'neck'),
  'chain-cuban': define('Cuban chain', 'neck'),
  'chain-pendant': define('Pendant chain', 'neck'),
  beads: define('Beads', 'neck'),
  coral: define('Coral beads', 'neck'),
  wristwatch: define('Wristwatch', 'wrist'),
  bangles: define('Bangles', 'wrist'),
  agbada: define('Agbada', 'full', ['torso', 'upperarms', 'hips', 'legs'], ['top', 'bottom']),
  kaftan: define('Kaftan', 'full', ['torso', 'upperarms', 'forearms', 'hips', 'legs'], ['top', 'bottom']),
  abaya: define('Abaya', 'full', ['torso', 'upperarms', 'forearms', 'hips', 'legs'], ['top', 'bottom']),
  'buba-iro': define('Buba and iro', 'full', ['torso', 'upperarms', 'hips', 'legs'], ['top', 'bottom']),
  'school-uniform': define('School uniform', 'full', ['torso', 'upperarms', 'hips', 'legs'], ['top', 'bottom']),
  'work-uniform': define('Work uniform', 'full', ['torso', 'upperarms', 'forearms', 'hips', 'legs'], ['top', 'bottom']),
  slippers: define('Slippers', 'shoes', ['feet']),
  sandals: define('Sandals', 'shoes', ['feet']),
  sneakers: define('Sneakers', 'shoes', ['feet']),
} as const satisfies Record<AvatarWearableId, AvatarWearableDefinition>;

/** Old saved accessories remain visible through the legacy renderer mapping, without new ownership. */
export const LEGACY_AVATAR_WEARABLES = {
  'legacy-glasses': define('Glasses', 'face', [], [], 'legacy'),
  'legacy-sunglasses': define('Sunglasses', 'face', [], [], 'legacy'),
  'legacy-cap': define('Cap', 'head', [], [], 'legacy'),
  'legacy-headwrap': define('Headwrap', 'head', [], [], 'legacy'),
  'legacy-fila': define('Fila', 'head', [], [], 'legacy'),
  'legacy-earrings': define('Earrings', 'ears', [], [], 'legacy'),
  'legacy-chain': define('Chain', 'neck', [], [], 'legacy'),
  'legacy-watch': define('Wristwatch', 'wrist', [], [], 'legacy'),
  'legacy-beads': define('Beads', 'wrist', [], [], 'legacy'),
  'legacy-backpack': define('Backpack', 'carry', [], [], 'legacy'),
  'legacy-handbag': define('Handbag', 'carry', [], [], 'legacy'),
} as const satisfies Record<LegacyAvatarWearableId, AvatarWearableDefinition>;

/** One lookup for renderer metadata; only AVATAR_WEARABLES IDs are valid new look selections. */
export const AVATAR_WEARABLE_CATALOGUE: Readonly<Record<ResolvedAvatarWearableId, AvatarWearableDefinition>> = Object.freeze({
  ...AVATAR_WEARABLES,
  ...LEGACY_AVATAR_WEARABLES,
});

/** Old appearance accessory IDs to renderer aliases. This mapping grants no item ownership. */
export const LEGACY_ACCESSORY_TO_WEARABLE: Readonly<Partial<Record<string, LegacyAvatarWearableId>>> = Object.freeze({
  glasses: 'legacy-glasses',
  sunglasses: 'legacy-sunglasses',
  cap: 'legacy-cap',
  headwrap: 'legacy-headwrap',
  fila: 'legacy-fila',
  earrings: 'legacy-earrings',
  chain: 'legacy-chain',
  watch: 'legacy-watch',
  beads: 'legacy-beads',
  backpack: 'legacy-backpack',
  handbag: 'legacy-handbag',
});
