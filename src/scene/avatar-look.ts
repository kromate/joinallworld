/** Canonical saved-look normalization shared by procedural and skinned avatar paths. */
import { hash } from './build.ts';
import { normalizeAvatarAppearance } from '../types/avatar.ts';
import type { AvatarLookExtensions } from '../types/avatar.ts';
import { normalizeAvatarWearables } from '../game/wardrobe/rules.ts';
import type { Colour } from './types.ts';

export type Body = 'woman' | 'man';
export type Fabric = 'plain' | 'ankara' | 'adire' | 'asooke';
export type Face = 'oval' | 'round' | 'long';
export type Expression = 'smile' | 'neutral' | 'grin';
export interface Swatch { id: string; hex: Colour }
/** The option ids a look can take (colours are swatches). */
export interface LookOptions {
  body: readonly Body[];
  hair: Record<Body, readonly string[]>;
  outfit: Record<Body, readonly string[]>;
  fabric: readonly Fabric[];
  accessories: readonly string[];
  face: readonly Face[];
  expression: readonly Expression[];
  skin: readonly Swatch[];
  hairColor: readonly Swatch[];
  outfitColor: readonly Swatch[];
}
/** A complete look: every field set, colours as '#rrggbb'. */
export interface Look extends AvatarLookExtensions {
  body: Body;
  hair: string;
  outfit: string;
  fabric: Fabric;
  skin: Colour;
  hairColor: Colour;
  outfitColor: Colour;
  bottomsColor: Colour;
  accessories: string[];
  face: Face;
  expression: Expression;
}

const swatches = (entries: [string, Colour][]): Swatch[] => entries.map(([id, hex]) => ({ id, hex }));
export const LOOK_OPTIONS: Readonly<LookOptions> = Object.freeze<LookOptions>({
  body: ['woman', 'man'],
  hair: {
    woman: ['braids', 'afro', 'bun', 'ponytail', 'long', 'locs', 'lowcut', 'gele', 'classic', 'cornrows', 'twists', 'bantuknots'],
    man: ['lowcut', 'bald', 'curls', 'afro', 'locs', 'braids', 'classic', 'fade', 'cornrows', 'twists'],
  },
  outfit: {
    woman: ['casual', 'office', 'owambe', 'sitework', 'jersey', 'kaftan', 'gown'],
    man: ['casual', 'hoodie', 'office', 'chill', 'sitework', 'jersey', 'kaftan', 'agbada'],
  },
  fabric: ['plain', 'ankara', 'adire', 'asooke'],
  accessories: ['glasses', 'sunglasses', 'cap', 'headwrap', 'fila', 'earrings', 'chain', 'watch', 'beads', 'backpack', 'handbag'],
  face: ['oval', 'round', 'long'],
  expression: ['smile', 'neutral', 'grin'],
  skin: swatches([['sand', '#c68a5e'], ['honey', '#b0764d'], ['bronze', '#9a6341'], ['chestnut', '#845236'], ['cocoa', '#6e422c'], ['umber', '#573323'], ['ebony', '#40261b']]),
  hairColor: swatches([['black', '#1c1917'], ['softblack', '#2b2320'], ['darkbrown', '#3d2a1f'], ['brown', '#5a3a26'], ['auburn', '#8a3b22'], ['blonde', '#d2a857'], ['purple', '#7a4bb0']]),
  outfitColor: swatches([['blue', '#3f72c4'], ['green', '#3f9a5a'], ['red', '#c9423a'], ['orange', '#e0822f'], ['violet', '#8055c2'], ['pink', '#dd6fa0'], ['teal', '#2f9d98'], ['navy', '#243a66'], ['cream', '#ece2c6'], ['gold', '#d6a83a']]),
});
/** Accessories that share a slot replace each other: only the first of a slot is drawn. */
export const ACCESSORY_SLOTS: Readonly<Record<string, string>> = Object.freeze({ glasses: 'eyes', sunglasses: 'eyes', cap: 'head', headwrap: 'head', fila: 'head', earrings: 'ears', chain: 'neck', watch: 'wrist', beads: 'hand', backpack: 'carry', handbag: 'carry' });
// The game's skin swatches (APPEARANCE.skin in content/traits.js), so a saved look keeps its tone in a scene.
const GAME_SKIN: Record<string, Colour> = { skin1: '#e0ac7e', skin2: '#c98e62', skin3: '#b0764c', skin4: '#96603c', skin5: '#7a4a2c', skin6: '#5e3620', skin7: '#3f2416' };

