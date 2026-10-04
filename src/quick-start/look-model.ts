/**
 * OWNER: quick start
 * The landing screen's own logic, as pure functions: name suggestions, the looks a new Sim may wear, the one-tap presets and
 * the draft the screen edits. No DOM, no storage, no clock, no network — it runs under `node --test` (./model.test.js).
 * It is NOT part of the first download: it is fetched with the landing screen (src/ui/panels/groups/landing.js), which only
 * a device without a life ever sees. What the first download needs of the quick start is ./model.js.
 *
 * @typedef {{ body: string, hair: string, outfit: string, fabric: string, skin: string, hairColor: string,
 *   outfitColor: string, bottomsColor: string, accessories?: string[], face?: string, expression?: string }} Look
 * @typedef {{ name: string, look: Look, landedAt: number, nameEdited: boolean, shuffles: number, preset: string | null }} Draft
 */
import { APPEARANCE, ACCESSORY_BASICS } from '../game/content/traits.ts';

// ---- names ---------------------------------------------------------------------------------
/** Friendly suggestions for the name field: "<mood> <name>", always 3–24 ordinary characters. */
export const NAME_MOODS = Object.freeze(['Sunny', 'Jolly', 'Lucky', 'Bright', 'Easy', 'Happy', 'Gentle', 'Sharp', 'Smooth', 'Breezy']);
export const NAME_STEMS = Object.freeze(['Tobi', 'Ada', 'Zainab', 'Chidi', 'Amaka', 'Femi', 'Ngozi', 'Bola', 'Kemi', 'Emeka', 'Sade', 'Uche', 'Halima', 'Dayo', 'Ife', 'Tunde',
  'Yemi', 'Kelechi', 'Simi', 'Musa', 'Bisi', 'Nneka', 'Segun', 'Aisha']);
const pick = (list, random) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];
/** @param {() => number} random returns 0 ≤ n < 1 */
export const suggestName = (random) => `${pick(NAME_MOODS, random)} ${pick(NAME_STEMS, random)}`;
/**
 * What is wrong with a name before it is sent, or null. The server decides (length, control
 * characters and its text filter); this only saves a round trip for the obvious cases.
 * @param {unknown} value
 * @returns {string | null}
 */
export function nameProblem(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 3) return 'A name needs at least 3 characters.';
  if (name.length > 24) return 'A name can be at most 24 characters.';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return 'A name needs ordinary characters.';
  return null;
}

// ---- looks ---------------------------------------------------------------------------------
const styles = (kind, body) => (kind === 'hair' ? [...(APPEARANCE.hair[body] ?? []), ...(APPEARANCE.extra.hair[body] ?? [])]
  : [...(APPEARANCE.outfits[body] ?? []), ...(APPEARANCE.extra.outfits[body] ?? [])]);
/** Styles a new Sim may wear: everything offered for the body except what is sold only in the Boutique. */
export const starterStyles = (kind, body) => styles(kind, body).filter((id) => !APPEARANCE.boutiqueOnly[kind].includes(id));
const swatch = (group, id) => APPEARANCE[group].some((item) => item.id === id);
const slotOf = (id) => APPEARANCE.accessories.find((item) => item.id === id)?.slot;

/**
 * `value` as a look a new Sim may wear, or null when any part of it is not a valid starter choice.
 * The same rules the server applies (checkLook with `starter`), so a draft kept on the device from an
 * older build is dropped instead of being refused at Play.
 * @param {unknown} value
 * @returns {Look | null}
 */
export function starterLook(value) {
  const look = /** @type {Look} */ (value);
  if (!look || typeof look !== 'object' || !APPEARANCE.bodies.some((body) => body.id === look.body)) return null;
  if (!starterStyles('hair', look.body).includes(look.hair) || !starterStyles('outfit', look.body).includes(look.outfit) || !APPEARANCE.fabrics.includes(look.fabric)) return null;
  if (!swatch('skin', look.skin) || !swatch('hairColours', look.hairColor) || !swatch('outfitColours', look.outfitColor) || !swatch('outfitColours', look.bottomsColor)) return null;
  const extras = look.accessories === undefined || look.accessories === null ? [] : look.accessories;
  if (!Array.isArray(extras) || extras.length > APPEARANCE.accessoryLimit || !extras.every((id) => ACCESSORY_BASICS.includes(id))
    || new Set(extras.map(slotOf)).size !== extras.length) return null;
  return { body: look.body, hair: look.hair, outfit: look.outfit, fabric: look.fabric, skin: look.skin, hairColor: look.hairColor, outfitColor: look.outfitColor, bottomsColor: look.bottomsColor,
    accessories: [...extras], face: APPEARANCE.faces.includes(look.face) ? look.face : APPEARANCE.faces[0], expression: APPEARANCE.expressions.includes(look.expression) ? look.expression : APPEARANCE.expressions[0] };
}

