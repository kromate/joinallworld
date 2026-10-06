/**
 * SHORT ADDRESSES: the one table of web addresses that open a place or a game (`/games`, `/games/chess`, `/abuja`,
 * `/kano/games`, `/messages`, …). The browser (src/app/features/paths) and both hosts (server/path-meta.ts, for the link
 * preview and the sitemap) read this file and nothing else, so an address means the same everywhere.
 *
 * Everything about a place comes from the city registry: every known city id answers as `/<id>`, every state as
 * `/<state>` (a state with exactly one open city is that city), so a city added to the registry has its address with no
 * change here. The fixed words below win over a city: the path-table test asserts that no city id, state id or alias is one of
 * them, so a future city called "games" fails the test instead of breaking the address.
 */
import { cityCatalogue, cityCatalogueEntry, cityRules, knownCityIds } from './game/cities/registry.ts'

export const GAME_SLUGS = ['chess', 'oro', 'weave', 'whot', 'penalties'] as const
export type GameSlug = typeof GAME_SLUGS[number]
/** The Phone table a board game opens (a private game against the computer). Oro is the daily puzzle, not a table. */
export const PHONE_TABLE: Readonly<Record<Exclude<GameSlug, 'oro'>, string>> = Object.freeze({ chess: 'phone-chess', weave: 'phone-weave', whot: 'phone-whot', penalties: 'phone-penalty' });

export const PANEL_WORDS = ['messages', 'friends', 'invite', 'business', 'jobs', 'help', 'sound', 'signup', 'login'] as const
export type PanelWord = typeof PANEL_WORDS[number]

/** What an address asks for. */
export type PathIntent =
  | { kind: 'games'; game: GameSlug | null }
  | { kind: 'city'; city: string; page: 'games' | null; venue: string | null }
  | { kind: 'state'; state: string }
  | { kind: 'atlas'; level: 'nigeria' | 'world' }
  | { kind: 'panel'; panel: PanelWord }

/** First segments that belong to something else: the API, the build, the share and invite links, the mail pages, the operator pages, the socket and the image folders. Never a place. */
export const RESERVED_PREFIXES: readonly string[] = Object.freeze(['api', 'assets', 's', 'j', 'v', 'e', 'admin', 'socket', 'og', 'icons']);

const games = (game: GameSlug | null): PathIntent => ({ kind: 'games', game });
/** The words that always mean what they say, whatever the registry holds. */
const FIXED: Readonly<Record<string, PathIntent>> = Object.freeze({
  games: games(null), play: games(null), chess: games('chess'), word: games('oro'),
  nigeria: { kind: 'atlas', level: 'nigeria' }, world: { kind: 'atlas', level: 'world' }, map: { kind: 'atlas', level: 'world' },
  ...Object.fromEntries(PANEL_WORDS.map((panel): [string, PathIntent] => [panel, { kind: 'panel', panel }])),
});
/** Every word a path may start with that is not a place. */
export const FIXED_WORDS: readonly string[] = Object.freeze(Object.keys(FIXED));

/** Other ways to write a city's name. A target that is not in the registry is ignored. */
export const CITY_ALIASES: Readonly<Record<string, string>> = Object.freeze({ ph: 'port-harcourt', portharcourt: 'port-harcourt', ijebuode: 'ijebu-ode', ijebu: 'ijebu-ode' });

const SLUG = /^[a-z0-9-]{1,40}$/;
const isGameSlug = (value: string): value is GameSlug => (GAME_SLUGS as readonly string[]).includes(value);
const realCity = (id: string): boolean => !id.startsWith('test-') && cityCatalogueEntry(id) !== null;

/** Every state the registry has a city in (open or not). */
export function knownStateIds(): string[] {
  return [...new Set(knownCityIds().filter(realCity).flatMap((id) => cityCatalogueEntry(id)?.state.id ?? []))];
}
/** The open cities of a state, in registry order. */
export const openCitiesOf = (state: string): string[] => cityCatalogue().filter((city) => city.state.id === state && city.open && !city.id.startsWith('test-')).map((city) => city.id);
/** Every open city, in registry order. */
export const openCityIds = (): string[] => knownCityIds().filter((id) => realCity(id) && cityCatalogueEntry(id)?.open === true);

/** What an address, a link preview or the landing says about a place. The catalogue holds it before any city's rules are loaded; a loaded city adds its own line. */
export interface PlaceFacts { id: string; name: string; state: { id: string; name: string }; open: boolean; lat: number; lon: number; teaser: string }
export function placeFacts(id: string): PlaceFacts | null {
  const entry = realCity(id) ? cityCatalogueEntry(id) : null;
  if (!entry) return null;
  return { id: entry.id, name: entry.name, state: { id: entry.state.id, name: entry.state.name }, open: entry.open, lat: entry.lat, lon: entry.lon, teaser: cityRules(id)?.atlas.teaser ?? entry.teaser ?? `${entry.name}, in ${entry.state.name}: a city to live in.` };
}

