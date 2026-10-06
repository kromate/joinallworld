// The chess board's pure parts: squares and orientation, the legal moves of a square, promotion,
// the clocks, the move list, the captured pieces and the words and events a new move gives. The
// component only draws what these answer.
import type { ChessView } from './tablesBoundary.ts'

export type Colour = 'w' | 'b'
export type PlayedMove = ChessView['legal'][number]
export type Promo = NonNullable<PlayedMove['promo']>
export type ChessEvent = 'move' | 'capture' | 'check' | 'castle' | 'promote' | 'end'

export const FILES = 'abcdefgh'

/** Square name ('e4') of a board index (a8 = 0 … h1 = 63). */
export const squareName = (index: number): string => `${FILES[index & 7] ?? 'a'}${8 - (index >> 3)}`
/** Board index of a square name, or -1. */
export function squareIndex(name: string): number {
  const file = FILES.indexOf(name[0] ?? ''), rank = Number(name[1])
  return name.length === 2 && file >= 0 && rank >= 1 && rank <= 8 ? (8 - rank) * 8 + file : -1
}

/** The colour at the bottom: Black for a Black player, White for everyone else, turned over by Flip. */
export function orientation(you: Colour | null, flipped: boolean): Colour {
  const base: Colour = you === 'b' ? 'b' : 'w'
  return flipped ? (base === 'w' ? 'b' : 'w') : base
}
/** Board indexes in the order they are drawn, top left first. */
export function displayOrder(bottom: Colour): number[] {
  const up = Array.from({ length: 64 }, (_, index) => index)
  return bottom === 'w' ? up : up.reverse()
}
/** The square one step from `from` in the drawn grid (columns and rows, positive down and right), or null off the board. */
export function stepSquare(from: string, bottom: Colour, columns: number, rows: number): string | null {
  const order = displayOrder(bottom), at = order.indexOf(squareIndex(from))
  if (at < 0) return null
  const column = (at & 7) + columns, row = (at >> 3) + rows
  if (column < 0 || column > 7 || row < 0 || row > 7) return null
  return squareName(order[row * 8 + column] as number)
}
/** The square a keyboard starts on: the left pawn of the player at the bottom. */
export const homeSquare = (bottom: Colour): string => (bottom === 'w' ? 'e2' : 'e7')

export const pieceAt = (view: Pick<ChessView, 'board'>, square: string): string | null => view.board[squareIndex(square)] ?? null
export const isLight = (index: number): boolean => ((index >> 3) + (index & 7)) % 2 === 0

const KIND_NAME: Readonly<Record<string, string>> = { P: 'pawn', R: 'rook', N: 'knight', B: 'bishop', Q: 'queen', K: 'king' }
const KIND_PLURAL: Readonly<Record<string, string>> = { P: 'pawns', R: 'rooks', N: 'knights', B: 'bishops', Q: 'queens', K: 'kings' }
/** 'White pawn' for 'wP'. */
export const pieceLabel = (code: string): string => `${code[0] === 'w' ? 'White' : 'Black'} ${KIND_NAME[code[1] ?? ''] ?? 'piece'}`
/** 'White pawn on e2'. */
export const pieceOnLabel = (code: string, square: string): string => `${pieceLabel(code)} on ${square}`
const lower = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1)

export interface SquareState { selected: boolean; legal: boolean; last: boolean; check: boolean }
/** The words for one square: 'e4, white knight, selected'. */
export function squareLabel(square: string, code: string | null, state: SquareState): string {
  const parts = [square, code ? lower(pieceLabel(code)) : 'empty']
  if (state.selected) parts.push('selected')
  if (state.legal) parts.push('legal move')
  if (state.last) parts.push('last move')
  if (state.check) parts.push('check')
  return parts.join(', ')
}

// ---- the moves ----------------------------------------------------------------------------------

