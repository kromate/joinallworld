// OWNER: growth — the chess table: turns, every way a game ends, draw offers, clocks, what a seat sees, and the computer player.
import test from 'node:test';
import assert from 'node:assert/strict';
import chess, { MAX_OFFERS, charge, clockMs, side } from './chess.ts';
import type { ChessMove, ChessState } from './chess.ts';
import { RulesError, cleanOptions, withNames } from './rules.ts';
import { makeRng } from '../game/util.ts';
import { legalMoves, moveFrom, moveTo, parseFen, positionKey, squareName } from './chess-core.ts';
import { chooseMove } from './chess-bot.ts';
import type { BotLevel } from './chess-bot.ts';

const rng = makeRng('chess');
const start = (options: unknown = {}): ChessState => chess.start(2, makeRng('c'), cleanOptions(chess, options));
const refused = (run: () => unknown, pattern?: RegExp) => assert.throws(run, (error) => error instanceof RulesError && (pattern === undefined || pattern.test(error.message)));
/** "e2e4" or "e7e8q" as a move. */
const mv = (text: string): ChessMove => (text.length === 5 ? { t: 'move', from: text.slice(0, 2), to: text.slice(2, 4), promo: text[4] as 'q' } : { t: 'move', from: text.slice(0, 2), to: text.slice(2, 4) });
/** Play the moves in turn, each by the seat to move. */
function play(state: ChessState, moves: string[]): ChessState {
  return moves.reduce((now, text) => chess.apply(now, chess.toMove(now)[0] as number, mv(text), rng), state);
}
/** A game that begins at a given position (the same state `start` would give, with the position replaced). */
function fromFen(fen: string, options: unknown = {}, extra: Partial<ChessState> = {}): ChessState {
  return { ...start(options), fen, half: Number(fen.split(' ')[4] ?? 0), counts: { [positionKey(parseFen(fen))]: 1 }, ...extra };
}
const finished = (state: ChessState) => { assert.ok(state.over, 'the game is over'); return state.over; };
const text = (state: ChessState, names = ['Ada', 'Bola']) => withNames(finished(state).text, names);
const deepFreeze = <Value>(value: Value): Value => {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
};

test('chess: options, who plays white, the contract', () => {
  assert.deepEqual([chess.id, chess.label, chess.seats], ['chess', 'Chess', { min: 2, max: 2 }]);
  assert.deepEqual(cleanOptions(chess, {}), { clock: '10+0', colour: 'white', level: 'medium' });
  assert.deepEqual(cleanOptions(chess, { clock: '3+2', colour: 'purple', level: 'hard' }), { clock: '10+0', colour: 'white', level: 'hard' });
  assert.deepEqual(chess.options.clock.names, ['5 min + 3 s', '10 min', 'Relaxed (3 min a move)']);
  assert.equal(start().white, 0);
  assert.equal(start({ colour: 'black' }).white, 1);
  const seen = new Set<number>();
  for (let i = 0; i < 20; i++) seen.add(chess.start(2, makeRng(`r${i}`), cleanOptions(chess, { colour: 'random' })).white);
  assert.equal(seen.size, 2, 'random colour uses the generator');
  assert.deepEqual(chess.start(2, () => 0.1, cleanOptions(chess, { colour: 'random' })).white, 0);
  assert.deepEqual(chess.start(2, () => 0.9, cleanOptions(chess, { colour: 'random' })).white, 1);
  assert.deepEqual([chess.toMove(start()), chess.toMove(start({ colour: 'black' }))], [[0], [1]]);
  assert.deepEqual(chess.toMove(play(start({ colour: 'black' }), ['e2e4'])), [0]);
  assert.deepEqual(start({ clock: '5+3' }).left, [300000, 300000]);
  assert.equal(start({ clock: 'untimed' }).left, null);
  assert.deepEqual([chess.moved(start()), chess.outcome(start())], [[0, 0], null]);
});

