/**
 * OWNER: social
 * The sentences of the people screens: what a person's status reads as, and the line above a list of people.
 * Apart from social-model.ts on purpose: only screens that are fetched on demand read them, so they are not part of
 * the first download (vite.config.ts). Pure; tested with the model in social.test.ts and live.test.ts.
 */
import { PRESENCE, agoText } from './social-model.ts';
import type { PresenceEntry } from './social-model.ts';
import type { PeopleListing } from '../types/social.ts';

/** PRESENCE read by an arbitrary status word, as the people list reports it. */
const presenceByStatus: Readonly<Record<string, PresenceEntry | undefined>> = PRESENCE;

/**
 * "Online · Freedom Park", "Online · at home", "Online · visiting a friend", "Away", "Reconnecting…",
 * "Offline". Given the server's `now`, an offline player whose listing carries `seenAt` (the time
 * their last connection closed) reads "Offline · last seen 5 min ago".
 * With live location a friend on the move reads "On the way to Freedom Park", "On the way home" or
 * "Travelling to Ibadan". `place` names the reader's own city: a friend in another one reads
 * "Online · in Ibadan" — the city only, never a venue of it.
 */
export function presenceText(person: { status?: string; seenAt?: number; venue?: string; cityId?: string; going?: string; journey?: string } | null | undefined, venueName: (id: string) => string = (id) => id, now: number | null = null,
  place: { cityId?: string; cityName?: (id: string) => string } | null = null): string {
  const entry = presenceByStatus[person?.status ?? ''] || PRESENCE.offline;
  if (entry === PRESENCE.offline && typeof person?.seenAt === 'number' && Number.isFinite(person.seenAt) && typeof now === 'number' && Number.isFinite(now)) return `${entry.label} · last seen ${agoText(person.seenAt, now)}`;
  const cityName = (id: string): string => place?.cityName?.(id) ?? id;
  const elsewhere = person?.cityId && place?.cityId && person.cityId !== place.cityId ? person.cityId : null;
  if (person?.status === 'away' && person.journey) return `Travelling to ${cityName(person.journey)}`;
  if (person?.status === 'away' && person.going) return elsewhere ? `On the move in ${cityName(elsewhere)}` : `On the way ${person.going === 'home' ? 'home' : `to ${venueName(person.going)}`}`;
  if (elsewhere && (person?.status === 'online' || person?.status === 'away')) return `${entry.label} · in ${cityName(elsewhere)}`;
  if (person?.status !== 'online' || !person.venue) return entry.label;
  return `${entry.label} · ${person.venue === 'home' ? 'at home' : person.venue === 'visit' ? 'visiting a friend' : venueName(person.venue)}`;
}

/** The line above the people list: what the count means and why it may be empty. */
export function roomSummary(list: Pick<PeopleListing, 'venue' | 'self' | 'count'> | null | undefined, venueName: string): string {
  if (!list) return 'Checking who is here…';
  if (list.venue === 'home') return list.count ? `${list.count} guest${list.count === 1 ? '' : 's'} in your home` : 'Your home is private. Only guests you let in appear here.';
  if (list.self === 'travelling') return 'You are on the move. People appear when you arrive.';
  if (list.self === 'not_joined') return `Connecting you to ${venueName}… other players cannot see you here yet.`;
  return `${list.count} other player${list.count === 1 ? '' : 's'} here — the same people who see this venue’s chat.`;
}
