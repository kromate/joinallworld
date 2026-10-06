// OWNER: growth — the chess core: move counts against known positions, castling, en passant, promotion, notation, draws by material.
import test from 'node:test';
import assert from 'node:assert/strict';
import { START_FEN, hasLegalMove, inCheck, insufficientMaterial, legalMoves, make, moveFrom, moveTo, movePromo, parseFen, perft, positionKey, san, squareName, toFen } from './chess-core.ts';

const POSITIONS: { name: string; fen: string; counts: number[] }[] = [
  { name: 'start', fen: START_FEN, counts: [20, 400, 8902, 197281, 4865609] },
  { name: 'kiwipete', fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', counts: [48, 2039, 97862, 4085603] },
  { name: 'position 3', fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', counts: [14, 191, 2812, 43238, 674624] },
  { name: 'position 4', fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', counts: [6, 264, 9467, 422333] },
  { name: 'position 5', fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', counts: [44, 1486, 62379] },
  { name: 'position 6', fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', counts: [46, 2079, 89890] },
];

for (const { name, fen, counts } of POSITIONS) {
  test(`chess core: perft of ${name}`, () => {
    counts.forEach((count, index) => assert.equal(perft(fen, index + 1), count, `${name} depth ${index + 1}`));
  });
}

/** The legal moves of a FEN as "e2e4" (and "e7e8q"). */
const plain = (fen: string): string[] => legalMoves(parseFen(fen)).map((move) => squareName(moveFrom(move)) + squareName(moveTo(move)));
/** Play "e1g1"-style moves from a FEN (each must be legal) and return the FEN. */
function walk(fen: string, moves: string[]): string {
  const pos = parseFen(fen);
  for (const text of moves) {
    const move = legalMoves(pos).find((legal) => squareName(moveFrom(legal)) + squareName(moveTo(legal)) === text.slice(0, 4) && (text.length === 4 || 'nbrq'.indexOf(text[4] as string) + 2 === movePromo(legal)));
    assert.ok(move !== undefined, `${text} is legal`);
    make(pos, move);
  }
  return toFen(pos);
}
const sanOf = (fen: string, text: string): string => {
  const pos = parseFen(fen);
  const move = legalMoves(pos).find((legal) => squareName(moveFrom(legal)) + squareName(moveTo(legal)) + (movePromo(legal) ? 'nbrq'[movePromo(legal) - 2] : '') === text);
  assert.ok(move !== undefined, `${text} is legal`);
  return san(pos, move);
};

test('chess core: a FEN round-trips, and nonsense is refused', () => {
  for (const { fen } of POSITIONS) assert.equal(toFen(parseFen(fen)), fen);
  assert.throws(() => parseFen('8/8/8/8/8/8/8/8 w - - 0 1'));
  assert.throws(() => parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1'));
  assert.throws(() => parseFen('4k3/8/8/8/8/8/8/4K3 x - - 0 1'));
  assert.throws(() => parseFen('4k3/8/8/8/8/8/8/4K2P w - - 0 1'), /pawn/);
  assert.throws(() => parseFen('4k3/8/8/8/8/8/4r3/4K3 b - - 0 1'), /check/);
  // A right with no rook to use it is dropped.
  assert.match(toFen(parseFen('4k3/8/8/8/8/8/8/4K3 w KQkq - 0 1')), / w - - /);
});

test('chess core: castling is allowed, and refused through or out of check, after the king or rook has moved, or with pieces between', () => {
  const open = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  assert.deepEqual(['e1g1', 'e1c1'].filter((move) => plain(open).includes(move)), ['e1g1', 'e1c1']);
  assert.equal(sanOf(open, 'e1g1'), 'O-O');
  assert.equal(sanOf(open, 'e1c1'), 'O-O-O');
  const through = '1k6/8/8/8/8/8/5r2/R3K2R w KQ - 0 1';
  assert.equal(plain(through).includes('e1g1'), false, 'f1 is attacked');
  assert.equal(plain(through).includes('e1c1'), true);
  assert.equal(plain('4r1k1/8/8/8/8/8/8/R3K2R w KQ - 0 1').some((move) => move === 'e1g1' || move === 'e1c1'), false, 'out of check');
  assert.equal(plain('1r4k1/8/8/8/8/8/8/R3K2R w KQ - 0 1').includes('e1c1'), true, 'an attacked rook square does not matter');
  assert.equal(plain('6k1/8/8/8/8/8/8/R3K2R w K - 0 1').includes('e1c1'), false, 'no right');
  assert.equal(plain('r3k2r/8/8/8/8/8/8/RN2K1NR w KQkq - 0 1').some((move) => move === 'e1g1' || move === 'e1c1'), false, 'pieces between');
  const kingMoved = walk(open, ['e1e2', 'a8a7', 'e2e1', 'a7a8']);
  assert.equal(plain(kingMoved).some((move) => move === 'e1g1' || move === 'e1c1'), false, 'the king has moved');
  const rookMoved = walk(open, ['h1g1', 'a8a7', 'g1h1', 'a7a8']);
  assert.equal(plain(rookMoved).includes('e1g1'), false, 'the h-rook has moved');
  assert.equal(plain(rookMoved).includes('e1c1'), true);
  // Black castles too, and the rook lands next to the king.
  const black = walk(open, ['a1a2', 'e8g8']);
  assert.match(black, /^r4rk1\//);
  // A rook captured on its square ends the right.
  assert.equal(plain(walk('r3k2r/8/8/8/8/8/6b1/R3K2R b KQkq - 0 1', ['g2h1'])).includes('e1g1'), false, 'the rook was taken on its square');
});

test('chess core: en passant only straight away, and never when it exposes the king', () => {
  const fen = walk('k7/3p4/8/4P3/8/8/8/K7 b - - 0 1', ['d7d5']);
  assert.match(fen, / d6 /);
  assert.equal(plain(fen).includes('e5d6'), true);
  assert.equal(sanOf(fen, 'e5d6'), 'exd6');
  const later = walk(fen, ['a1b1', 'a8b8', 'b1a1', 'b8a8']);
  assert.equal(plain(later).includes('e5d6'), false, 'the chance has gone');
  assert.equal(plain('k7/8/8/K2pP2r/8/8/8/8 w - d6 0 1').includes('e5d6'), false, 'both pawns leave the fifth rank');
  const taken = walk(fen, ['e5d6']);
  assert.match(taken, /^k7\/8\/3P4\/8\//, 'the pawn that passed is removed');
  // The key keeps the target only when a capture exists.
  assert.equal(positionKey(parseFen(fen)).endsWith(' d6'), true);
  assert.equal(positionKey(parseFen(walk('k7/3p4/8/8/8/8/8/K7 b - - 0 1', ['d7d5']))).endsWith(' -'), true);
});

test('chess core: promotion to each piece, with and without a capture', () => {
  const fen = 'k2r4/4P3/8/8/8/8/8/K7 w - - 0 1';
  const moves = legalMoves(parseFen(fen)).filter((move) => moveFrom(move) === 12);
  assert.deepEqual(moves.map((move) => movePromo(move)).sort(), [2, 2, 3, 3, 4, 4, 5, 5], 'four choices, two squares');
  assert.equal(sanOf('k7/4P3/8/8/8/8/8/K7 w - - 0 1', 'e7e8q'), 'e8=Q+');
  assert.equal(sanOf(fen, 'e7d8q'), 'exd8=Q+');
  assert.equal(sanOf(fen, 'e7d8n'), 'exd8=N');
  assert.equal(sanOf('7k/4P3/8/8/8/8/8/K7 w - - 0 1', 'e7e8r'), 'e8=R+');
  assert.match(walk('7k/4P3/8/8/8/8/8/K7 w - - 0 1', ['e7e8b']), /^4B2k\//);
});

test('chess core: pinned pieces and check evasion', () => {
  assert.equal(plain('k3r3/8/8/8/8/8/4N3/4K3 w - - 0 1').some((move) => move.startsWith('e2')), false, 'a pinned knight cannot move');
  assert.equal(plain('k3r3/8/8/8/8/8/4R3/4K3 w - - 0 1').filter((move) => move.startsWith('e2')).length, 6, 'a pinned rook slides along the pin');
  const check = '4r1k1/8/8/8/8/8/8/R3K3 w - - 0 1';
  assert.equal(inCheck(parseFen(check)), true);
  assert.deepEqual(plain(check).sort(), ['e1d1', 'e1d2', 'e1f1', 'e1f2']);
  assert.equal(plain('4r1k1/8/8/8/8/8/3B4/R3K3 w - - 0 1').includes('d2e3'), true, 'a block');
});

test('chess core: mate, stalemate and the notation of both', () => {
  const mate = parseFen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
  assert.deepEqual([inCheck(mate), hasLegalMove(mate)], [true, false]);
  assert.equal(sanOf('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2', 'd8h4'), 'Qh4#');
  const stale = parseFen('k7/2Q5/1K6/8/8/8/8/8 b - - 0 1');
  assert.deepEqual([inCheck(stale), hasLegalMove(stale)], [false, false]);
  assert.equal(sanOf('k7/8/1K6/8/8/8/2Q5/8 w - - 0 1', 'c2c7'), 'Qc7');
});

test('chess core: notation tells identical pieces apart', () => {
  assert.equal(sanOf('7k/8/8/8/8/5N2/8/KN6 w - - 0 1', 'b1d2'), 'Nbd2');
  assert.equal(sanOf('7k/8/8/8/8/5N2/8/KN6 w - - 0 1', 'f3d2'), 'Nfd2');
  assert.equal(sanOf('7k/R7/8/8/8/8/8/R3K3 w - - 0 1', 'a1a3'), 'R1a3');
  assert.equal(sanOf('7k/R7/8/8/8/8/8/R3K3 w - - 0 1', 'a7a3'), 'R7a3');
  assert.equal(sanOf('1k6/8/8/8/8/8/6K1/R4R2 w - - 0 1', 'a1d1'), 'Rad1');
  assert.equal(sanOf('1k6/8/8/8/8/8/6K1/R4R2 w - - 0 1', 'f1d1'), 'Rfd1');
  assert.equal(sanOf('8/8/8/7k/8/Q7/8/Q1Q4K w - - 0 1', 'a1c3'), 'Qa1c3');
  assert.equal(sanOf('8/8/8/7k/8/Q7/8/Q1Q4K w - - 0 1', 'a3c3'), 'Q3c3');
  assert.equal(sanOf('8/8/8/7k/8/Q7/8/Q1Q4K w - - 0 1', 'c1c3'), 'Qcc3');
  assert.equal(sanOf('k7/8/8/3p4/4P3/8/8/K7 w - - 0 1', 'e4d5'), 'exd5');
  assert.equal(sanOf('k7/8/8/3p4/4P3/8/8/K7 w - - 0 1', 'e4e5'), 'e5');
  assert.equal(sanOf('k7/8/8/3p4/4P3/8/8/K7 w - - 0 1', 'a1b2'), 'Kb2');
  assert.equal(sanOf('4k3/8/8/8/8/8/3n4/R3K3 w - - 0 1', 'e1d2'), 'Kxd2');
});

test('chess core: material that cannot mate', () => {
  const dead = (fen: string) => insufficientMaterial(parseFen(fen));
  assert.equal(dead('4k3/8/8/8/8/8/8/4K3 w - - 0 1'), true, 'K v K');
  assert.equal(dead('4k3/8/8/8/8/8/8/3NK3 w - - 0 1'), true, 'K+N v K');
  assert.equal(dead('4k3/8/8/8/8/8/8/3BK3 w - - 0 1'), true, 'K+B v K');
  assert.equal(dead('4kb2/8/8/8/8/8/8/2B1K3 w - - 0 1'), true, 'bishops on the same colour');
  assert.equal(dead('2b1k3/8/8/8/8/8/8/2B1K3 w - - 0 1'), false, 'bishops on different colours');
  assert.equal(dead('4k3/8/8/8/8/8/8/2NNK3 w - - 0 1'), false, 'K+N+N v K can still be mated into');
  assert.equal(dead('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'), false, 'a pawn');
  assert.equal(dead('4k3/8/8/8/8/8/8/3RK3 w - - 0 1'), false, 'a rook');
  assert.equal(dead('4k3/8/8/8/8/B7/8/2B1K3 w - - 0 1'), true, 'two bishops on the same colour')
  assert.equal(dead('4k3/8/8/8/8/8/8/2BBK3 w - - 0 1'), false, 'two bishops on different colours');
});
