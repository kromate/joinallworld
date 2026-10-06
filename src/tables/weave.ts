/**
 * OWNER: growth
 * Weave: weave words on the cloth. The rules and the computer player are in ./weave-core.ts (they take the
 * word list as a parameter); this module binds the real list. The board, premium squares and the live score
 * preview, with no word list, are in ./weave-board.ts (safe for the browser). SERVER ONLY: this imports the
 * whole word list, so the browser takes only types from here.
 */
import { makeWeave, warmBot } from './weave-core.ts';
import { ready } from '../words/dict.ts';
import { wordList } from './weave-words.ts';

export { side, SCORELESS_LIMIT, EXCHANGE_MIN_BAG, HISTORY_SHOWN, TURN_SECONDS, MISSED_TURNS_BEFORE_FORFEIT, leaveValue } from './weave-core.ts';
export type { WeaveMove, WeaveOptions, WeaveRules, WeaveState, WeaveTurn, WeaveView } from './weave-core.ts';

const rules = makeWeave(wordList);
/** Inflate the word list (once) and prepare the computer player's tables. Await this before the first game of Weave: the rules look words up synchronously. */
export async function warm(): Promise<void> {
  await ready();
  warmBot(wordList);
}
export default rules;
