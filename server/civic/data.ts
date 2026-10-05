// OWNER: civic — the shape of the `civic` collection and safe access to one city's part of it.
// Portable: plain objects only, reached through ctx.collection(db, 'civic') by the routes.
//
// db.civic = {
//   v: 1,
//   prefs:  { [publicId]: { richList?: true, directory?: true } }      true = hidden from that list
//   salt:   string                        random; mixed into the address keys of the vote cap
//   cities: { [cityId]: {
//     seq:       number                       last id issued for announcements and shout-outs
//     visits:    number                       resident-days: +1 the first time a resident checks in on a Lagos day
//     prunedAt:  ms
//     residents: { [publicId]: { name, house, since, lastSeen, day, cash, week, earned, gems, claims } }
//     gov:       { elections: { [week]: { candidates: { [publicId]: { name, slogan, at } }, votes: { [voterId]: candidateId },
//                                         addr?: { [addressKey]: votes }, capLogged?: { [addressKey]: true } } },
//                  (addr and capLogged exist for the current election only; addressKey is a salted hash, never an address)
//                  announcements: [{ id, by: { id, name }, text, at, term }] }
//     ads:       { billboard: { [slotId]: ad }, sea: { [plotId]: ad } }    ad = { by: { id, name }, text, colour, icon, at, expiresAt }
//     hunt:      { found, claims, byDay: { [lagosDay]: found } }
//     radio:     { queues: { [venueId]: [{ id, by: { id, name }, title, artist, at, startsAt, endsAt, requestId }] },
//                  daily: { [publicId]: { day, n } } }
//   } }
// }
// Only public ids and public names are ever stored here — never a session secret.
import type { CityId } from '../../src/types/protocol.ts';
import type { CivicCityRecord, CivicCollection } from '../types.ts';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const whole = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0;

/** `source?.key` for a value that may be anything: undefined unless `source` is an object. */
export function field(source: unknown, key: string): unknown {
  return typeof source === 'object' && source !== null ? Reflect.get(source, key) : undefined;
}

export const emptyCivic = (): CivicCollection => ({ v: 1, prefs: {}, cities: {} });

const emptyCity = (): CivicCityRecord => ({
  seq: 0, visits: 0, prunedAt: 0, residents: {}, gov: { elections: {}, announcements: [] },
  ads: { billboard: {}, sea: {} }, hunt: { found: 0, claims: 0, byDay: {} }, radio: { queues: {}, daily: {} },
});

/**
 * When a city's civic life began: its stored opening, else the first resident it ever had, else `now`. Lagos has no opening
 * (0): its record predates the field and its notices stay as they were.
 */
export function openedAtOf(city: CivicCityRecord, cityId: CityId, now: number): number {
  if (whole(city.openedAt)) return city.openedAt as number;
  if (cityId === 'lagos') return 0;
  const since = Object.values(city.residents ?? {}).map((entry) => entry?.since).filter((value): value is number => Number.isFinite(value));
  return since.length ? Math.min(...since, now) : now;
}

/** One city's civic data, created or repaired in place so a damaged collection cannot crash a route. */
export function cityOf(civic: CivicCollection, cityId: CityId): CivicCityRecord {
  if (!record(civic.cities)) civic.cities = {};
  if (!record(civic.prefs)) civic.prefs = {};
  const existing = civic.cities[cityId];
  let city: CivicCityRecord;
  if (record(existing)) city = existing;
  else city = civic.cities[cityId] = emptyCity();
  if (!whole(city.seq)) city.seq = 0;
  if (!whole(city.visits)) city.visits = 0;
  if (!Number.isFinite(city.prunedAt)) city.prunedAt = 0;
  if (!record(city.residents)) city.residents = {};
  if (!record(city.gov)) city.gov = { elections: {}, announcements: [] };
  if (!record(city.gov.elections)) city.gov.elections = {};
  if (!Array.isArray(city.gov.announcements)) city.gov.announcements = [];
  if (!record(city.ads)) city.ads = { billboard: {}, sea: {} };
  if (!record(city.ads.billboard)) city.ads.billboard = {};
  if (!record(city.ads.sea)) city.ads.sea = {};
  if (!record(city.hunt)) city.hunt = { found: 0, claims: 0, byDay: {} };
  if (!whole(city.hunt.found)) city.hunt.found = 0;
  if (!whole(city.hunt.claims)) city.hunt.claims = 0;
  if (!record(city.hunt.byDay)) city.hunt.byDay = {};
  if (!record(city.radio)) city.radio = { queues: {}, daily: {} };
  if (!record(city.radio.queues)) city.radio.queues = {};
  if (!record(city.radio.daily)) city.radio.daily = {};
  return city;
}

export const nextId = (city: CivicCityRecord, prefix: string): string => `${prefix}${(city.seq += 1)}`;