const cityIntent = (city: string): PathIntent => ({ kind: 'city', city, page: null, venue: null });

/**
 * The words that would mean two things: a city id, state id or alias that is also a fixed word or a reserved prefix, an alias that is
 * also a city id, and an alias whose city the registry does not have. The path-table test asserts that this is empty, so a city
 * called "games" fails the test instead of breaking the address.
 */
export function pathCollisions(cityIds: readonly string[] = knownCityIds().filter(realCity), stateIds: readonly string[] = knownStateIds()): string[] {
  const taken = new Set([...FIXED_WORDS, ...RESERVED_PREFIXES]);
  const found = [...cityIds, ...stateIds, ...Object.keys(CITY_ALIASES)].filter((word) => taken.has(word));
  for (const [alias, city] of Object.entries(CITY_ALIASES)) if (cityIds.includes(alias) || !cityIds.includes(city)) found.push(alias);
  return [...new Set(found)];
}

/** A word that names a place: a city, an alias of one, or a state. Null when it names none. */
function placeOf(word: string): PathIntent | null {
  const id = Object.hasOwn(CITY_ALIASES, word) ? CITY_ALIASES[word] ?? word : word;
  if (realCity(id)) {
    const facts = placeFacts(id);
    // A city that is not open yet has no map to open: its state's page says it is coming.
    return facts?.open ? cityIntent(id) : facts ? { kind: 'state', state: facts.state.id } : null;
  }
  if (!knownStateIds().includes(word)) return null;
  const open = openCitiesOf(word);
  return open.length === 1 && open[0] ? cityIntent(open[0]) : { kind: 'state', state: word };
}

/** The segments of an address that is ours to read, lower case; null for `/`, a file, anything odd, or a reserved prefix. */
function segments(pathname: string): string[] | null {
  const parts = pathname.toLowerCase().split('/').filter((part, index, all) => part !== '' || (index !== 0 && index !== all.length - 1));
  if (parts.length === 0 || parts.some((part) => !SLUG.test(part))) return null;
  return RESERVED_PREFIXES.includes(parts[0] ?? '') ? null : parts;
}

/** Whether an address is another feature's (the API, the build files, a link of the invite or share kinds, any file): never treated as a place, never rewritten. */
export function isReservedPath(pathname: string): boolean {
  const parts = pathname.split('/').filter(Boolean);
  const first = (parts[0] ?? '').toLowerCase();
  return RESERVED_PREFIXES.includes(first) || /\.[a-z0-9]+$/i.test(parts.at(-1) ?? '');
}

/** What an address asks for, or null (the home page, an unknown word, a reserved prefix, a file). Query and fragment are not part of the path. */
export function parsePath(pathname: string): PathIntent | null {
  const parts = segments(pathname.split(/[?#]/, 1)[0] ?? '');
  const first = parts?.[0], second = parts?.[1];
  if (!first) return null;
  const fixed = Object.hasOwn(FIXED, first) ? FIXED[first] : undefined;
  if (fixed) return first === 'games' && second && isGameSlug(second) ? games(second) : fixed;
  const place = placeOf(first);
  if (place?.kind !== 'city' || !second) return place;
  return second === 'games' ? { ...place, page: 'games' } : { ...place, venue: second };
}

/** The address an intent is shown and shared under. */
export function pathOf(intent: PathIntent): string {
  switch (intent.kind) {
    case 'games': return intent.game ? `/games/${intent.game}` : '/games';
    case 'city': return `/${intent.city}${intent.page ? `/${intent.page}` : intent.venue ? `/${intent.venue}` : ''}`;
    case 'state': return `/${intent.state}`;
    case 'atlas': return `/${intent.level}`;
    case 'panel': return `/${intent.panel}`;
  }
}

/** A city's address as one string (what "Share Abuja" copies, after the origin). */
export const cityPath = (city: string): string => `/${city}`;

// ---- where on earth: the nearest open city, worked out from the registry's own coordinates ------------------

export interface NearCity { id: string; name: string; km: number }
const RAD = Math.PI / 180;
/** Great-circle distance in kilometres. */
export function kmBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a = Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}
/**
 * The cities whose atlas markers are nearest a position, nearest first: the open ones, or with `open: false` the ones that are not
 * open yet. Pure: nothing is stored or sent.
 */
export function nearestCities(lat: number, lon: number, count: number, { open = true }: { open?: boolean } = {}): NearCity[] {
  const found: NearCity[] = [];
  for (const id of knownCityIds()) {
    const facts = placeFacts(id);
    if (!facts || facts.open !== open) continue;
    found.push({ id: facts.id, name: facts.name, km: kmBetween(lat, lon, facts.lat, facts.lon) });
  }
  return found.sort((a, b) => a.km - b.km).slice(0, count);
}
/** The nearest open city (or, with `open: false`, the nearest one that is not open yet), or null. */
export const nearestCity = (lat: number, lon: number, options: { open?: boolean } = {}): NearCity | null => nearestCities(lat, lon, 1, options)[0] ?? null;
