import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyBoard, placeTiles } from '../../../tables/weave-board.ts'
import type { WeaveView } from '../../../tables/weave-core.ts'
import {
  eventFor, historyLine, historyLines, moveTile, newDraft, newSquares, nextEvent, placeTile, placedAt, preview, recallAll, recallTile, restingRack, results, scoreRows,
  setBlankLetter, shuffleRack, spokenTurn, squareLabel, squareName, statusLine, swapReason, syncDraft, toPlay, toSwap, toggleSwap, unsetBlank, premiumClass, premiumShort,
} from './weaveModel.ts'

const seats = [{ name: 'Ada' }, { name: 'Bola', bot: true }, { name: 'Chi' }]
const view = (patch: Partial<WeaveView> = {}): WeaveView => ({
  game: 'weave', options: { speed: 'relaxed' }, board: emptyBoard(), scores: [0, 0, 0], history: [], bagCount: 60, rack: ['s', 't', 'o', 'r', 'm', 'e', '?'],
  counts: [7, 7, 7], turn: 0, out: [false, false, false], scoreless: 0, over: null, racks: null, ...patch,
})

/** Lay `letters` of the rack along row `r` from column `c`. */
function lay(v: WeaveView, indexes: number[], r: number, c: number) {
  let draft = newDraft(v.rack)
  indexes.forEach((index, at) => { draft = placeTile(draft, v.board, v.rack ?? [], index, r, c + at) })
  return draft
}

test('draft: place, move, recall, and the rack that is left', () => {
  const v = view()
  let draft = newDraft(v.rack)
  assert.deepEqual(restingRack(draft), [0, 1, 2, 3, 4, 5, 6])
  draft = placeTile(draft, v.board, v.rack ?? [], 0, 6, 6)
  assert.equal(draft.placed.length, 1)
  assert.deepEqual(restingRack(draft), [1, 2, 3, 4, 5, 6])
  assert.equal(placeTile(draft, v.board, v.rack ?? [], 1, 6, 6), draft, 'a taken square refuses')
  assert.equal(placeTile(draft, v.board, v.rack ?? [], 0, 6, 7), draft, 'a tile already down is not laid twice')
  assert.equal(placeTile(draft, v.board, v.rack ?? [], 1, 13, 0), draft, 'off the board refuses')
  const moved = moveTile(draft, v.board, { r: 6, c: 6 }, { r: 6, c: 7 })
  assert.ok(placedAt(moved, 6, 7) && !placedAt(moved, 6, 6))
  const occupied = placeTiles(v.board, [{ r: 2, c: 2, l: 'a' }])
  assert.equal(placeTile(newDraft(v.rack), occupied, v.rack ?? [], 0, 2, 2).placed.length, 0, 'a board tile blocks')
  assert.equal(recallTile(moved, 6, 7).placed.length, 0)
  assert.equal(recallAll(lay(v, [0, 1, 2], 6, 5)).placed.length, 0)
})

test('draft: shuffling changes only the order; a new rack starts over; an opponent covering a square drops the tile', () => {
  const v = view()
  const draft = lay(v, [0, 1], 6, 6)
  const shuffled = shuffleRack(draft, () => 0)
  assert.deepEqual(shuffled.rackOrder.slice().sort(), draft.rackOrder.slice().sort())
  assert.equal(shuffled.placed.length, 2)
  assert.deepEqual(syncDraft(draft, v), draft)
  assert.equal(syncDraft(draft, view({ rack: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })).placed.length, 0)
  const taken = view({ board: placeTiles(v.board, [{ r: 6, c: 7, l: 'x' }]) })
  assert.deepEqual(syncDraft(draft, taken).placed.map((tile) => tile.c), [6])
})

test('swap: ticking tiles and the move they make; the bag decides whether a swap is allowed', () => {
  let picked: number[] = []
  picked = toggleSwap(picked, 3); picked = toggleSwap(picked, 1)
  assert.deepEqual(picked, [1, 3])
  assert.deepEqual(toggleSwap(picked, 1), [3])
  assert.deepEqual(toSwap(['s', 't', 'o', 'r', 'm', 'e', '?'], [1, 6]), { t: 'exchange', letters: ['t', '?'] })
  assert.equal(swapReason({ bagCount: 7 }, true), null)
  assert.match(swapReason({ bagCount: 3 }, true) ?? '', /needs 7 tiles in the bag; 3 left/)
  assert.equal(swapReason({ bagCount: 30 }, false), 'Wait for your turn.')
})

