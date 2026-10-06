# City modules

A playable city is one folder under `src/game/cities`. The folder exports one `CityModule`: eager rules needed for validation and prices, a lazy content loader, and a lazy map loader. Lagos is the reference module. The current open cities are Lagos, Ibadan, Abeokuta, Ota, Ijebu-Ode, Sagamu, Port Harcourt, Abuja and Kano.

## Catalogue states

The registry distinguishes three questions.

- `isKnownCityId` accepts every city named by the atlas and compatibility layer.
- `isCityId` accepts cities whose stored lives the server may read. This currently includes the nine open city modules.
- `isOpenCityId` accepts cities that can receive a new life or a trip. This currently includes Lagos, Ibadan, Abeokuta, Ota, Ijebu-Ode, Sagamu, Port Harcourt, Abuja and Kano.

Kaduna is the one closed preview: it is on the atlas, at the end of the Abuja railway, and cannot be travelled to. Ibadan is an authored module (`src/game/cities/ibadan`). Lives that earlier builds filed under its key are read by that module: their venue ids resolve through `legacyVenueAliases`, and the owner chooses a local government once, for free (`legacyLgaChoice`).

`registeredCityIds()` returns server-known ids. `playableCityIds()` returns open modules. Callers should choose the list that matches the action instead of treating an atlas label as permission to create a life.

## Contract

`CityModule<City, State, LocalUnit, District, Hub>` ties a city's id to its authored child ids. Its `rules` object is the small synchronous metadata boundary used by validation, housing prices and travel. The initial loading screen does not import the engine or city content. The prose and gameplay catalogue in `CityContent` loads only when a host enters or previews the city. Map metadata is a separate lazy chunk.

Rules provide:

- city, state and country identity;
- timezone and the shared-frame map origin;
- `defaultName`, the name of a life that has none yet (a city that does not say gets 'New Lagosian');
- a separate atlas marker, teaser and preview text;
- a map pack that may carry `character` (ground tint, roofs, hills, water, rail, landmark icons) and `extent` (the name of the whole-extent view);
- the city's name for its local units, plus local-unit land tiers;
- rented-home districts and the local unit each belongs to;
- road, air and rail hubs;
- symmetric links to other known cities.

Content provides the venue scene kind, existing activity definition, opening hours, display wording and position; regulars and their city; career workplaces; rented homes and their map spots; calendar entries; goal and wish wording; radio venues; billboard roads; table places; a ranked things-to-do list; and a short culture card.

Local-unit rules contain identities, geography categories and prices only. Every content module supplies `localUnitDescriptions` keyed by its complete local-unit list. Engine price and address helpers work without prose; estate views, local-government panels and map packs attach descriptions after the city content loads.

Dream and family-outcome wording can be localized through `dreamWording` and `lotteryWording`. These fields change labels, guidance and explanatory bullets only; IDs, targets, loans, cash, skill effects and rewards remain shared mechanics. Check the onboarding cards, profile, goals and completion messages when authoring these overrides.

