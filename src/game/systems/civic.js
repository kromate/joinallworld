/**
 * OWNER: civic
 * Per-life civic state: votes cast, plots and billboards owned, hunt progress (shared city state lives in server/routes/civic.js).
 *
 * State key: `civic` — keep everything this system stores under state.civic.
 * Valid-but-empty placeholder, already registered by systems/index.js. Fill in sanitize
 * (validate every saved field), actions, advance, view, and optional on/modifiers/activities.
 * The full contract is in src/game/registry.js. Import only registry.js, util.js, clock.js,
 * api.js and content/*.
 */
export default {
  id: 'civic',
  stateKeys: ['civic'],
  sanitize(input, state) { state.civic = {}; },
  actions: {},
  advance() {},
};
