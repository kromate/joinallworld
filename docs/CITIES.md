# City modules

A playable city is one folder under `src/game/cities`. The folder exports one `CityModule`: eager rules needed for validation and prices, a lazy content loader, and a lazy map loader. Lagos is the reference module. The current open cities are Lagos, Ibadan, Abeokuta, Ota, Ijebu-Ode, Sagamu, Port Harcourt, Abuja and Kano.

## Catalogue states

The registry distinguishes three questions.

- `isKnownCityId` accepts every city named by the atlas and compatibility layer.
- `isCityId` accepts cities whose stored lives the server may read. This currently includes the nine open city modules.
- `isOpenCityId` accepts cities that can receive a new life or a trip. This currently includes Lagos, Ibadan, Abeokuta, Ota, Ijebu-Ode, Sagamu, Port Harcourt, Abuja and Kano.

Aba, Owerri and Kaduna remain closed atlas previews. Older Ibadan saves may contain Lagos venue ids; the explicit aliases are `park → agodi-gardens`, `library → ui-campus`, `office → cocoa-house`, `hospital → uch`, `market → dugbe-market`, `beach → eleyele-lake`, `airport → ibadan-airport`, `polling-unit → mapo-polling`, `state-house → mapo-hall`, `amala-shitta → dugbe-amala`, `salon → mokola-salon`, `church → ui-chapel`, `mosque → ui-mosque`, `viewing-centre → lekan-salami-stadium`, `i-fitness → lekan-salami-stadium`, `canopy-walk → iita-forest`, `refinery → moniya-station`, `cchub → polytechnic`, `radio/shrine/quilox/rooftop → agodi-gardens`, `palms → dugbe-market`, and `police → mapo-hall`. They preserve old references while the current Ibadan module supplies the real city content.

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

Local-unit rules contain identities, geography categories and prices only. Every content module supplies `localUnitDescriptions` keyed by its complete local-unit list. Engine price and address helpers work without prose; estate views, local-government panels and map packs attach descriptions after the city content loads.

Dream and family-outcome wording can be localized through `dreamWording` and `lotteryWording`. These fields change labels, guidance and explanatory bullets only; IDs, targets, loans, cash, skill effects and rewards remain shared mechanics. Check the onboarding cards, profile, goals and completion messages when authoring these overrides.

Travel visits and activity cooldowns are keyed by city outside Lagos; existing bare Lagos keys remain readable. Bounded references to an unloaded origin survive reload without loading its prose. Loaded catalogues validate the referenced IDs and cooldown duration. Daily earning and roadside-event caps remain global. The last local route and an unanswered roadside choice are transient and clear when the character changes city.

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

## Requirements for opening

An open city needs at least one valid local unit, one rented-home district, a road hub, a venue for every required career track or an explicit unavailable-career declaration, two regulars at every public venue, and working civic venues for polling and government. It also needs food, health, worship, market, recreation and home scene coverage. Nightlife may use a club, shrine or rooftop scene, or a culturally appropriate activity tagged `nightlife` in another built scene, such as an evening tea and suya garden or film house. Calendar events, the gem hunt, radio, billboards, tables, goals and wishes may reference only ids in that city's content.

Every venue needs a stable id unique within the city, an existing scene kind, a district, opening hours where applicable, one line describing what a player can do there, spots and activities, and a position. New cities use longitude and latitude. Lagos keeps its legacy map points until the shared-frame renderer adopts the geometry pack; that renderer transition must preserve existing play behavior and city placement.

Links must produce matching journeys from both endpoints through `linksFrom`. Local-unit ids must match the scene pack and decoded map geometry. Sampling covers the union of state, play-area, unit and water extents, so a footprint outside its state or a local polygon outside its footprint is rejected along with material gaps, land overlap and land-water overlap. Multi-unit geometry must expose exact shared segments from its shared-arc source. State-edge agreement between different modules, such as the Lagos-Ogun border, is checked when that neighbouring state module is added. Child ids must be unique, and loading the registry must not load content or geometry chunks. A city stays closed when any of these checks fails.

## Saved characters

A first arrival without a saved residence is a visitor at a public venue. Its local unit remains unchosen across reloads. Choosing a local unit allocates the free starter house; private home actions remain unavailable until then. Returning to a city restores its existing residence.

Each session has one active character. Reading another city's life cannot create a second character. An arrival is filed under its destination in the same settlement transaction. Existing separate lives are retained in `legacyLives`, with city provenance held separately for older records without an estate. The character list and receipt-protected switch exchange whole records without merging or deleting them. A retry returns the saved switch result.

Money receipts, friend relationships, privacy preferences, consent and anti-farming limits follow the character. City-local records and deliberate account-global exceptions are listed in `server/civic/CITY-ISOLATION.md`.

## Regenerating the reference geometry

`npm run geo:boundaries` regenerates only the Lagos topology. Use `npm run geo:boundaries -- --oyo`, `--ogun`, `--rivers`, `--fct`, `--kano`, or `--nigeria` for the corresponding explicit targets; combine any target with `--check` to compare exact generated text and decoded geometry without writing. The command downloads pinned ADM1/ADM2 sources into the ignored cache and verifies their byte counts and SHA-256 before processing them. The projection, simplification thresholds and raster water derivation are recorded in the generator and generated header. The default cannot change the Nigeria atlas.

The production bundle omits Vue's unused Options API runtime; all shipped components use Composition API. Terser is pinned as a build-only dependency with safe transformations, ES2020 output supported by the existing browser targets, and three compression passes. The entry gate checks both the loading-screen closure and the complete automatic game-startup closure against the original byte limits. Moving a download behind the loading screen does not satisfy that budget by itself.

## FCT metadata and local travel zones

Abuja uses area councils and a fictional Community Chair title, with explanatory copy in its lazy catalogue. Public civic headings and notices derive their terminology from city metadata; internal election keys and mechanics remain shared. See [CITIES-FCT.md](CITIES-FCT.md) for source qualifications and the game-role decision.

A city may restrict a local mode through `localModeZones`. Both trip endpoints must belong to the same declared zone. Public venue ids, the actual rented-home id and an owned home’s unit are separate explicit endpoint sets. Modes without a zone retain normal availability; Trek remains free everywhere. Abuja uses this to limit keke to satellite-town trips. Rented-home map markers use their authored geographic positions; schematic owned-estate plots remain separate.

## Planned routes and seasonal climate

`CityLink.status: 'coming'` blocks new bookings before any fare is taken, even between open cities. The canonical registry and atlas use the same route-availability rule. An already paid trip still finishes when only the route status changes; the existing removed-route or changed-duration settlement rules remain intact. A planned rail route without sourced geometry has no invented preview line.

Optional `CityRules.climate` supplies twelve monthly beta rain chances and seasonal clear-weather labels. The existing deterministic weather block and seed remain shared; omitted climate metadata preserves the original weather output. Kano uses a hot/dry and harmattan-labelled pattern, without new heat or dust penalties. See [CITIES-KANO.md](CITIES-KANO.md).

State-overview landmarks may point to an authored local departure venue. This only opens the destination picker when the player is already in that city. It does not move the character, charge money or start an activity. The simulated Tiga outing uses the ordinary timed-activity rules from its city departure venue, without creating a residence outside the metropolitan footprint.
