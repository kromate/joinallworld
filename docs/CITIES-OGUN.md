# Ogun State city modules

Ogun State opens four city modules on one shared state outline: Abeokuta, Ota, Ijebu-Ode and Sagamu. Each city renders only its selected local governments. The state overview retains all 20 local-government features and labels the nine unopened areas as coming.

| City | Open local governments |
|---|---|
| Abeokuta | Abeokuta North, Abeokuta South, Odeda, Obafemi/Owode |
| Ota | Ado Odo/Ota |
| Ijebu-Ode | Ijebu Ode, Ijebu North East, Odogbolu |
| Sagamu | Sagamu, Ikenne, Remo North |

Ewekoro, Ifo, Ijebu East, Ijebu North, Imeko/Afon, Ipokia, Ogun Water Side, Yewa North and Yewa South remain visible as coming areas. Olabisi Onabanjo University at Ago-Iwoye is correctly shown in coming Ijebu North. Funmilayo Ransome-Kuti Station at Papalanto is a state reference in Ewekoro; current NRC material confirms freight use, so the game does not present it as an active passenger boarding point.

## City content

Every opened city has at least 15 public places, two distinct local regulars per place, all canonical careers, free Home recovery, paid and free clinic care, polling and government venues, worship, markets, food, recreation and culturally appropriate evening activity. Public landmarks use sourced longitude and latitude. Fictional shops, clinics, parks and civic setups are labelled beta and placed only at licensed city or landmark anchors.

Abeokuta includes Olumo Rock climbing, an adire-dye activity at Itoku, Ake palace and Centenary Hall, the presidential library, FUNAAB, MKO Abiola Stadium, the Ogun River and Lafenwa Bridge, Kuto and Professor Wole Soyinka Station. Its Lisabi calendar row is an explicitly simulated game edition.

Ijebu-Ode includes a fictional beta city-level heritage gathering that explains Ojude Oba and regberegbe, plus TASUED at Ijagun and Dipo Dina Stadium. Its calendar row says it is a beta game edition on a fixed game date; the real Ojude Oba follows Eid al-Kabir. No exact open coordinate for the real palace forecourt or festival ground has been verified, so the city reference visibly states that limitation.

Sagamu includes Babcock University, Sagamu Interchange and an Ikenne heritage route. Mayflower School is a sourced overlay. The Obafemi Awolowo residence remains a heritage identity that requires an open exact point before a dedicated marker is shipped.

Ota includes Covenant University, Bells University, Sango-Ota transport and market play, and an industry interpretation. Cross-border commuting into Lagos remains a proposal. The modules implement ordinary intercity travel only.

## Travel

All fares and simulated durations are beta game values:

| Link | Mode | Fare | Duration |
|---|---|---:|---:|
| Lagos–Ota | road | ₦2,000 | 26 seconds |
| Lagos–Abeokuta | road | ₦3,500 | 29 seconds |
| Lagos–Abeokuta | rail | ₦7,000 | 19 seconds |
| Ota–Abeokuta | road | ₦2,500 | 27 seconds |
| Abeokuta–Ibadan | road | ₦3,000 | 28 seconds |
| Abeokuta–Ibadan | rail | ₦4,000 | 19 seconds |
| Abeokuta–Sagamu | road | ₦2,500 | 27 seconds |
| Ota–Sagamu | road | ₦2,500 | 28 seconds |
| Sagamu–Ijebu-Ode | road | ₦1,500 | 27 seconds |

Local travel offers Trek, Okada, Bus and Taxi. Fares, durations, needs and roadside-event chances are beta.

## Data and licences

State and local-government geometry comes from geoBoundaries gbOpen Nigeria ADM1 and ADM2 release `9469f09`, originally GRID3, under CC BY 4.0. The Ogun state and Lagos state polygons share the same generated topology seam.

