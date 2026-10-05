/**
 * OWNER: social
 * Pure client-side model of live location (src/types/live.ts): the table of friends' spots a browser keeps from the
 * `live-snapshot` and `live-move` frames, what a spot reads as at a given server time, and who is drawn on the map.
 * No DOM, no network, no clock other than the `now` passed in — tested in live.test.ts.
 *
 * A TRIP IS NOT STREAMED. A spot carries the server time a trip began and how long it takes; where the friend is on
 * the route, and that they have reached the door, is worked out here from the server clock.
 */
import type { LiveCity, LiveMoveFrame, LiveSnapshotFrame, LiveSpot } from '../types/live.ts';
import type { Whereabouts } from '../types/social.ts';
import type { MapPeople, MapPerson } from '../map3d/people.ts';

/** How long a friend whose last connection closed reads "Reconnecting…" (server/social/presence.ts RECONNECT_GRACE_MS). */
export const LIVE_GRACE_MS = 20000;
/** Friends drawn on the map at once. */
export const MAP_FRIENDS = 24;

/** What the browser knows: each followed friend's latest spot, and the counts of the city it watches. */
export interface LiveTable { friends: Map<string, LiveSpot>; city: LiveCity | null; at: number }
export const freshLive = (): LiveTable => ({ friends: new Map(), city: null, at: 0 });

const isSpot = (value: unknown): value is LiveSpot => typeof value === 'object' && value !== null && typeof (value as LiveSpot).id === 'string' && typeof (value as LiveSpot).status === 'string';
const isCity = (value: unknown): value is LiveCity => typeof value === 'object' && value !== null && typeof (value as LiveCity).cityId === 'string' && typeof (value as LiveCity).venues === 'object' && (value as LiveCity).venues !== null;

/** A snapshot replaces everything held. */
export function takeSnapshot(table: LiveTable, frame: Pick<LiveSnapshotFrame, 'at' | 'city' | 'friends'>): void {
  table.friends = new Map((Array.isArray(frame.friends) ? frame.friends : []).filter(isSpot).map((spot) => [spot.id, spot]));
  table.city = isCity(frame.city) ? frame.city : null;
  table.at = Number.isFinite(frame.at) ? frame.at : table.at;
}
/** A move changes the friends it names and, when it carries them, the city's counts. Returns the ids it changed. */
export function takeMove(table: LiveTable, frame: Pick<LiveMoveFrame, 'at' | 'spots' | 'city'>): string[] {
  const changed: string[] = [];
  for (const spot of Array.isArray(frame.spots) ? frame.spots : []) if (isSpot(spot)) { table.friends.set(spot.id, spot); changed.push(spot.id); }
  if (isCity(frame.city)) table.city = frame.city;
  if (Number.isFinite(frame.at)) table.at = frame.at;
  return changed;
}

export const ended = (trip: { startedAt: number; duration: number }, now: number): boolean => now >= trip.startedAt + trip.duration * 1000;

/**
 * What the lists say about a friend at server time `now`: the fields of a friend's whereabouts, complete (a field
 * that is absent is no longer true). A trip whose time is up reads as being at its destination; a closed connection
 * reads "reconnecting" for the grace period and offline after it.
 */
export function whereabouts(spot: LiveSpot, now: number): Whereabouts {
  if (spot.status !== 'online') {
    const gone = spot.status === 'offline' || (typeof spot.seenAt === 'number' && now - spot.seenAt >= LIVE_GRACE_MS);
    return { status: gone ? 'offline' : 'reconnecting', ...(typeof spot.seenAt === 'number' ? { seenAt: spot.seenAt } : {}) };
  }
  const city = spot.cityId ? { cityId: spot.cityId } : {};
  if (spot.journey) return { status: 'away', ...city, journey: spot.journey.to };
  if (spot.trip) return ended(spot.trip, now) ? { status: 'online', ...city, venue: spot.trip.to } : { status: 'away', ...city, going: spot.trip.to };
  return spot.venue ? { status: 'online', ...city, venue: spot.venue } : { status: 'away', ...city };
}
const WHERE_KEYS = ['status', 'seenAt', 'cityId', 'venue', 'going', 'journey'] as const;
/** Write a friend's whereabouts over a record that carries them (a friend row, a player card). Returns true when anything changed. */
export function applyWhereabouts(target: Whereabouts, next: Whereabouts): boolean {
  let changed = false;
  const from: Partial<Record<(typeof WHERE_KEYS)[number], unknown>> = next, to: Partial<Record<(typeof WHERE_KEYS)[number], unknown>> = target;
  for (const key of WHERE_KEYS) {
    if (from[key] === to[key]) continue;
    changed = true;
    if (from[key] === undefined) delete to[key]; else to[key] = from[key];
  }
  return changed;
}

/** Who is drawn on the map of `cityId`, and how many other players are at each venue. */
export function mapPeople(input: {
  table: LiveTable
  /** The player's friends, by name; only those the table has a spot for can be drawn. */
  friends: readonly { id: string; name: string }[]
  cityId: string
  /** Where the player stands (null while travelling): they are not one of the "others" there. */
  here: string | null
  now: number
  look(person: { id: string; name: string }): { initial: string; hue: number }
}): MapPeople {
  const people: MapPerson[] = [], standing: Record<string, number> = {};
  for (const friend of input.friends) {
    const spot = input.table.friends.get(friend.id);
    if (!spot || spot.status !== 'online' || spot.cityId !== input.cityId || spot.journey) continue;
    const trip = spot.trip && !ended(spot.trip, input.now) ? spot.trip : null, venue = trip ? null : spot.trip?.to ?? spot.venue ?? null;
    if (!trip && (!venue || venue === 'home' || venue === 'visit')) continue;
    // The server counts a friend at the venue it has them recorded at; one who has only just arrived by the clock is not in that count yet.
    if (!trip && spot.venue && venue === spot.venue) standing[venue] = (standing[venue] ?? 0) + 1;
    people.push({ ...friend, ...input.look(friend), ...(trip ? { trip: { ...trip } } : { venue: venue ?? '' }) });
  }
  people.sort((a, b) => Number(Boolean(b.trip)) - Number(Boolean(a.trip)) || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
  return { people: people.slice(0, MAP_FRIENDS), counts: othersAt(input.table, input.cityId, input.here, standing) };
}
/** Players at each venue of `cityId` who are neither the player (standing at `here`) nor one of the friends counted in `named`. */
export function othersAt(table: LiveTable, cityId: string, here: string | null, named: Readonly<Record<string, number>> = {}): Record<string, number> {
  const counts: Record<string, number> = {};
  if (table.city?.cityId !== cityId) return counts;
  for (const [venue, total] of Object.entries(table.city.venues)) {
    const left = (Number.isFinite(total) ? total : 0) - (named[venue] ?? 0) - (venue === here ? 1 : 0);
    if (left > 0) counts[venue] = left;
  }
  return counts;
}
// The words beside a place in the list of places are in ./live-lines.ts: only the Map's list reads them.
