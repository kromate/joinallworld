# Cities abroad

Fifteen cities outside Nigeria are open: Yaoundé, Lomé, Accra, Nairobi, Algiers, Cotonou, Abidjan, Dakar, Cape Town, Addis Ababa, Cairo, Rabat, Kigali, Kampala and Lusaka. Each opened as a bounded starter: a real arrival airport and a small, generic set of game venues. Cairo, Kigali, Kampala, Rabat and Lusaka have received full map detail. This page says what a starter holds, what the detailed tier holds, and how to move another city across.

## The starter tier is deliberate

[The playable Africa packet](../world/playable-africa/README.md) states it: "It does not represent complete city or national coverage", and "Deeper streets, real landmarks, regional conditions and additional cities can arrive incrementally after countries become usable." The second wave adds: "Full administrative geometry remains separate from the synthetic starter play zone." A starter has one local unit, `centre` ("Starter play zone"), a land outline that is the sampled window itself (a rectangle), about 660 m of central streets and building boxes, and ten venues named "… (game venue)".

## What differs from a Nigerian city

| Feature | Nigerian city (for example Ibadan, Abuja, Kano) | Starter foreign city | Detailed foreign city (Cairo, Kigali, Kampala, Rabat, Lusaka) |
|---|---|---|---|
| Outline | Real local-government polygons from geoBoundaries, shared borders (`src/map3d/geo/data/*.ts`) | One rectangle, the sampled window (`<city>/geometry.ts`) | Built-up extent traced from mapped land use, water cut out of it, with a plain ground colour round it so the old square never shows |
| Districts / units | 6 to 20 local units, 5 to 14 rented-home districts (`rules.ts`) | One unit and one district, "Starter play zone" | One unit, "Greater Cairo"; neighbourhood names on the ground |
| Roads | 25 to 600 main roads from OpenStreetMap (`roads.ts`) | About 70 to 160 street pieces in a 660 m window | 190 to 700 main roads, cut a short way past the outline |
| Water and rail | Rivers, lakes, rail lines (`water.ts`, `rail.ts`, `formula` files) | None (`water: []`) | Rivers, lakes, a lake shore or a sea coast (Lake Victoria at Kampala, the Atlantic at Rabat), carried on to the edge of the ground |
| Venues | 25 to 30, real named places with sourced coordinates, districts and prose (`content.ts`, `landmarks.ts`) | 10 generic "(game venue)" entries on one point grid | 16 to 25 real places, each with its OpenStreetMap element |
| Names and prose | City-written descriptions, regulars, culture card | Neutral shared prose | Real names; prose still the shared neutral game text |
| Source record | Pinned research caches, spec, `--check` | A receipt of the sampled window | Header of each generated file with the Overpass answer hashes |
| Size of city data | About 90 KB of TypeScript plus 15 to 190 KB of shared state geometry | About 90 KB (mostly sample buildings) | About 70 KB, loaded only with the city map and content |

## How a detailed foreign city is built

Everything stays inside the existing destination factory (`src/game/cities/africa/`). Nothing is added to the first download: the places load with the city's content chunk, the outline, water and roads with its map chunk.

