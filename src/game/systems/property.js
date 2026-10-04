/**
 * OWNER: home
 * Houses and cars: owning, renting, moving, selling.
 *
 * State keys: homeOwned (legacy boolean carried from existing saves — keep it loading) and
 * `property` for everything new. Spend and earn only through api.js (debit/credit).
 * Valid-but-empty placeholder: add actions, advance and view here.
 */
export default {
  id: 'property',
  stateKeys: ['homeOwned', 'property'],
  sanitize(input, state) {
    state.homeOwned = input.homeOwned === true;
    state.property = {};
  },
  actions: {},
  advance() {},
};
