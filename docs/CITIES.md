# City modules

A playable city is one folder under `src/game/cities`. The folder exports one `CityModule`: eager rules needed for validation and prices, a lazy content loader, and a lazy map loader. Lagos is the reference module. No other city is open yet.

## Catalogue states

The registry distinguishes three questions.

- `isKnownCityId` accepts every city named by the atlas and compatibility layer.
- `isCityId` accepts cities whose stored lives the server may read. This currently includes Lagos and Ibadan.
- `isOpenCityId` accepts cities that can receive a new life or a trip. This currently includes Lagos and Ibadan.

Abuja and Port Harcourt remain closed. Ibadan is an authored module (`src/game/cities/ibadan`). Lives that earlier builds filed under its key are read by that module: their venue ids resolve through `legacyVenueAliases`, and the owner chooses a local government once, for free (`legacyLgaChoice`).

`registeredCityIds()` returns server-known ids. `playableCityIds()` returns open modules. Callers should choose the list that matches the action instead of treating an atlas label as permission to create a life.

## Contract

`CityModule<City, State, LocalUnit, District, Hub>` ties a city's id to its authored child ids. Its `rules` object is the small synchronous metadata boundary used by validation, housing prices and travel. The initial loading screen does not import the engine or city content. The prose and gameplay catalogue in `CityContent` loads only when a host enters or previews the city. Map metadata is a separate lazy chunk.

Rules provide:

- city, state and country identity;
- timezone and the shared-frame map origin;
- a separate atlas marker, teaser and preview text;
- the city's name for its local units, plus local-unit land tiers;
- rented-home districts and the local unit each belongs to;
- road, air and rail hubs;
- symmetric links to other known cities.

Content provides the venue scene kind, existing activity definition, opening hours, display wording and position; regulars and their city; career workplaces; rented homes and their map spots; calendar entries; goal and wish wording; radio venues; billboard roads; table places; a ranked things-to-do list; and a short culture card.

Dream and family-outcome wording can be localized through `dreamWording` and `lotteryWording`. These fields change labels, guidance and explanatory bullets only; IDs, targets, loans, cash, skill effects and rewards remain shared mechanics. Check the onboarding cards, profile, goals and completion messages when authoring these overrides.

The engine remains synchronous after startup. A host first awaits `loadCityContent(id)`, then reads `cityContent(id)`. Reading an unloaded city's content throws. `cachedCityContent(id)` is the non-throwing probe. Map hosts use the equivalent `loadCityMap` and `cityMap` pair.

The browser, servers, tests and command-line tools must cross this loading boundary before calling `createLife`. The shared engine never imports another city's venue or regular catalogue as a fallback. Lagos definitions live in `src/game/cities/lagos/venues.ts` and `regulars.ts`; import them directly only when inspecting that city's source data. A friend's bounded identity snapshot travels with the character, so loading a destination does not require the previous city's prose.


## State, city and local unit

A state owns one or more cities. A life belongs to one local unit in one city. The `unit` text is data, so Abuja can use "area council" while other places use "local government". Rented-home districts sit below a city and point to their local unit.

The state map is the travel and overview surface. `CityMapGeometry.state` is its full first-level outline and may be shared by several city modules. `playArea` is the part opened by one city; that city's local units and local water tile only this footprint. The city map is the play surface with venues, homes and those local units. Both use the same projection and whole-unit origin, so a city footprint can be placed back into its state without a second coordinate system. A city never claims that its local units cover the rest of the state.

Map geometry follows the equirectangular Nigeria frame: 8 degrees east and 9 degrees north as the frame origin, 9 degrees north as the standard parallel, x east, z south, and ten units per kilometre. Lagos is anchored at 3.40 degrees east, 6.45 degrees north, which projects to `{-5052, 2835}` after whole-unit rounding. The atlas marker remains at 3.38 degrees east, 6.52 degrees north; the marker and geometry anchor serve different views. Its geometry source is the generated geoBoundaries gbOpen Lagos topology, licensed CC BY 4.0 and attributed in `NOTICE.md`. `loadGeometry` decodes that topology and `loadScene` imports the existing renderer pack. Both stay behind the lazy map chunk.

## Adding a city

1. Add one folder with rules, content and a lazy map loader. Keep generated, licensed geometry behind that loader. Links belong to the module; the registry combines both directions. Every provisional fare or duration carries `beta: true`.
2. Register the module once in `MODULES`. Its metadata supplies names, server validation, atlas markers, local units and travel without another city table. A module supersedes reserved closed-city metadata.
3. Add its contract and journey tests. `cityContractTest(module)` checks the built scene registry, career coverage, goal and wish references, and both directions of every live registry link. It decodes the real polygons, proves that multi-unit data contains exact shared border segments, samples the union extent to ensure local units and local water tile `playArea`, checks that the footprint lies inside `state`, detects overlap and outside geometry within stated tolerances, and checks the shared-frame round trip. This is a bounded topology check, not a formal GIS proof that every possible neighbouring edge is complete. Host tests register the fictional modules before starting the host and await their content loaders.

The small fictional modules use `{ profile: 'test-fixture' }`, which skips only the full-city venue-kind minimum. The profile is refused for an id that does not start with `test-`; an opened module cannot use it. The negative contract suite holds broken examples for missing shared borders, overlaps, state coverage gaps, missing scene builders, incomplete career declarations, broken goal and wish references, and links that disagree with the registry.

