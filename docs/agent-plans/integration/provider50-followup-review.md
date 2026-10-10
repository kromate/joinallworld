# Country provider 50 follow-up: source review

## Pins and scope

- Reviewed commit: `28f9626b65f00f696b45e0852d72096a6f949f0e` (`da73711f2a3e14cff6989d6037c56c470a778a89` tree), parent `2ef1f188ee18a5ede4b22de1bf36beed4a9c46f4`, integration base `eec14690544a4646e4cd8a5ad280d61bbe2709ca`.
- The worktree remained clean at `eec14690544a4646e4cd8a5ad280d61bbe2709ca`; the fetched commit was read with `git show` and was not checked out.
- Full branch delta is 32 files, 1,125 insertions and 84 deletions. Follow-up `28f9626b` changes six files; its provider change only calls `catalogueEntry(id)` before returning state.
- Source review only. No build, compiler, test runner, server, browser, or runtime acceptance was performed.

## Findings

### 1. [P1] A transient directory initialization failure is permanent, and the exposed state uses the wrong key

At `src/game/cities/catalogue-provider.browser.ts:12-16`, `pending` and `failures` contain country ISO values, while `directory` permanently retains the first promise. `prepareCountryCatalogue` adds/deletes `iso` at line 23. `catalogueState(id)` checks `pending.has(id)` and `failures.has(id)` at line 22, where `id` is a city ID. Therefore a foreign city reports `unprepared` during a request and after a failure. The line-22 call added by `28f9626b` only reconciles eviction; it does not repair the key mismatch.

If `openRuntimeCountryDirectory` rejects, line 16 caches that rejected promise forever. A later explicit retry reuses the same rejection and cannot issue another index request. This turns a temporary offline or transport failure into a reload-only failure.

**Fix contract:** derive the foreign fact once in `catalogueState`, reconcile the city row, then query `pending`/`failures` with `fact.countryId`. In `openDirectory`, install one promise and clear `directory` only in that same promise's rejection handler (`if (directory === work) directory = null`). Do not auto-fetch, auto-retry, clear a newer promise, or alter the reader's eviction guard. Add source/unit coverage for `unprepared -> pending -> failed -> explicit retry -> ready`, including two cities in one country.

### 2. [P1] Country selection has no latest-actor rule or pending/offline/error presentation

`src/app/features/start/StepHome.vue:44-45` awaits both directory opening and country preparation without `try/catch`, request identity, cancellation, or a component-level loading/error state. It switches `countryId` before metadata is ready. A rejection escapes the Vue click handler and leaves an empty country view with no retry. Competing A/B selections may complete out of order; either completion uses the then-current `states` and may start or repeat the current country's city load. The city loader itself is sound: `homeCityModel.ts:29-55` uses a monotonic `latestLoad` and ignores stale success/failure.

The atlas has the same presentation gap. `src/map3d/geo/atlas.ts:1060` starts country preparation, silently drops errors, and redraws after any completion without checking that the selected country is still the initiating country. Content requests at lines 1066 and 1096 do check current selection; line 1302 only redraws after a stale inspect-city load. Before verified metadata arrives, `src/map3d/regions.ts:62-71,113-116` substitutes ISO text for state/country names and generic teaser text, while `regions.ts:265-268` already marks the country open from trusted facts. This displays placeholders as ordinary metadata and provides no pending/offline/error distinction.

**Fix contract:** give each UI actor a monotonic country-request token (and abort signal if the provider exposes one). Only the latest live actor may publish country/state/city selection or an error. Keep the previous ready view while loading; show an explicit loading status, a recoverable offline/load error, and an explicit retry. Do not convert missing display metadata into `unknown`, `closed`, or ISO/name placeholders. Atlas completion may redraw only if the same country remains selected. Preserve trusted facts as admission/routing authority; HTTP metadata must remain display-only.

### 3. [P2] `startup-size.ts` validates foreign assets but excludes their bytes from its total

`scripts/startup-size.ts:42-55` finds the selected foreign loader, index, and country shard. Lines 56-63 build a set only from `OutputChunk` objects, and lines 81-90 total only chunk code. The index and shard are never added to `raw` or `gzip`, despite the script's startup description. Thus foreign JavaScript is included, but selected directory assets are presence-checked rather than measured.

