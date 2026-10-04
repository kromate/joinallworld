/**
 * OWNER: growth
 * Whot, as it is played in Nigeria. Pure rules (see ./rules.ts for the contract).
 *
 * THE PACK — 54 cards: Circles and Triangles 1 2 3 4 5 7 8 10 11 12 13 14 (12 each); Crosses and
 * Squares 1 2 3 5 7 10 11 13 14 (9 each); Stars 1 2 3 4 5 7 8 (7); and five Whot cards, numbered 20.
 *
 * THE GAME — Each player is dealt a hand; the rest is the MARKET, face down, and one card is
 * turned up to start the pile. On your turn, play a card that matches the top card's SHAPE or its
 * NUMBER, or play a Whot — or, if you cannot or would rather not, go to market: draw one card,
 * and your turn ends. The first player to empty their hand wins.
 *
 *   1  HOLD ON         everyone else waits: you play again
 *   2  PICK TWO        the next player draws two — unless they answer with a 2
 *   5  PICK THREE      the next player draws three — unless they answer with a 5
 *   8  SUSPENSION      the next player misses their turn
 *   14 GENERAL MARKET  every other player draws one, and you play again
 *   20 WHOT            goes on anything; you name the shape that must follow
 * "Last card!" is called for you when you are down to one card: nobody is punished for forgetting.
 *
 * WHERE HOUSES DIFFER — a table chooses (TABLE OPTIONS):
 *   hand    cards dealt: 4, 5 (default) or 6
 *   defend  what answering a Pick Two with a 2 (or a Pick Three with a 5) does:
 *             'pass'  (default) the penalty moves on to the next player unchanged
 *             'stack' it grows: each answer adds two (or three) more
 *   market  what happens when the market runs out:
 *             'count' (default) the game ends there; the lowest total in hand wins (a star counts
 *                     double, a Whot counts 20)
 *             'turn'  the pile, except its top card, is shuffled into a new market and play goes on
 *
 * STATE (the server's own; a player only ever gets `view`)
 *   { options, hands: [[card]], market: [card] (drawn from the end), pile: [card] (top last),
 *     call: shape | null, turn, pick: cards owed by `turn`, pickBy: 2 | 5 | null, out: [bool],
 *     moves: [n], said: [bool], last: { seat, text } | null, over: Outcome | null }
 *   card = { s: 'circle' | 'triangle' | 'cross' | 'square' | 'star' | 'whot', n }
 * MOVES   { t: 'play', i: index in hand, shape?: for a Whot }   { t: 'draw' }
 */
import { RulesError, shuffled } from './rules.ts';
import type { Outcome, TableRules } from './rules.ts';

export const SHAPES = Object.freeze(['circle', 'triangle', 'cross', 'square', 'star'] as const);
export type Shape = (typeof SHAPES)[number];
/** The shape of a card: one of the five, or the Whot. */
export type CardShape = Shape | 'whot';
export type Card = { s: CardShape; n: number };
/** What a table chose (see TABLE OPTIONS above). */
export type WhotOptions = { hand: 4 | 5 | 6; defend: 'pass' | 'stack'; market: 'count' | 'turn' };
/** The server's own state of a game (see STATE above). */
export type WhotState = {
  options: WhotOptions; hands: Card[][]; market: Card[]; pile: Card[]; call: Shape | null; turn: number; pick: number; pickBy: number | null;
  out: boolean[]; moves: number[]; said: boolean[]; last: { seat: number; text: string } | null; over: Outcome | null;
};
export type WhotMove = { t: 'play'; i: number; shape?: Shape } | { t: 'draw' };
/** What a seat (or a watcher: null) may see. */
export type WhotView = {
  game: 'whot'; options: WhotOptions; top: Card; call: Shape | null; market: number; pile: number; turn: number | null; pick: number; pickBy: number | null;
  counts: number[]; out: boolean[]; said: boolean[]; hand: Card[] | null; playable: number[]; over: Outcome | null; shown: Card[][] | null;
};

