/**
 * The Nigeria sheet has two useful map scales. A whole-country view shows one marker per state;
 * once the player has zoomed far enough to read a zone, it shows the open cities instead.
 *
 * Keep this decision independent of Three.js and the DOM so additions to the city catalogue do
 * not change the zoom boundary.
 */

export type NigeriaMarkerDetail = 'states' | 'cities';

/** One press of the atlas zoom-in control uses 0.6, so it always crosses this boundary. */
export const CITY_DETAIL_DISTANCE_SHARE = 0.72;

export function nigeriaMarkerDetail(wholeNigeriaDistance: number | null, viewDistance: number): NigeriaMarkerDetail {
  if (wholeNigeriaDistance === null || !Number.isFinite(wholeNigeriaDistance) || wholeNigeriaDistance <= 0 || !Number.isFinite(viewDistance)) return 'states';
  return viewDistance <= wholeNigeriaDistance * CITY_DETAIL_DISTANCE_SHARE ? 'cities' : 'states';
}