`scripts/download-budget.ts:71-88,132-144` does include the selected index, shard, and located foreign loader in `startupFiles`. Its `STARTUP_BROTLI` uses all files (`:198-204`); `STARTUP_RAW` and `STARTUP_GZIP` deliberately remain JavaScript-only. This is the stronger budget gate, though the loader-chunk text search is an emitted-code heuristic.

**Fix contract:** retain selected `OutputAsset` objects for the verified index and shard in `startup-size.ts`, print their exact raw/gzip sizes, and add them to the startup totals. Keep JavaScript-only budget semantics where named that way, but label JS and full-payload totals distinctly. Fail closed on zero/multiple loader chunks, indexes, or missing shards as the follow-up already does.

### 4. [P1 for the planned combination] The literal 50 count prevents a 55-city combined build from reaching the budget gate

`scripts/download-budget.ts:244-246` reads required IDs from `catalogue.generated.ts` and throws unless the count is exactly 50. Current source is exactly 40 Nigeria plus 10 admitted foreign cities (`nigeria-catalogue.generated.ts:4-45`, `foreign-admission.generated.ts:2-13`), so the guard matches this commit. A 55-row combination aborts before measuring any startup. Removing only the count would be unsafe because it would silently treat all catalogue rows as admitted. `src/app/entry.test.ts:243-247` also repeats the ten foreign IDs manually and would not cover a changed projection.

**Fix contract:** derive the required ordered IDs from the reviewed runtime admission projection (Nigeria projection plus `FOREIGN_ADMITTED_CITIES`), assert uniqueness and exact order/set equality against `TRUSTED_CITY_FACTS_ROWS`, and assert the emitted rules/content startup IDs match that projection. If the five combined rows are queued or closed, exclude them from admission and startup requirements. If they are intentionally admitted, update the reviewed projection and pins explicitly. Generate the entry-test foreign list from the same projection. Do not replace the literal with `55`.

## Accepted source invariants

- `src/browser/countryDirectory.ts:158-178` requires the exact admitted country set and counts. Lines 224-246 require the exact requested country's city count, positional IDs, uniqueness, country identity, and open status before publication. A stale or incomplete shard is not treated as ready.
- Browser authority remains local: `trusted-city-facts.generated.ts:19-22` supplies the 50 synchronous IDs/names/coordinates/airport/country facts, and `registry.ts:167-169` generates routes from them. HTTP shards do not supply fares, links, rules, content, or admission.
- The server/Node provider remains eager and synchronous: `catalogue-provider.ts:1-14` imports full `CITY_CATALOGUE`/`CITY_LOADERS`; `catalogueState` returns `ready`, `closed`, or `unknown` synchronously. `vite.config.ts:39-54` swaps in the browser provider only for the browser build.
- The browser starts with Nigeria and trusted facts; the directory module is dynamically imported only by `openDirectory` (`catalogue-provider.browser.ts:14-16`). No source path automatically requests all 11 country shards. Saved foreign startup requests its selected country through the city loader.

## Acceptance gates after the finite fixes

1. Typecheck the touched provider, StepHome/atlas callers, and budget scripts in the combined tree.
2. Run focused provider tests for state keys, concurrent same-country preparation, failed initialization explicit retry, and exact shard publication.
3. Build once and require emitted startup-ID equality with the trusted admission projection; measure all 50 currently admitted cities (or the newly reviewed exact projection), with foreign loader JS plus exactly one index and selected country shard.
4. Browser proof: rapidly choose A then B, force A success/failure after B, go offline then explicitly retry, navigate away during atlas preparation, and confirm only the live actor updates. Verify pending/error copy and that ready metadata remains visible.
5. Server/native parity: import the default provider without the Vite swap and verify the eager catalogue/loaders plus synchronous `ready/closed/unknown`, route fares, names, coordinates, and airport facts remain unchanged.


Root independently inspected the critical source branches and exact successor commit. This is source acceptance only; no fixed implementation, actual browser or durable journey is approved.
