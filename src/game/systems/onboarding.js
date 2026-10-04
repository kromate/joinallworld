/**
 * OWNER: character
 * Character creation: gender/appearance, traits, dream, birth lottery, starting district.
 *
 * State key: `onboarding` — keep everything this system stores under state.onboarding.
 * Valid-but-empty placeholder, already registered by systems/index.js. Fill in sanitize
 * (validate every saved field), actions, advance, view, and optional on/modifiers/activities.
 * The full contract is in src/game/registry.js. Import only registry.js, util.js, clock.js,
 * api.js and content/*.
 */
export default {
  id: 'onboarding',
  stateKeys: ['onboarding'],
  sanitize(input, state) { state.onboarding = {}; },
  actions: {},
  advance() {},
};
