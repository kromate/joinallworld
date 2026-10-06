/**
 * OWNER: world
 * The location-confirmed check, as pure maths: is a device inside the local government the player lives in? (docs/LOCATION.md)
 *
 * LOCATION PRIVACY. judgeResidence() is one of the only functions that ever sees a latitude and a longitude. It runs in the player's
 * browser against the real boundary bundled in the city pack, returns one word, and keeps nothing: no position is stored, logged,
 * sent or put in an event. Pure: no DOM, no network, no Three.js, so it also runs under `node --test`.
 *
 *   inside        the position is within the local government's boundary
 *   near          it is just outside, within BORDER_TOLERANCE_M or within the reported accuracy circle: consumer location is imprecise
 *   outside       it is further away than that (or in another city or country)
 *   inaccurate    the fix is worse than MAX_ACCURACY_M (a desktop placed by its network address): nothing can be said, so nothing is confirmed
 */
import { inLga, near, partsOf } from './lga.ts';
import { toLocal } from './geo/frame.ts';
import type { CityPack } from './types.ts';

/** How far outside the boundary (metres) a position still counts as inside: phones and laptops are off by this much near a border. */
export const BORDER_TOLERANCE_M = 1500;
/** A fix less precise than this (metres) is not used: a desktop's network-address location is often kilometres wrong. */
export const MAX_ACCURACY_M = 5000;
/** Map units are 100 m (docs/MAP-GEOMETRY.md). */
const METRES_PER_UNIT = 100;

export type ResidenceVerdict = 'inside' | 'near' | 'outside' | 'inaccurate';

/** How far (metres) a point of the pack's local frame is from the local government, 0 when inside. */
export function metresOutside(pack: Pick<CityPack, 'lgas'>, lgaId: string, x: number, z: number): number | null {
  const lga = pack.lgas.find((item) => item.id === lgaId);
  if (!lga) return null;
  if (inLga(lga, x, z)) return 0;
  let best = Infinity;
  for (const part of partsOf(lga)) for (const ring of part) best = Math.min(best, near(x, z, ring));
  return best * METRES_PER_UNIT;
}

/** Judge a position (and the accuracy radius the device reported, in metres) against one local government of the pack. */
export function judgeResidence(pack: Pick<CityPack, 'lgas' | 'frame'> | null | undefined, lgaId: string, latitude: number, longitude: number, accuracy: number): ResidenceVerdict {
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_ACCURACY_M) return 'inaccurate';
  if (!pack?.frame || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return 'outside';
  const [x, z] = toLocal(pack.frame.origin, longitude, latitude);
  const away = metresOutside(pack, lgaId, x, z);
  if (away === null) return 'outside';
  if (away === 0) return 'inside';
  return away <= Math.max(BORDER_TOLERANCE_M, accuracy) ? 'near' : 'outside';
}

/** A verdict that confirms. */
export const confirms = (verdict: ResidenceVerdict): boolean => verdict === 'inside' || verdict === 'near';