/** The legal moves that start on `square` (empty unless it is your turn: the server sends none otherwise). */
export const legalFrom = (view: Pick<ChessView, 'legal'>, square: string): PlayedMove[] => view.legal.filter((move) => move.from === square)
/** The squares a piece may go to, each once (a promotion lists four moves to the same square). */
export const destinationsFrom = (view: Pick<ChessView, 'legal'>, square: string): string[] => [...new Set(legalFrom(view, square).map((move) => move.to))]
/** Every legal move from one square to another: one, or four when a pawn promotes. */
export const movesBetween = (view: Pick<ChessView, 'legal'>, from: string, to: string): PlayedMove[] => view.legal.filter((move) => move.from === from && move.to === to)
/** True when the move from `from` to `to` needs the piece to be chosen. */
export const needsPromotion = (view: Pick<ChessView, 'legal'>, from: string, to: string): boolean => movesBetween(view, from, to).some((move) => move.promo !== undefined)
/** True when the move takes a piece (a pawn that changes file onto an empty square takes en passant). */
export function isCapture(view: Pick<ChessView, 'board'>, from: string, to: string): boolean {
  if (pieceAt(view, to)) return true
  return pieceAt(view, from)?.[1] === 'P' && from[0] !== to[0]
}
export const PROMOTIONS: readonly { promo: Promo; name: string; kind: string }[] = [
  { promo: 'q', name: 'Queen', kind: 'Q' }, { promo: 'r', name: 'Rook', kind: 'R' }, { promo: 'b', name: 'Bishop', kind: 'B' }, { promo: 'n', name: 'Knight', kind: 'N' },
]

/** True while a seated player may move: it is their turn and the game is on. */
export const canMove = (view: Pick<ChessView, 'you' | 'turn' | 'over'>): boolean => view.you !== null && view.turn === view.you && view.over === null

// ---- clocks -------------------------------------------------------------------------------------

