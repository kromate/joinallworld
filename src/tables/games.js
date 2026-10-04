/**
 * OWNER: growth
 * The registry of table games: one rules object per game (the contract is in ./rules.js).
 */
import whot from './whot.js';
import penalty from './penalty.js';

/** @type {Record<string, import('./rules.js').TableRules>} */
export const GAMES = Object.freeze({ whot, penalty });
