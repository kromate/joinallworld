/**
 * OWNER: world
 * What the atlas says about a region: the model behind its sheet and its row in the list.
 * Pure — no Three.js, no DOM. Everything comes from the registry (../regions.js), the links
 * between cities (src/game/content/world.js) and the map data's own names.
 *
 *   regionInfo(ref, context) → RegionInfo
 *   listOrder(a, b)          open first, then planned, then by name
 *
 * ONLY AN OPEN REGION CAN BE ENTERED. `action` is null for everything else — with one exception
 * that already existed: a player who holds a life in a legacy city (Ibadan) is offered it as a
 * "Preview" (cityAccess in ../regions.js). Nothing is shown that cannot work: a route's `live`
 * is true only when the server would let the trip start.
 *
 * @typedef {{ kind: 'state' | 'country', id: string }} RegionRef
 * @typedef {{ id: string, to: string, mode: 'road' | 'air', label: string, fare: number, minutes: number, km: number, hub: string, live: boolean, why: string | null }} RouteInfo
 * @typedef {{ kind: 'enter-city' | 'open-city' | 'zoom', label: string, city?: string, level?: string }} RegionAction
 * @typedef {{ kind: string, id: string, name: string, type: string, capital: string | null, teaser: string, status: import('../regions.js').RegionStatus,
 *   tag: string, tone: 'here' | 'open' | 'preview' | 'soon' | 'none', city: { id: string, name: string } | null, preview: string[] | null,
 *   routes: RouteInfo[], routesFrom: string | null, planned: string | null, wait: string | null, action: RegionAction | null }} RegionInfo
 */
import { AFRICA_GROUPS, CONTINENTS, ZONES, cityAccess, cityEntry, regionEntry } from '../regions.js';
import { CITY_LINKS, CITY_RULES } from '../../game/content/world.js';

const TYPES = { country: 'Country', territory: 'Territory', continent: 'Continent' };
const STATUS_RANK = { open: 0, planned: 1, soon: 2 };
export const linkKey = (link) => `${link.a}:${link.b}:${link.mode}`;

/** The links between `from` and `to`, each with its fare and time, and whether the server would let it leave. */
function routesBetween(from, to, mine) {
  return CITY_LINKS.filter((link) => (link.a === from && link.b === to) || (link.a === to && link.b === from)).map((link) => {
    const live = mine?.find((item) => item.to === to && item.mode === link.mode), open = CITY_RULES[to]?.status === 'open';
    const why = live ? live.blocked || null : open ? null : `${CITY_RULES[to]?.name ?? 'It'} is not open yet, so nothing leaves for it. Departures start the day it opens.`;
    return { id: linkKey(link), to, mode: link.mode, label: link.label, fare: link.fare, minutes: Math.round((link.seconds / 60) * 10) / 10, km: link.km,
      hub: CITY_RULES[from]?.hub?.[link.mode] ?? 'the park', live: Boolean(live) && !live.blocked && open, why };
  });
}

/**
 * @param {RegionRef} ref
 * @param {{ feature?: { name: string, k?: string, cap?: string | [string, number, number], sub?: string, c?: string } | null,
 *   current?: string | null, held?: string[], routes?: { to: string, mode: string, blocked?: string | null }[] | null }} [context]
 * @returns {RegionInfo}
 */
export function regionInfo(ref, { feature = null, current = null, held = [], routes = null } = {}) {
  const entry = regionEntry(ref.kind, ref.id), status = entry.status, name = feature?.name ?? ref.id;
  const capital = Array.isArray(feature?.cap) ? feature.cap[0] : feature?.cap ?? null;
  const base = { kind: ref.kind, id: ref.id, name, capital, status, city: null, preview: null, routes: [], routesFrom: null, planned: null, wait: null, action: null };
  const fromName = CITY_RULES[current]?.name ?? null;

  if (ref.kind === 'state') {
    const zone = ZONES[entry.zone]?.name, city = entry.city ? cityEntry(entry.city) : null;
    const type = `${ref.id === 'fct' ? 'Territory' : 'State'}${zone ? ` · ${zone}` : ''}`;
    const teaser = entry.teaser || `${name} is on the map for later.`;
    if (!city) return { ...base, type, teaser, tag: 'Coming soon', tone: 'soon', wait: `${name} is not open yet. We will announce it in the game when it is.` };
    const access = cityAccess(city.id, { current, held });
    const info = { ...base, type, teaser, city: { id: city.id, name: city.name }, preview: city.preview ?? null };
    if (status === 'open') {
      // The open city: from here every link to a planned city can be looked at.
      const others = current === city.id ? [...new Set(CITY_LINKS.filter((link) => link.a === city.id || link.b === city.id).map((link) => (link.a === city.id ? link.b : link.a)))] : [];
      return { ...info, tag: access === 'here' ? 'You are here' : 'Open', tone: access === 'here' ? 'here' : 'open',
        routes: others.flatMap((to) => routesBetween(city.id, to, routes)), routesFrom: others.length ? city.name : null,
        action: access === 'here' ? { kind: 'open-city', label: `Enter ${city.name}`, city: city.id } : { kind: 'enter-city', label: `Go to ${city.name}`, city: city.id } };
    }
    return { ...info, tag: access === 'preview' ? 'Preview' : 'Coming soon', tone: access === 'preview' ? 'preview' : 'soon',
      routes: current && current !== city.id ? routesBetween(current, city.id, routes) : [], routesFrom: fromName,
      wait: `${city.name} is not open yet. We will announce it in the game when it is.`,
      action: access === 'preview' ? { kind: 'enter-city', label: `Preview · open your ${city.name} life`, city: city.id } : null };
  }

  const group = AFRICA_GROUPS[feature?.sub]?.name ?? CONTINENTS[feature?.c]?.name ?? null;
  const type = `${TYPES[feature?.k] || 'Country'}${group ? ` · ${group}` : ''}`;
  if (status === 'open') {
    return { ...base, type, teaser: entry.teaser || `${name} is open.`, tag: 'Open', tone: 'open', action: entry.level ? { kind: 'zoom', label: `Zoom in to ${name}`, level: entry.level } : null };
  }
  if (status === null) return { ...base, type, teaser: entry.teaser || `${name} is on the map for context.`, tag: 'Not planned', tone: 'none' };
  return { ...base, type, tag: 'Coming soon', tone: 'soon',
    teaser: entry.teaser || `${name} is on the map for later. Allworld opens one place at a time.`,
    planned: status === 'planned' && entry.hub && fromName ? `Flights between ${fromName} and ${entry.hub.name} are planned for the day ${name} opens.` : null,
    wait: `${name} is not open yet. We will announce it in the game when it is.` };
}

/** Rows of the list: open first, then planned, then by name. */
export function listOrder(a, b) {
  const rank = (item) => STATUS_RANK[item.status] ?? 3;
  return rank(a) - rank(b) || a.name.localeCompare(b.name);
}
