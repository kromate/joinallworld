// Where the active city's game tables stand. The raw Lagos rows feed Lagos CityContent only.
// It is a file of its own so the HUD chip, which ships with the first download, knows only where
// tables stand and downloads no game code or socket client.
export { GAME_LABELS, tableById, tablesAt, tablesFor } from '../../../tables/city-places.ts'
export type { CityTablePlace as TablePlace } from '../../../tables/city-places.ts'
