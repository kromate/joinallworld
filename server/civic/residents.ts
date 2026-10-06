// OWNER: civic — the residents registry behind Neighbours, the Rich List, the presence counters
// and the city-wide gem counter. Feature modules may not enumerate device sessions, so a player
// enters this registry the first time one of their signed-in civic requests is served, and every
// such request refreshes their entry from the server-held life. Nothing here is client-supplied.
// Portable and pure: functions take the city's civic data, a time, and (for presence) the
// foundation's online(publicId) check.
import { lagosTime } from '../../src/game/clock.ts';
import { DISTRICTS, UNKNOWN_DISTRICT, OWN_DISTRICT, NEIGHBOURS, RICH_LIST } from '../../src/game/content/civic.ts';

import type { LifeState } from '../../src/types/life.ts';
import { scanKeys } from '../keyed.ts';
import type { PlayerRef } from '../../src/types/protocol.ts';
import type { CityCounters, District as DistrictView, NeighbourHome, HuntCounters, RichRow } from '../../src/types/civic.ts';
import type { CivicCityRecord, CivicCollection, ResidentRecord } from '../types.ts';

const PRUNE_EVERY_MS = 3600000;
const count = (value: unknown): number => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0);
export interface ResidentDistrict { id: string; name?: string; label?: string }
const districtView = (district: ResidentDistrict): DistrictView => ({ id: district.id, label: district.label ?? district.name ?? district.id, count: 0, online: 0, homes: [] });

/**
 * The home a life lives in, read defensively (a slice may not exist yet): the district of its rented home, or 'own' while it
 * lives in its own house on its plot — then `property.house` is only the last home it rented, not where it lives.
 */
export function houseOf(life: LifeState, districts: readonly ResidentDistrict[] = DISTRICTS): string | null {
  if (life?.estate?.living === 'own') return OWN_DISTRICT.id;
  const id = life?.property?.house;
  return typeof id === 'string' && districts.some((district) => district.id === id) ? id : null;
}

/**
 * Record that `who` is a resident and refresh their entry from their settled life. Adds newly
 * found gems to the city counter and counts a visit on the first check-in of a Lagos day.
 * Residents not seen for a whole session lifetime are dropped (their session has expired).
 */
export function checkIn(city: CivicCityRecord, now: number, who: PlayerRef, life: LifeState, ttlMs: number, districts: readonly ResidentDistrict[] = DISTRICTS): ResidentRecord {
  const day = lagosTime(now).day;
  const resident = city.residents[who.id] ||= { name: who.name, house: null, since: now, lastSeen: 0, day: -1, cash: 0, week: 0, earned: 0, gems: 0, claims: 0 };
  if (resident.day !== day) { resident.day = day; city.visits = count(city.visits) + 1; }
  resident.name = who.name;
  resident.house = houseOf(life, districts);
  resident.lastSeen = now;
  resident.cash = count(life.cash);
  resident.week = count(life.civic?.week?.week);
  resident.earned = count(life.civic?.week?.earned);
  const gems = count(life.civic?.gems), claims = count(life.civic?.claims);
  const fresh = Math.max(0, gems - count(resident.gems));
  if (fresh) {
    city.hunt.found = count(city.hunt.found) + fresh;
    city.hunt.byDay[day] = count(city.hunt.byDay[day]) + fresh;
    for (const key of Object.keys(city.hunt.byDay)) if (Number(key) < day - 7) delete city.hunt.byDay[key];
  }
  city.hunt.claims = count(city.hunt.claims) + Math.max(0, claims - count(resident.claims));
  resident.gems = gems; resident.claims = claims;
  if (now - city.prunedAt >= PRUNE_EVERY_MS) {
    city.prunedAt = now;
    // The index says who last checked in before the cut-off; each is judged again by its own record.
    for (const { key: id } of scanKeys(city.residents, 'civicResident', { nBelow: now - ttlMs })) { const entry = city.residents[id]; if (entry && now - entry.lastSeen > ttlMs) delete city.residents[id]; }
  }
  return resident;
}

const current = (city: CivicCityRecord, now: number, ttlMs: number): [string, ResidentRecord][] => Object.entries(city.residents).filter(([, entry]) => now - entry.lastSeen <= ttlMs);

/**
 * Real counters. `players` = residents with an unexpired check-in; `online` = those of them with
 * an open connection right now (the foundation's presence check); `visits` = resident-days.
 */
export function counters(city: CivicCityRecord, now: number, ttlMs: number, online: (id: string) => boolean): CityCounters {
  // Counted from the index of last check-ins: no resident's record is read.
  const residents = scanKeys(city.residents, 'civicResident', { nAtLeast: now - ttlMs });
  return { players: residents.length, online: residents.filter((hit) => online(hit.key)).length, visits: count(city.visits) };
}

/** Gem counter for the HUD chip: all finds ever recorded in this city, and those recorded today. */
export function huntCounters(city: CivicCityRecord, now: number): Pick<HuntCounters, 'found' | 'today' | 'claims'> {
  return { found: count(city.hunt.found), today: count(city.hunt.byDay[lagosTime(now).day]), claims: count(city.hunt.claims) };
}

