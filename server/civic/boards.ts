// OWNER: civic — the place boards: cities, states and countries ranked against each other, by aggregates only.
// Each city keeps a small weekly tally (`city.pride`) that a resident's check-in updates by the difference from what that
// resident last added, so a board never reads a resident: it reads one tally per city, once every few seconds, then
// serves pages from the sorted result. Portable and pure: functions take the civic collection and a time.
import { lagosTime } from '../../src/game/clock.ts';
import { cityCatalogueEntry } from '../../src/game/cities/registry.ts';
import type { BoardMeasure, BoardRow, BoardScope, BoardYou, BoardsResponse } from '../../src/types/civic.ts';
import type { CivicCityRecord, CivicCollection, PrideWeek, ResidentRecord } from '../types.ts';

/** A place shows numbers and is ranked only when this many residents live there and this many opened the game this week. */
export const BOARD_MIN = 5;
export const BOARD_PAGE = { size: 25, max: 100 };
/** How long a built board is reused. */
export const BOARD_TTL_MS = 10000;
export const BOARD_SCOPES: readonly BoardScope[] = ['city', 'state', 'country'];
export const BOARD_MEASURES: readonly BoardMeasure[] = ['pride', 'earned', 'active', 'residents'];

const count = (value: unknown): number => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0);

/**
 * Add a resident's week to their city's tally, right after their check-in has refreshed the record. The tally holds this
 * Lagos week and, once a new week begins, the week before it. A resident adds themselves once per week as active and
 * thereafter only the change in what they earned, so a repeated check-in changes nothing and a resident that was never
 * added (a record from before the tally) is added in full the first time.
 */
export function addToTally(city: CivicCityRecord, resident: ResidentRecord, now: number): void {
  const week = lagosTime(now).week;
  let tally = city.pride;
  if (!tally || !Number.isSafeInteger(tally.week)) tally = city.pride = { week, active: 0, earned: 0 };
  if (tally.week > week) return;
  if (tally.week < week) {
    const before = tally;
    tally = city.pride = { week, active: 0, earned: 0, ...(before.week === week - 1 ? { prev: { week: before.week, active: count(before.active), earned: count(before.earned), residents: Object.keys(city.residents).length } } : {}) };
  }
  const added = resident.tw === week ? count(resident.te) : 0, mine = resident.week === week ? count(resident.earned) : 0;
  if (resident.tw !== week) tally.active = count(tally.active) + 1;
  tally.earned = Math.max(0, count(tally.earned) + mine - added);
  resident.tw = week; resident.te = mine;
}

interface Totals { residents: number; active: number; earned: number }
interface Place extends Totals { id: string; name: string; within: string | null }
interface Ranked extends Place { pride: number }
interface Built {
  week: number
  at: number
  /** Every place that enough players live in, best first, per scope and measure. */
  ranked: Record<BoardScope, Record<BoardMeasure, Ranked[]>>
  unranked: Record<BoardScope, number>
  /** The ranking by pride of the week before. */
  last: Record<BoardScope, Ranked[]>
  /** City id → the state and country it is counted in. */
  homes: Map<string, { state: { id: string; name: string } | null; country: { id: string; name: string } }>
}

const pride = (totals: Totals): number => (totals.residents > 0 ? Math.round(totals.earned / totals.residents) : 0);
const enough = (totals: Totals): boolean => totals.residents >= BOARD_MIN && totals.active >= BOARD_MIN;
/** The order of a board: more first; equal places by id, so the same data always gives the same ranks. */
const order = (measure: BoardMeasure) => (a: Ranked, b: Ranked): number => b[measure] - a[measure] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** Foreign catalogue entries have a placeholder "starter" district for a state: they are in no state ranking. */
const stateOf = (state: { id: string; name: string }): { id: string; name: string } | null => (state.id.endsWith('-starter') ? null : state);

