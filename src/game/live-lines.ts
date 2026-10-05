/**
 * OWNER: social
 * The words of the Map's list of places. Apart from live-model.ts on purpose: only the Map app reads them, and it is
 * fetched on demand (vite.config.ts). Pure; tested in live.test.ts.
 */
import { ended } from './live-model.ts';
import type { MapPeople } from '../map3d/people.ts';

/**
 * The words beside a place in the list of places: "Bola here", "Bola +2 here", "Ada, Bola here", "3 here".
 * A friend counts at the venue they stand at; one still on the road counts nowhere.
 */
export function crowdWords(people: MapPeople, now: number): Record<string, string> {
  const names = new Map<string, string[]>();
  for (const person of people.people) {
    const venue = person.trip ? (ended(person.trip, now) ? person.trip.to : null) : person.venue;
    if (venue) names.set(venue, [...(names.get(venue) ?? []), person.name]);
  }
  const words: Record<string, string> = {};
  for (const venue of new Set([...names.keys(), ...Object.keys(people.counts)])) {
    const friends = names.get(venue) ?? [], more = people.counts[venue] ?? 0;
    if (!friends.length && more <= 0) continue;
    words[venue] = !friends.length ? `${more} here` : friends.length > 2 ? `${friends.length + more} here` : `${friends.join(', ')}${more > 0 ? ` +${more}` : ''} here`;
  }
  return words;
}
