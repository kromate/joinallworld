const NEEDS = ['hunger', 'energy', 'fun', 'social', 'hygiene', 'bladder'];
const clamp = (value) => Math.min(100, Math.max(0, value));
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const result = (state, ok, code) => ({ ok, code, state });

// Five seconds is a local preview convenience; reference travel timing is unknown.
export const PREVIEW_TRAVEL_DURATION = 5;
export const TRAVEL_OPTIONS = Object.freeze({ trek: 0, keke: 150, danfo: 150, okada: 200, cab: 400 });
export const TRAVEL_EVIDENCE = Object.freeze({
  source: 'A06: observed transport menu fees',
  placeholder: true,
  timing: 'Five-second local-preview duration; exact reference duration and roadside events unverified.',
  cancellation: 'No refund in local preview; reference cancellation policy unverified.',
});

const actions = {
  chill: { id: 'chill', label: 'Chill Under the Trees', duration: 11, cost: 0, effects: { energy: 4, fun: 10 } },
  'stage-play': { id: 'stage-play', label: 'Stage Play', duration: 14, cost: 400, tags: ['fun'], unavailable: true },
  comedy: { id: 'comedy', label: 'Comedy', duration: 11, cost: 500, tags: ['fun', 'social'], unavailable: true },
  'spoken-word': { id: 'spoken-word', label: 'Spoken Word', duration: 9, cost: 0, choice: 'Choose', unavailable: true },
  'perform-comedy': { id: 'perform-comedy', label: 'Perform Comedy', duration: 11, requiredSkill: { name: 'Comedy', level: 3 }, locked: true, unavailable: true },
  'play-ayo': { id: 'play-ayo', label: 'Play Ayo', duration: 7, cost: 0, tags: ['fun', 'social'], unavailable: true },
};
for (const action of Object.values(actions)) {
  action.source = action.id === 'chill' ? 'A05: completed Freedom Park Chill observation'
    : 'A05: Freedom Park activity menu observations';
  action.placeholder = Boolean(action.unavailable);
  action.evidence = action.unavailable ? 'Label and requirements observed; completion outcome unverified.'
    : 'Completed Chill: 11 seconds, energy +4, fun +10.';
}

export const VENUES = {
  park: {
    id: 'park', label: 'Freedom Park', district: 'Lagos Island',
    spots: {
      amphitheatre: { id: 'amphitheatre', label: 'Amphitheatre', actions: [actions['stage-play'], actions.comedy, actions['spoken-word'], actions['perform-comedy']] },
      art: { id: 'art', label: 'Art gallery', actions: [] },
      trees: { id: 'trees', label: 'Under the trees', actions: [actions.chill, actions['play-ayo']] },
      drinks: { id: 'drinks', label: 'Drinks kiosk', actions: [] },
      people: { id: 'people', label: 'People', actions: [] },
    },
  },
  library: { id: 'library', label: 'The Library', district: 'Victoria Island', spots: {} },
};
for (const venue of Object.values(VENUES)) {
  venue.source = venue.id === 'park' ? 'A05: Freedom Park venue and spot observations'
    : 'A06: destination menu observation';
  venue.placeholder = venue.id === 'library';
  for (const spot of Object.values(venue.spots)) {
    spot.source = venue.source;
    spot.placeholder = spot.actions.length === 0;
  }
}

function validActive(value, location) {
  if (!isRecord(value) || !finite(value.remaining) || value.remaining <= 0) return null;
  if (value.kind === 'activity') {
    const action = actions[value.id];
    if (location !== 'park' || !action || action.unavailable || value.duration !== action.duration
      || value.remaining > action.duration) return null;
    return { kind: 'activity', id: action.id, duration: action.duration, remaining: value.remaining };
  }
  if (value.kind === 'travel' && Object.hasOwn(VENUES, value.id)
    && value.id !== location && value.duration === PREVIEW_TRAVEL_DURATION
    && value.remaining <= PREVIEW_TRAVEL_DURATION) {
    return { kind: 'travel', id: value.id, duration: PREVIEW_TRAVEL_DURATION, remaining: value.remaining };
  }
  return null;
}

