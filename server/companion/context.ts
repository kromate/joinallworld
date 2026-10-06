/**
 * OWNER: companion
 * THE CONTEXT BUILDER: what the language model is told about the game, made here from the life the server already holds —
 * never from facts the client sends. Pure apart from reading the stored session, social and business records.
 *
 * SENT: first name, city and venue, time of day, needs in words, cash rounded, job, home city and whether the player is a
 * visitor, the current goal and mission titles, ride debt (yes/no), stall (yes/no and status), a COUNT of friends online,
 * whether the market is open, the open cities, this city's venues (id and label), and a few authored knowledge entries.
 * NEVER SENT: e-mail, account ids, the session secret, the player's own id (the gateway only gets a one-way hash of it),
 * device or address data, a real-world location or whether one was confirmed, another player's name or message, anything in a
 * private chat, anything about who runs the game.
 */
import { cachedCityContent, cityName, playableCityIds } from '../../src/game/cities/index.ts';
import { isDefaultName } from '../../src/game/cities/registry.ts';
import { isOpen, lagosTime } from '../../src/game/clock.ts';
import { STARTER_GOALS } from '../../src/game/content/goals.ts';
import { JOBS } from '../../src/game/content/jobs.ts';
import { DAILY_MISSIONS, WEEKLY_MISSIONS } from '../../src/game/content/missions.ts';
import { BUSINESS } from '../../src/game/content/business.ts';
import { CONCEPTS } from '../../src/app/features/companion/knowledge.ts';
import { matchIntent } from '../../src/app/features/companion/intents.ts';
import { same } from '../../src/app/features/companion/text.ts';
import type { SuggestFacts } from '../../src/app/features/companion/suggest.ts';
import type { CityFact, PlaceFact } from '../../src/app/features/companion/types.ts';
import type { LifeState } from '../../src/types/life.ts';
import type { Db, SessionRecord } from '../types.ts';

export const MAX_VENUES = 40;
const NEEDS = ['hunger', 'energy', 'fun', 'social', 'hygiene', 'bladder'] as const;

export interface Built {
  /** The sections appended to the rules: STATE, PLACES, CITIES, KNOWLEDGE. */
  sections: string[]
  facts: SuggestFacts
  /** Every number that appears in what the model was told (commas removed): an amount in a reply must be one of them. */
  numbers: ReadonlySet<string>
  /** The intent the lead's matcher read, for the operator's topics and for tests. */
  intent: string
}
export interface Dependencies {
  now: number
  /** How many of the player's friends are connected now. */
  online: (id: string) => boolean
}

