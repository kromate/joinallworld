/**
 * OWNER: growth
 * Penalties: a shoot-out for two. Pure rules (see ./rules.js for the contract).
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
import { RulesError } from './rules.js';

export const ZONES = Object.freeze(['Left', 'Centre', 'Right']);
export const SUDDEN_ROUNDS = 5;
const clone = (state) => ({ ...state, picks: state.picks.slice(), goals: state.goals.slice(), taken: state.taken.slice(), history: state.history.slice(), out: state.out.slice(), moves: state.moves.slice() });
/** Who shoots the next kick: seats alternate, seat 0 first. */
export const kickerOf = (state) => state.kick % 2;

function settle(state) {
  const each = state.options.kicks, [a, b] = state.goals, [ta, tb] = state.taken;
  const win = (seat, text) => { state.over = { winners: [seat], draw: false, reason: 'goals', text, scores: state.goals.slice() }; };
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

function apply(before, seat, move) {
  if (before.over) throw new RulesError('The shoot-out is over.');
  if (seat !== 0 && seat !== 1) throw new RulesError('You are not in this shoot-out.');
  if (before.picks[seat] !== null) throw new RulesError('You have chosen. Wait for the other player.');
  const state = clone(before);
  state.picks[seat] = move.z;
  state.moves[seat] += 1;
  if (state.picks[0] === null || state.picks[1] === null) return state;
  const kicker = kickerOf(state), shot = state.picks[kicker], dive = state.picks[1 - kicker], goal = shot !== dive;
  state.history.push({ kicker, shot, dive, goal });
  if (goal) state.goals[kicker] += 1;
  state.taken[kicker] += 1;
  state.kick += 1;
  state.picks = [null, null];
  settle(state);
  return state;
}

function view(state, seat) {
  const mine = seat === 0 || seat === 1;
  return { game: 'penalty', options: state.options, kick: state.kick, kicker: state.over ? null : kickerOf(state), goals: state.goals, taken: state.taken, history: state.history,
    // Who has chosen — never what. Your own choice is shown to you only.
    chosen: state.picks.map((pick) => pick !== null), mine: mine ? state.picks[seat] : null,
    sudden: state.taken[0] >= state.options.kicks && state.taken[1] >= state.options.kicks && !state.over, over: state.over };
}

/** @type {import('./rules.js').TableRules} */
export default {
  id: 'penalty', label: 'Penalties', seats: { min: 2, max: 2 }, turnSeconds: 15,
  options: { kicks: { label: 'Kicks each', values: [3, 5], default: 5 } },
  start: (seats, rng, options) => ({ options, kick: 0, picks: [null, null], goals: [0, 0], taken: [0, 0], history: [], out: [false, false], moves: [0, 0], over: null }),
  toMove: (state) => (state.over ? [] : [0, 1].filter((seat) => state.picks[seat] === null)),
  parseMove(input) { if (input?.z === 0 || input?.z === 1 || input?.z === 2) return { z: input.z }; throw new RulesError('Choose left, centre or right.'); },
  apply, view,
  outcome: (state) => state.over,
  bot: (state, seat, rng) => ({ z: Math.floor(rng() * 3) }),
  // The clock ran out: a side is chosen for the seat, from the server's own generator.
  timeout: (state, seat, rng) => apply(state, seat, { z: Math.floor(rng() * 3) }),
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
    return [kick.goal ? `GOAL! {${kick.kicker}} shot ${ZONES[kick.shot].toLowerCase()}, {${1 - kick.kicker}} went ${ZONES[kick.dive].toLowerCase()}. ${after.goals[0]}–${after.goals[1]}` : `SAVED! {${1 - kick.kicker}} guessed ${ZONES[kick.dive].toLowerCase()}. ${after.goals[0]}–${after.goals[1]}`];
  },
  moved: (state) => state.moves.slice(),
};
