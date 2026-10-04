/**
 * OWNER: home
 * Home interior: placement grid, buy/sell/move/rotate furniture, object actions (attach them as activities with where: { venue: 'home', spot }).
 *
 * State key: `home` — keep everything this system stores under state.home.
 * Valid-but-empty placeholder, already registered by systems/index.js. Fill in sanitize
 * (validate every saved field), actions, advance, view, and optional on/modifiers/activities.
 * The full contract is in src/game/registry.js. Import only registry.js, util.js, clock.js,
 * api.js and content/*.
 */
export default {
  id: 'home',
  stateKeys: ['home'],
  sanitize(input, state) { state.home = {}; },
  actions: {},
  advance() {},
};
