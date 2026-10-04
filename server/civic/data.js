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
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const whole = (value) => Number.isSafeInteger(value) && value >= 0;

export const emptyCivic = () => ({ v: 1, prefs: {}, cities: {} });

/** One city's civic data, created or repaired in place so a damaged collection cannot crash a route. */
export function cityOf(civic, cityId) {
  if (!record(civic.cities)) civic.cities = {};
  if (!record(civic.prefs)) civic.prefs = {};
  const city = record(civic.cities[cityId]) ? civic.cities[cityId] : (civic.cities[cityId] = {});
  if (!whole(city.seq)) city.seq = 0;
  if (!whole(city.visits)) city.visits = 0;
  if (!Number.isFinite(city.prunedAt)) city.prunedAt = 0;
  if (!record(city.residents)) city.residents = {};
  if (!record(city.gov)) city.gov = {};
  if (!record(city.gov.elections)) city.gov.elections = {};
  if (!Array.isArray(city.gov.announcements)) city.gov.announcements = [];
  if (!record(city.ads)) city.ads = {};
  if (!record(city.ads.billboard)) city.ads.billboard = {};
  if (!record(city.ads.sea)) city.ads.sea = {};
  if (!record(city.hunt)) city.hunt = {};
  if (!whole(city.hunt.found)) city.hunt.found = 0;
  if (!whole(city.hunt.claims)) city.hunt.claims = 0;
  if (!record(city.hunt.byDay)) city.hunt.byDay = {};
  if (!record(city.radio)) city.radio = {};
  if (!record(city.radio.queues)) city.radio.queues = {};
  if (!record(city.radio.daily)) city.radio.daily = {};
  return city;
}

export const nextId = (city, prefix) => `${prefix}${(city.seq += 1)}`;