function build(civic: CivicCollection, now: number): Built {
  const week = lagosTime(now).week;
  const homes: Built['homes'] = new Map();
  const here = { city: new Map<string, Place>(), state: new Map<string, Place>(), country: new Map<string, Place>() };
  const before = { city: new Map<string, Place>(), state: new Map<string, Place>(), country: new Map<string, Place>() };
  const add = (into: Map<string, Place>, id: string, name: string, within: string | null, totals: Totals): void => {
    const place = into.get(id) ?? { id, name, within, residents: 0, active: 0, earned: 0 };
    place.residents += totals.residents; place.active += totals.active; place.earned += totals.earned; into.set(id, place);
  };
  for (const [cityId, record] of Object.entries(civic.cities)) {
    const entry = cityCatalogueEntry(cityId);
    if (!entry || !record || typeof record.residents !== 'object' || record.residents === null) continue;
    const state = stateOf(entry.state), country = { id: entry.countryISO ?? 'ng', name: entry.countryName ?? 'Nigeria' };
    homes.set(cityId, { state, country });
    const tally = record.pride, residents = Object.keys(record.residents).length;
    const current: PrideWeek | null = tally?.week === week ? tally : null;
    // The week before is the tally itself while no one has checked in since the week turned, else the copy taken then.
    const past = tally?.week === week - 1 ? { ...tally, residents } : tally?.prev?.week === week - 1 ? tally.prev : null;
    const thisWeek: Totals = { residents, active: count(current?.active), earned: count(current?.earned) };
    const lastWeek: Totals = { residents: count(past?.residents), active: count(past?.active), earned: count(past?.earned) };
    for (const [into, totals] of [[here, thisWeek], [before, lastWeek]] as const) {
      add(into.city, cityId, entry.name, state?.name ?? country.name, totals);
      if (state) add(into.state, state.id, state.name, country.name, totals);
      add(into.country, country.id, country.name, null, totals);
    }
  }
  const rank = (places: Map<string, Place>, measure: BoardMeasure): Ranked[] => [...places.values()].filter(enough).map((place) => ({ ...place, pride: pride(place) })).sort(order(measure));
  const ranked = {} as Built['ranked'], last = {} as Built['last'], unranked = {} as Built['unranked'];
  for (const scope of BOARD_SCOPES) {
    ranked[scope] = { pride: rank(here[scope], 'pride'), earned: rank(here[scope], 'earned'), active: rank(here[scope], 'active'), residents: rank(here[scope], 'residents') };
    last[scope] = rank(before[scope], 'pride');
    unranked[scope] = here[scope].size - ranked[scope].pride.length;
  }
  return { week, at: now, ranked, unranked, last, homes };
}

/** Builds the boards at most once per `BOARD_TTL_MS` (and once per Lagos week); `builds` counts the passes over the cities. */
export function createBoards(ttlMs = BOARD_TTL_MS) {
  let held: Built | null = null;
  const stats = { builds: 0 };
  return {
    stats,
    get(civic: CivicCollection, now: number): Built {
      if (!held || held.week !== lagosTime(now).week || now < held.at || now - held.at > ttlMs) { stats.builds += 1; held = build(civic, now); }
      return held;
    },
  };
}
export type Boards = ReturnType<typeof createBoards>;
export type BuiltBoards = Built;

/** The place `cityId` is counted in for a scope, or null (a city outside the catalogue, a country-less state). */
function placeOf(built: Built, scope: BoardScope, cityId: string | null): { id: string; name: string } | null {
  const home = cityId ? built.homes.get(cityId) : undefined;
  if (!home) return null;
  if (scope === 'country') return home.country;
  if (scope === 'state') return home.state;
  const entry = cityCatalogueEntry(cityId);
  return entry ? { id: entry.id, name: entry.name } : null;
}

/** One page of a board, the viewer's place, and last week's winner. `after` is the rank of the last row held. Null: not one of our cursors. */
export function boardView(built: Built, scope: BoardScope, by: BoardMeasure, viewerCity: string | null, after: string | null, limit: number): BoardsResponse | null {
  let from = 0;
  if (after !== null) {
    if (!/^\d{1,6}$/.test(after)) return null;
    from = Number(after);
  }
  const list = built.ranked[scope][by], mine = placeOf(built, scope, viewerCity);
  const rows: BoardRow[] = list.slice(from, from + limit).map((place, index) => ({ rank: from + index + 1, id: place.id, name: place.name, within: place.within,
    residents: place.residents, active: place.active, earned: place.earned, pride: place.pride, you: place.id === mine?.id }));
  const index = mine ? list.findIndex((place) => place.id === mine.id) : -1, above = index > 0 ? list[index - 1] : undefined, own = index >= 0 ? list[index] : undefined;
  const you: BoardYou | null = mine ? { id: mine.id, name: mine.name, rank: index >= 0 ? index + 1 : null,
    behind: above && own ? { id: above.id, name: above.name, amount: above[by] - own[by] } : null } : null;
  const winner = built.last[scope][0];
  return { scope, by, week: built.week, min: BOARD_MIN, rows, next: from + rows.length < list.length && rows.length ? String(from + rows.length) : null,
    total: list.length, unranked: built.unranked[scope], you, lastWeek: { week: built.week - 1, winner: winner ? { id: winner.id, name: winner.name } : null } };
}
