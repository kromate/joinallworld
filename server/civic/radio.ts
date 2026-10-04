// OWNER: civic — club radio: a per-venue queue of song shout-outs bought with in-game naira.
// A shout-out is a title and an artist as plain text. Nothing is played: there is no audio and
// no link. Each entry gets a fixed slot on server time, so "now playing" is derived, not ticked.
// Portable and pure: functions take the city's civic data and a time.
import { lagosTime } from '../../src/game/clock.ts';
import { RADIO } from '../../src/game/content/civic.ts';
import type { PlayerRef } from '../../src/types/protocol.ts';
import type { RadioEntry, RadioView } from '../../src/types/civic.ts';
import type { CivicCityRecord, ShoutoutRecord } from '../types.ts';
import { field } from './data.ts';
import { cleanLine } from './text.ts';

type Block = { code: string; reason: string };

export const isClub = (venueId: string): boolean => RADIO.venues.includes(venueId);
/** Validate a song. Returns { ok: true, song: { title, artist } } or { ok: false, code, reason }. */
export function validateSong(input: unknown): { ok: false; code: string; reason: string } | { ok: true; song: { title: string; artist: string } } {
  const title = cleanLine(field(input, 'title'), { min: 1, max: RADIO.titleMax, what: 'Song title' });
  if (!title.ok) return title;
  const artist = cleanLine(field(input, 'artist'), { min: 1, max: RADIO.artistMax, what: 'Artist name' });
  if (!artist.ok) return artist;
  return { ok: true, song: { title: title.text, artist: artist.text } };
}

const pending = (city: CivicCityRecord, venueId: string, now: number): ShoutoutRecord[] => {
  const queue: unknown = city.radio.queues[venueId];
  return (Array.isArray(queue) ? (queue as ShoutoutRecord[]) : []).filter((entry) => entry.endsAt > now);
};
const dailyCount = (city: CivicCityRecord, playerId: string, day: number): number => {
  const entry = city.radio.daily[playerId];
  return entry && entry.day === day ? entry.n : 0;
};

/** Why the player cannot queue a shout-out in this venue now, or null. Location and wallet are checked by the rules engine. */
export function shoutBlock(city: CivicCityRecord, now: number, playerId: string, venueId: string): Block | null {
  if (!isClub(venueId)) return { code: 'not_in_club', reason: 'Club radio only plays in clubs. Travel to one first.' };
  const used = dailyCount(city, playerId, lagosTime(now).day);
  if (used >= RADIO.perPlayerPerDay) return { code: 'shoutout_limit', reason: `You have used all ${RADIO.perPlayerPerDay} shout-outs for today. They reset at midnight, Lagos time.` };
  if (pending(city, venueId, now).length >= RADIO.queueMax) return { code: 'queue_full', reason: `The queue here is full (${RADIO.queueMax} songs). Try again in a few minutes.` };
  return null;
}

export function addShoutout(city: CivicCityRecord, now: number, who: PlayerRef, venueId: string, song: { title: string; artist: string }, id: string, requestId: string | null = null): ShoutoutRecord {
  const queue = pending(city, venueId, now), day = lagosTime(now).day;
  const startsAt = Math.max(now, queue.at(-1)?.endsAt ?? 0);
  const entry: ShoutoutRecord = { id, by: { id: who.id, name: who.name }, ...song, at: now, startsAt, endsAt: startsAt + RADIO.slotSeconds * 1000, requestId };
  queue.push(entry);
  city.radio.queues[venueId] = queue;
  for (const [playerId, count] of Object.entries(city.radio.daily)) if (count.day !== day) delete city.radio.daily[playerId];
  city.radio.daily[who.id] = { day, n: dailyCount(city, who.id, day) + 1 };
  return entry;
}

/** Operator removal of one queued or playing shout-out. Returns the removed entry, or null. The price is not refunded. */
export function removeShoutout(city: CivicCityRecord, venueId: string, id: string): ShoutoutRecord | null {
  const queue = Array.isArray(city.radio.queues[venueId]) ? city.radio.queues[venueId] : null;
  const index = queue ? queue.findIndex((entry) => entry.id === id) : -1;
  if (!queue || index < 0) return null;
  return queue.splice(index, 1)[0] ?? null;
}

/** Every shout-out still queued or playing, for the operator's listing. */
export function liveShoutouts(city: CivicCityRecord, now: number) {
  return Object.entries(city.radio.queues).flatMap(([venue, queue]) => (Array.isArray(queue) ? queue : []).filter((entry) => entry.endsAt > now)
    .map((entry) => ({ venue, id: entry.id, title: entry.title, artist: entry.artist, by: { id: entry.by.id, name: entry.by.name }, startsAt: entry.startsAt, endsAt: entry.endsAt })));
}

export const publicEntry = (entry: ShoutoutRecord, viewerId: string | null = null): RadioEntry => ({ id: entry.id, by: { id: entry.by.id, name: entry.by.name }, title: entry.title, artist: entry.artist, startsAt: entry.startsAt, endsAt: entry.endsAt, mine: entry.by.id === viewerId });

/** { venue, club, playing: Entry | null, queue: [Entry], price, slotSeconds, perDay, usedToday, queueMax } */
export function radioView(city: CivicCityRecord, now: number, venueId: string, viewerId: string | null = null): RadioView {
  const queue = isClub(venueId) ? pending(city, venueId, now) : [];
  const playing = queue.find((entry) => entry.startsAt <= now) ?? null;
  return {
    venue: venueId, club: isClub(venueId), playing: playing ? publicEntry(playing, viewerId) : null,
    queue: queue.filter((entry) => entry !== playing).map((entry) => publicEntry(entry, viewerId)),
    price: RADIO.price, slotSeconds: RADIO.slotSeconds, perDay: RADIO.perPlayerPerDay, queueMax: RADIO.queueMax,
    usedToday: viewerId ? dailyCount(city, viewerId, lagosTime(now).day) : 0,
  };
}
