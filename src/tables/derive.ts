/**
 * OWNER: growth
 * Which venues host the board games, worked out from what a venue IS (its scene kind) rather than
 * listed city by city: every open city gets a chess table, and a word-tile table, wherever there is
 * somewhere to sit and play. A city's own listed tables (Whot, penalties) are never replaced, and a
 * table a city lists for the same game at a venue stops a derived one being added there.
 * Plain data and one pure function, so the HUD chip, the scenes and the server all agree.
 */
import type { CityTablePlace } from '../types/content.ts';

/** Scene kinds that have room for a table of each board game, and what the table is called there. */
export const BOARD_GAME_KINDS = Object.freeze({
  chess: Object.freeze({
    park: 'Chess under the trees', buka: 'Chess by the window', rooftop: 'Chess on the roof', viewing: 'Chess in the back row',
    beach: 'Chess in the shade', quad: 'Chess on the quad', lakeside: 'Chess by the water', unilag: 'Student Union chess',
  } as const),
  weave: Object.freeze({
    buka: 'Word tiles after the meal', rooftop: 'Word tiles on the roof', quad: 'Word tiles on the quad',
    lakeside: 'Word tiles by the water', unilag: 'Student Union word tiles',
  } as const),
} as const);

/** Scenes that are a landmark to climb or look at, and are already near the scene's triangle budget: no table is added there. */
const NO_TABLE_VARIANTS: readonly string[] = ['outcrop', 'tower'];

type Games = keyof typeof BOARD_GAME_KINDS;
const SEATS: Readonly<Record<Games, number>> = { chess: 2, weave: 4 };

/** A table id for a derived table: the venue and the game, so it never moves when venues are added. */
export const derivedId = (venueId: string, game: Games): string => `${venueId}-${game}`;

/** The city's tables: those it lists, then one chess and one word-tile table at every venue whose scene kind suits the game. */
export function withBoardGames(venues: readonly { id: string; kind: string; definition?: { scene?: { variant?: string } } }[], listed: readonly CityTablePlace[]): CityTablePlace[] {
  const out: CityTablePlace[] = [...listed];
  for (const game of Object.keys(BOARD_GAME_KINDS) as Games[]) {
    const kinds: Readonly<Record<string, string>> = BOARD_GAME_KINDS[game];
    for (const venue of venues) {
      const label = kinds[venue.kind];
      if (label === undefined || NO_TABLE_VARIANTS.includes(venue.definition?.scene?.variant ?? '') || listed.some((table) => table.venueId === venue.id && table.game === game)) continue;
      out.push({ id: derivedId(venue.id, game), venueId: venue.id, game, label, seats: SEATS[game] });
    }
  }
  return out;
}
