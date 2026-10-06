import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  canMove, capturedWords, clockText, destinationsFrom, displayOrder, eventFromSan, isCapture, materialLead, movesBetween, needsPromotion, nextEvent, orientation,
  overBanner, pairMoves, remainingFor, sanWords, seenOf, sortCaptured, squareIndex, squareLabel, squareName, statusText, stepSquare, turnLeft,
} from './chessModel.ts'
import { PIECE_SVG } from './chessPieces.ts'

const legal = [
  { from: 'e2', to: 'e4' }, { from: 'e2', to: 'e3' }, { from: 'g1', to: 'f3' },
  { from: 'a7', to: 'a8', promo: 'q' as const }, { from: 'a7', to: 'a8', promo: 'r' as const }, { from: 'a7', to: 'a8', promo: 'b' as const }, { from: 'a7', to: 'a8', promo: 'n' as const },
]
const sides = { w: 'Ada', b: 'Bola' }
const drawn = { winners: [], draw: true, reason: 'agreed', text: '', scores: [0.5, 0.5] }

test('squares and indexes agree', () => {
  assert.equal(squareName(0), 'a8')
  assert.equal(squareName(63), 'h1')
  assert.equal(squareIndex('e4'), 36)
  assert.equal(squareIndex('z9'), -1)
  for (let i = 0; i < 64; i++) assert.equal(squareIndex(squareName(i)), i)
})

test('Black sits at the bottom for a Black player, and Flip turns the board', () => {
  assert.equal(orientation('b', false), 'b')
  assert.equal(orientation('w', false), 'w')
  assert.equal(orientation(null, false), 'w')
  assert.equal(orientation('b', true), 'w')
  assert.equal(orientation(null, true), 'b')
  assert.equal(squareName(displayOrder('w')[0] as number), 'a8')
  assert.equal(squareName(displayOrder('b')[0] as number), 'h1')
  assert.equal(stepSquare('e2', 'w', 0, 1), 'e1')
  assert.equal(stepSquare('e2', 'b', 0, 1), 'e3')
  assert.equal(stepSquare('a8', 'w', -1, 0), null)
})

test('legal destinations and promotion', () => {
  assert.deepEqual(destinationsFrom({ legal }, 'e2'), ['e4', 'e3'])
  assert.deepEqual(destinationsFrom({ legal }, 'd2'), [])
  assert.equal(movesBetween({ legal }, 'a7', 'a8').length, 4)
  assert.equal(needsPromotion({ legal }, 'a7', 'a8'), true)
  assert.equal(needsPromotion({ legal }, 'e2', 'e4'), false)
  assert.equal(canMove({ you: 'w', turn: 'w', over: null }), true)
  assert.equal(canMove({ you: 'w', turn: 'b', over: null }), false)
  assert.equal(canMove({ you: null, turn: 'w', over: null }), false)
})

test('captures include en passant', () => {
  const board = Array<string | null>(64).fill(null)
  board[squareIndex('e5')] = 'wP'
  board[squareIndex('d5')] = 'bP'
  assert.equal(isCapture({ board }, 'e5', 'd6'), true)
  assert.equal(isCapture({ board }, 'e5', 'e6'), false)
  assert.equal(isCapture({ board }, 'e5', 'd5'), true)
})

test('labels name the piece and what is on the square', () => {
  const none = { selected: false, legal: false, last: false, check: false }
  assert.equal(squareLabel('e4', 'wN', none), 'e4, white knight')
  assert.equal(squareLabel('e4', null, { ...none, legal: true }), 'e4, empty, legal move')
  assert.equal(squareLabel('e1', 'wK', { selected: true, legal: false, last: true, check: true }), 'e1, white king, selected, last move, check')
})

test('clock text', () => {
  assert.equal(clockText(300000), '5:00')
  assert.equal(clockText(65400), '1:06')
  assert.equal(clockText(3723000), '1:02:03')
  assert.equal(clockText(9990), '9.9')
  assert.equal(clockText(4200), '4.2')
  assert.equal(clockText(-5), '0.0')
})

