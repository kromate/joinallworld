/**
 * OWNER: growth
 * Where the game tables stand. Plain data only (the rules are in ./games.ts, so a screen that
 * only needs to know "is there a table here?" does not download any game).
 * A table belongs to a venue: you sit at it only while your Sim is in that venue; anyone in the
 * city may watch. Adding a table is one row here; adding a game is one rules file (./rules.ts)
 * and one line in ./games.ts.
 */
import type { TableGameId } from '../types/growth.ts';

export const GAME_LABELS = Object.freeze({ whot: 'Whot', penalty: 'Penalties' });

/** One table: a row of TABLES. */
export interface TableDef { id: string; venue: string; game: TableGameId; label: string; seats: number }

/**
 * id      unique within a city;  venue  a venue id from src/game/content/venues.ts
 * game    a key of GAMES;        label  what the table is called in that venue
 * seats   the most players this table takes (never more than the game's own maximum)
 */
export const TABLES = Object.freeze(([
  { id: 'buka-corner', venue: 'amala-shitta', game: 'whot', label: 'Corner table', seats: 4 },
  { id: 'buka-door', venue: 'amala-shitta', game: 'whot', label: 'Table by the door', seats: 4 },
  { id: 'park-bench', venue: 'park', game: 'whot', label: 'Bench under the trees', seats: 4 },
  { id: 'rooftop-lounge', venue: 'rooftop', game: 'whot', label: 'Lounge table', seats: 4 },
  { id: 'viewing-whot', venue: 'viewing-centre', game: 'whot', label: 'Back-row table', seats: 4 },
  { id: 'viewing-goal', venue: 'viewing-centre', game: 'penalty', label: 'Five-a-side goal', seats: 2 },
  { id: 'beach-goal', venue: 'beach', game: 'penalty', label: 'Goalposts in the sand', seats: 2 },
  { id: 'park-goal', venue: 'park', game: 'penalty', label: 'Kickabout corner', seats: 2 },
  // The Student Union at the UNILAG campus (src/campus/unilag): the campus has its own scene host, so these two are
  // opened from the Tables app and the "table here" chip rather than walked up to.
  { id: 'union-whot-1', venue: 'unilag', game: 'whot', label: 'Student Union table 1', seats: 4 },
  { id: 'union-whot-2', venue: 'unilag', game: 'whot', label: 'Student Union table 2', seats: 4 },
] as const) satisfies readonly TableDef[]);

export const tableById = (id: string) => TABLES.find((table) => table.id === id) ?? null;
export const tablesAt = (venue: string) => TABLES.filter((table) => table.venue === venue);
/** House players that fill empty seats. They are always labelled as bots. */
export const BOT_NAMES = Object.freeze(['Mama Put', 'Oga Landlord', 'Sisi Eko']);
