# 7f startup-budget diagnosis

## Scope and evidence

- Reviewed source only at `clean integration checkout`, commit `7f2dd820cdeb2b14aa16c19e7f665cb84579be81`, tree `b08f02304e1255c6481459a337de4c5012f40503` (parents `eec14690544a4646e4cd8a5ad280d61bbe2709ca` and `c12b8ebd83cd301475fb1d7bf9e143af260d6621`). No build, compiler, test, server, or browser was run.
- Both supplied CI logs report the same result: first paint 35,704; startup raw 615,338 (338 over 615,000); gzip 222,986 (14 under 223,000); Brotli 195,763 (163 over 195,600). Lagos is the largest of all 55 measured cities (`private raw job log`, Node 24 at lines 1021-1024).
- Against `eec146...`, the only production startup projections added for the five cities are five catalogue rows, five loader rows, and five expanded route objects: `src/game/cities/catalogue.generated.ts:55-59`, `loaders.generated.ts:55-59`, and `routes.generated.ts:380-434`. Their checked-in source growth is 433, 264, and 1,143 bytes respectively. The reported aggregate artifact delta of 1,244 raw / 192 Brotli cannot be assigned exactly per source file without an artifact diff, but these are the complete changed production startup inputs.
- The catalogue is eagerly mapped into entries (`catalogue.ts:34-45`). Vite turns every loader row into an eager compact `[chunk URL, export]` descriptor while leaving its city module lazy (`vite.config.ts:113-147`). `loadCityLinks()` imports the route projection before city content becomes ready (`registry.ts:146-175`), and Vite places it in `city-routes` (`vite.config.ts:190`). The new full map/content/rules remain lazy; first paint staying unchanged is consistent with that boundary.

## Smallest safe saving

Change only `scripts/city/build-catalogue.ts` and regenerate `src/game/cities/routes.generated.ts`. Keep every one of the 55 catalogue and loader rows. Replace the repeated literal representation of the 15 standard Lagos-to-foreign flights with a generated-file helper plus calls in the same array positions.

The emitted helper should take all authoritative values as literals, for example `foreignFlight(id, name, km, fare, seconds): CityLink`, and return the same mutable object shape and insertion order currently serialized:

```ts
{ a: 'lagos', b: id, mode: 'air', beta: true,
  label: `Flight between Lagos and ${name}`, icon: '✈️', km, fare, seconds }
```

The array remains frozen. The calls retain the current order and exact numeric values. In particular the five additions remain Cairo 3919/334000/20, Rabat 3242/279000/20, Kigali 3103/268000/20, Kampala 3308/285000/20, and Lusaka 3664/313000/20.

Make compaction fail closed in the generator. A row qualifies only when it has exactly the standard property set; `a === 'lagos'`; `b` is that discovered non-Nigerian city; mode/beta/icon/label match; and its km, fare, and seconds equal the values already produced by `buildDestinationRules` (`africa/rules.ts:9-18`) using `greatCircleKm`, `generatedAirFare`, and `timedLink`. Any custom label, status, fare, duration, endpoint, or extra field must continue to serialize as a full object. This makes the helper an encoding of verified authored facts, not a second authority or runtime recomputation.

Apply the encoding to all 15 homogeneous foreign flights, rather than special-casing only the five new rows. That removes repeated keys and fixed strings from the minified route chunk and gives a meaningful margin over the required 339 raw and 164 Brotli bytes. The exact saving remains an online artifact result; do not accept the patch based on source-byte arithmetic.

## Rejected smaller-looking changes

- Do not delete the authored foreign flights and rely on `generateCityLinks`. That generator sorts city IDs (`generatedLinks.ts:54-67`), changing `lagos -> accra` to `accra -> lagos`; atlas route IDs are directional (`map3d/geo/info.ts:45`) and the accepted cross-border behavior explicitly uses `lagos:accra:air` (`map3d/geo/atlas.test.ts:525-533`). It can also change global route order.
- Do not remove or defer the five catalogue/loader rows. They are the admission and lazy-module lookup for the five new cities. Removing them violates the 55-city/15-foreign requirement.
- Do not raise budgets, alter `scripts/download-budget.ts:160-173`, or adopt the broader unaccepted provider change. The route projection is a bounded source duplication already generated from the city rules.

## Acceptance contract

1. Assert deep, ordered parity of every `AUTHORED_CITY_LINKS` row before and after regeneration. Explicitly assert all 15 route IDs remain `lagos:<foreign-city>:air`, and the five values above remain exact.
2. Verify `allCityLinks()` and `linksFrom('lagos')` order/value parity, the atlas `lagos:accra:air` preview, guest-first navigation, saved/homeward navigation, and server fare/admission journeys. No city, rule, fare, UI, business, or voice path may be removed.
3. Run catalogue freshness, compiler, focused route/generated-link/atlas tests, then the full suite.
4. Build and run the unchanged download-budget gate on Node 22 and 24. Acceptance requires actual startup raw <=615,000, gzip <=223,000, Brotli <=195,600, all 55 cities measured, plus unchanged first-paint and native/artifact gates. If Brotli still lacks durable margin, stop and inspect the artifact delta rather than weakening a gate.

