// The pure parts of the Weave board: the tentative move (tiles laid on the board but not yet
// played), what it would score, the words the screen says (status, scores, history, results) and the
// event a new turn gives. The component only draws what these answer. The live score uses the same
// board functions as the server's rules, and none of the word list: a play that is not a word is
// refused by the server, not here.
import { CENTRE, RACK_SIZE, SIZE, cellAt, isBlankTile, premiumAt, scorePlay, tileValue } from '../../../tables/weave-board.ts'
import type { Board, Placement, Premium } from '../../../tables/weave-board.ts'
import type { WeaveMove, WeaveTurn, WeaveView } from '../../../tables/weave-core.ts'

/** Fewer tiles than this in the bag and a swap is not allowed (the server's rule). */
export const SWAP_MIN_BAG = 7
export const COLUMNS = 'ABCDEFGHIJKLM'
export const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'

/** A rack tile laid on a square. `letter` is '' for a blank whose letter is not chosen yet. */
export interface PlacedTile { r: number; c: number; rackIndex: number; letter: string; blank?: true }
/** The tentative move: tiles on the board, and the order the rack is shown in. `rackKey` is the rack it was made for. */
export interface Draft { placed: PlacedTile[]; rackOrder: number[]; rackKey: string }
export interface Square { r: number; c: number }

const inside = (r: number, c: number): boolean => Number.isInteger(r) && Number.isInteger(c) && r >= 0 && c >= 0 && r < SIZE && c < SIZE
export const rackKeyOf = (rack: readonly string[] | null): string => (rack ?? []).join('')
export const newDraft = (rack: readonly string[] | null): Draft => ({ placed: [], rackOrder: (rack ?? []).map((_, index) => index), rackKey: rackKeyOf(rack) })

export const placedAt = (draft: Draft, r: number, c: number): PlacedTile | undefined => draft.placed.find((tile) => tile.r === r && tile.c === c)
/** The rack indexes still in the rack, in the order they are shown. */
export const restingRack = (draft: Draft): number[] => draft.rackOrder.filter((index) => !draft.placed.some((tile) => tile.rackIndex === index))

/** Lay a rack tile on an empty square. Unchanged when the square is taken, off the board, or the tile is already down. */
export function placeTile(draft: Draft, board: Board, rack: readonly string[], rackIndex: number, r: number, c: number): Draft {
  const letter = rack[rackIndex]
  if (letter === undefined || !inside(r, c) || cellAt(board, r, c) !== '.' || placedAt(draft, r, c) || draft.placed.some((tile) => tile.rackIndex === rackIndex)) return draft
  const tile: PlacedTile = letter === '?' ? { r, c, rackIndex, letter: '', blank: true } : { r, c, rackIndex, letter }
  return { ...draft, placed: [...draft.placed, tile] }
}
/** Move a tentative tile to another empty square (the letter of a blank is kept). */
export function moveTile(draft: Draft, board: Board, from: Square, to: Square): Draft {
  const tile = placedAt(draft, from.r, from.c)
  if (!tile || !inside(to.r, to.c) || cellAt(board, to.r, to.c) !== '.' || placedAt(draft, to.r, to.c)) return draft
  return { ...draft, placed: draft.placed.map((one) => (one === tile ? { ...one, r: to.r, c: to.c } : one)) }
}
export const recallTile = (draft: Draft, r: number, c: number): Draft => (placedAt(draft, r, c) ? { ...draft, placed: draft.placed.filter((tile) => tile.r !== r || tile.c !== c) } : draft)
export const recallAll = (draft: Draft): Draft => (draft.placed.length ? { ...draft, placed: [] } : draft)
/** Choose the letter of a tentative blank. */
export function setBlankLetter(draft: Draft, r: number, c: number, letter: string): Draft {
  const tile = placedAt(draft, r, c)
  const lower = letter.toLowerCase()
  if (!tile || !tile.blank || !/^[a-z]$/.test(lower)) return draft
  return { ...draft, placed: draft.placed.map((one) => (one === tile ? { ...one, letter: lower } : one)) }
}
/** The tentative blank still waiting for its letter, if any. */
export const unsetBlank = (draft: Draft): PlacedTile | undefined => draft.placed.find((tile) => tile.blank && tile.letter === '')
/** Shuffle the order the rack is shown in (Fisher-Yates; `random` is Math.random in the browser). */
export function shuffleRack(draft: Draft, random: () => number): Draft {
  const order = draft.rackOrder.slice()
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [order[i], order[j]] = [order[j] as number, order[i] as number]
  }
  return { ...draft, rackOrder: order }
}
/**
 * Bring a draft up to date with a new view. A different rack (your own play came back) starts a new
 * draft; the same rack keeps the tiles and the order, but lets go of tiles whose square an opponent
 * just filled.
 */
export function syncDraft(draft: Draft, view: Pick<WeaveView, 'board' | 'rack'>): Draft {
  if (draft.rackKey !== rackKeyOf(view.rack)) return newDraft(view.rack)
  const kept = draft.placed.filter((tile) => cellAt(view.board, tile.r, tile.c) === '.')
  return kept.length === draft.placed.length ? draft : { ...draft, placed: kept }
}

