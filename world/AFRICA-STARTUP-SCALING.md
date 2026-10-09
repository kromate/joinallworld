# Scaling African city admission

This is a source-level review of the exact C1 release source at `c1f7c1f7369139ce559292318ba9842c23a28267` in `/Users/anthonyakpan/.codex/worktrees/world-first-five-release/joinallworld`. The review document lives in the WORLD worktree; runtime observations below refer to that pinned C1 checkout, not WORLD's older 45-row tree. It proposes the next implementation seam; it does not change runtime code or claim playability.

The current C1 startup measurement supplied for this review is **613,014 raw bytes, 222,381 gzip bytes, and 195,277 Brotli bytes**, against caps of 615,000, 223,000, and 195,600 bytes. The remaining measured headroom is 1,986 raw bytes, 619 gzip bytes, and 323 Brotli bytes. These are the current combined startup measurements and limits, not savings estimates. This review did not rerun the build. `scripts/startup-size.ts` documents its own chunk totals as exact and per-module allocation as estimated; neither source file size nor city count predicts the minified startup delta reliably.

The exact C1 generated catalogue has 50 rows: 40 Nigeria rows and ten foreign starters. Its checked-in files are 3,692 bytes for `catalogue.generated.ts`, 2,962 for `loaders.generated.ts`, and 8,088 for `routes.generated.ts`. `registry.ts` is 14,760 bytes and `generatedLinks.ts` is 4,165 bytes. These are raw source-file sizes, not compiled startup bytes. There are 31 foreign Africa folders with `facts.ts` in the WORLD checkout; that is a source inventory count, not an admission count. C1's current ten foreign rows comprise the first five plus the next five; the additional 16 source candidates must not be treated as runtime admissions.

## What is already lazy

`src/game/cities/catalogue.ts` eagerly imports the small generated catalogue and loader table. `src/game/cities/registry.ts` indexes those rows but invokes a `CITY_LOADERS[id]` closure only when `loadCityRules(id)` is called. The Africa module pattern in `src/game/cities/africa/module.ts` keeps each selected city's `content.ts` and map import deferred; the map's geometry is further deferred until `loadCityMap(id)`. Preserve this pattern. Do not put facts, rules, content, or geometry objects in a global bootstrap table.

The C1 adapter is present in `src/map3d/regions.ts`, with its review history in `world/playable-africa/integration.patch` and `world/playable-africa/integration-notes.md`. It groups generated foreign catalogue rows for country markers and creates a lazy `pack` callback. It does not import city rules, content, or geometry to draw the country list, and it reuses the existing world country outline instead of adding country geometry. This keeps module loading lazy, but it still makes every admitted city marker and loader closure part of the eager catalogue. `countryList()` and `citiesOf()` scan that whole catalogue on each call. The 150-byte row-plus-loader limit in `scripts/city/build-catalogue.ts` bounds each entry, but it does not make an unbounded global list free.

## The route catalogue is the larger scaling risk

`registry.ts` dynamically imports `routes.generated.ts` in `loadCityLinks()`. `loadCityContent()` always waits for it, and `src/game/cities/lifeCities.ts` loads it while reconstructing a saved life. This route data therefore sits on the selected-city startup path even though only a small neighborhood is needed for a given player.

The generator in `scripts/city/build-catalogue.ts` discovers every city folder with `index.ts`, imports each module during generation, checks each serialized catalogue-row-plus-loader pair against 150 raw bytes, then collects all module `rules.links` into `routes.generated.ts`. At the pinned C1 SHA, the generated catalogue has 50 rows and the authored route file has 34 records. Ten are explicit Lagos-to-foreign-starter game connections; these do not establish real flight service or timetables. After loading that authored list, `allCityLinks()` also calls `generateCityLinks()` over every open catalogue city. `src/game/cities/generatedLinks.ts` compares every city pair and adds a beta road when its formula allows one, plus a beta air link for every qualifying pair of airport cities without an authored link. The current C1 set has 50 open catalogue entries (40 Nigeria and ten foreign), so the pair loop considers up to 1,225 unordered city pairs; its 18 airport entries yield up to 153 air-pair candidates before distance and authored-link filters. These are pair-space counts, not measured generated-edge counts. A planned 54-capital set would yield 1,431 foreign-airport pair candidates only if every capital had an airport; it excludes Nigeria and does not mean those connections are permitted or served. The runtime graph can still synthesize beta links beyond the 34 authored records, including foreign-to-foreign pairs. Server travel is validated against the same `linksFrom()` results in the game engine, so replacing client links alone would not be sufficient.

## Smallest safe shared boundary

Keep synchronous registry lookups for already-loaded data and add an asynchronous loading boundary above them:

1. Add a tiny eager country directory containing only country ID, display name, and optional default city ID. It should not contain city facts or geometry.
2. Add `loadCountryDirectory(countryId)` to load compact city marker rows and per-city loader closures for one selected country. Cache each directory. Keep the existing Nigeria catalogue and `CITY_LOADERS` behavior behind a compatibility adapter so old Nigeria IDs, state names, home IDs, saves, and atlas entry routes remain unchanged. Country selection should load only the chosen country's directory; city selection then loads only that city's rules.
3. Replace generated foreign all-pairs links with explicit, sparse, stable game-connection records, loaded by route neighborhood. Keep the old Nigeria route catalogue and its route identities, fares, durations, and behavior byte-for-byte compatible. Keep C1's ten explicit Lagos-to-foreign game connections only as existing beta game edges; do not present them as real-world schedules. Do not recalculate or rename Nigeria links. A server that is about to validate travel loads the required route neighborhood first, after which its existing synchronous exact-link validation can remain in place. Saved-life reconstruction should load only the neighborhoods required for the current and return destinations.
4. Keep content and geometry behind the current selected-city loaders. The country map can continue using its world outline and compact city coordinates; it should not trigger city-map imports.

This is a proposed interface boundary, not a request to make all registry functions asynchronous or to redesign the saved-life model. A practical first shape is `loadCountryDirectory(id): Promise<CountryDirectory>` and `loadTravelNeighborhood(cityId): Promise<readonly CityLink[]>`, with immutable results cached after load. Only the explicit admission/runtime layer should decide which countries are available. Existing Nigeria catalogue data and route records remain the compatibility source until a separately reviewed migration proves exact preservation.

## Next verifiable implementation unit

Before admitting the next 16 plus five source starters, build a small adapter prototype with two foreign countries, one of them containing two cities, while keeping the five current foreign starters and all Nigeria entries unchanged. The focused verification should establish that:

- importing the bootstrap and listing countries imports no foreign city facts, rules, content, or geometry;
- selecting one country loads only that country's directory, and selecting one city loads only that city's rules;
- content and geometry load only after their explicit requests;
- the selected city's available travel edges are limited to its explicit neighborhood, and the server rejects a destination without an exact admitted edge;
- the complete pre-existing Nigeria route records and IDs compare exactly before and after the adapter;
- the existing Nigeria home IDs, state entry points, default city, and saved-life reconstruction remain unchanged;
- the measured startup report still fits all three existing caps, with no cap increase, and reports selected-city chunks separately from bootstrap.

Then admit one country at a time from its pinned source packet, rerun source and runtime checks, and record actual startup sizes. Do not multiply a per-city raw limit into a purported bundle saving: only the measured build establishes that. This keeps the route/data boundary verifiable before moving from the 26 generated-source candidates toward the 54-country denominator and then broader world coverage.