`homePalette` (`{ back, left, floor: [a, b] }`, as #rrggbb) gives the rooms of that city's homes their own wall and floor colours; Lagos names none and keeps the shared room colours. It is city data only and never enters a stored life. `carNicknames` replaces the shared nickname of any car (label, price and speed stay shared). `defaultName` is a rules field (above). A venue's scene is its `kind`, optionally refined by `variant`; a scene's `camera` may carry `start`, a factor on how far back the view begins. Dream and family-outcome wording can be localized through `dreamWording` and `lotteryWording`. These fields change labels, guidance and explanatory bullets only; IDs, targets, loans, cash, skill effects and rewards remain shared mechanics. Check the onboarding cards, profile, goals and completion messages when authoring these overrides.

Travel visits and activity cooldowns are keyed by city outside Lagos; existing bare Lagos keys remain readable. Bounded references to an unloaded origin survive reload without loading its prose. Loaded catalogues validate the referenced IDs and cooldown duration. Daily earning and roadside-event caps remain global. The last local route and an unanswered roadside choice are transient and clear when the character changes city.

The engine remains synchronous after startup. A host first awaits `loadCityContent(id)`, then reads `cityContent(id)`. Reading an unloaded city's content throws. `cachedCityContent(id)` is the non-throwing probe. Map hosts use the equivalent `loadCityMap` and `cityMap` pair.

The browser, servers, tests and command-line tools must cross this loading boundary before calling `createLife`. The shared engine never imports another city's venue or regular catalogue as a fallback. Lagos definitions live in `src/game/cities/lagos/venues.ts` and `regulars.ts`; import them directly only when inspecting that city's source data. A friend's bounded identity snapshot travels with the character, so loading a destination does not require the previous city's prose.


## State, city and local unit

A state owns one or more cities. A life belongs to one local unit in one city. The `unit` text is data, so Abuja can use "area council" while other places use "local government". Rented-home districts sit below a city and point to their local unit.

The state map is the travel and overview surface. `CityMapGeometry.state` is its full first-level outline and may be shared by several city modules. `playArea` is the part opened by one city; that city's local units and local water tile only this footprint. The city map is the play surface with venues, homes and those local units. Both use the same projection and whole-unit origin, so a city footprint can be placed back into its state without a second coordinate system. A city never claims that its local units cover the rest of the state.

Map geometry follows the equirectangular Nigeria frame: 8 degrees east and 9 degrees north as the frame origin, 9 degrees north as the standard parallel, x east, z south, and ten units per kilometre. Lagos is anchored at 3.40 degrees east, 6.45 degrees north, which projects to `{-5052, 2835}` after whole-unit rounding. The atlas marker remains at 3.38 degrees east, 6.52 degrees north; the marker and geometry anchor serve different views. Its geometry source is the generated geoBoundaries gbOpen Lagos topology, licensed CC BY 4.0 and attributed in `NOTICE.md`. `loadGeometry` decodes that topology and `loadScene` imports the existing renderer pack. Both stay behind the lazy map chunk.

### How the state view and the city maps relate

- The atlas (Nigeria level) is the state view. A state with several open cities names each of them on the map; the city the player is in carries "You are here", the others "Open", and a state's own marker never claims the player is there. Labels collide-check by priority; only the player's city is always shown.
- Selecting such a state opens its card: one 44px chip per city, then the state's own map (`src/map3d/geo/state-overview.ts`): every local government of the state in the shared projection, open cities as pins, the unopened local governments grey and labelled "coming", and the travel links between cities (including those that leave for a city in another state, such as Lagos or Ibadan) as lines, dashed for rail. Tapping a pin selects the city; tapping a line or a row shows its mode, fare, time and distance. The overview loads with the state's map chunk when the card opens.
- Choosing a city (its dot, its name, a pin of the state view or its chip) shows its travel card: its name and one line about it, then one button per way there, cheapest first, each with its price and its seconds ("Bus · ₦14,000 · 59 s"). One tap on a way leaves; a fare above half the cash in hand asks once, in place (`TRAVEL_CONFIRM_SHARE`, `src/map3d/geo/travel-card.ts`). A way that cannot leave says why: what stops every way alike is said once above them, a fare that cannot be paid names the amount missing. "Things to do in <city>" (the content's `thingsToDo`, fetched when the card opens) and the routes with their preview are folded under it.
- The Map's level bar (World › Africa › Nigeria › the city) is on the city map itself and is the atlas's own breadcrumb on the atlas, so every level is one tap from the Map (`G` opens the world). A tap on an open country from further out goes straight in to its cities. A state with several open cities, tapped on the map, is flown to and names its cities; a tap on a city's dot is that city whichever state's ground is under the finger.
- A city map shows only its own local governments and play area, with the land around it drawn quiet: neighbouring states and countries, the sea, and the roads that leave. The whole-extent button names the city, not the state. The two views share one projection and origin, so a city's footprint lies exactly on the state view.
- On a phone the folded card keeps the city chips and leaves the map in view; "Routes and details" unfolds the state map.
- Per-city map character, roads and water for Ogun live in `src/game/cities/ogun/{character,scene}.ts`, clipped per city from the OpenStreetMap files; they load only with that city's map.

## Adding a city

1. Add one folder with rules, content and a lazy map loader. Keep generated, licensed geometry behind that loader. Links belong to the module; the registry combines both directions. Every provisional fare carries `beta: true`. A link is written with `timedLink({ …, mode, km })`: its `seconds` come from the one timetable (`INTERCITY_TIME` in `src/game/content/travel.ts`), never from a number of its own.
2. Register the module once in `MODULES`. Its metadata supplies names, server validation, atlas markers, local units and travel without another city table. A module supersedes reserved closed-city metadata.
3. Add its contract and journey tests. `cityContractTest(module)` checks the built scene registry, career coverage, goal and wish references, and both directions of every live registry link. It decodes the real polygons, proves that multi-unit data contains exact shared border segments, samples the union extent to ensure local units and local water tile `playArea`, checks that the footprint lies inside `state`, detects overlap and outside geometry within stated tolerances, and checks the shared-frame round trip. This is a bounded topology check, not a formal GIS proof that every possible neighbouring edge is complete. Host tests register the fictional modules before starting the host and await their content loaders.

The small fictional modules use `{ profile: 'test-fixture' }`, which skips only the full-city venue-kind minimum. The profile is refused for an id that does not start with `test-`; an opened module cannot use it. The negative contract suite holds broken examples for missing shared borders, overlaps, state coverage gaps, missing scene builders, incomplete career declarations, broken goal and wish references, and links that disagree with the registry.

A completed journey starts a new life, settles, works and travels out and back. Saved lives retain cash, needs, skills, friends and every home they hold. Tests keep the previous source city on jobs and require the player to choose a local workplace before working after travel (one action, `apply-job` for the held track, at most once a day; the level is kept).

## How long a trip takes

`INTERCITY_TIME` holds the whole timetable. By road a trip takes `24 + km × 45/970` seconds, kept between 25 and 75 (Lagos–Ibadan 30 s, Lagos–Kano 75 s); a train takes two-thirds of the road time for its distance; a flight takes `10 + km/85` seconds, kept between 12 and 20. `INTERCITY_TIME.scale` multiplies every one of them and is the one number to tune. The price of skipping a trip (`TRIP_SKIP`) is ₦100 plus ₦40 for each second left, divided by the scale, so a whole trip costs the same to skip whatever the scale; it is never more than half the fare, the first skip of a character is free, and nothing is sold with under three seconds left. A trip inside a city takes at most `LOCAL_TRIP_CAP_SECONDS` (15), so none is long enough to be sold a skip. A trip saved in progress under an earlier, longer timetable finishes on the clock it left with.

## What a city module also says

`rules.campus` names the campus a city carries (`'unilag'` for Lagos). The campus rules and scene load on demand and exist only for a city that names one: its volunteering activity and its gate (`src/campus/unilag/volunteer.ts`, `hasCampus`) read the module, not a city id. The browser registers campus stand-ins until the rules are fetched (`src/game/campus-gate.ts`); a life in a city with no campus never needs them.

The character creator's list of places is read from the registry (`placesFrom` in `src/app/features/start/placesModel.ts`): a reserved city appears under its state as "coming" without another table, and opens when a module replaces the reservation. Ibadan, Abuja, Port Harcourt, Abeokuta and Kano are reserved today.

The loading screen, the game shell and a city's content are separate downloads. The registry's rules (ids, prices, units, links) are eager; Lagos content is assembled in the engine chunk because the engine reads it synchronously, and any other module's content and map are their own chunks, fetched after the loading screen paints. The sizes are guarded by `src/app/entry.test.ts`.

## A visitor is never stuck

A character in a city where it has no home can always recover, earn and get home, whatever it has spent. The numbers are in `src/game/content/relief.ts` (the two thresholds of the card are with it, in `src/app/features/relief/reliefHelp.ts`); the rules are in `src/game/relief.ts` and `systems/estate.ts`.

- **Ride home on credit** (`estate.relocate { to, mode, credit: true }`). Offered to a visitor whose cash is below the cheapest fare to the MAIN home, and only to that city by that way. The fare is advanced straight into the ticket (two ledger lines, no spending money is handed over) and becomes `state.travel.rideDebt`, the one optional field this adds (absent when nothing is owed, so a saved life is unchanged). Half of every wage, gig, stall collection and gift received goes to it as a ledger line (`Ride home repaid`) until it is paid; `travel.repay-ride` pays it from cash. One debt at a time. While it stands no other trip between cities starts, the trip cannot be skipped (so the free first skip cannot be combined with it), and the main home cannot be moved nor a second home bought. A guest who has not settled in cannot travel at all, credit or not.
- **Odd jobs, a bench and a tap.** Three ordinary activities placed on the first spot of each city's public arrival place (`publicArrivalVenue`), open at every hour, with no minimum needs. Odd jobs pay a little, only below a cash limit, with a break between jobs shared by every city, and count as paid gigs (the daily gig limit). The bench and the tap are free, only for someone whose Energy or Hunger is below 60, with a break.
- **Where a ticket lands.** A visitor who arrives by a flight lands at the airport venue, by road at the motor park or terminal, by rail at the station (`ticketArrivalVenue`: the venue the city names for that hub, if it has one and it is open to everyone at that moment), and otherwise at the public arrival place. A resident arriving at a house of their own lands at Home; a ping or an invite lands beside the friend. The nets above stay at the public arrival place: from an airport or terminal the "What you can do now" card sends the visitor there, and the trek is free.
- **"What you can do now"** (`src/app/features/relief`). A card in the HUD, and in the wallet, for the moments a player could be stuck in; it comes once for each situation and can be dismissed. The one goal line points at its first step.
- **The search.** `npm test` plays a few thousand sampled states (`src/game/stuck.test.ts`, `src/game/stuckSearch.ts`) and fails on any from which needs do not recover, no money comes in, or a visitor cannot get home. `node --experimental-strip-types scripts/dead-ends.ts --no-nets` lists the dead ends the nets exist for.

## Requirements for opening

An open city needs at least one valid local unit, one rented-home district, a road hub, a venue for every required career track or an explicit unavailable-career declaration, two regulars at every public venue, and working civic venues for polling and government. It also needs food, health, worship, market, recreation and home scene coverage. Nightlife may use a club, shrine or rooftop scene, or a culturally appropriate activity tagged `nightlife` in another built scene, such as an evening tea and suya garden or film house. Calendar events, the gem hunt, radio, billboards, tables, goals and wishes may reference only ids in that city's content.

Every venue needs a stable id unique within the city, an existing scene kind, a district, opening hours where applicable, one line describing what a player can do there, spots and activities, and a position. New cities use longitude and latitude. Lagos keeps its legacy map points until the shared-frame renderer adopts the geometry pack; that renderer transition must preserve existing play behavior and city placement.

Links must produce matching journeys from both endpoints through `linksFrom`. Local-unit ids must match the scene pack and decoded map geometry. Sampling covers the union of state, play-area, unit and water extents, so a footprint outside its state or a local polygon outside its footprint is rejected along with material gaps, land overlap and land-water overlap. Multi-unit geometry must expose exact shared segments from its shared-arc source. State-edge agreement between different modules, such as the Lagos-Ogun border, is checked when that neighbouring state module is added. Child ids must be unique, and loading the registry must not load content or geometry chunks. A city stays closed when any of these checks fails.

## Saved characters

### One home, and more by choice

A character has one MAIN home (`estate.home`): the city where it first settled. The free starter house is given once, for that first home.

- **Visiting.** Arriving in any other city asks for nothing. The life is at a public venue with the notice "Welcome to <city>. You are visiting: your home is in <home city>." and stays a visitor for as long as it likes. A visitor works (the held job is taken up at the city's workplace with `apply-job`), eats, shops, plays, chats, calls, banks and invests as anyone does. It rests at a guest house: `estate.lodge` charges `LODGING.fee` (₦2,500, `src/game/content/world.ts`) and restores Energy and Hygiene at once; it is refused for a life with a home in the city, for one already rested, and without the money.
- **What stays with a home.** Going Home, home activities and furniture, renting a flat, building and styling a house, and the residents' roll of a city (the directory, neighbours, the rich list) belong to lives with a local unit there. A visitor is listed nowhere as a resident.
- **Buy a home here** (`estate.set-lga { lga, home: 'buy' }`). An additional home: a `SECOND_HOME.tier` house (the two-room house) on a plot in the chosen local unit, at that tier's ordinary price there (`tierCost`: ₦60,000 scaled by the unit's land). The main home is untouched. The owner rests there free, upgrades and styles it as any house, pays its ground rent while in that city, and is a resident of that local unit.
- **Make this city my main home** (`estate.set-lga { lga, home: 'main' }` for a visitor, `estate.make-home` in a city where a house is already held). For a visitor it is free: the one starter house is given up where it stood (with the flat rented there, if any) and stands on a plot here, with its look. It is allowed only while the main home is the free starter house; a house that was paid for is never given up, so its owner buys a home here first and then names it the main one. The main home moves at most once every `SECOND_HOME.moveCooldownDays` (7) days.
- **One vote.** Voting and standing for office are for the city of the main home only (`civicEligibility`, check `home`, code `not_main_home`), so a character with homes in several cities has one vote per election.
- **Lives from before the rule.** A saved life with homes in several cities keeps every one, unchanged, and is at home in each as before. `estate.home` is additive: a save without it gets it at load, as the home whose local unit was chosen first (one that never recorded a choice counts as the oldest). A stored value is kept only while a home is still held there. `estate.homeAt` records the last move. A city that was only visited leaves nothing in `estate.away`.

A choice of local unit by a visitor without `home` is refused (`choice_required`) and changes nothing. Returning to a city where a home is held restores it.

Each session has one active character. Reading another city's life cannot create a second character. An arrival is filed under its destination in the same settlement transaction. A trip ended early by `travel.skip` (the wait paid for in game money, `src/game/trip-skip.ts`) arrives through the same completion and is filed in the transaction of that action. Existing separate lives are retained in `legacyLives`, with city provenance held separately for older records without an estate. The character list and receipt-protected switch exchange whole records without merging or deleting them. A retry returns the saved switch result.

### The two ways a life is "kept aside"

One session record is one traveller. Inside it:

- `cities` holds at most one life, filed under `character.city` (the destination, once a trip has landed).
- `legacyLives` holds every other life the record has ever carried, each under a key `<city>:<n>` (older records used `<city>:<milliseconds>`; both are read). `legacyLifeCities` records the city of each, for a life that holds no estate; the city of an entry is its own `estate.city`, then that record, then its key prefix.
- Switching exchanges two whole entries; nothing is merged or deleted. The listing and the switch work on the record the request reaches through `request.secret`, so they serve a guest (the cookie is the key) and a signed-in browser (the binding leads to a key no browser holds) alike.

An account setting a character aside (docs/ACCOUNTS.md) is a different move at a different level: the whole record, `legacyLives` and `legacyLifeCities` included, goes to the archive and comes back as it left. A sign-in never changes `legacyLives`, and switching an older life never changes the account.

Money receipts, friend relationships, privacy preferences, consent and anti-farming limits follow the character. City-local records and deliberate account-global exceptions are listed in `server/civic/CITY-ISOLATION.md`.

## Regenerating the reference geometry

`npm run geo:boundaries` regenerates only the Lagos topology. Use `npm run geo:boundaries -- --oyo`, `--ogun`, `--rivers`, `--fct`, `--kano`, or `--nigeria` for the corresponding explicit targets; combine any target with `--check` to compare exact generated text and decoded geometry without writing. The command downloads pinned ADM1/ADM2 sources into the ignored cache and verifies their byte counts and SHA-256 before processing them. The projection, simplification thresholds and raster water derivation are recorded in the generator and generated header. The default cannot change the Nigeria atlas.

The production bundle omits Vue's unused Options API runtime; all shipped components use Composition API. Terser is pinned as a build-only dependency with safe transformations, ES2020 output supported by the existing browser targets, and two compression passes. The entry gate checks both the loading-screen closure and the complete automatic game-startup closure against the original byte limits. Moving a download behind the loading screen does not satisfy that budget by itself.

## Atlas markers

Every city of the registry is a marker on the Nigeria atlas, open or not, and every open city is named at every zoom. Where markers crowd (Lagos, Ibadan and the four Ogun cities lie within a few pixels of each other on a phone), a name tries its other anchors (`alts` in `src/map3d/geo/labels.ts`); when no side is free it is set down on the nearest free spot of the rings round its dot, whole on screen, and a leader line joins it to the dot. A name never covers another city's dot.

## Local units, the elected office and local travel zones

`rules.unit` names a city's local units ("local government", or "area council" in Abuja) and every sentence that says it reads the city (`src/game/cities/terminology.ts`). `rules.civicTitle` names the office the players of a city elect where it is not a Governor's: the Federal Capital Territory has no governor, so Abuja's is the Community Chair, and `civicExplanation` in its content says under the seat what the office is and that it is not a real public office. Stored civic keys and the election rules are shared by every city. See [CITIES-FCT.md](CITIES-FCT.md).

A city may restrict a local mode through `localModeZones`: both ends of a trip must belong to one declared zone (public venue ids, the rented home's id and an owned home's local unit are separate lists). Modes without a zone go everywhere; Trek is always free. Abuja keeps keke to its satellite towns and Kano to its neighbourhoods. `localRoutes` declares a trip between two named venues by another mode: Port Harcourt's boat runs between its two landings and nowhere else (see [CITIES-RIVERS.md](CITIES-RIVERS.md)).

Venues authored on one reference point (a neighbourhood's services share its locality point) are fanned out round it on the map for display (`spread` in `src/map3d/cities/module.ts`); their coordinates in the data do not change.

## Planned routes and seasonal climate

`CityLink.status: 'coming'` lists a link between two open cities that cannot be booked yet: it is refused before any fare is taken, the atlas shows it as coming, and a trip already paid for still finishes. The Lagos–Kano railway is the one such link.

### Every open city reaches every other

A module writes only the links that are real and tuned (its railways, its named roads and flights). `allCityLinks()` adds the rest with `generateCityLinks` (`src/game/cities/generatedLinks.ts`), a pure function of the open modules' atlas positions and air hubs, so a city opened later, in Nigeria or anywhere else, is connected to every existing city with no edit to any other module. Test fixtures are not part of it: a `test-` city keeps exactly the links it declares.

- Road: every pair whose road distance is at most `maxRoadKm` (1,500 km), unless a road link is authored. Road distance is the great-circle distance between the atlas positions times 1.35 (the authored roads run 1.3 to 1.5 times the straight line). Fare `₦1,500 + ₦16 per km`, rounded to ₦500 (authored: 130 km ₦3,500; 760 km ₦14,000; 1,100 km ₦20,000).
- Air: every pair where both cities have an air hub and are at least 250 km apart, unless an air link is authored. Fare `₦20,000 + ₦80 per km` of great-circle distance, rounded to ₦1,000 (authored: 364 km ₦45,000; 520 km ₦65,000; 834 km ₦85,000). Past `maxRoadKm`, air is offered between ANY two open cities: a city without an airport is assumed to be served from its nearest airfield (the label says so), so no pair is ever unreachable, including cities on another continent.
- Rail: never generated. Only authored railways exist.
- Times come from `timedLink`, so they stay inside the timetable's clamps (road 25 to 75 s, air 12 to 20 s), and the skip fee follows the fare as for any other link.
- The atlas card shows at most one button per mode, cheapest first. A rail link is drawn only from track geometry a city module holds; one without it has no line.

Optional `rules.climate` gives twelve monthly rain chances and the names of clear weather by season; a city without it keeps the shared weather. Kano's is hot and dry with harmattan dust from November to February, and adds no penalty. See [CITIES-KANO.md](CITIES-KANO.md).

A landmark of a state's overview may point at a venue of an open city (`departure`): the button only opens that venue's card for a player who is in the city. It moves nobody and starts nothing.
