/**
 * OWNER: growth
 * Penalties: a shoot-out for two. Pure rules (see ./rules.ts for the contract).
 *
 * THE GAME — Players take turns to shoot; the other keeps goal. For each kick BOTH choose a side
 * at the same time — left, centre or right — and neither sees the other's choice until both are
 * in. The keeper who chose the same side saves it; otherwise it is a goal. After `kicks` kicks each
 * (five by default) the most goals wins; it ends early once one side cannot be caught. Level after
 * that, it goes to sudden death: one kick each until someone leads, for at most five more rounds,
 * and then it is a draw.
 *
 * Nothing here depends on reflexes or on the speed of a connection: a choice is a tap, and the
 * server reveals both together.
 *
 * STATE (the server's own; a player only ever gets `view`)
 *   { options, kick: kicks taken so far, picks: [zone | null, zone | null] for the kick being
 *     chosen, goals: [n, n], taken: [n, n], history: [{ kicker, shot, dive, goal }],
 *     out: [bool, bool], moves: [n, n], over: Outcome | null }
 * MOVE  { z: 0 | 1 | 2 }   (left, centre, right)
 */
import { RulesError } from './rules.ts';
import type { Outcome, TableRules } from './rules.ts';

export const ZONES = Object.freeze(['Left', 'Centre', 'Right'] as const);
/** One value per seat: a shoot-out is for two. */
type Pair<Value> = [Value, Value];
/** A side: 0 left, 1 centre, 2 right. */
export type Zone = 0 | 1 | 2;
export type PenaltyOptions = { kicks: 3 | 5 };
export type Kick = { kicker: 0 | 1; shot: Zone; dive: Zone; goal: boolean };
/** The server's own state of a shoot-out (see STATE above). */
export type PenaltyState = {
  options: PenaltyOptions; kick: number; picks: Pair<Zone | null>; goals: Pair<number>; taken: Pair<number>; history: Kick[];
  out: Pair<boolean>; moves: Pair<number>; over: Outcome | null;
};
export type PenaltyMove = { z: Zone };
/** What a seat (or a watcher) may see: who has chosen, never what. */
export type PenaltyView = {
  game: 'penalty'; options: PenaltyOptions; kick: number; kicker: number | null; goals: Pair<number>; taken: Pair<number>; history: Kick[];
  chosen: Pair<boolean>; mine: Zone | null; sudden: boolean; over: Outcome | null;
};
export const SUDDEN_ROUNDS = 5;
const clone = (state: PenaltyState): PenaltyState => ({ ...state, picks: [...state.picks], goals: [...state.goals], taken: [...state.taken], history: state.history.slice(), out: [...state.out], moves: [...state.moves] });
/** Who shoots the next kick: seats alternate, seat 0 first. */
export const kickerOf = (state: PenaltyState): 0 | 1 => (state.kick % 2) as 0 | 1; // the remainder of 2 is 0 or 1

function settle(state: PenaltyState): void {
  const each = state.options.kicks, [a, b] = state.goals, [ta, tb] = state.taken;
  const win = (seat: number, text: string) => { state.over = { winners: [seat], draw: false, reason: 'goals', text, scores: state.goals.slice() }; };
  if (ta <= each && tb <= each && (ta < each || tb < each)) {
    // The regular kicks: it ends as soon as one side cannot be caught with the kicks it has left.
    if (a > b + (each - tb)) win(0, `{0} wins the shoot-out ${a}–${b}.`);
    else if (b > a + (each - ta)) win(1, `{1} wins the shoot-out ${b}–${a}.`);
    return;
  }
  if (ta !== tb) return; // sudden death is decided only after both have kicked
  if (a !== b) win(a > b ? 0 : 1, `{${a > b ? 0 : 1}} wins the shoot-out ${Math.max(a, b)}–${Math.min(a, b)}${ta > each ? ' in sudden death' : ''}.`);
  else if (ta >= each + SUDDEN_ROUNDS) state.over = { winners: [], draw: true, reason: 'goals', text: `Still level at ${a}–${b} after sudden death. A draw.`, scores: state.goals.slice() };
}

