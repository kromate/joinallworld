/**
 * How a saved look (src/scene/characters.ts normalizeLook) dresses the skinned body. Pure: no Three.js, no assets, so
 * it is tested on its own (tint.test.ts) and the body material (skinned.ts) only turns its numbers into uniforms.
 *
 * THE MAPPING (docs/ASSETS.md has the table)
 *   body          'woman' → base-body-female.glb, 'man' → base-body-male.glb
 *   skin          the texture's skin texels are multiplied by  look.skin / skinRef  (both linear RGB), so the painted
 *                 shading, lips, eyes and brows stay and only the tone moves. skinRef is the texture's own mean skin
 *                 colour, measured by the pipeline (manifest.ts).
 *   top           look.outfitColor on the torso, clavicles and upper arms (the COLOR_0 g region)
 *   bottoms       look.bottomsColor on the hips and legs (b region)
 *   hair          look.hairColor on the hair cap (a region)
 *   shoes         a fixed dark leather on the feet (what the regions leave)
 *   layers        wardrobe/renderer.ts supplies original cuts, hair, accessories and cloth patterns on the same rig.
 *                 This shader retains the safe clothed base and its painted face below those layers.
 * Colours are hex in the look and leave here as linear RGB, the space the shader works in.
 *
 * OLD SAVES go through normalizeLook like every look: legacy keys (gender, skinTone, hairstyle), named or numbered
 * swatches, missing fields (the seed's) and junk (the seed's, never a throw) all give a body and five colours.
 */
import { normalizeLook } from '../characters.ts';
import { BODY_MANIFEST } from './manifest.ts';
import type { BodyKey } from './manifest.ts';

export type Rgb = [number, number, number];
/** What the body material needs to wear a look. */
export interface BodyTint {
  key: BodyKey;
  /** Multiplies skin texels (linear). */
  skin: Rgb;
  top: Rgb;
  bottoms: Rgb;
  hair: Rgb;
  shoes: Rgb;
}

export const SHOES = '#2e2622';

/** sRGB hex (#rgb or #rrggbb) → linear RGB, 0..1. Anything unreadable is mid grey. */
export function linear(hex: string): Rgb {
  const text = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim())?.[1] ?? '808080';
  const full = text.length === 3 ? text.split('').map((c) => c + c).join('') : text;
  return [0, 2, 4].map((at) => {
    const v = parseInt(full.slice(at, at + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
}

/** Which body file a look wears. */
export function bodyKeyFor(look: unknown, seed?: unknown): BodyKey {
  return normalizeLook(look, seed).body === 'man' ? 'male' : 'female';
}

/** The colours a look puts on the body (see the mapping above). */
export function bodyTint(look: unknown, seed?: unknown): BodyTint {
  const read = normalizeLook(look, seed), key: BodyKey = read.body === 'man' ? 'male' : 'female';
  const reference = BODY_MANIFEST.bodies[key].skinRef, skin = linear(read.skin);
  return {
    key,
    skin: skin.map((value, index) => value / reference[index]!) as Rgb,
    top: linear(read.outfitColor), bottoms: linear(read.bottomsColor), hair: linear(read.hairColor), shoes: linear(SHOES),
  };
}
