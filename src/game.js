const INITIAL = {
  cash: 5000,
  energy: 100,
  hunger: 100,
  health: 100,
  job: null,
  deliveries: 0,
  homeOwned: false,
  message: 'Welcome to Lagos! Pick up a delivery job to explore the city.',
};

const clamp = (value) => Math.max(0, Math.min(100, value));
const validNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const safeMoney = (value, fallback) =>
  Number.isSafeInteger(value) && value >= 0 ? value : fallback;

/** Return a fresh validated state. Hunger is fullness: 100 means well fed. */
export function createGame(saved) {
  const input = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  const state = { ...INITIAL };
  state.cash = safeMoney(input.cash, INITIAL.cash);
  state.deliveries = safeMoney(input.deliveries, 0);
  for (const need of ['energy', 'hunger', 'health']) {
    if (validNumber(input[need])) state[need] = clamp(input[need]);
  }
  if (input.job === 'pickup' || input.job === 'dropoff') state.job = input.job;
  state.homeOwned = input.homeOwned === true;
  if (typeof input.message === 'string' && input.message.length <= 500) {
    state.message = input.message;
  }
  return state;
}

/** Actions mutate and return the same state; their result is described in message. */
export function chooseJob(state) {
  if (state.job) {
    state.message = state.job === 'pickup'
      ? 'Your delivery is waiting at the Market.'
      : 'Take your package to the Office.';
  } else {
    state.job = 'pickup';
    state.message = 'Delivery accepted! Collect the package at the Market.';
  }
  return state;
}

export function buyHome(state) {
  if (state.homeOwned) {
    state.message = 'This home is already yours. Welcome back!';
  } else if (state.cash < 12000) {
    state.message = 'A home costs ₦12,000. Complete more deliveries to save up.';
  } else {
    state.cash -= 12000;
    state.homeOwned = true;
    state.message = 'You bought your Lagos home! Visit to rest and recover energy.';
  }
  return state;
}

export function interact(state, venueId) {
  const venue = typeof venueId === 'string' ? venueId.toLowerCase() : '';
  switch (venue) {
    case 'market':
      if (state.job === 'pickup') {
        state.job = 'dropoff';
        state.message = 'Package collected! Deliver it to the Office for ₦1,500.';
      } else {
        state.message = state.job === 'dropoff'
          ? 'You have the package already. Head to the Office.'
          : 'The Market is bustling. Accept a delivery job to collect a package.';
      }
      break;
    case 'office':
      if (state.job === 'dropoff') {
        state.cash += 1500;
        state.deliveries += 1;
        state.job = null;
        state.message = 'Delivery complete! You earned ₦1,500.';
      } else {
        state.message = state.job === 'pickup'
          ? 'Collect the package at the Market first.'
          : 'Accept a delivery job to earn ₦1,500.';
      }
      break;
    case 'amala':
      if (state.cash >= 500) {
        state.cash -= 500;
        state.hunger = 100;
        state.energy = clamp(state.energy + 25);
        state.message = 'Fresh amala! Fullness restored and energy boosted for ₦500.';
      } else {
        state.message = 'An amala meal costs ₦500. You need more cash.';
      }
      break;
    case 'hospital':
      if (state.health >= 100) {
        state.message = 'You are healthy. No treatment needed.';
      } else if (state.cash >= 300) {
        state.cash -= 300;
        state.health = 100;
        state.message = 'Treatment complete. Health restored for ₦300.';
      } else {
        state.message = 'Hospital treatment costs ₦300. You need more cash.';
      }
      break;
    case 'home':
      if (!state.homeOwned) return buyHome(state);
      state.energy = 100;
      state.message = 'Home sweet home. You rested and restored your energy.';
      break;
    default:
      state.message = 'Explore Lagos and visit a venue to interact.';
  }
  return state;
}

/** Advance needs by elapsed seconds. Invalid or negative time is ignored. */
export function updateNeeds(state, dt) {
  if (!validNumber(dt) || dt <= 0) return state;
  // Integrate deprivation over the whole interval so frame rate does not affect health.
  const hungrySeconds = Math.max(0, dt - state.hunger / 0.12);
  const exhaustedSeconds = Math.max(0, dt - state.energy / 0.08);
  state.hunger = clamp(state.hunger - dt * 0.12);
  state.energy = clamp(state.energy - dt * 0.08);
  state.health = clamp(state.health - (hungrySeconds + exhaustedSeconds) * 0.05);
  return state;
}