export const SHAPE_NAMES = Object.freeze({ circle: 'Circle', triangle: 'Triangle', cross: 'Cross', square: 'Square', star: 'Star', whot: 'Whot' });
const NUMBERS: Record<Shape, number[]> = { circle: [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14], triangle: [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14], cross: [1, 2, 3, 5, 7, 10, 11, 13, 14], square: [1, 2, 3, 5, 7, 10, 11, 13, 14], star: [1, 2, 3, 4, 5, 7, 8] };
export const WHOTS = 5;
export const SPECIAL: Readonly<Record<number, string>> = Object.freeze({ 1: 'Hold on', 2: 'Pick two', 5: 'Pick three', 8: 'Suspension', 14: 'General market', 20: 'Whot' });
const PICKS: Record<number, number> = { 2: 2, 5: 3 };
const isShape = (value: unknown): value is Shape => SHAPES.some((shape) => shape === value);

/** The whole pack, in a fixed order. */
export function pack(): Card[] {
  const cards: Card[] = [];
  for (const s of SHAPES) for (const n of NUMBERS[s]) cards.push({ s, n });
  for (let i = 0; i < WHOTS; i++) cards.push({ s: 'whot', n: 20 });
  return cards;
}
export const cardName = (card: Card): string => (card.s === 'whot' ? 'Whot' : `${SHAPE_NAMES[card.s]} ${card.n}`);
/** What a card left in hand counts when the market runs out: a star counts double. */
export const cardValue = (card: Card): number => (card.s === 'star' ? card.n * 2 : card.n);
const total = (hand: Card[]): number => hand.reduce((sum, card) => sum + cardValue(card), 0);
const clone = (state: WhotState): WhotState => ({ ...state, hands: state.hands.map((hand) => hand.slice()), market: state.market.slice(), pile: state.pile.slice(), out: state.out.slice(), moves: state.moves.slice(), said: state.said.slice() });
// The pile always holds the card turned up at the start, so it is never empty.
const top = (state: WhotState): Card => state.pile.at(-1) as Card;
const active = (state: WhotState): number[] => state.out.map((gone, seat) => (gone ? -1 : seat)).filter((seat) => seat >= 0);
function nextSeat(state: WhotState, from: number, steps = 1): number {
  let seat = from;
  for (let done = 0; done < steps;) { seat = (seat + 1) % state.hands.length; if (!state.out[seat]) done += 1; }
  return seat;
}

/** May `card` go on the pile now, for the seat to move? */
export function playable(state: WhotState, card: Card): boolean {
  if (state.pick > 0) return card.n === state.pickBy;       // under a Pick Two or Pick Three only the same number answers
  if (card.s === 'whot') return true;
  if (state.call) return card.s === state.call;              // after a Whot, the named shape (or another Whot)
  return card.s === top(state).s || card.n === top(state).n;
}

/** Take `count` cards from the market into a hand. Returns false when the market ran out and the game is counted. */
function draw(state: WhotState, seat: number, count: number, rng: () => number): boolean {
  for (let i = 0; i < count; i++) {
    if (!state.market.length) {
      if (state.options.market === 'turn' && state.pile.length > 1) { state.market = shuffled(state.pile.slice(0, -1), rng); state.pile = [top(state)]; }
      if (!state.market.length) { countOut(state); return false; }
    }
    const card = state.market.pop();
    if (card) state.hands[seat]?.push(card); // the market is not empty here
  }
  state.said[seat] = false;
  return true;
}

/** The market is finished: the lowest total in hand wins; equal lowest totals share it. */
function countOut(state: WhotState): void {
  const scores = state.hands.map((hand) => total(hand));
  const best = Math.min(...active(state).map((seat) => scores[seat] ?? 0)); // every seat has a score
  const winners = active(state).filter((seat) => scores[seat] === best);
  state.over = { winners: winners.length === 1 ? winners : [], draw: winners.length > 1, reason: 'count', scores,
    text: winners.length === 1 ? `The market finished. {${winners[0]}} wins on the count with ${best}.` : `The market finished and the count is level at ${best}. A draw.` };
}
function win(state: WhotState, seat: number, reason: string, text: string): void {
  state.over = { winners: [seat], draw: false, reason, text, scores: state.hands.map((hand) => total(hand)) };
}

