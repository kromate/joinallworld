/**
 * Types of the rules engine (src/game, src/life.js).
 *
 * life.ts, view.ts, actions.ts, registry.ts and campus.ts also export a few runtime lists
 * (LIFE_STATE_KEYS, VIEW_KEYS, ACTION_TYPES …) that engine.test.ts checks against the running
 * code, so they are re-exported with their values; content.ts is types only.
 */
export * from './life.ts'
export * from './view.ts'
export * from './actions.ts'
export type * from './content.ts'
export * from './registry.ts'
// The UNILAG campus (src/campus/unilag): its three systems' state, timed actions, actions, events, views and routes.
export * from './campus.ts'