/**
 * Directory of homes grouped by district. Totals count every resident; the listed homes leave
 * out anyone who hid themselves, and are capped (online first, then most recently seen).
 *   { total, online, listed, districts: [{ id, label, count, online, homes: [{ id, name, online, you }] }] }
 */
export function neighboursView(city: CivicCityRecord, now: number, ttlMs: number, online: (id: string) => boolean, prefs: CivicCollection['prefs'] | undefined, viewerId: string | null = null,
  cityDistricts: readonly ResidentDistrict[] = DISTRICTS) {
  type Group = Omit<DistrictView, 'homes'> & { homes: (NeighbourHome & { lastSeen: number })[] };
  const groups = new Map<string, Group>([...cityDistricts.map(districtView), OWN_DISTRICT, UNKNOWN_DISTRICT].map((district) => [district.id, { id: district.id, label: district.label, count: 0, online: 0, homes: [] }]));
  let total = 0, onlineTotal = 0;
  for (const [id, entry] of current(city, now, ttlMs)) {
    const group = groups.get(entry.house ?? UNKNOWN_DISTRICT.id) ?? groups.get(UNKNOWN_DISTRICT.id);
    if (!group) continue;
    const here = online(id);
    total += 1; group.count += 1;
    if (here) { onlineTotal += 1; group.online += 1; }
    if (prefs?.[id]?.directory !== true || id === viewerId) group.homes.push({ id, name: entry.name, online: here, you: id === viewerId, lastSeen: entry.lastSeen });
  }
  let budget = NEIGHBOURS.total, listed = 0;
  const districts = [...groups.values()].filter((group) => group.count > 0 || (group.id !== UNKNOWN_DISTRICT.id && group.id !== OWN_DISTRICT.id)).map((group) => {
    const homes = group.homes.sort((a, b) => Number(b.you) - Number(a.you) || Number(b.online) - Number(a.online) || b.lastSeen - a.lastSeen || (a.id < b.id ? -1 : 1))
      .slice(0, Math.min(NEIGHBOURS.perDistrict, budget)).map(({ lastSeen, ...home }) => home);
    budget -= homes.length; listed += homes.length;
    return { ...group, homes };
  });
  return { total, online: onlineTotal, listed, districts };
}

/**
 * Top balances and top earners of the current Lagos week, from the last check-in of each
 * resident. Players who opted out are left out of both lists (and told so in `you`).
 *   { week, size, balances: [{ rank, id, name, amount, you }], earners: [...], you: { listed, cash, earned, balanceRank, earnerRank } | null }
 */
export function richListView(city: CivicCityRecord, now: number, ttlMs: number, prefs: CivicCollection['prefs'] | undefined, viewerId: string | null = null) {
  const week = lagosTime(now).week;
  const listed = current(city, now, ttlMs).filter(([id]) => prefs?.[id]?.richList !== true)
    .map(([id, entry]) => ({ id, name: entry.name, cash: count(entry.cash), earned: entry.week === week ? count(entry.earned) : 0 }));
  const board = (key: 'cash' | 'earned'): RichRow[] => listed.filter((entry) => entry[key] > 0).sort((a, b) => b[key] - a[key] || (a.id < b.id ? -1 : 1))
    .map((entry, index) => ({ rank: index + 1, id: entry.id, name: entry.name, amount: entry[key], you: entry.id === viewerId }));
  const balances = board('cash'), earners = board('earned');
  const mine = viewerId ? city.residents[viewerId] : null;
  return {
    week, size: RICH_LIST.size, balances: balances.slice(0, RICH_LIST.size), earners: earners.slice(0, RICH_LIST.size),
    you: mine ? { listed: prefs?.[viewerId ?? '']?.richList !== true, cash: count(mine.cash), earned: mine.week === week ? count(mine.earned) : 0,
      balanceRank: balances.find((entry) => entry.you)?.rank ?? null, earnerRank: earners.find((entry) => entry.you)?.rank ?? null } : null,
  };
}

