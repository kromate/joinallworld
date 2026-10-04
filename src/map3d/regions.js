/**
 * OWNER: world
 * Region registry: country → cities. Everything the country map (src/world-map.js) and the 3D
 * city map (src/map3d/map3d.js) know about places comes from here, so a new city is DATA plus a
 * city module — never an edit to the map code.
 *
 * TO ADD A CITY
 *   1. Write src/map3d/cities/<id>.js exporting the same shape as cities/lagos.js (bounds, land,
 *      roads, sites, homes, districts, zones and an optional decorate()).
 *   2. Add an entry to its country's `cities` below with `status: 'playable'` and
 *      `pack: () => import('./cities/<id>.js')`.
 * TO ADD A COUNTRY: add an entry to COUNTRIES with an outline (longitude/latitude pairs, any
 * rough stylised shape) and its cities. The country map draws whichever country is selected.
 *
 * status   'playable'  the city can be entered and has a 3D city pack
 *          'soon'      shown on the country map with its teaser; cannot be entered
 * legacy   true when the server already keeps lives for this city although it is shown as coming
 *          soon. Only a player who already has such a life is offered it, labelled "Preview".
 */

export const COUNTRIES = Object.freeze({
  nigeria: {
    id: 'nigeria', name: 'Nigeria', status: 'playable',
    // A stylised outline, [longitude, latitude], drawn from general knowledge of the country's shape.
    outline: [[2.7, 6.4], [2.75, 7.6], [2.7, 9.0], [3.5, 10.1], [3.6, 11.7], [4.0, 12.9], [4.2, 13.5], [5.4, 13.85], [6.8, 13.1], [8.0, 13.3], [9.5, 12.8], [10.8, 13.35],
      [12.3, 13.1], [13.5, 13.7], [14.2, 12.6], [14.6, 11.6], [13.8, 11.0], [13.3, 10.0], [13.2, 9.3], [12.7, 8.7], [12.2, 8.3], [11.8, 7.0], [11.2, 6.5], [10.6, 7.05],
      [10.1, 6.9], [9.6, 6.5], [9.2, 6.2], [8.8, 5.7], [8.6, 4.8], [8.2, 4.55], [7.4, 4.4], [6.7, 4.35], [6.0, 4.3], [5.5, 4.9], [5.1, 5.7], [4.6, 6.2], [3.6, 6.4]],
    // The two great rivers meet at Lokoja and run to the delta.
    rivers: [
      [[3.6, 11.7], [4.5, 10.3], [5.6, 9.2], [6.2, 8.5], [6.75, 7.8], [6.7, 6.6], [6.5, 5.5], [6.2, 4.6]],
      [[13.2, 9.3], [11.6, 8.9], [10.0, 8.3], [8.5, 7.75], [6.75, 7.8]],
    ],
    cities: {
      lagos: { id: 'lagos', name: 'Lagos', region: 'Lagos State', status: 'playable', lon: 3.38, lat: 6.52, side: 'left',
        teaser: 'The city that never slows down: mainland hustle, island nights and the Atlantic at your feet.', pack: () => import('./cities/lagos.js') },
      ibadan: { id: 'ibadan', name: 'Ibadan', region: 'Oyo State', status: 'soon', legacy: true, lon: 3.95, lat: 7.38, side: 'right',
        teaser: 'Seven hills of brown roofs, Cocoa House and the best amala in the country.', pack: null },
      abuja: { id: 'abuja', name: 'Abuja', region: 'Federal Capital Territory', status: 'soon', lon: 7.49, lat: 9.06, side: 'right',
        teaser: 'The capital under Aso Rock: wide roads, big offices and bigger politics.', pack: null },
      'port-harcourt': { id: 'port-harcourt', name: 'Port Harcourt', region: 'Rivers State', status: 'soon', lon: 7.03, lat: 4.82, side: 'right',
        teaser: 'The Garden City: oil money, bole and fish, and creeks that run to the sea.', pack: null },
    },
  },
});

/** Countries not in the game yet, named so the country picker can say what is planned. */
export const MORE_REGIONS = Object.freeze(['More Nigerian states', 'Ghana', 'Kenya', 'South Africa', 'United Kingdom']);

export const countryList = () => Object.values(COUNTRIES);
export const citiesOf = (countryId) => Object.values(COUNTRIES[countryId]?.cities || {});
export function cityEntry(cityId) {
  for (const country of Object.values(COUNTRIES)) if (Object.hasOwn(country.cities, cityId)) return { ...country.cities[cityId], country: country.id, countryName: country.name };
  return null;
}
export const isPlayable = (cityId) => cityEntry(cityId)?.status === 'playable';
/** Does this city have a 3D pack? Without one the city map falls back to the 2D schematic. */
export const hasCityPack = (cityId) => typeof cityEntry(cityId)?.pack === 'function';
export async function loadCityPack(cityId) {
  const entry = cityEntry(cityId);
  if (typeof entry?.pack !== 'function') return null;
  const module = await entry.pack();
  return module.default || module;
}

/**
 * What a player may do with a city, given the city they are in and the legacy cities they already
 * have a life in (ids). → 'here' | 'enter' | 'preview' | 'soon'
 */
export function cityAccess(cityId, { current = null, held = [] } = {}) {
  const entry = cityEntry(cityId);
  if (!entry) return 'soon';
  if (cityId === current) return 'here';
  if (entry.status === 'playable') return 'enter';
  return entry.legacy && held.includes(cityId) ? 'preview' : 'soon';
}

/** Longitude/latitude → flat map units for one country: x east, y south, the country fitted into `width`. */
export function projector(countryId, width = 1000) {
  const outline = COUNTRIES[countryId].outline;
  const lons = outline.map((point) => point[0]), lats = outline.map((point) => point[1]);
  const west = Math.min(...lons), east = Math.max(...lons), south = Math.min(...lats), north = Math.max(...lats);
  const scale = width / (east - west);
  return { width, height: (north - south) * scale, point: (lon, lat) => [(lon - west) * scale, (north - lat) * scale] };
}
