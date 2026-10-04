/**
 * OWNER: growth
 * The registry of table games: one rules object per game (the contract is in ./rules.ts).
 */
import whot from './whot.ts';
import penalty from './penalty.ts';

export const GAMES = Object.freeze({ whot, penalty });
