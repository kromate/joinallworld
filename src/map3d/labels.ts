/**
 * OWNER: world
 * Where the place labels and the opening view go. Pure maths — no Three.js, no DOM — so the rules
 * can be checked under `node --test`.
 *
 * THE PLAYER'S PIECE IS NEVER COVERED. A label hangs above its building; the avatar stands at the
 * door and walks up to it at the end of a trip, so the two can meet on screen. When they do, the
 * label steps out of the way — up, on a longer stalk, or down over its own roof when that is the
 * shorter move — and steps back as soon as the avatar has passed. The step is a function of where
 * the two are in this frame and nothing else: no timer, no ease of its own, no frames of its own.
 *
 *   avatarBox(feet, head, { riding, tag })   → { l, r, t, b }   the piece on screen (and its "You" tag)
 *   labelShift(box, avatar)                  → pixels to move the label's box by (negative is up)
 *   nearPoints(at, narrow)                   → ground points the close view around `at` must hold
 */

export interface ScreenPoint { x: number; y: number }
/** A box on screen in pixels: left, right, top, bottom. */
export interface ScreenBox { l: number; r: number; t: number; b: number }
export interface GroundPoint { x: number; z: number }

/** The avatar's box on screen from its projected feet and head. `tag` adds the "You" tag that rides above it during a trip. */
export function avatarBox(feet: ScreenPoint, head: ScreenPoint, { riding = false, tag = false }: { riding?: boolean; tag?: boolean } = {}): ScreenBox {
  const height = Math.max(8, feet.y - head.y), half = Math.max(tag ? 22 : 8, height * (riding ? 0.55 : 0.3));
  return { l: feet.x - half, r: feet.x + half, t: head.y - (tag ? 30 : 3), b: feet.y + 2 };
}

/** A label is allowed to drop over its own roof only when that is a much shorter move than rising clear. */
const DOWN_BIAS = 1.6;

/**
 * How far a label's box must move so that it does not cover the avatar: 0 when they are apart,
 * negative to rise above the avatar's head, positive to drop below its feet. The move grows from
 * nothing as the two start to overlap sideways (`soft` pixels), so a label never snaps.
 */
export function labelShift(box: ScreenBox, avatar: ScreenBox | null | undefined, { gap = 5, soft = 14 }: { gap?: number; soft?: number } = {}): number {
  if (!avatar) return 0;
  const across = Math.min(box.r, avatar.r) - Math.max(box.l, avatar.l);
  if (across <= 0 || box.b <= avatar.t || box.t >= avatar.b) return 0;
  const up = box.b - avatar.t + gap, down = avatar.b - box.t + gap, k = Math.min(1, across / soft);
  return Math.round((up <= down * DOWN_BIAS ? -up : down) * k * k * (3 - 2 * k));
}

/**
 * The ground the close view holds around `at` (the player): the streets either side and a little
 * more to the south, where the camera looks from. A phone gets a tighter patch than a wide screen,
 * so that the places next to the player are named in words and not shrunk to their icons.
 */
export function nearPoints(at: GroundPoint, narrow = true): GroundPoint[] {
  const side = narrow ? 27 : 46, north = narrow ? 20 : 26, south = narrow ? 24 : 30;
  return [{ x: at.x - side, z: at.z }, { x: at.x + side, z: at.z }, { x: at.x, z: at.z - north }, { x: at.x, z: at.z + south }];
}

/** Beyond this camera distance (map units) a view is of a whole state, not a city: only a name that matters is lettered, and local governments are named instead. */
export const WHOLE_FROM = 560;
/** A local-government plate's size is by its polygon only from this far out; nearer it is the usual small plate. */
export const PLATE_SIZED_FROM = 700;
const PLATE_MAX = 2.5;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
/** The room a plate's lettering needs, in pixels, at its usual size (11px type): about 8.4px a letter (capitals, spaced) and the padding. */
export const plateWidth = (name: string) => name.length * 8.4 + 22;
/**
 * How a local government's name plate is shown: whether it fits its own polygon, and the factor
 * its type grows by. Nearer than PLATE_SIZED_FROM it is the usual plate, always; farther out the
 * plate grows with the polygon (to PLATE_MAX), and one whose polygon is too small to hold its name stays hidden.
 */
export function plateFit(name: string, spanPixels: number, distance: number, sizedFrom = PLATE_SIZED_FROM): { show: boolean; scale: number } {
  if (distance < sizedFrom) return { show: true, scale: 1 };
  const need = plateWidth(name);
  return { show: spanPixels >= need * 0.4, scale: Math.round(clamp((spanPixels * 0.72) / need, 1, PLATE_MAX) * 8) / 8 };
}
/** The span of the points' x and z: { minX, maxX, minZ, maxZ }. */
export function spanOf(points: readonly (readonly [number, number])[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of points) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
  return { minX, maxX, minZ, maxZ };
}
