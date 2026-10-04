/**
 * OWNER: growth
 * The registry of table games: one rules object per game (the contract is in ./rules.js).
 */
import whot from './whot.ts';
import penalty from './penalty.ts';

/** @type {Record<string, import('./rules.ts').TableRules>} */
export const GAMES = Object.freeze({ whot, penalty });