1. Choose the play box and the dense core in `scripts/geo/destination-detail/<id>.ts` (copy the recipe nearest to the city: `kigali.ts` for an inland city, `kampala.ts` for one on a big lake, `rabat.ts` for one on the sea, `lusaka.ts` for a small mapped one). The box must hold the airport and leave at least 0.008 degrees (about 900 m) between every chosen place and its edge; the builder refuses a place nearer the edge. The shared queries are in `queries.ts`: named places, an extras query (bus and rail stations, squares, parks, large places of worship, government buildings), land use, roads and the water recipes.
2. Run `ALLWORLD_GEO_CACHE=<directory outside the repository> node --experimental-strip-types scripts/geo/build-destination-detail.ts <id>` once to fetch and cache the answers. The tool asks one request at a time, 30 seconds apart, retries with longer waits, caps an answer at 12 MiB and names each cache file after its query. It makes five requests per city: places, extras, water, land use and roads. Do not repeat a failing query in a loop; the public server often answers 504 for several minutes, so leave the build to wait.
3. List the answers' candidates (name, kind, Wikidata) from the cache and fill `places` with one OpenStreetMap element per game venue slot: `transit`, `meal`, `community` (a university or a business with a staff area), `clinic`, `recreation`, `market`, `worship`, `polling`, `government`, plus extra sights (`key`) of kinds `quad`, `viewing`, `walk`, `hilltop`, `worship` or `mall`. Add every well mapped sight you can tie to an element (16 to 25 places per city so far). Names come from the element (the English name, else the French one, else the local one); points are read from it; the district is the nearest labelled neighbourhood within two and a half kilometres. Never type a name or a point from memory. A slot with no honest real place keeps its generic game venue; leave it out.
4. Choose the neighbourhood labels (`names`), the cutoffs (`cell`, `grow`, `shore`, `minRoadKm`, `maxRoads`, `roadMarginDegrees`) and the `surround` colour (the countryside round the outline; the builder writes it into `terrain.ts`). Water: an inland city uses `inlandWaterQuery`; a city on a big lake uses `lakeWaterQuery` and `sea: { kind: 'lake', bandMetres }`; a coastal city uses `coastWaterQuery` and `sea: { kind: 'coast', bandMetres }`. The shore ways are drawn as a barrier on a grid, and a region is land where a known place lies in it, so a shore needs no direction. Set `shore: 0` where the water is long and thin. Run the build again; it writes `places.ts`, `geometry.ts` (outline) and `terrain.ts` (`water` inside the play area, `reachWater` carried on to the edge of the drawn ground, roads cut a short way past the outline, labels, surround colour).
5. In `facts.ts` set `bounds`, `coverageNote`, the state name, and `names` (`area`, `unit`, `roadHub`, where `roadHub` equals the transit place's name). Keep the city id, airport and every venue id. The generic slot venues keep their ids, spots and activities, so saved lives and goals still resolve; only the name, point and description change.
6. In `content.ts` pass `PLACES` to `buildDestinationContent(FACTS, PLACES)`; in `map.ts` pass `TERRAIN` to `createDestinationMap`. Run `npm run cities:catalogue`, update the five asset pins and the state name in `world/playable-africa-rollout/receipts/<id>.json`, then run `python3 scripts/world/check-playable-africa-rollout.py <id>`, and copy `kigali/map.test.ts` and `kigali/journey.test.ts`.
7. Check: the city's tests, the city contract and catalogue tests, `npm run typecheck`, then one build with `npm run size:download` to confirm the first download is unchanged.

The land outline is a sketch at the grid's size (about 40 m after tracing) and says so in its file header. It is not an administrative boundary; where an administrative boundary of the right level exists and covers only the built-up area, prefer it. The ground outside the outline is drawn in the `surround` colour all the way out, so the old square of a starter never shows.

## Estimates for the remaining cities

Five cities are done (Cairo, Kigali, Kampala, Rabat, Lusaka). Measured on those: about one hour of hands-on work per city once the shared tools exist (reading the candidate lists, choosing places, the tests), plus waiting for the public map server, which answered 504 for 5 to 40 minutes at a time; plan 45 to 90 minutes of wall clock per city for the five requests. The work is mostly choosing places honestly.

| City | Expected effort | Note |
|---|---|---|
| Accra, Nairobi, Algiers, Abidjan, Addis Ababa | 1.5 to 2 hours each | Dense mapping; Cape Town and Dakar have a coastline, so they use the coast recipe |
| Cape Town, Dakar | 2 hours each | Coast recipe (`rabat.ts`) |
| Yaoundé, Lomé, Cotonou | 2 to 3 hours each | Thin Wikidata tagging; relax the discovery filters and read more candidates; Lomé and Cotonou are on the sea |
