import { routeUnavailable } from '../../game/cities/routeAvailability.ts';
import { cityLinks, cityRules, cityName, catalogueCitiesInState, isOpenCityId, linksFrom } from '../../game/cities/registry.ts';
/**
 * OWNER: world
 * What the atlas says about a region: the model behind its sheet and its row in the list.
 * Pure — no Three.js, no DOM. Everything comes from the registry (../regions.js), the links
 * between cities (src/game/cities/registry.ts) and the map data's own names.
 *
 *   regionInfo(ref, context) → RegionInfo
 *   listOrder(a, b)          open first, then planned, then by name
 *
 * ONLY AN OPEN REGION CAN BE ENTERED. `action` is null for everything else — with one exception
 * that already existed: a player who holds a life in a legacy city (Ibadan) is offered it as a
 * "Preview" (cityAccess in ../regions.js). Nothing is shown that cannot work: a route's `live`
 * is true only when the server would let the trip start.
 *
 */
import type { CityLinkMode } from '../../types/index.ts';
import { TRIP_SKIP, tripSkipFee } from '../../game/content/travel.ts';
import type { AfricaGroupId, ContinentId, RegionKind, RegionStatus } from '../types.ts';
import { AFRICA_GROUPS, CONTINENTS, ZONES, cityAccess, cityEntry, regionEntry } from '../regions.ts';

export interface RegionRef { kind: RegionKind; id: string }
export interface RouteInfo { status?: 'open' | 'coming'; id: string; to: string; mode: CityLinkMode; label: string; fare: number; /** Whole seconds the trip takes. */ seconds: number; minutes: number; km: number; hub: string; live: boolean; why: string | null; /** What arriving at once would add to the fare, in naira (0: this character's first skip, which is free). Absent when the player's own routes are not known. */ skip?: number }
export interface RegionAction { kind: 'enter-city' | 'open-city' | 'zoom'; label: string; city?: string; level?: string }
export type RegionTone = 'here' | 'open' | 'preview' | 'soon' | 'none';
export interface RegionInfo {
  kind: RegionKind; id: string; name: string; type: string; capital: string | null; teaser: string; status: RegionStatus;
  tag: string; tone: RegionTone; city: { id: string; name: string } | null; preview: readonly string[] | null;
  routes: RouteInfo[]; /** Cities this one is planned to link to: named under "Opening soon", with no fare. */ soon: string[]; routesFrom: string | null; planned: string | null; wait: string | null; action: RegionAction | null;
}
/** The part of a data feature the sheet reads: any of the three data modules' features fits. */
export interface FeatureLike { name: string; k?: string; cap?: string | [string, number, number]; sub?: AfricaGroupId; c?: ContinentId }
/** What the sheet is told about the player: where they are, which legacy cities they hold, and the routes the server would allow. */
export interface RegionContext {
  cityId?: string | null;
  feature?: FeatureLike | null;
  current?: string | null;
  held?: string[];
  routes?: { to: string; mode: string; blocked?: string | null; /** The character still has its free first skip between cities. */ skipFree?: boolean }[] | null;
}

const TYPES: Readonly<Record<string, string>> = { country: 'Country', territory: 'Territory', continent: 'Continent' };
const STATUS_RANK: Readonly<Record<string, number>> = { open: 0, planned: 1, soon: 2 };
export const linkKey = (link: { a: string; b: string; mode: string }): string => `${link.a}:${link.b}:${link.mode}`;

/** The links between `from` and `to`, each with its fare and time, and whether the server would let it leave. */
function routesBetween(from: string, to: string, mine: RegionContext['routes']): RouteInfo[] {
  return cityLinks(from).filter(link => link.a === to || link.b === to).map((link) => {
    const live = mine?.find((item) => item.to === to && item.mode === link.mode), open = isOpenCityId(to);
    const unavailable = routeUnavailable(link);
    const why = unavailable?.reason ?? (live ? live.blocked || null : open ? null : `${cityName(to) ?? 'It'} is not open yet, so nothing leaves for it. Departures start the day it opens.`);
    return { ...(link.status ? { status: link.status } : {}), id: linkKey(link), to, mode: link.mode, label: link.label, fare: link.fare, seconds: link.seconds, minutes: Math.round((link.seconds / 60) * 10) / 10, km: link.km,
      hub: cityRules(from)?.hub?.[link.mode] ?? 'the park', live: Boolean(live) && !unavailable && !live!.blocked && open, why, ...(typeof live?.skipFree === 'boolean' && !unavailable ? { skip: live.skipFree && TRIP_SKIP.firstIntercityFree ? 0 : tripSkipFee('intercity', link.seconds, link.fare) } : {}) };
  });
}