function start(seats: number, rng: () => number, options: WhotOptions): WhotState {
  let cards = shuffled(pack(), rng);
  const hands: Card[][] = Array.from({ length: seats }, () => []);
  for (let round = 0; round < options.hand; round++) for (const hand of hands) { const card = cards.pop(); if (card) hand.push(card); } // the pack holds 54 cards
  // The first card on the pile is an ordinary one: special cards turned up go back under the market.
  const buried: Card[] = [];
  let up: Card | undefined;
  while (cards.length && !up) { const card = cards.pop(); if (card) { if (SPECIAL[card.n]) buried.push(card); else up = card; } }
  cards = [...buried, ...cards];
  // `up` is undefined only if the whole market were special cards, which the pack is not.
  return { options, hands, market: cards, pile: [up as Card], call: null, turn: 0, pick: 0, pickBy: null, out: hands.map(() => false), moves: hands.map(() => 0), said: hands.map(() => false), last: null, over: null };
}

function parseMove(input: unknown): WhotMove {
  const move = input as { t?: unknown; i?: unknown; shape?: unknown } | null | undefined; // untrusted input: every field is checked below
  if (move?.t === 'draw') return { t: 'draw' };
  if (move?.t === 'play' && typeof move.i === 'number' && Number.isInteger(move.i) && move.i >= 0 && move.i < 60) {
    if (move.shape !== undefined && !isShape(move.shape)) throw new RulesError('Name one of the five shapes.');
    return { t: 'play', i: move.i, ...(move.shape ? { shape: move.shape } : {}) };
  }
  throw new RulesError('That is not a move in Whot.');
}

function apply(before: WhotState, seat: number, move: WhotMove, rng: () => number): WhotState {
  if (before.over) throw new RulesError('The game is over.');
  if (seat !== before.turn) throw new RulesError('It is not your turn.');
  const state = clone(before), hand = state.hands[seat] ?? []; // a seat on turn always has a hand
  state.moves[seat] = (state.moves[seat] ?? 0) + 1;
  if (move.t === 'draw') {
    const owed = state.pick || 1;
    state.pick = 0; state.pickBy = null;
    if (draw(state, seat, owed, rng)) state.turn = nextSeat(state, seat);
    return state;
  }
  const card = hand[move.i];
  if (!card) throw new RulesError('You do not hold that card.');
  if (!playable(state, card)) {
    throw new RulesError(state.pick > 0 ? `You must answer with a ${state.pickBy} or go to market for ${state.pick}.`
      : state.call ? `${SHAPE_NAMES[state.call]}s were called. Play a ${SHAPE_NAMES[state.call]} or a Whot, or go to market.`
        : `${cardName(card)} does not go on ${cardName(top(state))}. Match the shape or the number, play a Whot, or go to market.`);
  }
  if (card.s === 'whot' && !move.shape && hand.length > 1) throw new RulesError('Name the shape you need.');
  hand.splice(move.i, 1);
  state.pile.push(card);
  state.call = null;
  if (!hand.length) { win(state, seat, 'empty-hand', `{${seat}} played their last card and wins. Check up!`); return state; }
  state.said[seat] = hand.length === 1;
  const others = active(state).filter((other) => other !== seat);
  if (card.n === 20) { state.call = move.shape ?? null; state.turn = nextSeat(state, seat); } // a Whot with cards left in hand always names a shape (checked above)
  else if (card.n === 1) state.turn = seat;
  else if (card.n === 8) state.turn = nextSeat(state, seat, 2);
  else if (card.n === 14) {
    for (const other of others) if (!state.over) draw(state, other, 1, rng);
    state.turn = seat;
  } else if (PICKS[card.n]) {
    state.pick = (state.options.defend === 'stack' && before.pickBy === card.n ? before.pick : 0) + (PICKS[card.n] ?? 0);
    state.pickBy = card.n;
    state.turn = nextSeat(state, seat);
  } else state.turn = nextSeat(state, seat);
  return state;
}

function describe(state: WhotState, seat: number, move: WhotMove): string {
  if (move.t === 'draw') return state.pick ? `{${seat}} picked ${state.pick}` : `{${seat}} went to market`;
  const hand = state.hands[seat] ?? [];
  const card = hand[move.i];
  if (!card) return `{${seat}} played`;
  const left = hand.length - 1;
  const extra = card.n === 20 ? (move.shape ? `: “I need ${SHAPE_NAMES[move.shape]}s”` : '') : SPECIAL[card.n] ? ` · ${SPECIAL[card.n]}!` : '';
  return `{${seat}} played ${cardName(card)}${extra}${left === 1 ? ' · Last card!' : ''}`;
}

