/**
 * OWNER: companion
 * THE CONTEXT BUILDER: what the language model is told about the game, made here from the life the server already holds —
 * never from facts the client sends. Pure apart from reading the stored session, social and business records.
 *
 * SENT: first name, city and venue, time of day, needs in words, cash rounded, job, home city and whether the player is a
 * visitor, the current goal and mission titles, ride debt (yes/no), stall (yes/no and status), a COUNT of friends online,
 * whether the market is open, selected open cities and venues (id and label), and a few authored knowledge entries.
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

export const MAX_VENUES = 6;
export const MAX_CITIES = 6;
const NEEDS = ['hunger', 'energy', 'fun', 'social', 'hygiene', 'bladder'] as const;

export interface Built {
  /** The sections appended to the rules: STATE, PLACES, CITIES, KNOWLEDGE. */
  sections: string[]
  /** Whole optional entries, in relevance order, added only after required context and recent history fit. */
  optional: { section: number; text: string }[]
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
export function knowledgeFor(words: readonly string[], preferred?: string): { id: string; text: string }[] {
  return CONCEPTS.map((entry) => ({ entry, score: words.filter((w) => entry.terms.some((term) => same(w, term))).length }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => Number(b.entry.id === preferred) - Number(a.entry.id === preferred) || b.score - a.score)
    .slice(0, 3).map(({ entry }) => ({ id: entry.id, text: entry.text }));
}

function contextNumbers(sections: readonly string[]): ReadonlySet<string> {
  return new Set((sections.join('\n').match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((found) => found.replace(/,/g, '')));
}

/** Required sections already fit. Fill spare characters with whole public entries, then authorize only numbers actually sent. */
export function expandContext(built: Built, spare: number): Built {
  const sections = [...built.sections];
  for (const entry of built.optional) {
    const section = sections[entry.section];
    if (section === undefined || entry.text.length > spare) continue;
    sections[entry.section] = section + entry.text;
    spare -= entry.text.length;
  }
  return { ...built, sections, numbers: contextNumbers(sections) };
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

  const at = here.places.find((place) => place.id === state.location);
  const requiredPlaces = [at, match.place].filter((place): place is PlaceFact => place !== undefined)
    .filter((place, index, all) => all.findIndex((other) => other.id === place.id) === index);
  const extraPlaces = [...here.places].filter((place) => !requiredPlaces.some((required) => required.id === place.id))
    .sort((a, b) => Number(b.open) - Number(a.open)).slice(0, MAX_VENUES - requiredPlaces.length);
  const requiredCities = [cityId, match.city?.id, state.estate?.home]
    .filter((id): id is string => typeof id === 'string' && open.includes(id))
    .filter((id, index, all) => all.indexOf(id) === index);
  const extraCities = open.filter((id) => !requiredCities.includes(id)).slice(0, MAX_CITIES - requiredCities.length);

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
  const knowledge = knowledgeFor(words, match.concept?.id);
  const primary = knowledge[0];
  const placeNote = match.place ? [`${clean(match.place.label)} (${clean(match.place.district)}) is ${match.place.open ? 'open now' : 'closed now'}.`] : [];
  const sections = [
    stateLines.join('\n'),
    `PLACES (id: label), selected subset; Map has all: ${requiredPlaces.map((place) => `${place.id}: ${place.label}`).join('; ')}`,
    `CITIES open (id: name), selected subset; Map has all: ${requiredCities.map((id) => `${id}: ${cityName(id) ?? id}`).join('; ')}`,
  ];
  if (primary || placeNote.length) sections.push(`KNOWLEDGE (selected entries):\n${[...(primary ? [primary.text] : []), ...placeNote].map((line) => `- ${line}`).join('\n')}`);
  const optional = [
    ...knowledge.slice(1).map((entry) => ({ section: 3, text: `\n- ${entry.text}` })),
    ...extraPlaces.map((place) => ({ section: 1, text: `; ${place.id}: ${place.label}` })),
    ...extraCities.map((id) => ({ section: 2, text: `; ${id}: ${cityName(id) ?? id}` })),
  ];
  return {
    sections, optional, numbers: contextNumbers(sections), intent: match.intent,
    facts: { cityId, venues: here.facts, openCities: open, onlineFriends: online },
  };
}
