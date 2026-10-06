/**
 * OWNER: world
 * Where the player's friends are, for the country and world map: grouped by city (and, further out, by country), with a small
 * badge for each group, and the routing of "Show on map". Pure — no DOM, no Three.js; tested in friends.test.ts.
 *
 * WHO IS IN IT. Only friends the live frames carry a spot for (src/game/live-model.ts LiveTable): those are friends by request who are
 * not in a block, which is by design never the founder's automatic friends. A friend with no spot is not here at all, so the founder
 * sees ordinary friends only. Nothing here asks the server for anything.
 *
 * WHAT IS SHOWN OF A PLACE. A friend who is connected is in a city (`cityId`). Their venue is shown only when it is the reader's own
 * city — the same rule as the people lists ("Online · in Ibadan" for another city) — and a home is only ever "at home", never an
 * address. A friend who is offline or reconnecting has no place at all: they are listed under "offline", with when they were last seen.
 */
import { whereabouts } from '../../game/live-model.ts';
import type { LiveTable } from '../../game/live-model.ts';

export interface FriendRef { id: string; name: string }
export interface FriendHere {
  id: string
  name: string
  initial: string
  /** Connected to the game right now (online, or away on a trip): the badge's ring is green when any is. */
  online: boolean
  /** The venue, only for a friend in the reader's own city; 'home' reads "at home". */
  venue?: string
  /** On a journey to another city. */
  journey?: string
  seenAt?: number
}
export interface FriendsGroup { cityId: string; friends: FriendHere[]; online: boolean }
export interface FriendsModel {
  /** One group for each city a friend is in, the busiest first. */
  cities: FriendsGroup[]
  /** Friends with no place to show: offline, or reconnecting. */
  offline: FriendHere[]
}
export const EMPTY_FRIENDS: FriendsModel = Object.freeze({ cities: Object.freeze([]) as unknown as FriendsGroup[], offline: Object.freeze([]) as unknown as FriendHere[] });

const initialOf = (name: string): string => (name.trim().charAt(0) || '?').toUpperCase();
const byOnlineThenName = (a: FriendHere, b: FriendHere): number => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1);

export function friendsModel(input: { friends: readonly FriendRef[]; table: Pick<LiveTable, 'friends'>; now: number; viewerCity: string }): FriendsModel {
  const groups = new Map<string, FriendHere[]>(), offline: FriendHere[] = [];
  for (const friend of input.friends) {
    const spot = input.table.friends.get(friend.id);
    if (!spot) continue;
    const where = whereabouts(spot, input.now), base = { id: friend.id, name: friend.name, initial: initialOf(friend.name) };
    if ((where.status !== 'online' && where.status !== 'away') || !where.cityId) {
      offline.push({ ...base, online: false, ...(where.seenAt !== undefined ? { seenAt: where.seenAt } : {}) });
      continue;
    }
    const own = where.cityId === input.viewerCity, venue = where.venue ?? null;
    const here: FriendHere = { ...base, online: true, ...(own && venue && venue !== 'visit' ? { venue } : {}), ...(where.journey ? { journey: where.journey } : {}) };
    const list = groups.get(where.cityId);
    if (list) list.push(here); else groups.set(where.cityId, [here]);
  }
  const cities = [...groups.entries()].map(([cityId, friends]): FriendsGroup => ({ cityId, friends: friends.sort(byOnlineThenName), online: friends.some((item) => item.online) }))
    .sort((a, b) => b.friends.length - a.friends.length || (a.cityId < b.cityId ? -1 : 1));
  return { cities, offline: offline.sort(byOnlineThenName) };
}

/** The small badge of a group: up to three initials, the count, and whether a green ring is drawn. */
export function badgeOf(friends: readonly FriendHere[]): { initials: string[]; count: number; online: boolean } {
  return { initials: [...friends].sort(byOnlineThenName).slice(0, 3).map((item) => item.initial), count: friends.length, online: friends.some((item) => item.online) };
}

export interface CountryGroup { countryId: string; cityIds: string[]; friends: FriendHere[]; online: boolean }
/** The groups gathered by country, for the Africa and world levels. A city whose country is unknown is left out. */
export function byCountry(model: FriendsModel, countryOf: (cityId: string) => string | null): CountryGroup[] {
  const countries = new Map<string, CountryGroup>();
  for (const group of model.cities) {
    const id = countryOf(group.cityId);
    if (!id) continue;
    const entry = countries.get(id) ?? { countryId: id, cityIds: [], friends: [], online: false };
    entry.cityIds.push(group.cityId); entry.friends.push(...group.friends); entry.online = entry.online || group.online;
    countries.set(id, entry);
  }
  return [...countries.values()].map((entry) => ({ ...entry, friends: entry.friends.sort(byOnlineThenName) })).sort((a, b) => b.friends.length - a.friends.length || (a.countryId < b.countryId ? -1 : 1));
}

/** Where "Show on map" for one friend goes: the city map at their venue, the country map at their city with the badge open, or nowhere (no place to show). */
export type MapRoute = { layer: 'city'; destination: string } | { layer: 'world'; city: string; friends: true } | null;
export function routeToFriend(model: FriendsModel, id: string, viewerCity: string): MapRoute {
  for (const group of model.cities) {
    const friend = group.friends.find((item) => item.id === id);
    if (!friend) continue;
    if (group.cityId === viewerCity && friend.venue && friend.venue !== 'home') return { layer: 'city', destination: friend.venue };
    return { layer: 'world', city: group.cityId, friends: true };
  }
  return null;
}