/** The tiles of the draft as a play's placements (a blank is `blank: true` with its chosen letter). */
export const toPlacements = (draft: Draft): Placement[] => draft.placed.map((tile) => (tile.blank ? { r: tile.r, c: tile.c, l: tile.letter, blank: true } : { r: tile.r, c: tile.c, l: tile.letter }))
export const toPlay = (draft: Draft): WeaveMove => ({ t: 'play', tiles: toPlacements(draft) })

// ---- swapping -----------------------------------------------------------------------------------
/** Tick or untick a rack tile for a swap. */
export const toggleSwap = (selected: readonly number[], rackIndex: number): number[] => (selected.includes(rackIndex) ? selected.filter((index) => index !== rackIndex) : [...selected, rackIndex].sort((a, b) => a - b))
export const toSwap = (rack: readonly string[], selected: readonly number[]): WeaveMove => ({ t: 'exchange', letters: selected.map((index) => rack[index]).filter((letter): letter is string => letter !== undefined) })
/** Why a swap is not possible now, or null. */
export function swapReason(view: Pick<WeaveView, 'bagCount'>, myTurn: boolean): string | null {
  if (!myTurn) return 'Wait for your turn.'
  return view.bagCount < SWAP_MIN_BAG ? `A swap needs ${SWAP_MIN_BAG} tiles in the bag; ${view.bagCount} left.` : null
}

// ---- the live score -----------------------------------------------------------------------------
export interface Preview { ok: boolean; text: string; points: number; words: { word: string; points: number }[] }
const shout = (word: string): string => word.toUpperCase()

/** What the tentative tiles would score, in words: 'Weave: STORM 14 · BO 9 = 23', or what is wrong with the shape. */
export function preview(view: Pick<WeaveView, 'board'>, draft: Draft): Preview {
  if (draft.placed.length === 0) return { ok: false, text: 'Make a line of connected tiles', points: 0, words: [] }
  if (unsetBlank(draft)) return { ok: false, text: 'Choose a letter for the blank', points: 0, words: [] }
  const score = scorePlay(view.board, toPlacements(draft))
  if (!score.ok) return { ok: false, text: score.error ?? 'Make a line of connected tiles', points: 0, words: [] }
  const words = score.words.map((word) => ({ word: shout(word.word), points: word.points }))
  const parts = words.map((word) => `${word.word} ${word.points}`)
  if (score.bonus) parts.push(`all ${RACK_SIZE} tiles +${score.bonus}`)
  return { ok: true, text: `Weave: ${parts.join(' · ')}${parts.length > 1 ? ` = ${score.points}` : ''}`, points: score.points, words }
}

// ---- squares ------------------------------------------------------------------------------------
export const squareName = (r: number, c: number): string => `${COLUMNS[c] ?? '?'}${r + 1}`
const PREMIUM_CLASS: Readonly<Record<Premium, string>> = { DL: 'is-dl', TL: 'is-tl', DW: 'is-dw', TW: 'is-tw' }
const PREMIUM_WORDS: Readonly<Record<Premium, string>> = { DL: 'double letter', TL: 'triple letter', DW: 'double word', TW: 'triple word' }
export const isCentre = (r: number, c: number): boolean => r === CENTRE.r && c === CENTRE.c
/** The class of a square's premium ('' for none) and its short label ('DL', 'TL', 'DW', 'TW', '' ). */
export const premiumClass = (r: number, c: number): string => { const premium = premiumAt(r, c); return premium ? PREMIUM_CLASS[premium] : '' }
export const premiumShort = (r: number, c: number): string => premiumAt(r, c) ?? ''
/** What a square is, for a screen reader: 'H7, empty, double word' · 'H7, S, 1 point' · 'H7, S, 1 point, tentative'. */
export function squareLabel(board: Board, draft: Draft, r: number, c: number): string {
  const name = squareName(r, c)
  const tentative = placedAt(draft, r, c)
  const cell = tentative ? (tentative.blank ? tentative.letter.toUpperCase() : tentative.letter) : cellAt(board, r, c)
  if (tentative && tentative.letter === '') return `${name}, blank, letter not chosen, tentative`
  if (cell !== '.') {
    const blank = tentative ? Boolean(tentative.blank) : isBlankTile(cell)
    const value = blank ? 0 : tileValue(cell)
    return `${name}, ${cell.toUpperCase()}${blank ? ' as a blank' : ''}, ${value} point${value === 1 ? '' : 's'}${tentative ? ', tentative' : ''}`
  }
  const premium = premiumAt(r, c)
  return `${name}, empty${isCentre(r, c) ? ', centre' : ''}${premium ? `, ${PREMIUM_WORDS[premium]}` : ''}`
}
/** The squares whose tile is new in `next` compared with `before` ('r,c' keys): the last move, to highlight. */
export function newSquares(before: Board | null, next: Board): string[] {
  if (!before) return []
  const found: string[] = []
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (cellAt(before, r, c) === '.' && cellAt(next, r, c) !== '.') found.push(`${r},${c}`)
  return found
}

