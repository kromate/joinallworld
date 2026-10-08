/**
 * Stable IDs for skinned avatar items. This tuple is the canonical source for the closed union;
 * catalogue data and validators must be exhaustive over it.
 */
export const AVATAR_WEARABLE_IDS = [
  'hijab-drape', 'hijab-wrap', 'turban', 'gele-fan', 'gele-rose',
  'neck-scarf', 'shoulder-wrap',
  'chain-thin', 'chain-cuban', 'chain-pendant', 'beads', 'coral',
  'wristwatch', 'bangles',
  'agbada', 'kaftan', 'abaya', 'buba-iro', 'school-uniform', 'work-uniform',
  'slippers', 'sandals', 'sneakers',
] as const;
export type AvatarWearableId = typeof AVATAR_WEARABLE_IDS[number];
export const AVATAR_STARTER_WEARABLES: readonly AvatarWearableId[] = ['hijab-drape', 'turban', 'gele-fan', 'neck-scarf', 'wristwatch', 'kaftan', 'abaya', 'school-uniform', 'work-uniform', 'slippers'];
export const isAvatarWearableId = (value: unknown): value is AvatarWearableId => typeof value === 'string' && AVATAR_WEARABLE_IDS.some(id => id === value);

/** Render-only aliases for accessories saved by older looks. These are not Boutique purchase IDs. */
export const LEGACY_AVATAR_WEARABLE_IDS = [
  'legacy-glasses', 'legacy-sunglasses', 'legacy-cap', 'legacy-headwrap', 'legacy-fila',
  'legacy-earrings', 'legacy-chain', 'legacy-watch', 'legacy-beads', 'legacy-backpack', 'legacy-handbag',
] as const;
export type LegacyAvatarWearableId = typeof LEGACY_AVATAR_WEARABLE_IDS[number];
export type ResolvedAvatarWearableId = AvatarWearableId | LegacyAvatarWearableId;

export type AvatarHeight = 'short' | 'average' | 'tall';
export type AvatarBuild = 'slim' | 'average' | 'broad';
/** Cosmetic presentation category only. It is not the user's real age or an age check. */
export type AvatarAgeAppearance = 'adult' | 'mature' | 'elder';

export interface AvatarAppearance {
  height: AvatarHeight;
  build: AvatarBuild;
  ageAppearance: AvatarAgeAppearance;
}

/** Optional appearance fields to intersect with the legacy life Look at the integration boundary. */
export interface AvatarLookExtensions {
  wearables?: AvatarWearableId[];
  appearance?: AvatarAppearance;
}

/** Bounded projection of saved fields. Authoritative edits use the full slot validator. */
export function avatarSavedFields(value: unknown): AvatarLookExtensions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const wearables = 'wearables' in value && Array.isArray(value.wearables) ? [...new Set(value.wearables.slice(0, 23).filter(isAvatarWearableId))].slice(0, 11) : [];
  const appearance = normalizeAvatarAppearance('appearance' in value ? value.appearance : undefined);
  const changed = appearance.height !== 'average' || appearance.build !== 'average' || appearance.ageAppearance !== 'adult';
  return { ...(wearables.length ? { wearables } : {}), ...(changed ? { appearance } : {}) };
}

export const DEFAULT_AVATAR_APPEARANCE: Readonly<AvatarAppearance> = Object.freeze({
  height: 'average',
  build: 'average',
  ageAppearance: 'adult',
});

const HEIGHTS: readonly AvatarHeight[] = ['short', 'average', 'tall'];
const BUILDS: readonly AvatarBuild[] = ['slim', 'average', 'broad'];
const AGE_APPEARANCES: readonly AvatarAgeAppearance[] = ['adult', 'mature', 'elder'];

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.some((item) => item === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Fill missing or unknown cosmetic categories with stable defaults; never mutates the input.
 * @example normalizeAvatarAppearance({ height: 'giant', build: 'slim' })
 * // { height: 'average', build: 'slim', ageAppearance: 'adult' }
 */
export function normalizeAvatarAppearance(value: unknown): AvatarAppearance {
  const source = isRecord(value) ? value : {};
  return {
    height: isOneOf(HEIGHTS, source.height) ? source.height : DEFAULT_AVATAR_APPEARANCE.height,
    build: isOneOf(BUILDS, source.build) ? source.build : DEFAULT_AVATAR_APPEARANCE.build,
    ageAppearance: isOneOf(AGE_APPEARANCES, source.ageAppearance)
      ? source.ageAppearance
      : DEFAULT_AVATAR_APPEARANCE.ageAppearance,
  };
}

/** Cosmetic factors for the outer body group; preserve the mesh bind pose and bone matrices. */
export interface AvatarProportions {
  readonly height: number;
  readonly width: number;
  readonly depth: number;
}

/**
 * Categorical appearance scale factors only; the skinned body base remains an immutable shared asset.
 * With base scale s, apply `(s * height * width, s * height, s * height * depth)`.
 * Height is uniform so a taller body stays longer when lying down. Seat/contact and stride fitting must use these factors too.
 */
export function avatarProportions(appearance: unknown): AvatarProportions {
  const normalized = normalizeAvatarAppearance(appearance);
  return {
    height: normalized.height === 'short' ? 0.94 : normalized.height === 'tall' ? 1.06 : 1,
    width: normalized.build === 'slim' ? 0.9 : normalized.build === 'broad' ? 1.13 : 1,
    depth: normalized.build === 'slim' ? 0.94 : normalized.build === 'broad' ? 1.09 : 1,
  };
}
