/**
 * OWNER: world
 * What the maps know about houses and residents, fetched for the part of the city in view and
 * nothing more (server/routes/world.ts). One instance is shared by the 3D and the 2D map.
 *
 *   createWorldData({ fetchJson, cityId, onChange })
 *     summary()                 → Map<lgaId, { residents, houses, online, occ: Uint8Array(512) }> | null
 *     loadCity(force?)          the city summary; sent with its version stamp, so an unchanged city costs a few bytes
 *     estate(lga, estate)       → { houses: Map<plot, { p, s, u, id?, name?, online?, you? }>, at } | null (asks for it if missing or stale)
 *     want(list)                ask for several estates at once: [{ lga, estate }]
 *     drop()                    forget everything (the city changed)
 * No timers: every request is the result of the map opening, moving or being told something
 * changed. MEMORY IS BOUNDED: at most ESTATES_KEPT estates are kept, the least recently used go first.
 */

/** What the maps know about one local government: counters from the city summary; `occ[estate]` is the number of houses in that estate. */
export interface CitySummary { residents: number; houses: number; online: number; occ: Uint8Array }
/** One house of an estate, as /api/world/lga/:lga/estate/:estate/houses answers it: `p` plot, `s` packed style, `u` upgrade ready at (server time). */
export interface WorldHouse { p: number; s: number; u: number; id?: string; name?: string; online?: boolean; you?: boolean }
/** The houses of one estate that were fetched, and when. */
export interface WorldEstate { houses: Map<number, WorldHouse>; at: number }
/** What the map was told changed: the city summary, or one estate. */
export type WorldChange = 'city' | 'estate';
export type FetchJson = (path: string) => Promise<unknown>;
export interface WorldDataOptions {
  fetchJson?: FetchJson | null
  cityId?: string
  onChange?: (kind: WorldChange, detail?: { lga: string; estate: number }) => void
  now?: () => number
}
export interface WorldData {
  summary: () => Map<string, CitySummary> | null
  error: () => string
  loadCity: (force?: boolean) => Promise<void>
  estate: (lga: string, number: number) => WorldEstate | null
  want: (list: readonly { lga: string; estate: number }[]) => void
  stale: () => void
  drop: (next?: string) => void
  size: () => number
}

/** The shape of the /api/world/* answers, as the server sends them. The answer is not validated (the code below reads it as it always has), so it enters as `unknown` and is typed once, here. */
interface CityWire { v: string; unchanged?: boolean; online?: Record<string, number>; lgas?: { id: string; residents: number; houses: number; online: number; occ: string }[] }
interface HousesWire { v: number; page?: number; pages?: number; houses: WorldHouse[] }
/** What a failed request may carry: the server's `reason`, or an Error's `message`. */
type Failure = { reason?: string; message?: string } | null | undefined;
interface EstateEntry { houses: Map<number, WorldHouse> | null; at: number; loading: boolean; used: number }

export const ESTATES_KEPT = 24;
const CITY_AGE = 20000, ESTATE_AGE = 20000;

export function createWorldData({ fetchJson, cityId = 'lagos', onChange = () => {}, now = () => Date.now() }: WorldDataOptions): WorldData {
  let city = cityId, summary: Map<string, CitySummary> | null = null, version = '', cityAt = 0, cityLoading = false, failed = '';
  const estates = new Map<string, EstateEntry>(); // `${lga}/${estate}` → { houses, at, loading, used }
  let tick = 0;
  const decode = (text: string) => { const raw = atob(text), bytes = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i); return bytes; };

  async function loadCity(force = false): Promise<void> {
    if (!fetchJson || cityLoading || (!force && summary && now() - cityAt < CITY_AGE)) return;
    cityLoading = true;
    try {
      const body = await fetchJson(`/api/world/city?city=${city}${version ? `&v=${encodeURIComponent(version)}` : ''}`) as CityWire;
      cityAt = now(); failed = '';
      if (body.unchanged && summary) { for (const [id, online] of Object.entries(body.online || {})) if (summary.has(id)) summary.get(id)!.online = online; }
      else if (Array.isArray(body.lgas)) { version = body.v; summary = new Map(body.lgas.map((item): [string, CitySummary] => [item.id, { residents: item.residents, houses: item.houses, online: item.online, occ: decode(item.occ) }])); }
      onChange('city');
    } catch (error) { failed = (error as Failure)?.reason || (error as Failure)?.message || 'The city could not be loaded.'; cityAt = now(); onChange('city'); } finally { cityLoading = false; }
  }
  async function loadEstate(lga: string, estate: number, key: string, entry: EstateEntry): Promise<void> {
    entry.loading = true;
    try {
      const first = await fetchJson!(`/api/world/lga/${lga}/estate/${estate}/houses?city=${city}&page=0`) as HousesWire;
      const houses = new Map(first.houses.map((house): [number, WorldHouse] => [house.p, house]));
      for (let page = 1; page < (first.pages || 1); page++) for (const house of ((await fetchJson!(`/api/world/lga/${lga}/estate/${estate}/houses?city=${city}&page=${page}`)) as HousesWire).houses) houses.set(house.p, house);
      entry.houses = houses; entry.at = now();
      onChange('estate', { lga, estate });
    } catch { entry.at = now(); } finally { entry.loading = false; }
  }
  function estate(lga: string, number: number): WorldEstate | null {
    const key = `${lga}/${number}`;
    let entry = estates.get(key);
    if (!entry) {
      estates.set(key, entry = { houses: null, at: 0, loading: false, used: ++tick });
      // The least recently used estates make room.
      if (estates.size > ESTATES_KEPT) for (const [old] of [...estates].sort((a, b) => a[1].used - b[1].used).slice(0, estates.size - ESTATES_KEPT)) if (old !== key) estates.delete(old);
    }
    entry.used = ++tick;
    if (fetchJson && !entry.loading && now() - entry.at > ESTATE_AGE) void loadEstate(lga, number, key, entry);
    return entry.houses ? entry as WorldEstate : null;
  }
  return {
    summary: () => summary, error: () => failed,
    loadCity, estate,
    want(list) { for (const item of list) estate(item.lga, item.estate); },
    /** Something of the player's own changed (their plot, their style): what is cached is stale. */
    stale() { cityAt = 0; for (const entry of estates.values()) entry.at = 0; },
    drop(next = city) { city = next; summary = null; version = ''; cityAt = 0; estates.clear(); },
    size: () => estates.size,
  };
}
