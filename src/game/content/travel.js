/**
 * OWNER: world
 * Travel content: modes, fares, durations, need costs and roadside events.
 * Fares follow the transport menu observed in the reference game. The flat five-second
 * duration and the no-refund cancellation rule are original beta values.
 */
export const TRAVEL_MODES = {
  trek: { id: 'trek', label: 'Trek', icon: '🚶', fare: 0 },
  keke: { id: 'keke', label: 'Keke', icon: '🛺', fare: 150 },
  danfo: { id: 'danfo', label: 'Danfo', icon: '🚌', fare: 150 },
  okada: { id: 'okada', label: 'Okada', icon: '🏍️', fare: 200 },
  cab: { id: 'cab', label: 'Cab', icon: '🚕', fare: 400 },
};

/** Seconds for every trip (original beta value). */
export const TRAVEL_DURATION = 5;
