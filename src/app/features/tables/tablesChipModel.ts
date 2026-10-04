// The words of the "table here" chip, in a file of its own so the first download carries nothing else.
import { GAME_LABELS } from './tablesPlaces.ts'

/** The games played at the tables of a venue, once each: "Whot, Penalties". */
export const chipGames = (here: readonly { game: string }[]): string => [...new Set(here.map((table) => GAME_LABELS[table.game] ?? table.game))].join(', ')
