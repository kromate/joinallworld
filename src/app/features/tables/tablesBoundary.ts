// The typed boundary to the JavaScript behind the Tables app: the socket client (src/tables/client.ts,
// whose state `T` is a plain object it mutates), the card and penalty vocabularies and the rules
// text of the two boards. Every cast for those modules is here; the screens import only this file.
// The frames and the table types are the protocol's own (src/types/growth.ts).
import {
  T as T_JS, again as againJs, begin as beginJs, closeTable as closeTableJs, leave as leaveJs, openTable as openTableJs, play as playJs,
  refreshList as refreshListJs, reconnect as reconnectJs, setOption as setOptionJs, sit as sitJs, start as startJs,
} from '../../../tables/client.ts'
import { penaltyRules as penaltyRulesJs } from '../../../tables/penalty-board.ts'
import { ZONES as ZONES_JS } from '../../../tables/penalty.ts'
import { whotRules as whotRulesJs } from '../../../tables/whot-board.ts'
import { chessRules as chessRulesJs, weaveRules as weaveRulesJs } from '../../../tables/howto.ts'
import { SHAPES as SHAPES_JS, SHAPE_NAMES as SHAPE_NAMES_JS, SPECIAL as SPECIAL_JS, cardName as cardNameJs } from '../../../tables/whot.ts'
import type { TableGameId, TableOptionValue, TableRating, TableStateFrame, TableSummary } from '../../../types/growth.ts'
import type { ChessMove, ChessView } from '../../../tables/chess.ts'
import type { WeaveMove, WeaveView } from '../../../tables/weave.ts'
import type { FetchJson } from '../../types/client.ts'
import type { ToastKind } from '../../types/panel.ts'

export type { TableGameId, TableOptionValue, TableRating, TableResultMine, TableSeat, TableStateFrame, TableSummary } from '../../../types/growth.ts'
export { GAME_LABELS, tableById, tablesAt, tablesFor } from './tablesPlaces.ts'
export type { TablePlace } from './tablesPlaces.ts'

/** The `api` the client is handed (the legacy panel contract, only what client.js calls). */
export interface TablesApi {
  /** The client changed `T`: draw again. */
  refresh(): void
  view(): { cityId: string; connected: boolean; onboarding?: { required?: boolean } | null }
  toast(text: string, kind?: ToastKind): void
  fetchJson: FetchJson
  command(type: 'missions.refresh'): Promise<unknown>
  state(): { message?: string }
}

/** The last finished game's earning, from POST /api/growth/tables/claim ('paid', 'counted', 'for_fun' or a veto code). */
export interface TableClaim { game: string; label: string; won: boolean; code: string }

export type SocketPhase = 'idle' | 'connecting' | 'open' | 'closed'

/** The browser's side of the tables: what src/tables/client.ts keeps in `T`. */
export interface TablesClientState {
  api: TablesApi | null
  socket: SocketPhase
  /** Table summaries of the whole city (null until the first answer). */
  list: TableSummary[] | null
  /** Client time the list was last answered. */
  listAt: number
  /** The table on screen and the last table-state the server sent for it. */
  tableId: string | null
  state: TableStateFrame | null
  error: string | null
  pending: boolean
  claimed: TableClaim | null
  ratings: Partial<Record<TableGameId, TableRating>> | null
}

/** The live state object. Mutated by the client, never by a screen: read it through useTables(). */
export const T = T_JS as unknown as TablesClientState
/** Called by the app: idempotent. Opens the socket when connected and not onboarding. */
export const start = startJs as unknown as (api: TablesApi) => void
export const reconnect = reconnectJs as unknown as () => void
export const refreshList = refreshListJs as unknown as () => void
export const openTable = openTableJs as unknown as (id: string) => void
export const closeTable = closeTableJs as unknown as () => void
export const sit = sitJs as unknown as () => void
export const leave = leaveJs as unknown as () => void
export const begin = beginJs as unknown as (bots?: number) => void
export const again = againJs as unknown as () => void
export const setOption = setOptionJs as unknown as (name: string, value: TableOptionValue) => void
export const play = playJs as unknown as (move: WhotMove | PenaltyMove | ChessMove | WeaveMove) => void

// ---- the two games ----------------------------------------------------------------------------

export type WhotShape = 'circle' | 'triangle' | 'cross' | 'square' | 'star'
export type WhotCardData = { s: WhotShape | 'whot'; n: number }
export type WhotMove = { t: 'play'; i: number; shape?: WhotShape } | { t: 'draw' }
/** What the server's Whot view holds for one seat (src/tables/whot.ts view). */
export type WhotView = {
  game: 'whot'
  top: WhotCardData
  call: WhotShape | null
  /** Cards left in the market. */
  market: number
  turn: number | null
  /** Cards owed by `turn`, and the number that makes them owed (2 or 5). */
  pick: number
  pickBy: 2 | 5 | null
  counts: number[]
  out: boolean[]
  said: boolean[]
  /** Your own cards (null for a watcher) and the indexes you may play now. */
  hand: WhotCardData[] | null
  playable: number[]
  /** Every hand once the game is over. */
  shown: WhotCardData[][] | null
}
export type PenaltyKick = { kicker: number; shot: number; dive: number; goal: boolean }
export type PenaltyMove = { z: number }
/** What the server's penalty view holds for one seat (src/tables/penalty.ts view). */
export type PenaltyView = {
  game: 'penalty'
  options: { kicks: number }
  kicker: number | null
  goals: number[]
  taken: number[]
  history: PenaltyKick[]
  /** Your own choice for the kick being chosen, or null. */
  mine: number | null
  sudden: boolean
}
export type { ChessMove, ChessView, WeaveMove, WeaveView }
export type ChessState = TableStateFrame & { view: ChessView }
export type WeaveState = TableStateFrame & { view: WeaveView }
export type WhotState = TableStateFrame & { view: WhotView }
export type PenaltyState = TableStateFrame & { view: PenaltyView }

const hasView = (state: TableStateFrame): boolean => state.view !== null && typeof state.view === 'object'
export const isWhotState = (state: TableStateFrame): state is WhotState => state.table.game === 'whot' && hasView(state)
export const isChessState = (state: TableStateFrame): state is ChessState => state.table.game === 'chess' && hasView(state)
export const isWeaveState = (state: TableStateFrame): state is WeaveState => state.table.game === 'weave' && hasView(state)
export const isPenaltyState = (state: TableStateFrame): state is PenaltyState => state.table.game === 'penalty' && hasView(state)

export const SHAPES = SHAPES_JS as unknown as readonly WhotShape[]
export const SHAPE_NAMES = SHAPE_NAMES_JS as unknown as Readonly<Record<WhotShape | 'whot', string>>
/** The special numbers: 1 Hold on, 2 Pick two … */
export const SPECIAL = SPECIAL_JS as unknown as Readonly<Record<number, string>>
export const cardName = cardNameJs as unknown as (card: WhotCardData) => string
export const ZONES = ZONES_JS as unknown as readonly string[]
export const whotRules = whotRulesJs as unknown as readonly string[]
export const penaltyRules = penaltyRulesJs as unknown as readonly string[]
export const chessRules = chessRulesJs
export const weaveRules = weaveRulesJs
