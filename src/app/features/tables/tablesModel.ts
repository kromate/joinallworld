// The words and rules of the Tables app that need no browser: what a row of the list says, how the
// list is split into "where you are" and "elsewhere", the result sentence of a finished game, the
// turn clock's numbers, the choices of the rules select. Pure, so node --test reaches it.
import type { TableOptionValue, TableRating, TableResultMine, TableStateFrame, TableSummary, TableClaim } from './tablesBoundary.ts'
import { money } from '../../ui/format.ts'

/** The list is asked for again on open when it is older than this. */
export const LIST_STALE_MS = 20000

export const tableTitle = (table: Pick<TableSummary, 'gameLabel' | 'label'>): string => `${table.gameLabel} · ${table.label}`

/** Who is at the table, in a row of the list. */
export function rowWho(table: TableSummary): string {
  const humans = table.seats.filter((seat) => !seat.bot)
  if (table.status === 'playing') return `Game on · ${table.seats.map((seat) => seat.name).join(', ')}`
  return humans.length ? `${humans.map((seat) => seat.name).join(', ')} waiting for players` : 'Empty: sit down and start'
}
/** The quiet second line of a row: venue, who, how many watch. */
export const rowSub = (table: TableSummary): string => `${table.venueLabel} · ${rowWho(table)}${table.watching ? ` · ${table.watching} watching` : ''}`
export const openLabel = (table: Pick<TableSummary, 'status'>, mine: boolean): 'Watch' | 'Sit' | 'Look' => (table.status === 'playing' ? 'Watch' : mine ? 'Sit' : 'Look')

/** The tables where the player is (null where when travelling) and all the others, in the server's order. */
export function partition(list: readonly TableSummary[], at: string | null): { mine: TableSummary[]; other: TableSummary[] } {
  return { mine: list.filter((table) => table.venue === at), other: list.filter((table) => table.venue !== at) }
}
export const heroFigure = (count: number): string => (count ? `${count} table${count === 1 ? '' : 's'} where you are` : 'No table where you are')
export interface PaidTerms { win: number; paidLeft: number; perDay: number }
export const heroNote = (paid: PaidTerms | null | undefined): string => (paid ? `A win against a real player pays ${money(paid.win)} · ${paid.paidLeft} of ${paid.perDay} paid wins left today` : 'Play with whoever is here, or with a bot.')
export const ratingLine = (label: string, rating: TableRating): string => `Your ${label} rating: ${rating.rating}${rating.provisional ? ' (provisional)' : ''} · ${rating.won} won of ${rating.played} rated games.`

export const LIST_RULES: readonly string[] = [
  'Sit at a table in the place where your character is. Anyone can watch from anywhere.',
  'There are no stakes: nobody can lose money at a table. A win against a real player is paid by the game.',
  'Four paid wins a day. Games against the same player count three times a day; after that they are for fun.',
  'Bots fill empty seats when you ask. A game against bots pays nothing.',
  'If you leave before everyone has really played, the game is called off and nothing counts.',
]
export const NO_TABLE_HERE = { title: 'Go where the tables are', text: 'Whot is played at the buka, the park, the rooftop and the viewing centre; penalties at the viewing centre, the park and the beach.' }

/** The bot buttons of an open table: 1, 2 or 3 bots, as many as there are free seats. */
export const botCounts = (free: number): number[] => (free > 0 ? [1, 2, 3].filter((count) => count <= free) : [])
export const botLabel = (count: number): string => `+ ${count} bot${count === 1 ? '' : 's'}`
export const startNote = (table: Pick<TableSummary, 'min'> & { seats: readonly unknown[] }): string => (table.seats.length < table.min
  ? 'Nobody else here yet? Invite a friend, or play with a bot (a bot game pays nothing).'
  : 'Everyone seated plays. Add bots to fill the table if you like.')
export const hostNote = (host: boolean): string => (host ? 'You sat down first, so you choose.' : 'Whoever sat down first chooses.')
export const seatLabel = (seat: { name: string; away?: boolean }): string => `${seat.name}${seat.away ? ' · away' : ''}`

export type Result = NonNullable<TableStateFrame['result']>
export const outcomeTitle = (result: Pick<Result, 'calledOff'> & { mine: Pick<TableResultMine, 'won' | 'draw'> | null }): string => (result.calledOff ? 'Called off'
  : result.mine ? (result.mine.won ? 'You won' : result.mine.draw ? 'A draw' : 'You lost this one') : 'Game over')
/** The line under the result sentence: what the game paid, or why it did not. Null when there is none (called off, a watcher). */
export function outcomeNote(result: Pick<Result, 'calledOff'> & { mine: TableResultMine | null }, claimed: TableClaim | null, win: number): string | null {
  const mine = result.mine
  if (!mine || result.calledOff) return null
  const paid = mine.won && mine.human && mine.counted
    ? (claimed?.code === 'paid' ? `+${money(win)} paid.` : claimed ? 'Counted for your missions. Today’s paid wins are used up.' : 'Collecting your win…')
    : !mine.human ? 'A game against bots pays nothing.'
      : !mine.counted ? 'You two have played your three counted games today: this one was for fun.'
        : 'It counts for your missions.'
  return `${paid}${mine.change !== undefined ? ` Rating ${mine.rating} (${mine.change >= 0 ? '+' : ''}${mine.change}).` : ''}`
}

/** The table a panel was opened on (a link, the venue chip), or null. */
export function tableParam(params: unknown): string | null {
  if (typeof params !== 'object' || params === null || !('table' in params)) return null
  return typeof params.table === 'string' && params.table ? params.table : null
}
/** Back to the list: the seat is given up unless a game is on. Written as the existing panel decided it, a table that has not loaded yet included. */
export const leavesOnBack = (state: Pick<TableStateFrame, 'you' | 'table'> | null): boolean => state?.you !== null && state?.table.status !== 'playing'
/** Is the list old enough to ask for again? Only on the list screen. */
export const listIsStale = (onList: boolean, listAt: number, hasList: boolean, now: number): boolean => !onList ? false : hasList && now - listAt > LIST_STALE_MS

/** A select's value is the JSON of the option's value, so numbers and booleans survive the round trip. */
export const optionKey = (value: TableOptionValue): string => JSON.stringify(value)
export function parseOption(raw: string): TableOptionValue | undefined {
  try { const value: unknown = JSON.parse(raw); return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : undefined } catch { return undefined }
}

/** The turn clock bar: it starts where the turn's time really is, by the server's clock, and runs out with it. Null when no game is on. */
export function clockBar(state: Pick<TableStateFrame, 'clock' | 'n' | 'table'>, now: number): { seconds: number; from: string; key: string } | null {
  if (!state.clock || state.table.status === 'over') return null
  const left = Math.max(0, (state.clock.deadline - Math.max(now, state.clock.now)) / 1000)
  const seconds = Math.max(1, Math.round(left)), from = Math.min(1, left / state.clock.seconds).toFixed(2)
  return { seconds, from, key: `${state.n}|${seconds}|${from}` }
}

/** The name of a seat, or `fallback` when there is none (a turn that is null). */
export const nameAt = (seats: readonly { name: string }[], index: number | null, fallback = ''): string => (index === null ? fallback : seats[index]?.name ?? fallback)
export const plain = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`
