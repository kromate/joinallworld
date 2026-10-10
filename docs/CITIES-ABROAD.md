# Cities abroad

Fifteen cities outside Nigeria are open: Yaoundé, Lomé, Accra, Nairobi, Algiers, Cotonou, Abidjan, Dakar, Cape Town, Addis Ababa, Cairo, Rabat, Kigali, Kampala and Lusaka. Each opened as a bounded starter: a real arrival airport and a small, generic set of game venues. Cairo is the first to receive full map detail. This page says what a starter holds, what the detailed tier holds, and how to move another city across.

## The starter tier is deliberate

[The playable Africa packet](../world/playable-africa/README.md) states it: "It does not represent complete city or national coverage", and "Deeper streets, real landmarks, regional conditions and additional cities can arrive incrementally after countries become usable." The second wave adds: "Full administrative geometry remains separate from the synthetic starter play zone." A starter has one local unit, `centre` ("Starter play zone"), a land outline that is the sampled window itself (a rectangle), about 660 m of central streets and building boxes, and ten venues named "… (game venue)".

## What differs from a Nigerian city

| Feature | Nigerian city (for example Ibadan, Abuja, Kano) | Starter foreign city | Cairo now |
|---|---|---|---|
| Outline | Real local-government polygons from geoBoundaries, shared borders (`src/map3d/geo/data/*.ts`) | One rectangle, the sampled window (`<city>/geometry.ts`) | Built-up extent traced from mapped land use, the Nile cut out of it |
| Districts / units | 6 to 20 local units, 5 to 14 rented-home districts (`rules.ts`) | One unit and one district, "Starter play zone" | One unit, "Greater Cairo"; neighbourhood names on the ground |
| Roads | 25 to 600 main roads from OpenStreetMap (`roads.ts`) | About 70 to 160 street pieces in a 660 m window | 700 main roads over the whole play area |
| Water and rail | Rivers, lakes, rail lines (`water.ts`, `rail.ts`, `formula` files) | None (`water: []`) | The Nile with its islands |
| Venues | 25 to 30, real named places with sourced coordinates, districts and prose (`content.ts`, `landmarks.ts`) | 10 generic "(game venue)" entries on one point grid | 16 real places, each with its OpenStreetMap element |
| Names and prose | City-written descriptions, regulars, culture card | Neutral shared prose | Real names; prose still the shared neutral game text |
| Source record | Pinned research caches, spec, `--check` | A receipt of the sampled window | Header of each generated file with the Overpass answer hashes |
| Size of city data | About 90 KB of TypeScript plus 15 to 190 KB of shared state geometry | About 90 KB (mostly sample buildings) | About 70 KB, loaded only with the city map and content |

## How a detailed foreign city is built

Everything stays inside the existing destination factory (`src/game/cities/africa/`). Nothing is added to the first download: the places load with the city's content chunk, the outline, water and roads with its map chunk.

1. Choose the play box and the dense core in `scripts/geo/destination-detail/<id>.ts` (copy `cairo.ts`). Write the discovery queries: named venues with a Wikidata tag (universities, hospitals, stadiums, museums, mosques or churches, stations, markets, malls, parks, historic sights) and suburb or neighbourhood points.
2. Run `ALLWORLD_GEO_CACHE=<directory outside the repository> node --experimental-strip-types scripts/geo/build-destination-detail.ts <id>` once to fetch and cache the answers. The tool asks one request at a time, 30 seconds apart, retries with longer waits, caps an answer at 12 MiB and names each cache file after its query. It makes four to five requests per city: places, water, land use and roads. Do not repeat a failing query in a loop.
3. List the answers' candidates (name, kind, Wikidata) from the cache and fill `places` with one OpenStreetMap element per game venue slot: `transit`, `meal`, `community` (a university or a business with a staff area), `clinic`, `recreation`, `market`, `worship`, `polling`, `government`, plus extra sights (`key`) of kinds `quad`, `viewing`, `walk`, `hilltop` or `mall`. Names and points are read from the element; the district is the nearest labelled neighbourhood within a kilometre. Never type a name or a point from memory. A slot with no honest real place keeps its generic game venue; leave it out.
4. Choose the neighbourhood labels (`names`) and the cutoffs (`cell`, `grow`, `minRoadKm`, `maxRoads`). Run the build again; it writes `places.ts`, `geometry.ts` and `terrain.ts`.
5. In `facts.ts` set `bounds`, `coverageNote`, the state name, and `names` (`area`, `unit`, `roadHub`, where `roadHub` equals the transit place's name). Keep the city id, airport and every venue id. The generic slot venues keep their ids, spots and activities, so saved lives and goals still resolve; only the name, point and description change.
6. In `content.ts` pass `PLACES` to `buildDestinationContent(FACTS, PLACES)`; in `map.ts` pass `TERRAIN` to `createDestinationMap`. Run `npm run cities:catalogue`, update the five asset pins and the state name in `world/playable-africa-rollout/receipts/<id>.json`, then run `python3 scripts/world/check-playable-africa-rollout.py <id>`, and copy `cairo/map.test.ts` and `cairo/journey.test.ts`.
7. Check: the city's tests, the city contract and catalogue tests, `npm run typecheck`, then one build with `npm run size:download` to confirm the first download is unchanged.

The land outline is a sketch at the grid's size (about 50 m after tracing) and says so in its file header. It is not an administrative boundary; where an administrative boundary of the right level exists and covers only the built-up area, prefer it.

## Estimates per remaining city

These are estimates, not measurements; only Cairo has been done. Each city needs four to five Overpass requests (the public interpreter often answers 504 for several minutes, so allow waiting), one pass of choosing places from the candidate list, and the tests. The work is mostly choosing places honestly.

| City | Expected effort | Note |
|---|---|---|
| Kigali, Kampala, Lusaka, Rabat | 3 to 4 hours each | Do first; smaller mapped coverage, so some slots may stay generic |
| Accra, Nairobi, Algiers, Abidjan, Dakar, Cape Town, Addis Ababa | 3 hours each | Dense mapping; Cape Town and Dakar have a coastline, so the water query and the shore handling need a sea polygon, not a river |
| Yaoundé, Lomé, Cotonou | 4 hours each | Thin Wikidata tagging; relax the discovery filters and read more candidates |

Coastal cities need one addition: a sea or lagoon polygon from OpenStreetMap coastline data, which the Nile recipe does not cover.
