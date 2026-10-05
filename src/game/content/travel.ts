/**
 * OWNER: world
 * Travel content: modes, fares, durations and need costs.
 *
 * Provenance
 *   Fixed: the five modes, Danfo as the default selection, the two fare bands (`near` and the
 *   standard band stored on each mode as `fare`), fares charged at departure, a trek costing
 *   10 Energy and 7 Hygiene and training Fitness, and own-car travel costing fuel only.
 *   A Danfo ride leaves every need unchanged, so Danfo has no need cost.
 *   Original beta values (`beta` blocks below): every duration, the cross-lagoon `far` band,
 *   need costs of Keke, Okada and Cab, the Fitness XP amount, roadside-event chances and fuel.
 */

/** `fare` is the standard-band fare. `seconds` is the standard-band trip time (original beta value). */
import type { BaseTravelModeId, TravelModeId } from '../../types/life.ts'
import type { BaseModeTable, FareBands, RouteBand, TravelModeDefinition } from '../../types/content.ts'

export const TRAVEL_MODES: BaseModeTable = {
  trek: { id: 'trek', label: 'Trek', icon: '🚶', fare: 0, seconds: 12, needs: { energy: -10, hygiene: -7 }, xp: { fitness: 15 }, exposed: true, eventChance: 0.5,
    blurb: 'Free, slow, sweaty — and good for your fitness.' },
  keke: { id: 'keke', label: 'Keke', icon: '🛺', fare: 150, seconds: 9, needs: { hygiene: -1 }, eventChance: 0.2, blurb: 'Cheap and breezy.' },
  danfo: { id: 'danfo', label: 'Danfo', icon: '🚌', fare: 150, seconds: 8, needs: {}, eventChance: 0.25, blurb: 'Cheap, crowded, always an experience.' },
  okada: { id: 'okada', label: 'Okada', icon: '🏍️', fare: 200, seconds: 5, needs: { hygiene: -3 }, exposed: true, eventChance: 0.15, blurb: 'Fastest through traffic. Dusty, and no roof.' },
  cab: { id: 'cab', label: 'Cab', icon: '🚕', fare: 400, seconds: 6, needs: { energy: 2 }, eventChance: 0.15, blurb: 'Air-conditioned. Arrive rested.' },
};

/**
 * Own car. Offered only when some system adds 'car' through modify(state, 'travel.modes', ids).
 * The base "fare" is fuel; the owner of cars may reprice it through 'travel.fare' (data.mode === 'car').
 */
export const CAR_MODE = { id: 'car', label: 'Own car', icon: '🚗', fare: 120, seconds: 5, needs: {}, eventChance: 0.1, fuel: true, beta: true, blurb: 'Your own ride. You only pay for fuel.' } satisfies TravelModeDefinition;

/** Every mode the travel action accepts. */
export const ALL_MODES: Record<TravelModeId, TravelModeDefinition> = { ...TRAVEL_MODES, car: CAR_MODE };
// Object.keys is string[]; the keys of TRAVEL_MODES are exactly the BaseTravelModeId union.
export const BASE_MODE_IDS: readonly BaseTravelModeId[] = Object.freeze(Object.keys(TRAVEL_MODES) as BaseTravelModeId[]);
export const DEFAULT_MODE: BaseTravelModeId = 'danfo';

/**
 * Fares by band for the modes whose fare changes with distance. `near` is fixed (a short
 * hop within one district cluster); `far` (crossing the lagoon) is an original beta value.
 * The standard band is each mode's own `fare`.
 */
export const FARE_BANDS: FareBands = {
  near: { keke: 100, danfo: 100, okada: 200, cab: 350, car: 80 },
  far: { keke: 200, danfo: 200, okada: 300, cab: 550, car: 180, beta: true },
};

/** Trip-time multiplier per band (original beta values). */
export const BAND_TIME: Record<RouteBand, number> = { near: 0.85, standard: 1, far: 1.5 };
export const BAND_LABELS: Record<RouteBand, string> = { near: 'Short hop', standard: 'Across town', far: 'Across the lagoon' };
/** Map distance (in map units, see content/venues.ts) below which a trip on one landmass is a short hop. */
export const NEAR_DISTANCE = 160;
export const MIN_TRIP_SECONDS = 4;
export const MAX_TRIP_SECONDS = 60;

/** Legacy flat trip time. Saves written before per-mode travel carry it, and still resume. */
export const TRAVEL_DURATION = 5;

/**
 * Skipping the rest of a trip for game money ('travel.skip', src/game/trip-skip.ts). All original beta values.
 * The price is for the seconds NOT waited: `base + perSecond × seconds left`, rounded up to `roundTo`, so it falls
 * as the trip goes on. Between cities it is never more than `capShare` of the fare that was paid; inside a city never
 * more than `cap`. Nothing is sold below `minRemainingSeconds` (waiting is free), and a trip inside a city can be
 * skipped only while more than `localMinRemainingSeconds` is left — short hops are simply waited out.
 */
export const TRIP_SKIP = Object.freeze({
  beta: true,
  minRemainingSeconds: 3,
  localMinRemainingSeconds: 20,
  intercity: Object.freeze({ base: 100, perSecond: 10, capShare: 0.5 }),
  local: Object.freeze({ base: 50, perSecond: 5, cap: 300 }),
  /** Prices are whole multiples of this, and never below it. */
  roundTo: 50,
  /** From this price on the player is asked once more before paying, so a mis-tap cannot spend it. */
  confirmFrom: 1000,
  /** A price shown to the player is honoured for this long, so what is charged is what was on the button. */
  quoteGraceSeconds: 5,
  /** The first skip between cities of each character costs nothing. */
  firstIntercityFree: true,
});

/** The price of skipping `remaining` seconds of a trip. `fare` is what the trip cost at departure (between cities only). */
export function tripSkipFee(kind: 'intercity' | 'local', remaining: number, fare = 0): number {
  const step = TRIP_SKIP.roundTo, left = Math.max(0, Number.isFinite(remaining) ? remaining : 0);
  const rule = kind === 'intercity' ? TRIP_SKIP.intercity : TRIP_SKIP.local;
  const asked = Math.ceil((rule.base + rule.perSecond * left) / step) * step;
  const most = kind === 'intercity' ? Math.floor((Math.max(0, fare) * TRIP_SKIP.intercity.capShare) / step) * step : TRIP_SKIP.local.cap;
  return Math.max(step, Math.min(asked, most));
}
