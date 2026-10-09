# Playable Africa integration patch

`integration.patch` is a review-only patch for the existing shared registry and atlas files. It is intentionally unapplied. It adds optional `countryISO` and `countryName` catalogue metadata only to non-Nigeria generated rows; existing Nigeria rows and `COUNTRIES.nigeria` stay as they are. The 150-byte row-plus-loader ceiling remains enforced by `build-catalogue.ts`.

Foreign city metadata stays eager and compact. `countryList()` and `citiesOf()` read the generated catalogue only; they do not load rules, content, or maps. Foreign `Country` records have no outline because the atlas already gets country geometry from its world data. The patch does not add foreign state levels. `regionEntry('country', iso)` promotes a country only when its catalogue contains an open city, then provides that city as the entry point. Nigeria continues to enter through the existing `ng` level.

The country atlas info sheet now uses that city entry to produce the same travel card and enter/open action as the existing state branch. Travel links are generated with each city's ISO country code, defaulting to `ng` for legacy Nigeria rows. City IDs, Nigeria compatibility, and the existing route lifecycle are unchanged.

Integration follow-ups after applying the patch:

- Regenerate `catalogue.generated.ts`, `loaders.generated.ts`, and `routes.generated.ts` with the existing catalogue generator. The generated catalogue is deliberately not included here.
- Update the fixed-country expectations in `src/map3d/map3d.test.ts` and `src/map3d/world.test.ts`: `citiesOf('nigeria')` should equal the catalogue rows whose `countryISO` is absent or `ng`, rather than all generated rows.
- `src/game/cities/allCities.test.ts` currently recognizes new authored city sources only as `spec.ts` or `recipe.ts`, then runs the Nigeria `build-city.ts` formula check. Foreign modules instead use `facts.ts` and map-source data. Add a foreign-source checker for those facts/maps and branch the offline source check by module kind; do not feed foreign cities into the Nigeria formula checker. Keep the shared CityModule and content contract checks.
- Recheck the startup gzip budget with the compact foreign metadata included and offset any growth through the existing optimization budget. Do not raise configured caps.

The final patch keeps foreign internal starter units out of Nigeria atlas states. Foreign capital selection and map reopen use the real country on the Africa level. Nigeria remains at its existing state level. The source map core includes the real airport as well as the central sample, so the arrival point is inside the initial city camera frame. `plannedRoutes` uses derived country status and binds its country ID.

No regional climate is authored in this starter slice. Existing fallback game weather is provisional; it must not be presented as real local weather or uniform African humidity. Source-backed monthly conditions can be integrated separately.
