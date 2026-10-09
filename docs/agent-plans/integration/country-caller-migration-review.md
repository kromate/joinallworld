# Country caller migration review

## Fixed source point

- Integration is clean at `eec14690544a4646e4cd8a5ad280d61bbe2709ca`.
- WORLD was observed at `473cab1fb178f78ba3fc37d2ba7753bbc4636641` during the source review; unrelated untracked tooling and draft files exist and must not be copied.
- The trusted projection was introduced by `5dd7ae415da8e6b58fb3f7a2b0f0cbb8dc5249bf` and is unchanged at current WORLD head.
- `src/game/cities/trusted-city-facts.generated.ts` SHA-256 is `ee772a4546dce84d7df11767d0d3d10bc6c67e4bc5888ebd8d76380fa9732600`.
- It contains exactly 50 ordered open rows: the 40 Nigeria rows reused from `NIGERIA_CITY_CATALOGUE_ROWS`, then the 10 foreign rows in `FOREIGN_ADMITTED_CITIES` order. It admits no queued city.
- WORLD's recorded parity is 34 authored plus 1,053 generated route terms, 1,087 total. This is source evidence, not combined Integration acceptance.

## Packet pins to import, not regenerate

| WORLD file | SHA-256 |
| --- | --- |
| `src/game/cities/nigeria-catalogue.generated.ts` | `f5e4a694fce5daca5823b0838b0ddad04a161362c56695d6969dbc65e572f2cb` |
| `src/game/cities/foreign-admission.generated.ts` | `c1d3b64555cc7bce02b35bfd073b3f045982c2bd50d0e54934d18338d1c73f20` |
| `src/game/cities/foreign-loaders.generated.ts` | `f8ec4a18a58cb4cb238fcf049308b8233ffaffe8e484b7bd0129c9381d965426` |
| `src/game/cities/country-directory.generated.ts` | `c7d3777f7f29abb2c802c4f09bcea6d0a0e889858f50e8bb21e5d96f57f96f91` |
| `src/browser/countryDirectory.ts` | `847cd1eebabf1bdfd6238ab3bca9996b27d4186a9ed3611d172b7035da413f1f` |
| `src/browser/countryDirectoryHttp.ts` | `9782dde677adf5d3f70b8a93e912dac048443c77238bfa83cf6c939b32fb9dcd` |

The public packet is 12 `.txt` assets: index `index-4eaedd30de68e5d2af654c24c3e17b91ed3b78f39999f28bd7f8103d435bfefc.txt`, one Nigeria shard, and ten foreign shards. The content hash in each filename matched the file. Do not restore the retired `.json` assets or widen release policy.

## Next finite implementation unit

Replace `CITY_CATALOGUE` as browser admission/routing authority and migrate the actual landing and atlas consumers in the same unit. Keep the server provider on the full checked-in catalogue. Select the browser provider through Vite's existing browser-system resolver, so Node/server imports never receive browser APIs and the browser graph never receives the eager full foreign catalogue.

The common provider must expose two separate capabilities:

1. Trusted synchronous facts from `TRUSTED_CITY_FACTS_ROWS`: ID, name, open status, source, country ID, coordinates, and airport bit.
2. Catalogue state: `unknown`, `closed`, or open with `unprepared | pending | failed | ready`. Only `ready` carries foreign state/country display metadata. Nigeria and retained reserved rows are ready statically.

HTTP may transport and verify display metadata. It must never add an ID, open a country, rename a trusted city, alter coordinates or airport capability, or influence fares. Publication must match trusted ID/name/country/coordinates/airport fields and the exact admitted country ID set before any row becomes ready. Eviction returns foreign display rows to unprepared while trusted facts remain.

## Minimum disjoint write whitelist

Packet copies, byte-identical to the pins above:

- `src/browser/countryDirectory.ts`
- `src/browser/countryDirectoryHttp.ts`
- `src/game/cities/{trusted-city-facts,nigeria-catalogue,foreign-admission,foreign-loaders,country-directory}.generated.ts`
- `public/world-country-directory/**` for the exact 12 `.txt` assets only

Integration-owned edits:

- `src/game/cities/catalogue.ts`
- `src/game/cities/registry.ts`
- `src/game/cities/catalogue-provider.ts` new server/default provider
- `src/game/cities/catalogue-provider.browser.ts` new browser provider with lazy directory opening
- `src/app/features/start/placesModel.ts`
- `src/app/features/start/StepHome.vue`
- `src/map3d/regions.ts`
- `src/map3d/geo/atlas.ts`
- `vite.config.ts`

No other file is worker-owned. In particular, `src/client.ts`, `src/game/cities/lifeCities.ts`, `src/app/bootstrap.ts`, `src/app/features/start/warmLanding.ts`, server files, save formats, route generators, and generated city modules remain unchanged unless Root expands ownership after a concrete compiler error.

## Current caller requirements