A completed journey starts a new life, settles, works and travels out and back. Saved lives retain cash, needs, skills, friends and each city's home. Tests keep the previous source city on jobs and require the player to choose a local workplace before working after travel.

## What a city module also says

`rules.campus` names the campus a city carries (`'unilag'` for Lagos). The campus rules and scene load on demand and exist only for a city that names one: its volunteering activity and its gate (`src/campus/unilag/volunteer.ts`, `hasCampus`) read the module, not a city id. The browser registers campus stand-ins until the rules are fetched (`src/game/campus-gate.ts`); a life in a city with no campus never needs them.

The character creator's list of places is read from the registry (`placesFrom` in `src/app/features/start/placesModel.ts`): a reserved city appears under its state as "coming" without another table, and opens when a module replaces the reservation. Ibadan, Abuja, Port Harcourt, Abeokuta and Kano are reserved today.

The loading screen, the game shell and a city's content are separate downloads. The registry's rules (ids, prices, units, links) are eager; Lagos content is assembled in the engine chunk because the engine reads it synchronously, and any other module's content and map are their own chunks, fetched after the loading screen paints. The sizes are guarded by `src/app/entry.test.ts`.

## Requirements for opening

An open city needs at least one valid local unit, one rented-home district, a road hub, a venue for every required career track or an explicit unavailable-career declaration, two regulars at every public venue, and working civic venues for polling and government. It also needs food, health, worship, market, recreation and home scene coverage. Nightlife may use a club, shrine or rooftop scene, or a culturally appropriate activity tagged `nightlife` in another built scene, such as an evening tea and suya garden or film house. Calendar events, the gem hunt, radio, billboards, tables, goals and wishes may reference only ids in that city's content.

Every venue needs a stable id unique within the city, an existing scene kind, a district, opening hours where applicable, one line describing what a player can do there, spots and activities, and a position. New cities use longitude and latitude. Lagos keeps its legacy map points until the current renderer adopts the shared geometry pack, which preserves existing play behavior.

Links must produce matching journeys from both endpoints through `linksFrom`. Local-unit ids must match the scene pack and decoded map geometry. Sampling covers the union of state, play-area, unit and water extents, so a footprint outside its state or a local polygon outside its footprint is rejected along with material gaps, land overlap and land-water overlap. Multi-unit geometry must expose exact shared segments from its shared-arc source. State-edge agreement between different modules, such as the Lagos-Ogun border, is checked when that neighbouring state module is added. Child ids must be unique, and loading the registry must not load content or geometry chunks. A city stays closed when any of these checks fails.

## Saved characters

A first arrival without a saved residence is a visitor at a public venue. Its local unit remains unchosen across reloads. Choosing a local unit allocates the free starter house; private home actions remain unavailable until then. Returning to a city restores its existing residence.

Each session has one active character. Reading another city's life cannot create a second character. An arrival is filed under its destination in the same settlement transaction. Existing separate lives are retained in `legacyLives`, with city provenance held separately for older records without an estate. The character list and receipt-protected switch exchange whole records without merging or deleting them. A retry returns the saved switch result.

### The two ways a life is "kept aside"

One session record is one traveller. Inside it:

- `cities` holds at most one life, filed under `character.city` (the destination, once a trip has landed).
- `legacyLives` holds every other life the record has ever carried, each under a key `<city>:<n>` (older records used `<city>:<milliseconds>`; both are read). `legacyLifeCities` records the city of each, for a life that holds no estate; the city of an entry is its own `estate.city`, then that record, then its key prefix.
- Switching exchanges two whole entries; nothing is merged or deleted. The listing and the switch work on the record the request reaches through `request.secret`, so they serve a guest (the cookie is the key) and a signed-in browser (the binding leads to a key no browser holds) alike.

An account setting a character aside (docs/ACCOUNTS.md) is a different move at a different level: the whole record, `legacyLives` and `legacyLifeCities` included, goes to the archive and comes back as it left. A sign-in never changes `legacyLives`, and switching an older life never changes the account.

Money receipts, friend relationships, privacy preferences, consent and anti-farming limits follow the character. City-local records and deliberate account-global exceptions are listed in `server/civic/CITY-ISOLATION.md`.

## Regenerating the reference geometry

`npm run geo:boundaries` regenerates only the Lagos topology. It downloads the pinned ADM1/ADM2 sources into the ignored cache and verifies their byte counts and SHA-256 before processing them. `npm run geo:boundaries -- --check` compares both exact generated text and decoded geometry without writing. The projection, simplification thresholds and raster water derivation are recorded in the generator and generated header. Changing the Nigeria atlas requires the explicit `--nigeria` option; the default cannot change it.

The production bundle omits Vue's unused Options API runtime; all shipped components use Composition API. Terser is pinned as a build-only dependency with safe transformations, ES2020 output supported by the existing browser targets, and two compression passes. The entry gate checks both the loading-screen closure and the complete automatic game-startup closure against the original byte limits. Moving a download behind the loading screen does not satisfy that budget by itself.

## Atlas markers

Every city of the registry is a marker on the Nigeria atlas, open or not. Where markers crowd (Lagos, Abeokuta and Ibadan lie within a few pixels of each other), a closed city's marker tries its other anchors (`alts` in `src/map3d/geo/labels.ts`) before it is left out, so a city the creator lists is never missing from the atlas.