/** m:ss, h:mm:ss, and tenths of a second under ten seconds (4.2). */
export function clockText(ms: number): string {
  const left = Math.max(0, ms)
  if (left < 10000) return (Math.floor(left / 100) / 10).toFixed(1)
  const total = Math.ceil(left / 1000), hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60
  const two = (n: number): string => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`
}
export interface TurnClock { deadline: number; now: number; seconds: number }
/** Milliseconds to the turn's deadline: the frame's server time carried forward by the local time since it arrived. */
export const turnLeft = (clock: TurnClock, localNow: number, receivedAt: number): number => Math.max(0, clock.deadline - (localNow + (clock.now - receivedAt)))
/** The time a colour has left: live for the side to move, as last sent for the other; null in an untimed game. */
export function remainingFor(colour: Colour, view: Pick<ChessView, 'clocks' | 'turn' | 'over'>, clock: TurnClock | null, localNow: number, receivedAt: number): number | null {
  if (!view.clocks) return null
  if (clock && view.over === null && view.turn === colour) return turnLeft(clock, localNow, receivedAt)
  return Math.max(0, view.clocks[colour])
}

// ---- the move list ------------------------------------------------------------------------------

export interface MovePair { number: number; white: string; black: string | null; whiteAt: number; blackAt: number | null }
/** The history as numbered pairs: 1. e4 e5. `whiteAt` and `blackAt` are the plies (0-based). */
export function pairMoves(history: readonly string[]): MovePair[] {
  const pairs: MovePair[] = []
  for (let ply = 0; ply < history.length; ply += 2) {
    const black = history[ply + 1]
    pairs.push({ number: ply / 2 + 1, white: history[ply] as string, black: black ?? null, whiteAt: ply, blackAt: black === undefined ? null : ply + 1 })
  }
  return pairs
}

// ---- captured pieces ----------------------------------------------------------------------------

const VALUE: Readonly<Record<string, number>> = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 }
const ORDER = 'QRBNP'
/** Captured pieces from the most to the least valuable. */
export const sortCaptured = (pieces: readonly string[]): string[] => [...pieces].sort((a, b) => ORDER.indexOf(a[1] ?? '') - ORDER.indexOf(b[1] ?? '') || a.localeCompare(b))
const worth = (pieces: readonly string[]): number => pieces.reduce((sum, piece) => sum + (VALUE[piece[1] ?? ''] ?? 0), 0)
/** Material ahead for a colour (negative when behind): what it has taken less what it has lost. */
export const materialLead = (view: Pick<ChessView, 'captured'>, colour: Colour): number => worth(view.captured[colour]) - worth(view.captured[colour === 'w' ? 'b' : 'w'])
/** 'pawn, 2 knights' for the captured list, for a screen reader. */
export function capturedWords(pieces: readonly string[]): string {
  if (pieces.length === 0) return 'nothing'
  const counts = new Map<string, number>()
  for (const piece of sortCaptured(pieces)) counts.set(piece[1] ?? '', (counts.get(piece[1] ?? '') ?? 0) + 1)
  return [...counts].map(([kind, count]) => (count === 1 ? KIND_NAME[kind] : `${count} ${KIND_PLURAL[kind]}`)).join(', ')
}

// ---- words and events ---------------------------------------------------------------------------

/** The two names at the board, by colour. */
export interface Sides { w: string; b: string }
export function sidesOf(view: Pick<ChessView, 'white'>, seats: readonly { name: string }[]): Sides {
  return { w: seats[view.white]?.name ?? 'White', b: seats[1 - view.white]?.name ?? 'Black' }
}

/** What the little banner on the board says once the game is over. */
export function overBanner(over: NonNullable<ChessView['over']>): string {
  switch (over.reason) {
    case 'checkmate': return 'Checkmate'
    case 'stalemate': return 'Stalemate'
    case 'repetition': return 'Draw by repetition'
    case 'fifty-move': return 'Draw by the fifty-move rule'
    case 'insufficient': return 'Draw, not enough pieces'
    case 'agreed': return 'Draw agreed'
    case 'resign': return 'Resigned'
    case 'time': return 'Out of time'
    case 'forfeit': return 'Opponent left'
    default: return over.draw ? 'Draw' : 'Game over'
  }
}

/** The line under the board: whose move it is, or how it ended. */
export function statusText(view: Pick<ChessView, 'you' | 'turn' | 'over' | 'check'>, sides: Sides): string {
  if (view.over) return overBanner(view.over)
  const turn = view.turn
  if (turn === null) return ''
  const check = view.check !== null
  if (view.you === null) return `${sides[turn]} to move${check ? ', check' : ''}`
  if (turn === view.you) return check ? 'Check. Your move' : 'Your move'
  return `Waiting for ${sides[turn]}${check ? ' (in check)' : ''}`
}

const SAN_WORD: Readonly<Record<string, string>> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight' }
const SAN_PATTERN = /^([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=([QRBN]))?([+#])?$/
/** A move in words, for a screen reader: 'Nxe5+' becomes 'knight takes e5, check'. */
export function sanWords(san: string): string {
  const mark = san.endsWith('#') ? ', checkmate' : san.endsWith('+') ? ', check' : ''
  const bare = san.replace(/[+#]$/, '')
  if (bare === 'O-O') return `castles kingside${mark}`
  if (bare === 'O-O-O') return `castles queenside${mark}`
  const match = SAN_PATTERN.exec(san)
  if (!match) return san
  const [, piece, file, rank, takes, target, promo] = match
  const who = piece ? (SAN_WORD[piece] ?? '') : 'pawn'
  const from = `${file ?? ''}${rank ?? ''}`
  const lead = from ? `${who} ${from}` : who
  const verb = takes ? `${lead} takes ${target}` : `${lead} to ${target}`
  return `${verb}${promo ? `, promotes to ${SAN_WORD[promo]}` : ''}${mark}`
}

/** The sound-worthy kind of a move, from its notation. */
export function eventFromSan(san: string, over: boolean): ChessEvent {
  if (over) return 'end'
  if (san.includes('=')) return 'promote'
  if (san.startsWith('O-O')) return 'castle'
  if (san.endsWith('+') || san.endsWith('#')) return 'check'
  if (san.includes('x')) return 'capture'
  return 'move'
}
export interface Seen { moves: number; over: boolean }
export const seenOf = (view: Pick<ChessView, 'history' | 'over'>): Seen => ({ moves: view.history.length, over: view.over !== null })
/**
 * The event a new draw brings, or null: a longer history is a new move, a game that has just ended
 * (by resigning, the clock …) is an end. `before` is null on the first draw, which never makes one.
 */
export function nextEvent(before: Seen | null, view: Pick<ChessView, 'history' | 'over'>): ChessEvent | null {
  if (!before) return null
  const over = view.over !== null
  if (view.history.length > before.moves) return eventFromSan(view.history[view.history.length - 1] as string, over)
  return over && !before.over ? 'end' : null
}