// ---- paged reads (docs/LISTS.md) ---------------------------------------------------------------------------------------------------
// The first answers above are capped lists. These read further: a district's homes in name order, and the rich list below its top, each
// by a cursor of the last row held (a name and an id; an amount and an id), so a row that appears or changes meanwhile can neither repeat
// a row nor skip one. Each city's sorted rows are kept for INDEX_TTL_MS, so a page costs a binary search and the page, not a pass over
// every resident. `key` names the city: the rows do not depend on which copy of the city record a transaction saw.
export const INDEX_TTL_MS = 10000;
export const NEIGHBOURS_PAGE = { size: 40, max: 100 };
/** How far down the rich list a reader can go, and the rows of a page. */
export const RICH_PAGE = { size: 40, max: 100, depth: 500 };
interface HomeRow { id: string; name: string; lower: string }
interface BoardRow { id: string; name: string; amount: number }
const homeIndexes = new Map<string, { at: number; districts: Map<string, HomeRow[]> }>();
const boardIndexes = new Map<string, { at: number; week: number; boards: Record<'balances' | 'earners', BoardRow[]> }>();
const homeOrder = (a: HomeRow, b: HomeRow): number => (a.lower < b.lower ? -1 : a.lower > b.lower ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const cut = (cache: Map<string, unknown>): void => { while (cache.size > 24) cache.delete(cache.keys().next().value as string); };
const firstWhere = <T>(rows: readonly T[], after: (row: T) => boolean): number => { let low = 0, high = rows.length; while (low < high) { const mid = (low + high) >>> 1; if (after(rows[mid]!)) high = mid; else low = mid + 1; } return low; };

/** A page of one district's homes, by name. `after` is `<lower-cased name>:<id>` of the last row held (both URL-encoded). Null: the cursor is not one of ours. */
export function neighboursPage(key: string, city: CivicCityRecord, now: number, ttlMs: number, online: (id: string) => boolean, prefs: CivicCollection['prefs'] | undefined, viewerId: string | null,
  district: string, after: string | null, limit: number): { district: string; homes: NeighbourHome[]; next: string | null; count: number } | null {
  let held = homeIndexes.get(key);
  if (!held || now - held.at > INDEX_TTL_MS) {
    const districts = new Map<string, HomeRow[]>();
    for (const [id, entry] of current(city, now, ttlMs)) {
      const home = entry.house ?? UNKNOWN_DISTRICT.id, rows = districts.get(home) ?? [];
      rows.push({ id, name: entry.name, lower: entry.name.toLowerCase() }); districts.set(home, rows);
    }
    for (const rows of districts.values()) rows.sort(homeOrder);
    held = { at: now, districts }; homeIndexes.delete(key); homeIndexes.set(key, held); cut(homeIndexes);
  }
  const rows = held.districts.get(district) ?? [];
  let from = 0;
  if (after) {
    const parts = after.split(':');
    if (parts.length !== 2) return null;
    let lower: string, id: string;
    try { lower = decodeURIComponent(parts[0]!); id = decodeURIComponent(parts[1]!); } catch { return null; }
    from = firstWhere(rows, (row) => homeOrder(row, { id, name: '', lower }) > 0);
  }
  const homes: NeighbourHome[] = [];
  let i = from;
  for (; i < rows.length && homes.length < limit; i += 1) {
    const row = rows[i]!;
    if (prefs?.[row.id]?.directory === true && row.id !== viewerId) continue;
    homes.push({ id: row.id, name: row.name, online: online(row.id), you: row.id === viewerId });
  }
  const last = rows[i - 1];
  return { district, homes, next: last && i < rows.length ? `${encodeURIComponent(last.lower)}:${encodeURIComponent(last.id)}` : null, count: rows.length };
}

/** A page of the rich list below its top: `after` is `<amount>:<id>` of the last row held. Ranks are the rows' places on the whole list. Null: not one of our cursors. */
export function richListPage(key: string, city: CivicCityRecord, now: number, ttlMs: number, prefs: CivicCollection['prefs'] | undefined, viewerId: string | null,
  board: 'balances' | 'earners', after: string | null, limit: number): { board: string; rows: RichRow[]; next: string | null } | null {
  const week = lagosTime(now).week;
  let held = boardIndexes.get(key);
  if (!held || held.week !== week || now - held.at > INDEX_TTL_MS) {
    const listed = current(city, now, ttlMs).map(([id, entry]) => ({ id, name: entry.name, cash: count(entry.cash), earned: entry.week === week ? count(entry.earned) : 0 }));
    const make = (field: 'cash' | 'earned'): BoardRow[] => listed.filter((entry) => entry[field] > 0).map((entry) => ({ id: entry.id, name: entry.name, amount: entry[field] }))
      .sort((a, b) => b.amount - a.amount || (a.id < b.id ? -1 : 1)).slice(0, RICH_PAGE.depth);
    held = { at: now, week, boards: { balances: make('cash'), earners: make('earned') } }; boardIndexes.delete(key); boardIndexes.set(key, held); cut(boardIndexes);
  }
  const rows = held.boards[board];
  let from = 0;
  if (after) {
    const [amountText, id, extra] = after.split(':'), amount = Number(amountText);
    if (extra !== undefined || id === undefined || !Number.isFinite(amount)) return null;
    from = firstWhere(rows, (row) => row.amount < amount || (row.amount === amount && row.id > id));
  }
  const out: RichRow[] = [];
  for (let i = from; i < rows.length && out.length < limit; i += 1) {
    const row = rows[i]!;
    // A player who opted out of the list is left out, as in the top of it (the rank is the place on the list the reader sees).
    if (prefs?.[row.id]?.richList === true) continue;
    out.push({ rank: i + 1, id: row.id, name: row.name, amount: row.amount, you: row.id === viewerId });
  }
  const last = out.at(-1), lastIndex = last ? last.rank : from;
  return { board, rows: out, next: last && lastIndex < rows.length ? `${last.amount}:${last.id}` : null };
}
