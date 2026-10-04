/**
 * OWNER: career
 * Rent, loans and debt, weekly billing (use clock.js lagosTime().week to detect a new week; charge through api.debit so the ledger explains it).
 *
 * State key: `economy` — keep everything this system stores under state.economy.
 * Valid-but-empty placeholder, already registered by systems/index.js. Fill in sanitize
 * (validate every saved field), actions, advance, view, and optional on/modifiers/activities.
 * The full contract is in src/game/registry.js. Import only registry.js, util.js, clock.js,
 * api.js and content/*.
 */
export default {
  id: 'economy',
  stateKeys: ['economy'],
  sanitize(input, state) { state.economy = {}; },
  actions: {},
  advance() {},
};
