/**
 * The Overpass queries the detail recipes share. A recipe passes the play box (`bbox` is "south,west,north,east") and, where the
 * city needs it, the filters that differ. Every answer is cached by query text (overpass.ts), so a query is asked once.
 */

/** Named places worth a game venue: public buildings, sights and the neighbourhood points that label the ground. A broad filter asks for the English name or the local one; a narrow one also needs a Wikidata entry. */
export function placesQuery(bbox: string): string {
  const broad = ['["amenity"~"^(university|college|hospital|marketplace)$"]["name"]', '["leisure"="stadium"]["name"]', '["tourism"="museum"]["name"]', '["railway"="station"]["name"]', '["shop"="mall"]["name"]', '["amenity"~"^(townhall|courthouse)$"]["name"]', '["amenity"~"^(restaurant|cafe)$"]["name"]', '["place"~"^(suburb|neighbourhood|quarter)$"]["name"]'];
  const narrow = ['["amenity"="place_of_worship"]["wikidata"]["name"]', '["historic"]["wikidata"]["name"]', '["tourism"~"^(attraction|zoo|theme_park|viewpoint)$"]["name"]', '["leisure"="park"]["wikidata"]["name"]', '["man_made"="tower"]["name"]["wikidata"]'];
  return `[out:json][timeout:180][bbox:${bbox}];(\n${[...broad, ...narrow].map((filter) => `nwr${filter};`).join('\n')}\n);out center tags;`;
}

/** The land-use areas whose centres mark the built-up extent. */
export const landuseQuery = (bbox: string): string => `[out:json][timeout:120][bbox:${bbox}];(way["landuse"~"^(residential|commercial|industrial|retail|institutional|education|military|cemetery|religious)$"];relation["landuse"~"^(residential|commercial|industrial|retail)$"];);out center;`;

/** Motorway, trunk and primary roads of the box, plus named secondary roads in the core. */
export const roadsQuery = (bbox: string, core: string): string => `[out:json][timeout:120];way["highway"~"^(motorway|trunk|primary)$"](${bbox});out geom tags;way["highway"="secondary"]["name"](${core});out geom tags;`;

/** Lakes, reservoirs and rivers mapped as areas, and river banks. */
export const inlandWaterQuery = (bbox: string): string => `[out:json][timeout:120];(relation["natural"="water"]["water"~"^(lake|reservoir|river|lagoon|basin)$"](${bbox});way["natural"="water"]["water"~"^(lake|reservoir|river|lagoon|basin)$"](${bbox});relation["waterway"="riverbank"](${bbox});way["waterway"="riverbank"](${bbox}););out geom;`;

/** What the first query leaves out: bus and rail stations, squares, every named park, large places of worship and government buildings. */
export function extrasQuery(bbox: string): string {
  const filters = ['["amenity"="bus_station"]["name"]', '["public_transport"="station"]["name"]', '["railway"~"^(station|halt)$"]["name"]', '["place"="square"]["name"]', '["leisure"="park"]["name"]',
    '["amenity"="place_of_worship"]["name"]["building"~"^(cathedral|mosque|basilica|temple|synagogue)$"]', '["amenity"="place_of_worship"]["name"]["wikipedia"]',
    '["office"="government"]["name"]', '["building"="government"]["name"]', '["amenity"~"^(parliament|conference_centre|library)$"]["name"]', '["amenity"="theatre"]["name"]'];
  return `[out:json][timeout:180][bbox:${bbox}];(\n${filters.map((filter) => `nwr${filter};`).join('\n')}\n);out center tags;`;
}

const INLAND = '^(lake|reservoir|river|lagoon|basin)$';

/**
 * Water of a city on a big lake whose relation is too large to fetch whole: the lake's own shore ways that touch the box (a way holds at
 * most 2,000 points, so the answer stays small), then the other lakes, reservoirs and river banks as areas. The lake is found by name.
 */
export const lakeWaterQuery = (bbox: string, lake: string): string => `[out:json][timeout:180];relation["natural"="water"]["name"~"${lake}"](${bbox})->.lake;way(r.lake)(${bbox});out geom;(relation["natural"="water"]["water"~"${INLAND}"]["name"!~"${lake}"](${bbox});way["natural"="water"]["water"~"${INLAND}"](${bbox});relation["waterway"="riverbank"](${bbox});way["waterway"="riverbank"](${bbox}););out geom;`;

/** Water of a coastal city: the coastline ways that touch the box (land on the left), then lakes, river banks and estuaries as areas. */
export const coastWaterQuery = (bbox: string): string => `[out:json][timeout:180];way["natural"="coastline"](${bbox});out geom;(relation["natural"="water"]["water"~"${INLAND}"](${bbox});way["natural"="water"]["water"~"${INLAND}"](${bbox});relation["waterway"="riverbank"](${bbox});way["waterway"="riverbank"](${bbox}););out geom;`;