/** One-tap characters. Each is a complete starter look; `label` is what the button says. */
export const PRESETS = Object.freeze([
  { id: 'street', label: 'Street', look: { body: 'man', hair: 'fade', outfit: 'hoodie', fabric: 'plain', skin: 'skin-5', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' } },
  { id: 'owambe', label: 'Owambe', look: { body: 'woman', hair: 'gele', outfit: 'owambe', fabric: 'aso-oke', skin: 'skin-4', hairColor: 'black', outfitColor: 'gold', bottomsColor: 'violet' } },
  { id: 'office', label: 'Office', look: { body: 'woman', hair: 'bun', outfit: 'office', fabric: 'plain', skin: 'skin-3', hairColor: 'dark-brown', outfitColor: 'cream', bottomsColor: 'navy' } },
  { id: 'sporty', label: 'Sporty', look: { body: 'man', hair: 'low-cut', outfit: 'jersey', fabric: 'plain', skin: 'skin-6', hairColor: 'black', outfitColor: 'green', bottomsColor: 'cream' } },
  { id: 'chill', label: 'Chill', look: { body: 'woman', hair: 'braids', outfit: 'casual', fabric: 'ankara', skin: 'skin-6', hairColor: 'soft-black', outfitColor: 'orange', bottomsColor: 'teal' } },
].map((preset) => Object.freeze({ ...preset, look: Object.freeze(preset.look) })));
/** @returns {Look | null} */
export const presetLook = (id) => { const preset = PRESETS.find((item) => item.id === id); return preset ? starterLook(preset.look) : null; };

/** A random look a new Sim may wear. @param {() => number} random */
export function shuffleLook(random) {
  const body = pick(APPEARANCE.bodies, random).id;
  return /** @type {Look} */ (starterLook({ body, hair: pick(starterStyles('hair', body), random), outfit: pick(starterStyles('outfit', body), random), fabric: pick(APPEARANCE.fabrics, random),
    skin: pick(APPEARANCE.skin, random).id, hairColor: pick(APPEARANCE.hairColours, random).id, outfitColor: pick(APPEARANCE.outfitColours, random).id, bottomsColor: pick(APPEARANCE.outfitColours, random).id,
    accessories: random() < 0.35 ? [pick(ACCESSORY_BASICS, random)] : [], face: pick(APPEARANCE.faces, random), expression: pick(APPEARANCE.expressions, random) }));
}
/** The same look with the other body: the hairstyle and outfit are kept when that body has them. */
export function withBody(look, body) {
  if (!APPEARANCE.bodies.some((item) => item.id === body) || look.body === body) return look;
  const keep = (kind) => (starterStyles(kind, body).includes(look[kind]) ? look[kind] : starterStyles(kind, body)[0]);
  return { ...look, body, hair: keep('hair'), outfit: keep('outfit') };
}

// ---- the draft -----------------------------------------------------------------------------
/**
 * The draft the landing screen edits, rebuilt from whatever the device kept. Nothing saved is
 * trusted: a name or look that is no longer valid is replaced by a fresh suggestion, so the form is
 * always one tap from Play.
 * @param {unknown} saved  what storage held (any shape)
 * @param {{ random: () => number, now: number, name?: string }} options  `name`: a name this device already uses
 * @returns {Draft}
 */
export function draftFrom(saved, { random, now, name }) {
  const kept = saved && typeof saved === 'object' ? /** @type {Record<string, unknown>} */ (saved) : {};
  const keptName = typeof kept.name === 'string' && !nameProblem(kept.name) ? kept.name.trim() : null;
  const given = typeof name === 'string' && !nameProblem(name) ? name.trim() : null;
  const look = starterLook(kept.look);
  const preset = pick(PRESETS, random);
  return {
    name: keptName ?? given ?? suggestName(random),
    look: look ?? /** @type {Look} */ (presetLook(preset.id)),
    landedAt: Number.isFinite(kept.landedAt) && /** @type {number} */ (kept.landedAt) > 0 && /** @type {number} */ (kept.landedAt) <= now ? /** @type {number} */ (kept.landedAt) : now,
    nameEdited: keptName !== null && kept.nameEdited === true,
    shuffles: Number.isSafeInteger(kept.shuffles) && /** @type {number} */ (kept.shuffles) >= 0 ? Math.min(/** @type {number} */ (kept.shuffles), 999) : 0,
    preset: look ? (typeof kept.preset === 'string' && PRESETS.some((item) => item.id === kept.preset) ? kept.preset : null) : preset.id,
  };
}