/** Fresh local-preview seed: ₦5,000 and all needs 50, not reference-game defaults.
 * Valid saved values take precedence. Needs are satisfaction scores from 0 to 100.
 * Mutations return {ok,code,state}; createLife returns state itself.
 * Remaining time is restored as saved: offline time is paused, with no wall-clock catchup.
 */
export function createLife(saved) {
  const input = isRecord(saved) ? saved : {};
  const location = Object.hasOwn(VENUES, input.location) ? input.location : 'park';
  const spots = VENUES[location].spots;
  const needs = {};
  for (const need of NEEDS) {
    const value = isRecord(input.needs) ? input.needs[need] : input[need];
    needs[need] = finite(value) ? clamp(value) : 50;
  }
  return {
    cash: Number.isSafeInteger(input.cash) && input.cash >= 0 ? input.cash : 5000,
    name: typeof input.name === 'string' ? input.name.trim().slice(0, 24) || 'New Lagosian' : 'New Lagosian',
    homeOwned: input.homeOwned === true,
    needs,
    location,
    spot: Object.hasOwn(spots, input.spot) ? input.spot : location === 'park' ? 'amphitheatre' : null,
    activeAction: validActive(input.activeAction, location),
    message: typeof input.message === 'string' && input.message.length <= 500 ? input.message : '',
  };
}

export function startActivity(state, id) {
  if (state.activeAction) {
    state.message = 'Finish or cancel your current action first.';
    return result(state, false, 'busy');
  }
  const spot = VENUES[state.location]?.spots[state.spot];
  const action = spot?.actions.find((item) => item.id === id);
  if (!action || action.unavailable || action.locked) {
    state.message = 'This activity is unavailable in the local preview.';
    return result(state, false, 'unavailable');
  } else if (state.cash < action.cost) {
    state.message = 'You do not have enough cash for this activity.';
    return result(state, false, 'insufficient_funds');
  } else {
    state.cash -= action.cost;
    state.activeAction = { kind: 'activity', id, duration: action.duration, remaining: action.duration };
    state.message = action.label;
  }
  return result(state, true, 'started');
}

/** Local-preview policy pending observation: cancel grants no effects and refunds no travel fare. */
export function cancelActivity(state) {
  if (state.activeAction) {
    state.activeAction = null;
    state.message = 'Action cancelled.';
    return result(state, true, 'cancelled');
  }
  return result(state, false, 'idle');
}

export function advanceLife(state, dt) {
  if (!finite(dt) || dt <= 0) return result(state, false, 'invalid_time');
  if (!state.activeAction) return result(state, true, 'idle');
  const active = state.activeAction;
  active.remaining = Math.max(0, active.remaining - dt);
  if (active.remaining > 0) return result(state, true, 'advanced');
  state.activeAction = null;
  if (active.kind === 'activity') {
    const action = actions[active.id];
    for (const [need, amount] of Object.entries(action.effects)) {
      state.needs[need] = clamp(state.needs[need] + amount);
    }
    state.message = `${action.label} completed.`;
  } else {
    state.location = active.id;
    state.spot = active.id === 'park' ? 'amphitheatre' : null;
    state.message = `Arrived at ${VENUES[active.id].label}.`;
  }
  return result(state, true, 'completed');
}

export function startTravel(state, destination, mode) {
  if (state.activeAction) {
    state.message = 'Finish or cancel your current action first.';
    return result(state, false, 'busy');
  } else if (!Object.hasOwn(VENUES, destination) || !Object.hasOwn(TRAVEL_OPTIONS, mode)) {
    state.message = 'Choose a valid destination and travel option.';
    return result(state, false, 'invalid_travel');
  } else if (destination === state.location) {
    state.message = 'You are already here.';
    return result(state, false, 'already_here');
  } else if (state.cash < TRAVEL_OPTIONS[mode]) {
    state.message = 'You do not have enough cash for this fare.';
    return result(state, false, 'insufficient_funds');
  } else {
    state.cash -= TRAVEL_OPTIONS[mode];
    state.activeAction = {
      kind: 'travel', id: destination,
      duration: PREVIEW_TRAVEL_DURATION, remaining: PREVIEW_TRAVEL_DURATION,
    };
    state.message = `Travelling to ${VENUES[destination].label}.`;
  }
  return result(state, true, 'started');
}