test('chess: moves are parsed strictly and judged by the rules', () => {
  assert.deepEqual(chess.parseMove({ t: 'move', from: 'e2', to: 'e4', extra: 1 }), { t: 'move', from: 'e2', to: 'e4' });
  assert.deepEqual(chess.parseMove({ t: 'move', from: 'e7', to: 'e8', promo: 'n' }), { t: 'move', from: 'e7', to: 'e8', promo: 'n' });
  assert.deepEqual(chess.parseMove({ t: 'resign', x: 1 }), { t: 'resign' });
  for (const hostile of [undefined, null, 4, 'e2e4', [], {}, { t: 'castle' }, { t: 'move' }, { t: 'move', from: 'e2' }, { t: 'move', from: 'i2', to: 'e4' }, { t: 'move', from: 'e2', to: 'e9' }, { t: 'move', from: 'E2', to: 'e4' }, { t: 'move', from: 12, to: 28 }, { t: 'move', from: 'e2', to: 'e4', promo: 'k' }, { t: 'move', from: 'e2', to: 'e4', promo: 'Q' }]) refused(() => chess.parseMove(hostile));
  const state = start();
  refused(() => chess.apply(state, 1, mv('e7e5'), rng), /not your turn/);
  refused(() => chess.apply(state, 0, mv('e7e5'), rng), /no piece on e7/);
  refused(() => chess.apply(state, 0, mv('e2e5'), rng), /not allowed/);
  refused(() => chess.apply(state, 0, mv('e3e4'), rng), /no piece on e3/);
  refused(() => chess.apply(state, 0, mv('e2e4q'), rng), /last rank/);
  refused(() => chess.apply(state, 2, mv('e2e4'), rng), /not in this game/);
  refused(() => chess.apply(state, 0, { t: 'move', from: 'a1', to: 'a3' }, rng), /not allowed/);
  const after = chess.apply(state, 0, mv('e2e4'), rng);
  assert.deepEqual([after.history, after.played, chess.toMove(after), chess.moved(after)], [['e4'], [{ from: 'e2', to: 'e4' }], [1], [1, 0]]);
  assert.match(after.fen, /^rnbqkbnr\/pppppppp\/8\/8\/4P3\/8\/PPPP1PPP\/RNBQKBNR b KQkq e3 0 1$/);
  assert.equal(chess.describe(state, 0, mv('g1f3')), '{0} plays Nf3');
  assert.equal(chess.describe(state, 1, { t: 'offer-draw' }), '{1} offers a draw');
  assert.equal(chess.describe(state, 0, { t: 'resign' }), '{0} resigns');
  assert.equal(chess.describe(state, 0, mv('e2e5')), '{0} plays e2e5', 'an illegal move is only described');
  refused(() => chess.apply(after, 0, mv('e4e5'), rng), /not your turn/);
});