test('the mover runs on the frame, the other side stands still', () => {
  const clock = { deadline: 100000, now: 40000, seconds: 300 }
  const view = { clocks: { w: 60000, b: 45000 }, turn: 'w' as const, over: null }
  assert.equal(turnLeft(clock, 1000, 1000), 60000)
  assert.equal(turnLeft(clock, 3000, 1000), 58000)
  assert.equal(remainingFor('w', view, clock, 3000, 1000), 58000)
  assert.equal(remainingFor('b', view, clock, 3000, 1000), 45000)
  assert.equal(remainingFor('w', { ...view, over: drawn }, clock, 3000, 1000), 60000)
  assert.equal(remainingFor('w', { ...view, clocks: null }, clock, 3000, 1000), null)
  assert.equal(turnLeft(clock, 99999999, 1000), 0)
})

test('moves pair up', () => {
  assert.deepEqual(pairMoves([]), [])
  assert.deepEqual(pairMoves(['e4', 'e5', 'Nf3']), [
    { number: 1, white: 'e4', black: 'e5', whiteAt: 0, blackAt: 1 },
    { number: 2, white: 'Nf3', black: null, whiteAt: 2, blackAt: null },
  ])
})

test('captured pieces sort by worth and the lead is the difference', () => {
  assert.deepEqual(sortCaptured(['bP', 'bQ', 'bN', 'bP', 'bR']), ['bQ', 'bR', 'bN', 'bP', 'bP'])
  const captured = { w: ['bQ', 'bP'], b: ['wR', 'wN'] }
  assert.equal(materialLead({ captured }, 'w'), 2)
  assert.equal(materialLead({ captured }, 'b'), -2)
  assert.equal(capturedWords(['bP', 'bP', 'bN']), 'knight, 2 pawns')
  assert.equal(capturedWords([]), 'nothing')
})

test('status text', () => {
  const base = { you: 'w' as const, turn: 'w' as const, over: null, check: null }
  assert.equal(statusText(base, sides), 'Your move')
  assert.equal(statusText({ ...base, check: 'e1' }, sides), 'Check. Your move')
  assert.equal(statusText({ ...base, turn: 'b' }, sides), 'Waiting for Bola')
  assert.equal(statusText({ ...base, you: null }, sides), 'Ada to move')
  const mate = { winners: [0], draw: false, reason: 'checkmate', text: '', scores: [1, 0] }
  assert.equal(statusText({ ...base, over: mate }, sides), 'Checkmate')
  assert.equal(overBanner({ ...drawn, reason: 'repetition' }), 'Draw by repetition')
})

test('moves in words', () => {
  assert.equal(sanWords('e4'), 'pawn to e4')
  assert.equal(sanWords('Nxe5+'), 'knight takes e5, check')
  assert.equal(sanWords('O-O'), 'castles kingside')
  assert.equal(sanWords('exd5'), 'pawn e takes d5')
  assert.equal(sanWords('e8=Q#'), 'pawn to e8, promotes to queen, checkmate')
  assert.equal(sanWords('Nbd2'), 'knight b to d2')
})

test('events come from the last move, once, and never on the first draw', () => {
  assert.equal(eventFromSan('e4', false), 'move')
  assert.equal(eventFromSan('Nxe5', false), 'capture')
  assert.equal(eventFromSan('Qh5+', false), 'check')
  assert.equal(eventFromSan('O-O-O', false), 'castle')
  assert.equal(eventFromSan('e8=Q', false), 'promote')
  assert.equal(eventFromSan('Qxf7#', true), 'end')
  const view = { history: ['e4', 'e5'], over: null }
  assert.equal(nextEvent(null, view), null)
  assert.equal(nextEvent(seenOf(view), view), null)
  assert.equal(nextEvent(seenOf(view), { history: ['e4', 'e5', 'Nf3'], over: null }), 'move')
  const resigned = { winners: [0], draw: false, reason: 'resign', text: '', scores: [1, 0] }
  assert.equal(nextEvent(seenOf(view), { history: ['e4', 'e5'], over: resigned }), 'end')
  assert.equal(nextEvent(seenOf({ history: ['e4', 'e5'], over: resigned }), { history: ['e4', 'e5'], over: resigned }), null)
})

test('every piece has its drawing', () => {
  assert.equal(Object.keys(PIECE_SVG).length, 12)
  for (const svg of Object.values(PIECE_SVG)) assert.match(svg, /^<svg viewBox="0 0 100 100"/)
})
