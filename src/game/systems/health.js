/**
 * OWNER: world
 * Weather and illness: moodlets from rain and sickness (api.addMoodlet), hospital treatment.
 *
 * State key: `health` — keep everything this system stores under state.health.
 * Valid-but-empty placeholder, already registered by systems/index.js. Fill in sanitize
 * (validate every saved field), actions, advance, view, and optional on/modifiers/activities.
 * The full contract is in src/game/registry.js. Import only registry.js, util.js, clock.js,
 * api.js and content/*.
 */
export default {
  id: 'health',
  stateKeys: ['health'],
  sanitize(input, state) { state.health = {}; },
  actions: {},
  advance() {},
};