test('chess: fool\'s mate and scholar\'s mate are checkmate; a king in check must be answered', () => {
  const fool = play(start(), ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
  assert.deepEqual([finished(fool).reason, fool.over?.winners, chess.toMove(fool), fool.history.at(-1)], ['checkmate', [1], [], 'Qh4#']);
  assert.equal(text(fool), 'Bola wins by checkmate.');
  const scholar = play(start(), ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']);
  assert.deepEqual([finished(scholar).reason, scholar.over?.winners, scholar.history.at(-1), scholar.over?.scores], ['checkmate', [0], 'Qxf7#', [1, 0]]);
  refused(() => chess.apply(fool, 0, mv('a2a3'), rng), /over/);
  const check = play(start(), ['e2e4', 'f7f6', 'd1h5']);
  assert.equal(check.history.at(-1), 'Qh5+');
  assert.equal(chess.view(check, 1).check, 'e8');
  refused(() => chess.apply(check, 1, mv('a7a6'), rng), /in check/);
  assert.equal(chess.view(play(check, ['g7g6']), null).check, null);
});

test('chess: stalemate, material that cannot mate, repetition and the fifty-move rule end the game as a draw', () => {
  const stale = play(fromFen('k7/8/1K6/8/8/8/2Q5/8 w - - 0 1'), ['c2c7']);
  assert.deepEqual([finished(stale).reason, stale.over?.draw, stale.over?.winners, stale.over?.scores], ['stalemate', true, [], [0.5, 0.5]]);
  const bare = play(fromFen('k7/8/8/8/8/8/1n6/2K5 w - - 0 1'), ['c1b2']);
  assert.deepEqual([finished(bare).reason, bare.over?.draw], ['insufficient', true]);
  assert.equal(text(bare), 'Neither side has enough pieces to checkmate. A draw.');
  assert.equal(play(fromFen('k7/8/8/8/8/8/1r6/2K5 w - - 0 1'), ['c1b2']).over?.reason, 'insufficient', 'taking the last rook leaves bare kings');
  assert.equal(play(fromFen('k7/8/8/8/8/8/1n6/2KR4 w - - 0 1'), ['c1b2']).over, null, 'a rook is enough');
  // Threefold: the knights go out and home twice.
  const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
  const twice = play(start(), [...shuffle, ...shuffle.slice(0, 3)]);
  assert.equal(twice.over, null);
  const thrice = play(twice, ['f6g8']);
  assert.deepEqual([finished(thrice).reason, thrice.history.length], ['repetition', 8]);
  assert.equal(text(thrice), 'The same position has come up three times. A draw.');
  // A different move order that reaches the same position counts; different castling rights do not.
  const same = play(start(), ['g1f3', 'g8f6', 'b1c3', 'b8c6', 'c3b1', 'c6b8', 'f3g1', 'f6g8', 'g1f3', 'g8f6']);
  assert.deepEqual([finished(same).reason, same.history.length], ['repetition', 10], 'the position after ply 2 came up a third time');
  const rights = play(start(), ['e2e4', 'e7e5', 'e1e2', 'e8e7', 'e2e1', 'e7e8', 'e1e2', 'e8e7', 'e2e1', 'e7e8']);
  assert.equal(rights.over, null, 'the king moved, so the rights differ from the first time');
  // Fifty moves: a clock of 99 plies, one quiet move more.
  const nearly = fromFen('k7/8/8/8/8/8/8/K1R5 w - - 99 80');
  assert.equal(nearly.half, 99);
  const fifty = play(nearly, ['c1c2']);
  assert.deepEqual([finished(fifty).reason, fifty.half, fifty.over?.draw], ['fifty-move', 100, true]);
  assert.equal(play(fromFen('k7/8/8/8/8/8/8/K1R5 w - - 98 80'), ['c1c2', 'a8b8']).over?.reason, 'fifty-move');
  assert.equal(play(fromFen('k7/8/1K6/8/8/8/8/2R5 w - - 99 80'), ['c1c8']).over?.reason, 'checkmate', 'a mate on the hundredth ply still wins');
  assert.equal(play(fromFen('k7/8/8/8/8/8/5P2/K1R5 w - - 99 80'), ['f2f3']).over, null, 'a pawn move resets the clock');
});

test('chess: promotion needs a choice, and the choice is honoured', () => {
  const state = fromFen('k7/4P3/8/8/8/8/8/K7 w - - 0 1');
  refused(() => chess.apply(state, 0, mv('e7e8'), rng), /Choose what the pawn becomes/);
  refused(() => chess.apply(state, 0, mv('a1a2q'), rng), /last rank/);
  for (const [promo, piece] of [['q', 'wQ'], ['r', 'wR'], ['b', 'wB'], ['n', 'wN']] as const) {
    const done = chess.apply(state, 0, mv(`e7e8${promo}`), rng);
    assert.equal(chess.view(done, null).board[4], piece);
    assert.deepEqual(done.played.at(-1), { from: 'e7', to: 'e8', promo });
  }
  assert.equal(chess.apply(state, 0, mv('e7e8q'), rng).history.at(-1), 'e8=Q+');
  const view = chess.view(state, 0);
  assert.equal(view.legal.filter((move) => move.from === 'e7').length, 4, 'every promotion is listed');
  const capture = fromFen('k2r4/4P3/8/8/8/8/8/K7 w - - 0 1');
  assert.equal(chess.apply(capture, 0, mv('e7d8q'), rng).history.at(-1), 'exd8=Q+');
  assert.deepEqual(chess.apply(capture, 0, mv('e7d8q'), rng).captured, { w: ['bR'], b: [] });
});

test('chess: resigning, and the offer of a draw', () => {
  const state = start();
  const resigned = chess.apply(state, 1, { t: 'resign' }, rng);
  assert.deepEqual([finished(resigned).reason, resigned.over?.winners, chess.toMove(resigned)], ['resign', [0], []]);
  assert.equal(text(resigned), 'Bola resigned. Ada wins.');
  assert.equal(chess.apply(state, 0, { t: 'resign' }, rng).over?.winners[0], 1);
  assert.deepEqual(chess.moved(resigned), [0, 0], 'resigning is not a move');
  // An offer by the seat not to move, any time; it changes nothing else.
  const offered = chess.apply(state, 1, { t: 'offer-draw' }, rng);
  assert.deepEqual([offered.drawOffer, chess.toMove(offered), offered.fen === state.fen, chess.moved(offered), chess.view(offered, 0).drawOffer], [1, [0], true, [0, 0], 'b']);
  refused(() => chess.apply(offered, 1, { t: 'accept-draw' }, rng), /no draw offer/);
  refused(() => chess.apply(offered, 1, { t: 'offer-draw' }, rng), /already offered/);
  refused(() => chess.apply(offered, 0, { t: 'offer-draw' }, rng), /Accept or decline/);
  refused(() => chess.apply(state, 0, { t: 'accept-draw' }, rng), /no draw offer/);
  refused(() => chess.apply(state, 0, { t: 'decline-draw' }, rng), /no draw offer/);
  const agreed = chess.apply(offered, 0, { t: 'accept-draw' }, rng);
  assert.deepEqual([finished(agreed).reason, agreed.over?.draw, text(agreed)], ['agreed', true, 'Draw agreed.']);
  const declined = chess.apply(offered, 0, { t: 'decline-draw' }, rng);
  assert.deepEqual([declined.drawOffer, declined.over], [null, null]);
  // Playing on is declining.
  const moved = chess.apply(offered, 0, mv('e2e4'), rng);
  assert.equal(moved.drawOffer, null);
  // The seat that offered keeps the offer standing while it moves itself.
  const mine = chess.apply(chess.apply(state, 0, { t: 'offer-draw' }, rng), 0, mv('e2e4'), rng);
  assert.equal(mine.drawOffer, 0);
  // At most three offers a seat.
  let now = state;
  for (let i = 0; i < MAX_OFFERS; i++) now = chess.apply(chess.apply(now, 0, { t: 'offer-draw' }, rng), 1, { t: 'decline-draw' }, rng);
  refused(() => chess.apply(now, 0, { t: 'offer-draw' }, rng), /3 draws already/);
  assert.equal(chess.apply(now, 1, { t: 'offer-draw' }, rng).drawOffer, 1, 'the other seat still has its offers');
  assert.deepEqual([side({ t: 'resign' }), side({ t: 'offer-draw' }), side({ t: 'accept-draw' }), side({ t: 'decline-draw' }), side(mv('e2e4'))], [true, true, true, true, false]);
  assert.equal(chess.side, side);
});

test('chess: clocks - charge, the increment, the flag falling', () => {
  const state = start({ clock: '5+3' });
  assert.deepEqual([clockMs(state), chess.clockMs(state)], [300000, 300000]);
  const charged = charge(state, 0, 12000);
  assert.deepEqual(charged.left, [288000, 300000]);
  assert.deepEqual(state.left, [300000, 300000], 'charge does not mutate');
  const played = chess.apply(charged, 0, mv('e2e4'), rng);
  assert.deepEqual(played.left, [291000, 300000], '5+3: 300 s - 12 s + 3 s');
  assert.equal(clockMs(played), 300000, 'now the other seat\'s clock');
  assert.deepEqual(charge(played, 0, 5000), played, 'not the mover: unchanged');
  const second = chess.apply(charge(played, 1, 0), 1, mv('e7e5'), rng);
  assert.deepEqual(second.left, [291000, 303000]);
  assert.deepEqual(charge(state, 0, -50).left, [300000, 300000]);
  assert.equal(charge(start({ clock: '10+0' }), 0, 1000).left?.[0], 599000);
  assert.equal(chess.apply(charge(start({ clock: '10+0' }), 0, 1000), 0, mv('e2e4'), rng).left?.[0], 599000, 'no increment in 10+0');
  // A move that arrives after the clock ran out loses on time.
  const late = charge(state, 0, 300000);
  assert.deepEqual([finished(late).reason, late.over?.winners, late.left?.[0], clockMs(late)], ['time', [1], 0, 0]);
  assert.equal(text(late), 'Ada ran out of time. Bola wins.');
  refused(() => chess.apply(late, 0, mv('e2e4'), rng), /over/);
  assert.equal(charge(state, 0, 299999).over, null);
  // Black to move first when the host plays black.
  const black = start({ clock: '5+3', colour: 'black' });
  assert.equal(charge(black, 0, 1000).left?.[0], 300000, 'seat 0 is black and not on move');
  assert.deepEqual(charge(black, 1, 1000).left, [300000, 299000]);
  // Untimed games: 180 s a move, and no clock to charge.
  const relaxed = start({ clock: 'untimed' });
  assert.deepEqual([clockMs(relaxed), charge(relaxed, 0, 90000) === relaxed, chess.turnSeconds], [180000, true, 180]);
  assert.equal(chess.view(relaxed, 0).clocks, null);
  // Time out via the server's own call.
  const flagged = chess.timeout(state, 1, rng);
  assert.deepEqual([flagged.over?.winners, flagged.over?.reason, flagged.left?.[1]], [[0], 'time', 0]);
  assert.equal(chess.timeout(relaxed, 0, rng).over?.reason, 'time');
  // The flag against a side that cannot mate is a draw.
  const lone = fromFen('k7/8/8/8/8/8/8/K1N5 w - - 0 1', { clock: '5+3' });
  const drawn = chess.timeout(lone, 1, rng);
  assert.deepEqual([drawn.over?.draw, drawn.over?.reason], [true, 'insufficient']);
  assert.equal(chess.timeout(lone, 0, rng).over?.draw, true, 'a lone king flagging: the knight cannot mate');
  assert.equal(chess.timeout(fromFen('k7/8/8/8/8/8/8/K1R5 w - - 0 1', { clock: '5+3' }), 1, rng).over?.draw, false, 'a rook can mate');
});

test('chess: leaving the game, and nothing is ever changed in place', () => {
  const state = start();
  const left = chess.forfeit(state, 0);
  assert.deepEqual([finished(left).reason, left.over?.winners, text(left)], ['forfeit', [1], 'Ada left the game. Bola wins.']);
  assert.equal(chess.forfeit(left, 1), left, 'a finished game stays as it was');
  assert.equal(chess.timeout(left, 1, rng), left);
  const frozen = deepFreeze(play(start({ clock: '5+3' }), ['e2e4', 'd7d5']));
  for (const run of [
    () => chess.apply(frozen, 0, mv('e4d5'), rng),
    () => chess.apply(frozen, 1, { t: 'offer-draw' }, rng),
    () => chess.apply(frozen, 1, { t: 'resign' }, rng),
    () => chess.timeout(frozen, 0, rng),
    () => chess.forfeit(frozen, 1),
    () => charge(frozen, 0, 4000),
    () => chess.view(frozen, 0),
    () => chess.bot(frozen, 0, rng),
    () => chess.describe(frozen, 0, mv('e4d5')),
  ]) assert.doesNotThrow(run);
  const before = JSON.stringify(frozen);
  chess.apply(frozen, 0, mv('e4d5'), rng);
  assert.equal(JSON.stringify(frozen), before);
  const copy = JSON.parse(before) as ChessState;
  assert.deepEqual(copy, frozen, 'the state is plain JSON');
  assert.deepEqual(chess.view(copy, 1), chess.view(frozen, 1));
});

test('chess: a seat sees the board, its own legal moves only, the history and the clocks', () => {
  let state = start({ clock: '5+3' });
  const white = chess.view(state, 0), black = chess.view(state, 1), watcher = chess.view(state, null);
  assert.deepEqual([white.you, black.you, watcher.you, white.turn, white.white], ['w', 'b', null, 'w', 0]);
  assert.equal(white.legal.length, 20);
  assert.deepEqual([black.legal, watcher.legal], [[], []], 'only the seat to move is told');
  assert.deepEqual([white.board.length, white.board[0], white.board[4], white.board[60], white.board[63], white.board[27], white.board[48]], [64, 'bR', 'bK', 'wK', 'wR', null, 'wP']);
  assert.deepEqual([white.clocks, white.last, white.check, white.drawOffer, white.halfmove, white.over], [{ w: 300000, b: 300000 }, null, null, null, 0, null]);
  state = play(state, ['e2e4', 'd7d5', 'e4d5']);
  const next = chess.view(state, 1);
  assert.deepEqual([next.history, next.last, next.captured, next.legal.length > 0, chess.view(state, 0).legal], [['e4', 'd5', 'exd5'], { from: 'e4', to: 'd5' }, { w: ['bP'], b: [] }, true, []]);
  const flipped = play(start({ colour: 'black', clock: '5+3' }), ['e2e4']);
  const view = chess.view(flipped, 0);
  assert.deepEqual([view.you, view.white, view.turn, view.clocks, chess.view(flipped, 1).legal.length], ['b', 1, 'b', { w: 303000, b: 300000 }, 0]);
  assert.equal(view.legal.length, 20);
  const over = chess.view(play(start(), ['f2f3', 'e7e5', 'g2g4', 'd8h4']), 0);
  assert.deepEqual([over.turn, over.legal, over.check, over.over?.reason], [null, [], 'e1', 'checkmate']);
  // En passant, castling and promotion are all among the legal moves offered.
  const special = chess.view(fromFen('r3k2r/8/8/3pP3/8/8/8/R3K2R w KQkq d6 0 1'), 0).legal.map((m) => m.from + m.to);
  for (const wanted of ['e5d6', 'e1g1', 'e1c1']) assert.ok(special.includes(wanted), wanted);
  assert.equal(JSON.stringify(chess.view(state, 0)).includes('"counts"'), false);
});

/** The legal moves of a state's position as "e2e4". */
const legalOf = (fen: string): string[] => legalMoves(parseFen(fen)).map((move) => squareName(moveFrom(move)) + squareName(moveTo(move)));
const asText = (move: ChessMove) => (move.t === 'move' ? move.from + move.to + (move.promo ?? '') : move.t);

test('chess: the computer answers with a legal move at every level, from many positions', () => {
  for (const level of ['easy', 'medium', 'hard'] as const) {
    let state = start({ level });
    const seed = makeRng(`legal-${level}`);
    for (let ply = 0; ply < 40 && !state.over; ply++) {
      const mover = chess.toMove(state)[0] as number;
      if (ply % 4 === 0) { // a hand-made reply, to wander from the computer's own lines
        const options = legalOf(state.fen);
        state = chess.apply(state, mover, mv(options[Math.floor(seed() * options.length)] as string), rng);
        continue;
      }
      const move = chess.bot(state, mover, seed);
      assert.ok(legalOf(state.fen).includes(asText(move).slice(0, 4)), `${level}: ${asText(move)}`);
      state = chess.apply(state, mover, move, rng);
    }
  }
  refused(() => chess.bot(start(), 1, rng), /not the computer/);
  refused(() => chess.bot(chess.forfeit(start(), 0), 0, rng), /over/);
  // A draw offered to the computer is ignored: it just plays, and the offer lapses.
  const offered = chess.apply(start(), 0, { t: 'offer-draw' }, rng);
  const reply = chess.apply(offered, 0, mv('e2e4'), rng);
  const answer = chess.apply(reply, 1, chess.bot(reply, 1, rng), rng);
  assert.deepEqual([answer.drawOffer, answer.over], [null, null]);
  // Only legal move: no search at all, and the same answer every time.
  const forced = fromFen('k7/8/8/8/8/8/8/KR5r w - - 0 1');
  assert.deepEqual(asText(chess.bot(forced, 0, rng)), 'b1h1');
});

test('chess: computer games run to the end without an illegal move or an error', () => {
  const pairs: [BotLevel, BotLevel][] = [['easy', 'easy'], ['easy', 'medium'], ['medium', 'hard']];
  for (const [index, [first, second]] of pairs.entries()) {
    const seed = makeRng(`playout-${index}`);
    let state = start({ level: first });
    const levels: BotLevel[] = [first, second];
    const cap = first === 'easy' && second === 'easy' ? 600 : 110;
    let plies = 0;
    while (!state.over && plies < cap) {
      const mover = chess.toMove(state)[0] as number;
      const move = chess.bot({ ...state, options: { ...state.options, level: levels[mover] as BotLevel } }, mover, seed);
      state = chess.apply(state, mover, move, seed); // a refusal here would be an illegal move by the engine
      plies += 1;
    }
    assert.ok(state.over || plies === cap);
    assert.equal(state.history.length, plies);
    if (state.over) assert.ok(['checkmate', 'stalemate', 'repetition', 'fifty-move', 'insufficient'].includes(state.over.reason), state.over.reason);
  }
});

test('chess: the computer finds mate, and does not give away its queen', () => {
  for (const level of ['medium', 'hard'] as const) {
    // Mate in one.
    const one = fromFen('k7/8/1K6/8/8/8/8/7R w - - 0 1', { level });
    assert.equal(chess.apply(one, 0, chess.bot(one, 0, rng), rng).over?.reason, 'checkmate', `${level}: mate in one`);
    // Mate in two: whatever black answers, the next move mates.
    const two = fromFen('k7/8/2K5/8/8/8/8/6RR w - - 0 1', { level });
    const first = chess.apply(two, 0, chess.bot(two, 0, rng), rng);
    assert.equal(first.over, null);
    for (const reply of legalOf(first.fen)) {
      const answered = chess.apply(first, 1, mv(reply), rng);
      const mate = chess.apply(answered, 0, chess.bot(answered, 0, rng), rng);
      assert.equal(mate.over?.reason, 'checkmate', `${level}: mate after ${reply}`);
    }
    // A queen attacked by a pawn: move it (or take the pawn), never leave it.
    const hanging = fromFen('k7/8/8/4p3/3Q4/8/8/K7 w - - 0 1', { level });
    const saved = chess.apply(hanging, 0, chess.bot(hanging, 0, rng), rng);
    const reply = legalOf(saved.fen).map((move) => chess.apply(saved, 1, mv(move), rng));
    assert.ok(reply.every((state) => state.captured.b.every((piece) => piece !== 'wQ')), `${level}: the queen is not lost`);
    // A queen that could take a defended pawn does not.
    const poisoned = fromFen('rnbqkbnr/ppp2ppp/4p3/3p4/8/8/PPP1PPPP/RNBQKBNR w KQkq - 0 3', { level });
    const careful = chess.apply(poisoned, 0, chess.bot(poisoned, 0, rng), rng);
    assert.notEqual(careful.history[0], 'Qxd5');
  }
  // The engine is deterministic apart from the easy level.
  const position = parseFen('r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4');
  assert.deepEqual(chooseMove(position, 'hard', () => 0.3), chooseMove(position, 'hard', () => 0.9));
  // Node budgets are respected (a little over is the node that notices).
  assert.ok(chooseMove(position, 'medium', rng).nodes < 12100);
  assert.ok(chooseMove(position, 'hard', rng).nodes < 40100);
});

test('chess: the easy computer sometimes plays a move that is not the best', () => {
  const win = fromFen('k7/8/8/3q4/8/8/3R4/K7 w - - 0 1', { level: 'easy' });
  let best = 0;
  const chosen = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const move = asText(chess.bot(win, 0, makeRng(`easy-${i}`)));
    chosen.add(move);
    if (move === 'd2d5') best += 1;
  }
  assert.ok(best > 180 && best < 300, `takes the queen ${best} times of 300`);
  assert.ok(chosen.size > 1);
  // From the start it does not always play the same first move.
  const firsts = new Set<string>();
  for (let i = 0; i < 40; i++) firsts.add(asText(chess.bot(start({ level: 'easy' }), 0, makeRng(`first-${i}`))));
  assert.ok(firsts.size > 2, [...firsts].join(' '));
  // Hard is steady where easy is not.
  const hard = new Set<string>();
  for (let i = 0; i < 20; i++) hard.add(asText(chess.bot(start({ level: 'hard' }), 0, makeRng(`hard-${i}`))));
  assert.equal(hard.size, 1);
});