function view(state: WhotState, seat: number | null): WhotView {
  const mine = seat !== null && seat >= 0 && seat < state.hands.length ? state.hands[seat] ?? null : null;
  const myTurn = mine !== null && !state.over && state.turn === seat;
  return {
    game: 'whot', options: state.options, top: top(state), call: state.call, market: state.market.length, pile: state.pile.length,
    turn: state.over ? null : state.turn, pick: state.pick, pickBy: state.pickBy,
    counts: state.hands.map((hand) => hand.length), out: state.out, said: state.said,
    // Your own cards, and which of them may be played now. A watcher gets neither; nobody gets another hand or the market.
    hand: mine ? mine.map((card) => ({ ...card })) : null,
    playable: myTurn ? mine.map((card, index) => (playable(state, card) ? index : -1)).filter((index) => index >= 0) : [],
    over: state.over,
    // Once it is over the hands are shown, as cards laid on the table would be.
    shown: state.over ? state.hands.map((hand) => hand.map((card) => ({ ...card }))) : null,
  };
}

/** A sensible computer player: answers a pick if it can, keeps its Whot for when it is stuck, hits a player who is nearly out. */
function bot(state: WhotState, seat: number, rng: () => number): WhotMove {
  const hand = state.hands[seat] ?? [];
  const options = hand.map((card, i) => ({ card, i })).filter(({ card }) => playable(state, card));
  if (!options.length) return { t: 'draw' };
  const next = nextSeat(state, seat), danger = (state.hands[next]?.length ?? 0) <= 2;
  const weight = ({ card }: { card: Card }): number => {
    if (card.s === 'whot') return hand.length <= 2 ? 50 : 1;                 // a Whot is kept for a tight spot, or to finish
    if (card.n === 2 || card.n === 5) return danger ? 90 : 40 + card.n;
    if (card.n === 14) return danger ? 80 : 35;
    if (card.n === 8 || card.n === 1) return danger ? 70 : 30;
    return 10 + cardValue(card) / 2;                                          // otherwise shed the cards that count most
  };
  const best = options.map((option) => ({ ...option, w: weight(option) + rng() * 4 })).sort((a, b) => b.w - a.w)[0];
  if (!best) return { t: 'draw' }; // there is at least one option
  if (best.card.s !== 'whot') return { t: 'play', i: best.i };
  // Name the shape it holds most of (after the Whot is gone).
  const held: Record<Shape, number> = { circle: 0, triangle: 0, cross: 0, square: 0, star: 0 };
  hand.forEach((card, i) => { if (i !== best.i && card.s !== 'whot') held[card.s] += 1; });
  const shape = SHAPES.slice().sort((a, b) => held[b] - held[a])[0];
  return { t: 'play', i: best.i, ...(shape ? { shape } : {}) };
}

/** The clock ran out: the seat goes to market (or takes the cards it owes). */
const timeout = (state: WhotState, seat: number, rng: () => number): WhotState => apply(state, seat, { t: 'draw' }, rng);

function forfeit(before: WhotState, seat: number): WhotState {
  if (before.over || before.out[seat]) return before;
  const state = clone(before);
  state.out[seat] = true;
  // A leaver's cards go under the market, so nothing is lost from the pack.
  state.market = [...(state.hands[seat] ?? []), ...state.market];
  state.hands[seat] = [];
  const left = active(state);
  if (left.length === 1) { win(state, left[0] ?? seat, 'forfeit', `{${seat}} left the table. {${left[0]}} wins.`); return state; }
  if (state.turn === seat) { state.pick = 0; state.pickBy = null; state.turn = nextSeat(state, seat); }
  return state;
}

const rules: TableRules<WhotState, WhotMove, WhotView> = {
  id: 'whot', label: 'Whot', seats: { min: 2, max: 4 }, turnSeconds: 30,
  options: {
    hand: { label: 'Cards dealt', values: [4, 5, 6], default: 5 },
    defend: { label: 'Answering a Pick Two', values: ['pass', 'stack'], default: 'pass', names: ['Passes it on', 'Adds up'] },
    market: { label: 'When the market finishes', values: ['count', 'turn'], default: 'count', names: ['Count the cards', 'Turn the pile over'] },
  },
  start, parseMove, apply, view, bot, timeout, forfeit, describe,
  toMove: (state) => (state.over ? [] : [state.turn]),
  outcome: (state) => state.over,
  moved: (state) => state.moves.slice(),
};
export default rules;
