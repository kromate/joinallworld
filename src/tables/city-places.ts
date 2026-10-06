import { contentFor } from '../game/cities/runtime.ts'
import { GAME_LABELS as RAW_GAME_LABELS } from './places.ts'
import { withBoardGames } from './derive.ts'
import type { TableGameId } from '../types/growth.ts'

export interface CityTablePlace { id: string; venue: string; game: TableGameId; label: string; seats: number }
export const GAME_LABELS: Readonly<Record<string, string>> = RAW_GAME_LABELS
const isGame = (game: string): game is TableGameId => game === 'whot' || game === 'penalty' || game === 'chess' || game === 'weave'

export function tablesFor(cityId: string): CityTablePlace[] {
  const content = contentFor(cityId)
  return withBoardGames(content.venues, content.tablePlaces).flatMap((table) => isGame(table.game)
    ? [{ id: table.id, venue: table.venueId, game: table.game, label: table.label, seats: table.seats }]
    : [])
}
export const tableById = (cityId: string, id: string): CityTablePlace | null => tablesFor(cityId).find((table) => table.id === id) ?? null
export const tablesAt = (cityId: string, venue: string): CityTablePlace[] => tablesFor(cityId).filter((table) => table.venue === venue)