const key = (value: unknown): string => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES: Record<string, string> = { female: 'woman', f: 'woman', girl: 'woman', male: 'man', m: 'man', boy: 'man', asoke: 'asooke', lowcut: 'lowcut', site: 'sitework', work: 'sitework', smart: 'office' };

function pickOption<T extends string>(value: unknown, list: readonly T[], seed: number): T {
  const wanted = ALIASES[key(value)] || key(value);
  return list.includes(wanted as T) ? wanted as T : list[seed % list.length]!;
}
function pickColour(value: unknown, palette: readonly Swatch[], seed: number): Colour {
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim())) return value.trim().toLowerCase();
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < palette.length) return palette[value]!.hex;
  const named = palette.find((swatch) => swatch.id === key(value));
  if (!named && palette === LOOK_OPTIONS.skin && GAME_SKIN[key(value)]) return GAME_SKIN[key(value)]!;
  return (named || palette[seed % palette.length]!).hex;
}
/** Known accessories, one per slot, in the order given. */
function pickAccessories(value: unknown): string[] {
  const slots = new Set<string>(), out: string[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    const id = key(item), slot = ACCESSORY_SLOTS[id];
    if (!slot || slots.has(slot)) continue;
    slots.add(slot); out.push(id);
  }
  return out;
}
// What a passer-by with no recorded look may carry (most carry nothing).
const SEEDED_ACCESSORIES: string[][] = [[], [], [], ['glasses'], ['cap'], [], ['backpack'], ['watch'], [], ['sunglasses'], ['handbag'], []];

/** Fill in a look. The same input and seed always give the same result. */
export function normalizeLook(look?: unknown, seed?: unknown): Look {
  const source: Record<string, unknown> = look && typeof look === 'object' ? look as Record<string, unknown> : {};
  const recorded = Object.keys(source).length > 0;
  const base = seed ?? source.seed ?? source.id ?? 'joinallworld';
  const pick = (part: string) => hash(`${base}:${part}`);
  const body = pickOption(source.body ?? source.gender, LOOK_OPTIONS.body, pick('body'));
  const outfitColor = pickColour(source.outfitColor, LOOK_OPTIONS.outfitColor, pick('outfitColor'));
  let bottomsSeed = pick('bottomsColor');
  if (LOOK_OPTIONS.outfitColor[bottomsSeed % 10]!.hex === outfitColor) bottomsSeed += 7;
  // Seeded fallbacks rarely pick site work, so a crowd is not a sea of hard hats.
  const outfits = LOOK_OPTIONS.outfit[body], everyday = outfits.filter((id) => id !== 'sitework');
  const outfitSeed = outfits.indexOf(pick('outfit') % 9 === 0 ? 'sitework' : everyday[pick('outfit') % everyday.length]!);
  return {
    body,
    hair: pickOption(source.hair ?? source.hairstyle, LOOK_OPTIONS.hair[body], pick('hair')),
    outfit: pickOption(source.outfit, outfits, outfitSeed),
    fabric: pickOption(source.fabric, LOOK_OPTIONS.fabric, source.fabric == null && pick('fabric') % 2 ? 0 : pick('fabric')),
    skin: pickColour(source.skin ?? source.skinTone, LOOK_OPTIONS.skin, pick('skin')),
    hairColor: pickColour(source.hairColor, LOOK_OPTIONS.hairColor, pick('hairColor') % 4),
    outfitColor,
    bottomsColor: pickColour(source.bottomsColor, LOOK_OPTIONS.outfitColor, bottomsSeed),
    // A recorded look wears exactly what it lists (nothing, if it lists nothing).
    accessories: pickAccessories(recorded ? source.accessories : SEEDED_ACCESSORIES[pick('accessories') % SEEDED_ACCESSORIES.length]),
    face: pickOption(source.face, LOOK_OPTIONS.face, recorded ? 0 : pick('face')),
    expression: pickOption(source.expression, LOOK_OPTIONS.expression, 0),
    ...(source.wearables != null ? { wearables: normalizeAvatarWearables(source.wearables) } : {}),
    ...(source.appearance != null ? { appearance: normalizeAvatarAppearance(source.appearance) } : {}),
  };
}