test('preview: nothing laid, the first move off the centre, a lone tile', () => {
  const v = view()
  assert.deepEqual(preview(v, newDraft(v.rack)), { ok: false, text: 'Make a line of connected tiles', points: 0, words: [] })
  const off = preview(v, lay(v, [0, 1, 2], 1, 1))
  assert.equal(off.ok, false)
  assert.equal(off.text, 'The first word must cover the centre square.')
  assert.equal(preview(v, lay(v, [0], 6, 6)).text, 'The first word needs at least two letters.')
  const scatter = placeTile(lay(v, [0], 6, 6), v.board, v.rack ?? [], 1, 8, 8)
  assert.equal(preview(v, scatter).text, 'Those tiles must be in one row or one column.')
})

test('preview: a five-letter first play with the centre doubling it, and a second play that forms two words', () => {
  const v = view()
  // STORM along the middle row, columns 4 to 8, so it covers the centre.
  const first = lay(v, [0, 1, 2, 3, 4], 6, 4)
  const score = preview(v, first)
  assert.equal(score.ok, true)
  assert.equal(score.text, `Weave: STORM ${score.points}`)
  // S1 T1 O1 R1 M3 = 7 before premiums; the centre doubles it.
  assert.ok(score.points >= 14, 'the centre doubles the word')
  assert.deepEqual(score.words.map((word) => word.word), ['STORM'])
  const board = placeTiles(v.board, [4, 5, 6, 7, 8].map((c, at) => ({ r: 6, c, l: 'storm'[at] as string })))
  const next = view({ board })
  let draft = newDraft(next.rack)
  draft = placeTile(draft, board, next.rack ?? [], 5, 7, 8) // E below M
  draft = placeTile(draft, board, next.rack ?? [], 2, 8, 8) // O below it: MEO
  const two = preview(next, draft)
  assert.equal(two.ok, true)
  assert.deepEqual(two.words.map((word) => word.word), ['MEO'])
  assert.match(two.text, /^Weave: MEO \d+$/)
})

test('preview: every word formed is listed with the total, and a play of seven tiles adds the bonus', () => {
  const board = placeTiles(emptyBoard(), [{ r: 6, c: 6, l: 'a' }, { r: 6, c: 7, l: 'n' }])
  const v = view({ board, rack: ['d', 'o', 'e', 's', 't', 'r', 'i'] })
  let draft = newDraft(v.rack)
  draft = placeTile(draft, board, v.rack ?? [], 0, 7, 6)
  draft = placeTile(draft, board, v.rack ?? [], 1, 7, 7)
  const out = preview(v, draft)
  assert.equal(out.ok, true)
  assert.ok(out.words.length >= 3, 'DO across and AD and NO down')
  assert.match(out.text, /^Weave: DO \d+ · AD \d+ · NO \d+ = \d+$/)
  assert.equal(out.points, out.words.reduce((sum, word) => sum + word.points, 0))
  const seven = view({ board: emptyBoard(), rack: ['s', 't', 'o', 'r', 'm', 'e', 'd'] })
  const all = preview(seven, lay(seven, [0, 1, 2, 3, 4, 5, 6], 6, 3))
  assert.equal(all.ok, true)
  assert.match(all.text, /all 7 tiles \+30/)
})

test('blank: laying one needs a letter, which then counts as zero points and is played as a blank', () => {
  const v = view()
  let draft = lay(v, [0, 6], 6, 6)
  assert.equal(draft.placed[1]?.blank, true)
  assert.equal(unsetBlank(draft)?.c, 7)
  assert.equal(preview(v, draft).text, 'Choose a letter for the blank')
  assert.equal(setBlankLetter(draft, 6, 6, 'a'), draft, 'a plain tile is not a blank')
  assert.equal(setBlankLetter(draft, 6, 7, '3'), draft, 'only letters')
  draft = setBlankLetter(draft, 6, 7, 'T')
  assert.equal(unsetBlank(draft), undefined)
  const out = preview(v, draft)
  assert.equal(out.ok, true)
  assert.deepEqual(toPlay(draft), { t: 'play', tiles: [{ r: 6, c: 6, l: 's' }, { r: 6, c: 7, l: 't', blank: true }] })
  assert.equal(out.points, (1 + 0) * 2, 'the blank is worth nothing and the centre doubles')
  assert.equal(squareLabel(v.board, draft, 6, 7), 'G7, T as a blank, 0 points, tentative'.replace('G7', squareName(6, 7)))
})

