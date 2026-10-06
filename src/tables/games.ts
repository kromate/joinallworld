/**
 * OWNER: growth
 * The registry of table games: one rules object per game (the contract is in ./rules.ts).
 * Only the server imports this file, so the board games' rules and word lists never reach the browser.
 */
import whot from './whot.ts';
import penalty from './penalty.ts';
import chess from './chess.ts';
import weave from './weave.ts';

export const GAMES = Object.freeze({ whot, penalty, chess, weave });
