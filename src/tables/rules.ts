/**
 * OWNER: growth
 * THE CONTRACT FOR A TABLE GAME — every game under src/tables/ is one object of this shape.
 *
 * A game's rules are PURE: no clock, no I/O, no randomness except through the `rng` argument
 * (a () => float in [0, 1) the server seeds and never shares). State, moves and views are plain
 * JSON. The same file runs on the server, which is the only judge, and in the browser, which may
 * use it to show what is legal but never to decide anything.
 */

import type { TableOptionValue } from '../types/growth.ts'
import { isRecord } from '../game/util.ts'

export type { TableOptionValue }

/** How a game ended. `reason` is machine-readable: 'empty-hand', 'count', 'goals', 'forfeit', … */
export interface Outcome {
  /** Seats that won; empty for a draw or a game called off. */
  winners: number[]
  draw: boolean
  reason: string
  /** One sentence for people, with "{0}", "{1}", … for seat names. */
  text: string
  /** Per seat (what a score means is the game's own). */
  scores: number[]
}

/** The contested rules a table may choose: a game's options as the values a table holds, by name. */
export type TableOptions = Record<string, TableOptionValue>

/** One contested rule: what it is called, the values it may take, its default, and optional names for the values. */
export interface TableOptionSpec<Value extends TableOptionValue = TableOptionValue> {
  label: string
  values: readonly Value[]
  default: Value
  names?: readonly string[]
}
export type TableOptionSpecs<Options> = { [Name in keyof Options]: TableOptionSpec<Extract<Options[Name], TableOptionValue>> }

/** Every game's state carries the options its table chose (and nothing here ever shares it: a player only gets a `View`). */
export interface TableState { options: object }

/**
 * @typeParam State  the server's own state (plain JSON)
 * @typeParam Move   a move (plain JSON)
 * @typeParam View   what a seat (or a watcher) may see
 */
export interface TableRules<State extends TableState = TableState, Move = unknown, View = unknown> {
  /** 'whot', 'penalty' */
  id: string
  /** 'Whot' */
  label: string
  seats: { min: number; max: number }
  /** How long a seat has to move before `timeout` plays for it. */
  turnSeconds: number
  /** Contested rules a table may choose; anything else is ignored. */
  options: TableOptionSpecs<State['options']>
  start: (seats: number, rng: () => number, options: State['options']) => State
  /** The seats that may move now; [] once the game is over. */
  toMove: (state: State) => number[]
  /** Untrusted input → a move, or throws RulesError. */
  parseMove: (input: unknown) => Move
  /** The state after the move; never changes `state`; throws RulesError with a sentence for the player when the move is not allowed. */
  apply: (state: State, seat: number, move: Move, rng: () => number) => State
  outcome: (state: State) => Outcome | null
  /** What a seat (or a watcher: null) may see. Hidden things (another hand, the market's order) are NOT in it. */
  view: (state: State, seat: number | null) => View
  /** A legal move for the computer. */
  bot: (state: State, seat: number, rng: () => number) => Move
  /** The state after the clock played for a seat. */
  timeout: (state: State, seat: number, rng: () => number) => State
  /** The seat leaves; the others play on or win. */
  forfeit: (state: State, seat: number) => State
  /** A line for the table's log (state BEFORE the move). */
  describe: (state: State, seat: number, move: Move) => string
  /** Optional: extra log lines once a move has been applied (a result that was secret until now), with "{0}" for seat names. */
  report?: (before: State, after: State) => string[]
  /** Real moves made per seat (a game is called off if someone never really played). */
  moved: (state: State) => number[]
  /**
   * Optional: true for a move that is not a turn of play (resign, offer a draw): any seated player may make it at any time, it
   * does not stop or restart the clock, and it does not count as a real move for `moved`.
   */
  side?: (move: Move) => boolean
  /** Optional: how many milliseconds the seat to move has for its move; without it `turnSeconds` is the limit of every move. */
  clockMs?: (state: State) => number
  /**
   * Optional: the time the mover took, charged to a game that keeps its own clocks. The server calls it with its own measure
   * just before it applies a real move; the state it returns may be a game already lost on time.
   */
  charge?: (state: State, seat: number, elapsedMs: number) => State
}

/** Thrown by a rules module for a move that is not allowed. `message` is shown to the player. */
export class RulesError extends Error {}

/** A shuffled copy (Fisher–Yates) drawn from `rng`. */
export function shuffled<Item>(list: readonly Item[], rng: () => number): Item[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j] as Item, out[i] as Item]; } // both indices are in range
  return out;
}

/** The options a table plays with: each known option's chosen value when it is one of its values, otherwise its default. */
export function cleanOptions<Options extends TableOptions>(rules: { options: TableOptionSpecs<Options> }, given?: unknown): Options {
  const source: Record<string, unknown> = isRecord(given) ? given : {};
  const out: TableOptions = {};
  for (const [name, option] of Object.entries<TableOptionSpec>(rules.options)) {
    const chosen = source[name];
    out[name] = option.values.some((value) => value === chosen) ? chosen as TableOptionValue : option.default; // chosen is one of the option's own values
  }
  return out as Options; // the loop fills exactly the spec's names, each with one of its own values
}

/** Fill "{0}", "{1}" … in an outcome's sentence with seat names. */
export const withNames = (text: unknown, names: readonly string[]): string => String(text).replace(/\{(\d+)\}/g, (all: string, index: string) => names[Number(index)] ?? 'someone');

/**
 * Elo for two players. `score` is 1, 0.5 or 0 for the first. K is 40 for a player's first 10
 * rated games, 24 up to 30, then 16. Returns the two changes (whole numbers).
 */
export const RATING = Object.freeze({ start: 1200, floor: 100, provisionalGames: 5 });
export function eloChange(a: { rating: number; played: number }, b: { rating: number; played: number }, score: number): [number, number] {
  const k = (played: number) => (played < 10 ? 40 : played < 30 ? 24 : 16);
  const expected = 1 / (1 + 10 ** ((b.rating - a.rating) / 400));
  return [Math.round(k(a.played) * (score - expected)), Math.round(k(b.played) * ((1 - score) - (1 - expected)))];
}