function apply(before: PenaltyState, seat: number, move: PenaltyMove): PenaltyState {
  if (before.over) throw new RulesError('The shoot-out is over.');
  if (seat !== 0 && seat !== 1) throw new RulesError('You are not in this shoot-out.');
  if (before.picks[seat] !== null) throw new RulesError('You have chosen. Wait for the other player.');
  const state = clone(before);
  state.picks[seat] = move.z;
  state.moves[seat] += 1;
  const [first, second] = state.picks;
  if (first === null || second === null) return state;
  const kicker = kickerOf(state), shot = kicker === 0 ? first : second, dive = kicker === 0 ? second : first, goal = shot !== dive;
  state.history.push({ kicker, shot, dive, goal });
  if (goal) state.goals[kicker] += 1;
  state.taken[kicker] += 1;
  state.kick += 1;
  state.picks = [null, null];
  settle(state);
  return state;
}

function view(state: PenaltyState, seat: number | null): PenaltyView {
  const mine = seat === 0 || seat === 1;
  return { game: 'penalty', options: state.options, kick: state.kick, kicker: state.over ? null : kickerOf(state), goals: state.goals, taken: state.taken, history: state.history,
    // Who has chosen — never what. Your own choice is shown to you only.
    chosen: [state.picks[0] !== null, state.picks[1] !== null], mine: mine ? state.picks[seat] : null,
    sudden: state.taken[0] >= state.options.kicks && state.taken[1] >= state.options.kicks && !state.over, over: state.over };
}

/** A side chosen at random: `rng` is in [0, 1), so this is 0, 1 or 2. */
const randomZone = (rng: () => number): Zone => Math.floor(rng() * 3) as Zone;

/** The rules of the game. A shoot-out has secret choices, so it always has a `report`, and it needs no randomness to apply a move, so `apply` may be called without an `rng`. */
export type PenaltyRules = Omit<TableRules<PenaltyState, PenaltyMove, PenaltyView>, 'apply' | 'report'> & {
  apply: (state: PenaltyState, seat: number, move: PenaltyMove, rng?: () => number) => PenaltyState;
  report: (before: PenaltyState, after: PenaltyState) => string[];
};
const rules: PenaltyRules = {
  id: 'penalty', label: 'Penalties', seats: { min: 2, max: 2 }, turnSeconds: 15,
  options: { kicks: { label: 'Kicks each', values: [3, 5], default: 5 } },
  start: (seats, rng, options): PenaltyState => ({ options, kick: 0, picks: [null, null], goals: [0, 0], taken: [0, 0], history: [], out: [false, false], moves: [0, 0], over: null }),
  toMove: (state) => (state.over ? [] : [0, 1].filter((seat) => state.picks[seat] === null)),
  parseMove(input: unknown): PenaltyMove { const move = input as { z?: unknown } | null | undefined; /* untrusted: z is checked */ if (move?.z === 0 || move?.z === 1 || move?.z === 2) return { z: move.z }; throw new RulesError('Choose left, centre or right.'); },
  apply, view,
  outcome: (state) => state.over,
  bot: (state, seat, rng) => ({ z: randomZone(rng) }),
  // The clock ran out: a side is chosen for the seat, from the server's own generator.
  timeout: (state, seat, rng) => apply(state, seat, { z: randomZone(rng) }),
  forfeit(before, seat) {
    if (before.over) return before;
    const state = clone(before);
    state.out[seat] = true;
    state.over = { winners: [1 - seat], draw: false, reason: 'forfeit', text: `{${seat}} left the shoot-out. {${1 - seat}} wins.`, scores: state.goals.slice() };
    return state;
  },
  // A choice is secret until both are in, so the log never says which side.
  describe: (state, seat) => `{${seat}} is ready`,
  /** Lines for the log once a kick is decided (the service calls this with the states before and after a move). */
  report(before, after) {
    if (after.history.length === before.history.length) return [];
    const kick = after.history.at(-1);
    if (!kick) return []; // a decided kick was just added
    return [kick.goal ? `GOAL! {${kick.kicker}} shot ${ZONES[kick.shot].toLowerCase()}, {${1 - kick.kicker}} went ${ZONES[kick.dive].toLowerCase()}. ${after.goals[0]}–${after.goals[1]}` : `SAVED! {${1 - kick.kicker}} guessed ${ZONES[kick.dive].toLowerCase()}. ${after.goals[0]}–${after.goals[1]}`];
  },
  moved: (state) => state.moves.slice(),
};
export default rules;