const word = (level: number): string => (level >= 75 ? 'good' : level >= 50 ? 'okay' : level >= 25 ? 'low' : 'very low');
/** Cash to a round figure: the model is told "about", so an amount it repeats is the rounded one. */
export const roundedCash = (cash: number): number => {
  const step = cash < 1000 ? 50 : cash < 10000 ? 100 : cash < 100000 ? 500 : 1000;
  return Math.max(0, Math.round(cash / step) * step);
};
const naira = (value: number): string => `₦${value.toLocaleString('en-US')}`;
const dayPart = (hour: number): string => (hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night');
const clock = (hour: number): string => `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? 'AM' : 'PM'}`;
/** A first name only, letters, nothing the game's own default stands for. */
export function firstName(name: unknown): string {
  const first = String(name ?? '').trim().split(/\s+/)[0] ?? '';
  const clean = first.normalize('NFKC').replace(/[^\p{L}'’-]/gu, '').slice(0, 20);
  return clean && !isDefaultName(String(name ?? '').trim()) ? clean : '';
}
const clean = (text: string, max = 60): string => text.replace(/[\u0000-\u001f<>{}"`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** The knowledge entries a message is about (at most three), by the words they use. */
export function knowledgeFor(words: readonly string[]): { id: string; text: string }[] {
  return CONCEPTS.filter((entry) => words.some((w) => entry.terms.some((term) => same(w, term)))).slice(0, 3).map((entry) => ({ id: entry.id, text: entry.text }));
}

function venuesOf(cityId: string, now: number, state: LifeState): { facts: { id: string; label: string }[]; places: PlaceFact[] } {
  const content = cachedCityContent(cityId);
  const found = content ? content.venues.map((item) => item.definition) : [];
  const places: PlaceFact[] = found.map((venue) => ({
    id: String(venue.id), label: clean(venue.label), district: clean(venue.district), category: venue.category, open: isOpen(venue.hours, now),
    status: '', here: venue.id === state.location, activities: [], description: clean(venue.description, 80),
  }));
  return { facts: places.map((place) => ({ id: place.id, label: place.label })), places };
}

/**
 * Build the sections for one message. `message` is only used to choose which venues and which knowledge entries to include.
 * Returns null when the session has no life in any city.
 */
export function buildContext(db: Db, session: SessionRecord, cityId: string, message: string, deps: Dependencies): Built | null {
  const state = session.cities?.[cityId]?.state;
  if (!state) return null;
  const time = lagosTime(deps.now);
  const here = venuesOf(cityId, deps.now, state);
  const open = playableCityIds();
  const cities: CityFact[] = open.map((id) => ({ id, name: cityName(id) ?? id, open: true, here: id === cityId, home: id === state.estate?.home }));
  const match = matchIntent(message, { cities, places: here.places });
  const words = match.words;

  // Venues: the one matched, the one the player is at, then open ones, up to the cap.
  const wanted = [match.place?.id, state.location].filter((id): id is string => typeof id === 'string');
  const ranked = [...here.places].sort((a, b) => Number(wanted.includes(b.id)) - Number(wanted.includes(a.id)) || Number(b.open) - Number(a.open)).slice(0, MAX_VENUES);
  const venues = ranked.map((place) => ({ id: place.id, label: place.label }));
  const at = here.places.find((place) => place.id === state.location);

  const home = state.estate?.home ?? null;
  const job = state.job ? JOBS[state.job] : undefined;
  const chain = state.goals?.started ? STARTER_GOALS[state.goals.chain] : undefined;
  const missions = [...(state.missions?.daily ?? []), ...(state.missions?.weekly ?? [])].filter((entry) => !entry.claimed)
    .map((entry) => [...DAILY_MISSIONS, ...WEEKLY_MISSIONS].find((item) => item.id === entry.id)?.label).filter((label): label is string => Boolean(label)).slice(0, 3);
  const shops = Object.values((db.business as { shops?: Record<string, { by?: { id?: string }; status?: string }> } | undefined)?.shops ?? {}).filter((shop) => shop?.by?.id === session.publicId);
  const friendIds = Object.keys(db.social?.players?.[session.publicId]?.friends ?? {});
  const online = friendIds.filter((id) => deps.online(id)).length;
  const market = state.location && time.hour >= BUSINESS.hours.open && time.hour < BUSINESS.hours.close;
  const name = firstName(state.name);
  const needs = NEEDS.map((key) => `${key} ${word(state.needs?.[key] ?? 0)}`).join(', ');

  const stateLines = [
    'STATE (from the game, trusted):',
    ...(name ? [`Player: ${name}`] : []),
    `City: ${cityName(cityId) ?? cityId}${at ? `; at ${at.label}` : ''}. Time: ${dayPart(time.hour)}, about ${clock(time.hour)}.`,
    `Needs: ${needs}. Cash: about ${naira(roundedCash(state.cash ?? 0))}.`,
    `Job: ${job ? clean(job.label) : 'none'}. Home city: ${home ? cityName(home) ?? home : 'not set'}${home ? (home === cityId ? ' (resident)' : ' (visiting)') : ''}.`,
    `Goal: ${chain ? clean(chain.title) : 'none'}. Missions open: ${missions.length ? missions.map((label) => clean(label)).join('; ') : 'none'}.`,
    `Ride debt: ${(state.travel?.rideDebt ?? 0) > 0 ? 'yes' : 'no'}. Stall: ${shops.length ? `yes, ${shops.some((shop) => shop.status === 'open') ? 'open' : 'closed'}` : 'no'}. Friends online: ${online}. Market: ${market ? `open until ${clock(BUSINESS.hours.close)}` : 'closed'}.`,
  ];
  const sections = [
    stateLines.join('\n'),
    `PLACES (id: label): ${venues.map((venue) => `${venue.id}: ${venue.label}`).join('; ')}`,
    `CITIES open (id: name): ${open.map((id) => `${id}: ${cityName(id) ?? id}`).join('; ')}`,
  ];
  const knowledge = knowledgeFor(words);
  const placeNote = match.place ? [`${clean(match.place.label)} (${clean(match.place.district)}) is ${match.place.open ? 'open now' : 'closed now'}.`] : [];
  if (knowledge.length || placeNote.length) sections.push(`KNOWLEDGE:\n${[...knowledge.map((entry) => `- ${entry.text}`), ...placeNote.map((line) => `- ${line}`)].join('\n')}`);

  const numbers = new Set<string>();
  for (const found of sections.join('\n').match(/\d[\d,]*(?:\.\d+)?/g) ?? []) numbers.add(found.replace(/,/g, ''));
  return {
    sections, numbers, intent: match.intent,
    facts: { cityId, venues, openCities: open, onlineFriends: online },
  };
}