test('squares: names, classes and the words a screen reader gets', () => {
  const board = placeTiles(emptyBoard(), [{ r: 3, c: 3, l: 's' }, { r: 3, c: 4, l: 'o', blank: true }])
  const draft = newDraft(['a'])
  assert.equal(squareName(6, 6), 'G7')
  assert.equal(squareLabel(board, draft, 6, 6), 'G7, empty, centre, double word')
  assert.equal(squareLabel(board, draft, 3, 3), 'D4, S, 1 point')
  assert.equal(squareLabel(board, draft, 3, 4), 'E4, O as a blank, 0 points')
  assert.equal(squareLabel(board, placeTile(draft, board, ['a'], 0, 0, 1), 0, 1), 'B1, A, 1 point, tentative')
  assert.equal(premiumClass(3, 3), 'is-tw')
  assert.equal(premiumShort(3, 3), 'TW')
  assert.equal(premiumClass(0, 1), '')
  assert.deepEqual(newSquares(emptyBoard(), board).sort(), ['3,3', '3,4'])
  assert.deepEqual(newSquares(null, board), [])
})

test('words: status, scores, history and the spoken turn', () => {
  assert.equal(statusLine(view(), seats, 0), 'Your turn')
  assert.equal(statusLine(view({ turn: 2 }), seats, 0), 'Waiting for Chi')
  assert.equal(statusLine(view({ turn: 1 }), seats, 0), 'Bola is thinking')
  assert.equal(statusLine(view({ turn: 2 }), seats, null), 'Chi to play')
  assert.equal(statusLine(view({ turn: null, over: { winners: [0], draw: false, reason: 'x', text: 't', scores: [] } }), seats, 0), 'Game over')
  const rows = scoreRows(view({ scores: [10, 40, 40], turn: 2 }), seats, 0)
  assert.deepEqual(rows.map((row) => row.name), ['Bola', 'Chi', 'Ada'])
  assert.equal(rows[0]?.bot, true)
  assert.equal(rows[1]?.active, true)
  assert.equal(rows[2]?.you, true)
  const play = { seat: 0, kind: 'play' as const, words: [{ w: 'storm', p: 14 }, { w: 'bo', p: 9 }], points: 23, tiles: 5 }
  assert.equal(historyLine({ ...play, words: [{ w: 'storm', p: 14 }], points: 14 }, seats), 'Ada played STORM for 14')
  assert.equal(historyLine(play, seats), 'Ada played STORM, BO for 23')
  assert.equal(historyLine({ seat: 1, kind: 'exchange', words: [], points: 0, tiles: 3 }, seats), 'Bola swapped 3 tiles')
  assert.equal(historyLine({ seat: 1, kind: 'exchange', words: [], points: 0, tiles: 1 }, seats), 'Bola swapped 1 tile')
  assert.equal(historyLine({ seat: 2, kind: 'pass', words: [], points: 0, tiles: 0 }, seats), 'Chi passed')
  assert.deepEqual(historyLines({ history: [play, { seat: 2, kind: 'pass', words: [], points: 0, tiles: 0 }] }, seats), ['Chi passed', 'Ada played STORM, BO for 23'])
  assert.match(spokenTurn(play, seats), /^Ada played STORM, 23 points in all, and B O for 9\.$/)
})

test('results: the sentence with names, the winner and what each player was left holding', () => {
  const over = { winners: [0], draw: false, reason: 'empty-rack', text: '{0} used every tile and wins against {1}.', scores: [120, 90, 80] }
  const out = results({ over, scores: [120, 90, 80], racks: [[], ['q', '?'], ['z']] }, seats)
  assert.equal(out?.text, 'Ada used every tile and wins against Bola.')
  assert.deepEqual(out?.rows.map((row) => row.name), ['Ada', 'Bola', 'Chi'])
  assert.equal(out?.rows[0]?.winner, true)
  assert.deepEqual(out?.rows[1]?.left, ['Q', 'blank'])
  assert.equal(out?.rows[1]?.leftPoints, 10)
  assert.equal(out?.rows[2]?.leftPoints, 10)
  assert.equal(results({ over: null, scores: [], racks: null }, seats), null)
})

test('events: a kind per turn, a bingo for seven tiles, one per new move, none on the first draw', () => {
  const turn = (kind: 'play' | 'exchange' | 'pass', tiles: number) => ({ seat: 0, kind, words: [], points: 0, tiles })
  assert.equal(eventFor(turn('play', 4)), 'play')
  assert.equal(eventFor(turn('play', 7)), 'bingo')
  assert.equal(eventFor(turn('exchange', 3)), 'exchange')
  assert.equal(eventFor(turn('pass', 0)), 'pass')
  const history = [turn('play', 4), turn('pass', 0)]
  assert.equal(nextEvent(null, 5, { history, over: null }, false), null, 'the first draw makes no sound')
  assert.equal(nextEvent(5, 5, { history, over: null }, false), null, 'the same move again makes none')
  assert.equal(nextEvent(5, 6, { history, over: null }, false), 'pass')
  const over = { winners: [0], draw: false, reason: 'x', text: 't', scores: [] }
  assert.equal(nextEvent(6, 7, { history, over }, false), 'end')
  assert.equal(nextEvent(7, 8, { history, over }, true), null)
})
