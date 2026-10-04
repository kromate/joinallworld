/**
 * OWNER: growth
 * Where the game tables stand, and the registry of games. Plain data plus the rules objects.
 * A table belongs to a venue: you sit at it only while your Sim is in that venue; anyone in the
 * city may watch. Adding a table is one row here; adding a game is one rules file (./rules.js).
 */
import whot from './whot.js';

/** @type {Record<string, import('./rules.js').TableRules>} */
export const GAMES = Object.freeze({ whot });

/**
 * id      unique within a city;  venue  a venue id from src/game/content/venues.js
 * game    a key of GAMES;        label  what the table is called in that venue
 * seats   the most players this table takes (never more than the game's own maximum)
 */
export const TABLES = Object.freeze([
  { id: 'buka-corner', venue: 'amala-shitta', game: 'whot', label: 'Corner table', seats: 4 },
  { id: 'buka-door', venue: 'amala-shitta', game: 'whot', label: 'Table by the door', seats: 4 },
  { id: 'park-bench', venue: 'park', game: 'whot', label: 'Bench under the trees', seats: 4 },
  { id: 'rooftop-lounge', venue: 'rooftop', game: 'whot', label: 'Lounge table', seats: 4 },
  { id: 'viewing-whot', venue: 'viewing-centre', game: 'whot', label: 'Back-row table', seats: 4 },
].filter((table) => Object.hasOwn(GAMES, table.game)));

export const tableById = (id) => TABLES.find((table) => table.id === id) ?? null;
export const tablesAt = (venue) => TABLES.filter((table) => table.venue === venue);
/** House players that fill empty seats. They are always labelled as bots. */
export const BOT_NAMES = Object.freeze(['Mama Put', 'Oga Landlord', 'Sisi Eko']);
