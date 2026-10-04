/**
 * OWNER: world
 * Which zoom level is showing. Pure — no Three.js, no DOM.
 *
 * The atlas is one map with three levels of detail (ATLAS_LEVELS in ../regions.js, widest first).
 * Each level has a "fit" distance: how far the camera stands when that level's frame fills the
 * free part of the screen. The level changes half-way (geometrically) between two fits, so the
 * thresholds follow the screen: a phone and an ultra-wide monitor both swap where it looks right.
 *
 *   thresholds(fits)                       fits: camera distances, widest level first → the distances at which the level changes
 *   levelAt(distance, cuts, current)       → the index of the level to show, with hysteresis so it never flickers
 *   focusLevel(level, lon, lat, levels)    a closer level shows only over its own frame: zoomed in on Brazil is still the world map
 *   pitchAt(distance, fits, pitches)       the camera's tilt: flat-on far out, leaning in at the closest level
 *   crumbs(levels, index, city)            the breadcrumb: every level down to the current one, then the open city
 */

/** How far past a threshold the camera must go before the level changes back (a ratio). */
export const HYSTERESIS = 1.08;

/** @param {number[]} fits widest level first @returns {number[]} cuts[i] separates level i (farther) from level i + 1 (closer) */
export function thresholds(fits) {
  return fits.slice(1).map((near, i) => Math.sqrt(fits[i] * near));
}

/** @param {number} distance @param {number[]} cuts @param {number} [current] the level showing now, for hysteresis */
export function levelAt(distance, cuts, current = -1) {
  let level = cuts.length;
  for (let i = 0; i < cuts.length; i++) if (distance > cuts[i]) { level = i; break; }
  if (current < 0 || level === current) return level;
  // Moving one level: only once the camera is clearly past the threshold between them.
  const cut = cuts[Math.min(level, current)];
  if (level < current ? distance < cut * HYSTERESIS : distance > cut / HYSTERESIS) return Math.abs(level - current) === 1 ? current : level < current ? level + 1 : level - 1;
  return level;
}

/** How far outside a level's frame the view may be centred and still show that level, as a share of the frame's size. */
export const FRAME_MARGIN = 0.3;
/**
 * The level to show when the view is centred on (lon, lat): `level` if that point is in (or near) the level's frame,
 * otherwise the nearest wider level whose frame holds it.
 * @param {number} level @param {number} lon @param {number} lat @param {{ frame: number[] }[]} levels widest first
 */
export function focusLevel(level, lon, lat, levels) {
  let index = level;
  while (index > 0) {
    const [west, south, east, north] = levels[index].frame, mx = (east - west) * FRAME_MARGIN, my = (north - south) * FRAME_MARGIN;
    if (lon >= west - mx && lon <= east + mx && lat >= south - my && lat <= north + my) break;
    index -= 1;
  }
  return index;
}

/** Tilt in radians above the horizon, interpolated between the levels' own tilts by the logarithm of the distance. */
export function pitchAt(distance, fits, pitches) {
  if (distance >= fits[0]) return pitches[0];
  for (let i = 1; i < fits.length; i++) {
    if (distance >= fits[i]) { const k = Math.log(distance / fits[i]) / Math.log(fits[i - 1] / fits[i]); return pitches[i] + (pitches[i - 1] - pitches[i]) * k; }
  }
  return pitches[pitches.length - 1];
}

/** @returns {{ id: string, name: string, level?: number, city?: string, current: boolean }[]} */
export function crumbs(levels, index, city = null) {
  const out = levels.slice(0, index + 1).map((level, i) => ({ id: level.id, name: level.name, level: i, current: i === index }));
  if (city && index === levels.length - 1) out.push({ id: city.id, name: city.name, city: city.id, current: false });
  return out;
}
