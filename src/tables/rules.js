/**
 * OWNER: growth
 * THE CONTRACT FOR A TABLE GAME — every game under src/tables/ is one object of this shape.
 *
 * A game's rules are PURE: no clock, no I/O, no randomness except through the `rng` argument
 * (a () => float in [0, 1) the server seeds and never shares). State, moves and views are plain
 * JSON. The same file runs on the server, which is the only judge, and in the browser, which may
 * use it to show what is legal but never to decide anything.
 *
 * @typedef {object} Outcome
 * @property {number[]} winners   seats that won; empty for a draw or a game called off
 * @property {boolean} draw
 * @property {string} reason      machine reason: 'empty-hand', 'count', 'goals', 'forfeit', …
 * @property {string} text        one sentence for people, with "{0}", "{1}", … for seat names
 * @property {number[]} scores    per seat (what a score means is the game's own)
 *
 * @typedef {object} TableRules
 * @property {string} id                    'whot', 'penalty'
 * @property {string} label                 'Whot'
 * @property {{ min: number, max: number }} seats
 * @property {number} turnSeconds           how long a seat has to move before `timeout` plays for it
 * @property {Record<string, { label: string, values: any[], default: any, names?: string[] }>} options
 *                                          contested rules a table may choose; anything else is ignored
 * @property {(seats: number, rng: () => number, options: object) => object} start
 * @property {(state: object) => number[]} toMove      the seats that may move now; [] once the game is over
 * @property {(input: unknown) => object} parseMove    untrusted input → a move, or throws RulesError
 * @property {(state: object, seat: number, move: object, rng: () => number) => object} apply
 *                                          the state after the move; never changes `state`; throws RulesError
 *                                          with a sentence for the player when the move is not allowed
 * @property {(state: object) => Outcome | null} outcome
 * @property {(state: object, seat: number | null) => object} view   what a seat (or a watcher: null) may see.
 *                                          Hidden things — another hand, the market's order — are NOT in it.
 * @property {(state: object, seat: number, rng: () => number) => object} bot   a legal move for the computer
 * @property {(state: object, seat: number, rng: () => number) => object} timeout  the state after the clock played for a seat
 * @property {(state: object, seat: number) => object} forfeit   the seat leaves; the others play on or win
 * @property {(state: object, seat: number, move: object) => string} describe   a line for the table's log (state BEFORE the move)
 * @property {(state: object) => number[]} moved   real moves made per seat (a game is called off if someone never really played)
 */

/** Thrown by a rules module for a move that is not allowed. `message` is shown to the player. */
export class RulesError extends Error {}

/** A shuffled copy (Fisher–Yates) drawn from `rng`. */
export function shuffled(list, rng) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/** The options a table plays with: each known option's chosen value when it is one of its values, otherwise its default. */
export function cleanOptions(rules, given) {
  const out = {};
  for (const [name, option] of Object.entries(rules.options)) out[name] = option.values.includes(given?.[name]) ? given[name] : option.default;
  return out;
}

/** Fill "{0}", "{1}" … in an outcome's sentence with seat names. */
export const withNames = (text, names) => String(text).replace(/\{(\d+)\}/g, (all, index) => names[Number(index)] ?? 'someone');

/**
 * Elo for two players. `score` is 1, 0.5 or 0 for the first. K is 40 for a player's first 10
 * rated games, 24 up to 30, then 16. Returns the two changes (whole numbers).
 */
export const RATING = Object.freeze({ start: 1200, floor: 100, provisionalGames: 5 });
export function eloChange(a, b, score) {
  const k = (played) => (played < 10 ? 40 : played < 30 ? 24 : 16);
  const expected = 1 / (1 + 10 ** ((b.rating - a.rating) / 400));
  return [Math.round(k(a.played) * (score - expected)), Math.round(k(b.played) * ((1 - score) - (1 - expected)))];
}
