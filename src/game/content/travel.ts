/**
 * OWNER: world
 * Travel content: modes, fares, durations and need costs.
 *
 * Provenance
 *   Observed in the reference game: the five modes, Danfo as the default selection, the two
 *   fare bands (`near` and the standard band stored on each mode as `fare`), fares charged at
 *   departure, a trek costing 10 Energy and 7 Hygiene and training Fitness, and own-car travel
 *   costing fuel only.
 *   A Danfo ride was reported to leave every need unchanged, so Danfo has no need cost.
 *   Original beta values (`beta` blocks below): every duration, the cross-lagoon `far` band,
 *   need costs of Keke, Okada and Cab (never ridden in the reference game), the Fitness XP amount, roadside-event chances and fuel.
 */

/** `fare` is the standard-band fare. `seconds` is the standard-band trip time (original beta value). */
export const TRAVEL_MODES = {
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
export const CAR_MODE = { id: 'car', label: 'Own car', icon: '🚗', fare: 120, seconds: 5, needs: {}, eventChance: 0.1, fuel: true, beta: true, blurb: 'Your own ride. You only pay for fuel.' };

/** Every mode the travel action accepts. */
export const ALL_MODES = { ...TRAVEL_MODES, car: CAR_MODE };
export const BASE_MODE_IDS = Object.freeze(Object.keys(TRAVEL_MODES));
export const DEFAULT_MODE = 'danfo';

/**
 * Fares by band for the modes whose fare changes with distance. `near` was observed (a short
 * hop within one district cluster); `far` (crossing the lagoon) is an original beta value.
 * The standard band is each mode's own `fare`.
 */
export const FARE_BANDS = {
  near: { keke: 100, danfo: 100, okada: 200, cab: 350, car: 80 },
  far: { keke: 200, danfo: 200, okada: 300, cab: 550, car: 180, beta: true },
};

/** Trip-time multiplier per band (original beta values). */
export const BAND_TIME = { near: 0.85, standard: 1, far: 1.5 };
export const BAND_LABELS = { near: 'Short hop', standard: 'Across town', far: 'Across the lagoon' };
/** Map distance (in map units, see content/venues.js) below which a trip on one landmass is a short hop. */
export const NEAR_DISTANCE = 160;
export const MIN_TRIP_SECONDS = 4;
export const MAX_TRIP_SECONDS = 60;

/** Legacy flat trip time. Saves written before per-mode travel carry it, and still resume. */
export const TRAVEL_DURATION = 5;
