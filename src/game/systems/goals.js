/**
 * OWNER: character
 * Starter goal chain, wishes, stars, perks and dream progress. Observe other systems through `on` listeners; grant perks through `modifiers`.
 *
 * State key: `goals` — keep everything this system stores under state.goals.
 * Valid-but-empty placeholder, already registered by systems/index.js. Fill in sanitize
 * (validate every saved field), actions, advance, view, and optional on/modifiers/activities.
 * The full contract is in src/game/registry.js. Import only registry.js, util.js, clock.js,
 * api.js and content/*.
 */
export default {
  id: 'goals',
  stateKeys: ['goals'],
  sanitize(input, state) { state.goals = {}; },
  actions: {},
  advance() {},
};