export function regionInfo(ref: RegionRef, { cityId = null, feature = null, current = null, held = [], routes = null }: RegionContext = {}): RegionInfo {
  const entry = regionEntry(ref.kind, ref.id), status = entry.status, name = feature?.name ?? ref.id;
  const capital = Array.isArray(feature?.cap) ? feature.cap[0] : feature?.cap ?? null;
  const base: Omit<RegionInfo, 'type' | 'teaser' | 'tag' | 'tone'> = { kind: ref.kind, id: ref.id, name, capital, status, city: null, preview: null, routes: [], soon: [], routesFrom: null, planned: null, wait: null, action: null };
  const fromName = cityName(current) ?? null;

  if (ref.kind === 'state') {
    const zone = ZONES[entry.zone!]?.name;
    const candidates = catalogueCitiesInState(ref.id);
    const selectedId = cityId && candidates.some(item => item.id === cityId) ? cityId : current && candidates.some(item => item.id === current) ? current : entry.city;
    const city = selectedId ? cityEntry(selectedId) : null;
    const type = `${ref.id === 'fct' ? 'Territory' : 'State'}${zone ? ` · ${zone}` : ''}`;
    const teaser = entry.teaser || `${name} is on the map for later.`;
    if (!city) return { ...base, type, teaser, tag: 'Coming soon', tone: 'soon', wait: `${name} is not open yet. We will announce it in the game when it is.` };
    const access = cityAccess(city.id, { current, held });
    const info = { ...base, type, teaser: city.status === 'playable' ? city.teaser : teaser, city: { id: city.id, name: city.name }, preview: city.status === 'playable' ? null : city.preview ?? null };
    if (city.status === 'playable') {
      // The open city: from here every link to a planned city can be looked at.
      // Only open destinations are listed with a fare; the planned ones are named under "Opening soon".
      const every = current === city.id ? [...new Set(linksFrom(city.id).map(link => link.to))] : [];
      const others = every.filter((to) => isOpenCityId(to));
      const soon = every.filter((to) => !isOpenCityId(to)).map((to) => cityName(to) ?? to);
      return { ...info, soon, tag: access === 'here' ? 'You are here' : 'Open', tone: access === 'here' ? 'here' : 'open',
        routes: current && current !== city.id ? routesBetween(current, city.id, routes) : others.flatMap((to) => routesBetween(city.id, to, routes)), routesFrom: current && current !== city.id ? fromName : others.length ? city.name : null,
        action: access === 'here' ? { kind: 'open-city', label: `Enter ${city.name}`, city: city.id } : current ? null : { kind: 'enter-city', label: `Go to ${city.name}`, city: city.id } };
    }
    return { ...info, tag: access === 'preview' ? 'Preview' : 'Coming soon', tone: access === 'preview' ? 'preview' : 'soon',
      routes: current && current !== city.id ? routesBetween(current, city.id, routes) : [], routesFrom: fromName,
      wait: `${city.name} is not open yet. We will announce it in the game when it is.`,
      action: access === 'preview' ? { kind: 'enter-city', label: `Preview · open your ${city.name} life`, city: city.id } : null };
  }

  const group = AFRICA_GROUPS[feature?.sub!]?.name ?? CONTINENTS[feature?.c!]?.name ?? null;
  const type = `${TYPES[feature?.k!] || 'Country'}${group ? ` · ${group}` : ''}`;
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
export function listOrder(a: { status: RegionStatus; name: string }, b: { status: RegionStatus; name: string }): number {
  const rank = (item: { status: RegionStatus }) => STATUS_RANK[String(item.status)] ?? 3;
  return rank(a) - rank(b) || a.name.localeCompare(b.name);
}
