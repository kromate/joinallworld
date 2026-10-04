/**
 * OWNER: social
 * NPC interactions and relationships (player-to-player messaging lives in server/routes/social.js and server/ws/social.js).
 *
 * State key: `social` — keep everything this system stores under state.social.
 * Valid-but-empty placeholder, already registered by systems/index.js. Fill in sanitize
 * (validate every saved field), actions, advance, view, and optional on/modifiers/activities.
 * The full contract is in src/game/registry.js. Import only registry.js, util.js, clock.js,
 * api.js and content/*.
 */
export default {
  id: 'social',
  stateKeys: ['social'],
  sanitize(input, state) { state.social = {}; },
  actions: {},
  advance() {},
};
