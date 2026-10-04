// OWNER: civic — club radio: a per-venue queue of song shout-outs bought with in-game naira.
// A shout-out is a title and an artist as plain text. Nothing is played: there is no audio and
// no link. Each entry gets a fixed slot on server time, so "now playing" is derived, not ticked.
// Portable and pure: functions take the city's civic data and a time.
import { lagosTime } from '../../src/game/clock.js';
import { RADIO } from '../../src/game/content/civic.js';
import { cleanLine } from './text.js';

export const isClub = (venueId) => RADIO.venues.includes(venueId);
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
export const validRequestId = (value) => (typeof value === 'string' && REQUEST_ID.test(value) ? value : null);

/** Validate a song. Returns { ok: true, song: { title, artist } } or { ok: false, code, reason }. */
export function validateSong(input) {
  const title = cleanLine(input?.title, { min: 1, max: RADIO.titleMax, what: 'Song title' });
  if (!title.ok) return title;
  const artist = cleanLine(input?.artist, { min: 1, max: RADIO.artistMax, what: 'Artist name' });
  if (!artist.ok) return artist;
  return { ok: true, song: { title: title.text, artist: artist.text } };
}

const pending = (city, venueId, now) => (Array.isArray(city.radio.queues[venueId]) ? city.radio.queues[venueId] : []).filter((entry) => entry.endsAt > now);
const dailyCount = (city, playerId, day) => (city.radio.daily[playerId]?.day === day ? city.radio.daily[playerId].n : 0);

/** A shout-out this player already bought with the same request id (a retried request), if any. */
export function findRequest(city, venueId, now, playerId, requestId) {
  return requestId ? pending(city, venueId, now).find((entry) => entry.by.id === playerId && entry.requestId === requestId) ?? null : null;
}

/** Why the player cannot queue a shout-out in this venue now, or null. Location and wallet are checked by the rules engine. */
export function shoutBlock(city, now, playerId, venueId) {
  if (!isClub(venueId)) return { code: 'not_in_club', reason: 'Club radio only plays in clubs. Travel to one first.' };
  const used = dailyCount(city, playerId, lagosTime(now).day);
  if (used >= RADIO.perPlayerPerDay) return { code: 'shoutout_limit', reason: `You have used all ${RADIO.perPlayerPerDay} shout-outs for today. They reset at midnight, Lagos time.` };
  if (pending(city, venueId, now).length >= RADIO.queueMax) return { code: 'queue_full', reason: `The queue here is full (${RADIO.queueMax} songs). Try again in a few minutes.` };
  return null;
}

export function addShoutout(city, now, who, venueId, song, id, requestId = null) {
  const queue = pending(city, venueId, now), day = lagosTime(now).day;
  const startsAt = Math.max(now, queue.at(-1)?.endsAt ?? 0);
  const entry = { id, by: { id: who.id, name: who.name }, ...song, at: now, startsAt, endsAt: startsAt + RADIO.slotSeconds * 1000, requestId };
  queue.push(entry);
  city.radio.queues[venueId] = queue;
  for (const [playerId, count] of Object.entries(city.radio.daily)) if (count.day !== day) delete city.radio.daily[playerId];
  city.radio.daily[who.id] = { day, n: dailyCount(city, who.id, day) + 1 };
  return entry;
}

/** Operator removal of one queued or playing shout-out. Returns the removed entry, or null. The price is not refunded. */
export function removeShoutout(city, venueId, id) {
  const queue = Array.isArray(city.radio.queues[venueId]) ? city.radio.queues[venueId] : null;
  const index = queue ? queue.findIndex((entry) => entry.id === id) : -1;
  if (index < 0) return null;
  return queue.splice(index, 1)[0];
}

/** Every shout-out still queued or playing, for the operator's listing. */
export function liveShoutouts(city, now) {
  return Object.entries(city.radio.queues).flatMap(([venue, queue]) => (Array.isArray(queue) ? queue : []).filter((entry) => entry.endsAt > now)
    .map((entry) => ({ venue, id: entry.id, title: entry.title, artist: entry.artist, by: { id: entry.by.id, name: entry.by.name }, startsAt: entry.startsAt, endsAt: entry.endsAt })));
}

export const publicEntry = (entry, viewerId = null) => ({ id: entry.id, by: { id: entry.by.id, name: entry.by.name }, title: entry.title, artist: entry.artist, startsAt: entry.startsAt, endsAt: entry.endsAt, mine: entry.by.id === viewerId });

/** { venue, club, playing: Entry | null, queue: [Entry], price, slotSeconds, perDay, usedToday, queueMax } */
export function radioView(city, now, venueId, viewerId = null) {
  const queue = isClub(venueId) ? pending(city, venueId, now) : [];
  const playing = queue.find((entry) => entry.startsAt <= now) ?? null;
  return {
    venue: venueId, club: isClub(venueId), playing: playing ? publicEntry(playing, viewerId) : null,
    queue: queue.filter((entry) => entry !== playing).map((entry) => publicEntry(entry, viewerId)),
    price: RADIO.price, slotSeconds: RADIO.slotSeconds, perDay: RADIO.perPlayerPerDay, queueMax: RADIO.queueMax,
    usedToday: viewerId ? dailyCount(city, viewerId, lagosTime(now).day) : 0,
  };
}
