/**
 * OWNER: world
 * What the maps know about houses and residents, fetched for the part of the city in view and
 * nothing more (server/routes/world.js). One instance is shared by the 3D and the 2D map.
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
export const ESTATES_KEPT = 24;
const CITY_AGE = 20000, ESTATE_AGE = 20000;

export function createWorldData({ fetchJson, cityId = 'lagos', onChange = () => {}, now = () => Date.now() }) {
  let city = cityId, summary = null, version = '', cityAt = 0, cityLoading = false, failed = '';
  const estates = new Map(); // `${lga}/${estate}` → { houses, at, loading, used }
  let tick = 0;
  const decode = (text) => { const raw = atob(text), bytes = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i); return bytes; };

  async function loadCity(force = false) {
    if (!fetchJson || cityLoading || (!force && summary && now() - cityAt < CITY_AGE)) return;
    cityLoading = true;
    try {
      const body = await fetchJson(`/api/world/city?city=${city}${version ? `&v=${encodeURIComponent(version)}` : ''}`);
      cityAt = now(); failed = '';
      if (body.unchanged && summary) { for (const [id, online] of Object.entries(body.online || {})) if (summary.has(id)) summary.get(id).online = online; }
      else if (Array.isArray(body.lgas)) { version = body.v; summary = new Map(body.lgas.map((item) => [item.id, { residents: item.residents, houses: item.houses, online: item.online, occ: decode(item.occ) }])); }
      onChange('city');
    } catch (error) { failed = error?.reason || error?.message || 'The city could not be loaded.'; cityAt = now(); onChange('city'); } finally { cityLoading = false; }
  }
  async function loadEstate(lga, estate, key, entry) {
    entry.loading = true;
    try {
      const first = await fetchJson(`/api/world/lga/${lga}/estate/${estate}/houses?city=${city}&page=0`);
      const houses = new Map(first.houses.map((house) => [house.p, house]));
      for (let page = 1; page < (first.pages || 1); page++) for (const house of (await fetchJson(`/api/world/lga/${lga}/estate/${estate}/houses?city=${city}&page=${page}`)).houses) houses.set(house.p, house);
      entry.houses = houses; entry.at = now();
      onChange('estate', { lga, estate });
    } catch { entry.at = now(); } finally { entry.loading = false; }
  }
  function estate(lga, number) {
    const key = `${lga}/${number}`;
    let entry = estates.get(key);
    if (!entry) {
      estates.set(key, entry = { houses: null, at: 0, loading: false, used: ++tick });
      // The least recently used estates make room.
      if (estates.size > ESTATES_KEPT) for (const [old] of [...estates].sort((a, b) => a[1].used - b[1].used).slice(0, estates.size - ESTATES_KEPT)) if (old !== key) estates.delete(old);
    }
    entry.used = ++tick;
    if (fetchJson && !entry.loading && now() - entry.at > ESTATE_AGE) void loadEstate(lga, number, key, entry);
    return entry.houses ? entry : null;
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