Landmark points use OpenStreetMap under ODbL 1.0, Wikidata structured data under CC0, Wikimedia Commons structured coordinates under CC0 with image licences recorded separately, and published coordinate facts. Each point records its URL, licence and accuracy class in the Ogun landmark catalogue.

The Lagos–Abeokuta train line reuses the pinned OSM Lagos–Ibadan SGR relation extraction. It follows source vertices to the Abeokuta approach, then records one schematic final segment to the mapped Professor Wole Soyinka Station point. The source response hash and station object are retained with the lazy route chunk.

Primary references include the [Ogun State 2024 local-government report](https://new.ogunstate.gov.ng/archive/), [Federal station naming notice](https://fmino.gov.ng/buhari-names-railway-stations-after-prominent-nigerians/), [NRC Papalanto freight notice](https://nrc.gov.ng/2026/01/28/nrc-among-10-contributors-to-nigerias-gdp-unveils-plans-to-adopt-lng-for-train-operations/), [OOU main-campus page](https://main.oouagoiwoye.edu.ng/campuses/main/), [official Ojude Oba festival description](https://ojudeoba.com/festival/) and [TASUED official site](https://tasued.edu.ng/).

## Beta values

Beta content includes all land tiers, rents, move-in charges, local-mode values, intercity fares and times, activity costs and effects, local career placements, fictional venue placement, event schedules, billboard slots, table placements, calendar dates, dream wording and family wording. These values are game design and do not claim to be current market prices or official schedules.

## Roads and rivers

`src/game/cities/ogun/roads.ts` (`OGUN_ROADS`) and `src/game/cities/ogun/water.ts` (`OGUN_WATER`) are generated from OpenStreetMap through the public Overpass interpreter by `scripts/geo/build-ogun-roads.ts` and `scripts/geo/build-ogun-water.ts` (ODbL 1.0; the response SHA-256 is in each file header and in `src/models/geo/provenance.json`). They use the same compact row format as the Ibadan files and are not wired into the city map packs by these files themselves.

- Roads: motorway, trunk and primary ways in the box 6.45, 2.85, 7.5, 4.1 (south, west, north, east), which covers the four play areas and the corridors between them (Lagos–Abeokuta, Lagos–Ibadan, Abeokuta–Sagamu, Sagamu–Ijebu-Ode–Benin, Ota–Idiroko), plus named secondary ways in the Abeokuta, Ota, Ijebu-Ode and Sagamu town cores. A way is kept when one vertex lies inside the Ogun State outline. Each row is `[name, major (1/0), first longitude and latitude in 0.0001 degrees, then longitude and latitude steps to every next vertex]`.
- Water: named river ways (Ogun, Lafenwa, Yewa, Ona, Ibu, Omi, Ofe, Majidun Creek; lines) and named closed water ways (the Ogun-Osun reservoir and the Ologe lagoon; rings) in the same box. Each row is `[name, "river" or "lake", first longitude and latitude in 0.0001 degrees, then steps]`. Multipolygon water (the Lagos, Lekki and Epe lagoons, Badagry Creek) is not included, because the shared state outline already treats water as the gap between land polygons.

## Coordinate checks

Reference points were compared with OpenStreetMap, Wikidata and Wikimedia Commons structured coordinates. The Sagamu interchange sits where the Lagos–Ibadan Expressway motorway links meet the Abeokuta–Sagamu road, not at the F102 roundabout it used before. Venues carry their own points: real mapped places where they exist (the stadium, the markets, the Ake palace and hall, the teaching hospital, the state government hospital, a general hospital), otherwise a street-level spot in the named district. District text follows the local government that the source outline puts at the point (for example Olumo Rock and Ake are in Abeokuta South, Oke Mosan is in Obafemi/Owode, and the old Ijebu-Ode town centre falls inside the Odogbolu outline). `src/map3d/geo/ogun-borders.test.ts` checks the shared Lagos and Oyo borders, the 20 local-government names, venue footprints and the reference points.