- `catalogue.ts`: keep `CityCatalogueEntry` and the reserved-city insertion rule. An admitted open Kaduna suppresses reserved Kaduna; otherwise the closed entry and preview remain. Browser catalogue enumeration is Nigeria plus ready foreign metadata, never placeholders.
- Registry identity: `knownCityIds`, `registeredCityIds`, `playableCityIds`, `isKnownCityId`, `isCityId`, `isOpenCityId`, and `cityName` use trusted facts plus fixtures, not prepared catalogue presence.
- Routes: `allCityLinks()` maps the 50 trusted rows into the existing `generateCityLinks` call. Keep authored-first insertion, fixture conflict behavior, key replacement, fares, labels, airport decisions, coordinates, and order unchanged.
- Loaders: Nigeria loaders stay static. A trusted foreign ID dynamically imports `foreign-loaders.generated.ts`. Before a foreign module becomes visible, the browser provider prepares its display metadata; the server provider remains fully local. A failed preparation rejects the existing async load and is explicitly retryable.
- `placesModel.ts` and `StepHome.vue`: remove the module-evaluation snapshot built from `cityCatalogue()`. Nigeria remains immediately available. Country choices come from the verified directory index, but only trusted countries are open. Selecting a foreign country prepares exactly that country before its state/city list appears. Planned or unknown map countries remain distinct and cannot become playable from index data.
- `warmLanding.ts`: retain its current import timing. Its `QuickStartApp.vue` import must reach only trusted facts, static Nigeria, and the lazy provider shell. It must not statically reach `countryDirectory.ts`, `countryDirectoryHttp.ts`, foreign loaders, the full generated catalogue, or any country asset.
- Saved bootstrap: existing `bootstrap.ts -> loadLifeCities -> loadCityRules/loadCityContent` already awaits city modules before reconstruction. Provider preparation at the foreign module boundary makes a saved foreign current/home/ticket city ready without changing save JSON. Nigeria performs no directory HTTP. Keep unknown saved IDs falling back under existing `initialCity` and `lifeCities` rules.
- Client transitions: existing `client.ts` awaits `loadCityContent` before start, move, wake, held-city switch, and `clientCity()`. Do not add a second preparation path unless this sequencing is disproved. This avoids split retry and stale-response ownership.
- Atlas: country open status comes from trusted country IDs, never the HTTP index. Route drawing uses trusted name/coordinates even when display metadata is unprepared. City/state cards require ready metadata. Selecting an admitted foreign country may prepare its shard; opening World must not prepare every country. Keep planned/soon map countries closed.
- Server: the default provider preserves the complete local catalogue and all synchronous path metadata. No server fare, admission, save, or protocol field changes belong in this unit.

## Required gates after implementation

1. Source parity probe: exact ordered 50 trusted rows, 40 Nigeria plus 10 foreign across 11 countries; full equality of `allCityLinks()` to `eec` for IDs, order, labels, modes, fares, seconds, kilometres, status and beta fields; 34 authored and 1,053 generated terms.
2. Focused existing suites: registry/generated links, paths, bootstrap, client city/cache, start components, regions/world and atlas. Do not replace these with a proof-only fixture.
3. Compiler: `npm run typecheck:slot`. WORLD's earlier branch compiler result predates trusted facts and is not inherited.
4. Build and budget: `npm run build:slot`, then `npm run size:download`; every existing budget remains unchanged. Inspect the built entry/startup closures and fail if full foreign catalogue, foreign loader rows, or country HTTP reader enters automatic Lagos startup.
5. Smoke/release: `npm run test:smoke`; `.txt` country assets are present and `.json` variants remain absent.
6. Native isolated continuity: existing Nigeria start/save/reload/travel and one admitted foreign saved-life/start/travel path retain exact server fares, homes, wallet effects and route names. Use a disposable store and no production mutation.
7. Browser network acceptance: new Lagos device makes zero country-directory requests; cold saved foreign city fetches the index plus only its shard; explicit second-country selection fetches only that shard; retry and eviction re-prepare; unknown and planned countries never publish ready city metadata.

Stop if exact route parity, server full-catalogue behavior, or the no-HTTP Lagos path requires a file outside the whitelist. Return the concrete dependency to Root instead of widening scope.

## Root revalidation and execution order — 9 October, 23:57 UTC

Root fetched WORLD `bb6b779dc648c5d492d6b6db22361962153eb2c5` and independently matched all seven trusted projection/packet source hashes above. This migration stays pinned to the existing 50-city authority. WORLD’s separate third-five proposal adds Cairo, Rabat, Kigali, Kampala and Lusaka; its 55-row candidate needs its own route, save, budget and actual journey acceptance. Do not mix the two parity baselines or silently admit the five cities during the provider migration.

Use the existing remote country worker after its currently owned admission generation checkpoint, or another already available included worker with explicit disjoint ownership. All implementation and heavy checks run remotely. The original local integration tree and production remain unchanged. Source review approves this finite implementation scope; implementation and runtime acceptance are outstanding.