// ---- the words on the screen --------------------------------------------------------------------
type Seats = readonly { name: string; bot?: boolean }[]
const nameOf = (seats: Seats, seat: number): string => seats[seat]?.name ?? `Player ${seat + 1}`

/** The line under the board's header: whose move it is. */
export function statusLine(view: Pick<WeaveView, 'turn' | 'over'>, seats: Seats, you: number | null): string {
  if (view.over) return 'Game over'
  if (view.turn === null) return ''
  if (view.turn === you) return 'Your turn'
  const name = nameOf(seats, view.turn)
  return seats[view.turn]?.bot ? `${name} is thinking` : you === null ? `${name} to play` : `Waiting for ${name}`
}

export interface ScoreRow { seat: number; name: string; bot: boolean; score: number; tiles: number; active: boolean; you: boolean; out: boolean }
/** One row for each seat, the highest score first (ties keep the seat order). */
export function scoreRows(view: Pick<WeaveView, 'scores' | 'counts' | 'turn' | 'out'>, seats: Seats, you: number | null): ScoreRow[] {
  return seats.map((seat, index): ScoreRow => ({
    seat: index, name: seat.name, bot: Boolean(seat.bot), score: view.scores[index] ?? 0, tiles: view.counts[index] ?? 0,
    active: view.turn === index, you: you === index, out: Boolean(view.out[index]),
  })).sort((a, b) => b.score - a.score || a.seat - b.seat)
}
/** 'Ada played STORM for 14' · 'Bola swapped 3 tiles' · 'Bola passed'. */
export function historyLine(turn: WeaveTurn, seats: Seats): string {
  const name = nameOf(seats, turn.seat)
  if (turn.kind === 'exchange') return `${name} swapped ${turn.tiles} tile${turn.tiles === 1 ? '' : 's'}`
  if (turn.kind === 'pass') return `${name} passed`
  const words = turn.words.map((word) => shout(word.w)).join(', ')
  return `${name} played ${words || `${turn.tiles} tile${turn.tiles === 1 ? '' : 's'}`} for ${turn.points}`
}
/** The same turn said out loud for the live region. */
export function spokenTurn(turn: WeaveTurn, seats: Seats): string {
  const name = nameOf(seats, turn.seat)
  if (turn.kind !== 'play') return `${historyLine(turn, seats)}.`
  const [main, ...rest] = turn.words
  const extra = rest.length ? `, and ${rest.map((word) => `${shout(word.w).split('').join(' ')} for ${word.p}`).join(', ')}` : ''
  return `${name} played ${main ? shout(main.w) : `${turn.tiles} tiles`}, ${turn.points} point${turn.points === 1 ? '' : 's'} in all${extra}.`
}
/** Newest first, as the list shows them. */
export const historyLines = (view: Pick<WeaveView, 'history'>, seats: Seats): string[] => view.history.slice().reverse().map((turn) => historyLine(turn, seats))

export interface ResultRow { seat: number; name: string; score: number; winner: boolean; left: string[]; leftPoints: number }
export interface Results { text: string; rows: ResultRow[] }
/** How the game ended: the sentence, and who finished with what and which tiles they were left holding. Null while the game is on. */
export function results(view: Pick<WeaveView, 'over' | 'racks' | 'scores'>, seats: Seats): Results | null {
  const over = view.over
  if (!over) return null
  const text = over.text.replace(/\{(\d+)\}/g, (_, index: string) => nameOf(seats, Number(index)))
  const rows = seats.map((seat, index): ResultRow => {
    const left = (view.racks?.[index] ?? []).map((letter) => (letter === '?' ? 'blank' : letter.toUpperCase()))
    return {
      seat: index, name: seat.name, score: view.scores[index] ?? 0, winner: over.winners.includes(index), left,
      leftPoints: (view.racks?.[index] ?? []).reduce((sum, letter) => sum + (letter === '?' ? 0 : tileValue(letter)), 0),
    }
  })
  return { text, rows: rows.sort((a, b) => b.score - a.score || a.seat - b.seat) }
}

// ---- events -------------------------------------------------------------------------------------
export type WeaveEvent = 'play' | 'bingo' | 'exchange' | 'pass' | 'end'
export const eventFor = (turn: WeaveTurn): WeaveEvent => (turn.kind === 'play' ? (turn.tiles >= RACK_SIZE ? 'bingo' : 'play') : turn.kind)
/** The event a draw gives: none on the first draw of a game (`previousN` null) or when no move was made since; 'end' when the game just ended. */
export function nextEvent(previousN: number | null, n: number, view: Pick<WeaveView, 'history' | 'over'>, wasOver: boolean): WeaveEvent | null {
  if (previousN === null || n === previousN) return null
  if (view.over) return wasOver ? null : 'end'
  const last = view.history.at(-1)
  return last ? eventFor(last) : null
}
