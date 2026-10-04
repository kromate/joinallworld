// Where the game tables stand: the typed boundary to src/tables/places.js, which is plain data.
// It is a file of its own so the HUD chip, which ships with the first download, knows only where
// tables stand and downloads no game code or socket client.
import { GAME_LABELS as GAME_LABELS_JS, TABLES as TABLES_JS, tableById as tableByIdJs, tablesAt as tablesAtJs } from '../../../tables/places.js'
import type { TableGameId } from '../../../types/growth.ts'

/** One table of the city: it belongs to a venue and takes `seats` players at most. */
export interface TablePlace { id: string; venue: string; game: TableGameId; label: string; seats: number }

export const GAME_LABELS = GAME_LABELS_JS as unknown as Readonly<Record<string, string>>
export const TABLES = TABLES_JS as unknown as readonly TablePlace[]
export const tableById = tableByIdJs as unknown as (id: string) => TablePlace | null
export const tablesAt = tablesAtJs as unknown as (venue: string) => TablePlace[]
