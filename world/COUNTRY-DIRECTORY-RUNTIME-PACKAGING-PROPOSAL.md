# Country directory implementation proposal

Checked 9 October 2026 at 23:03 UTC. This is reviewed implementation source,
not an accepted combined game release. Production still has 11 open countries.

The country generator now uses an explicit admission manifest rather than
discovering every generated city folder. It preserves the exact C1 catalogue,
loader and route outputs and all 40 Nigeria rows. The initial manifest includes
the ten foreign cities already deployed. Extensions require a pinned source
packet and verified selected city assets before the generator imports a city.
No additional city has been admitted by this change.

The generated output provides a compact Nigeria catalogue and Nigeria-only lazy
loader table, a compact foreign identity list, a separate foreign lazy loader
table, and a descriptor for content-addressed country metadata. The browser
adapter prepares selected countries over HTTP and validates their identity,
hashes, counts and catalogue shape. It supports cancellation, retry, bounded
concurrency and eviction. Nigeria uses static metadata without an HTTP request.

## Integration contract

WORLD owns `scripts/city/build-catalogue.ts`, `scripts/city/runtime-admission.ts`,
the explicit manifest and generated files, and the three new `src/browser/`
files. Integration owns the shared registry, browser bootstrap, picker, atlas,
save compatibility and server authority. The browser adapter uses DOM APIs;
import it from browser bootstrap, not the engine registry project. Inject the
prepared typed metadata into the engine. Keep the server's trusted synchronous
fare and admission checks. Import the foreign loader table dynamically when
needed. Do not load all foreign country metadata at startup.

`openRuntimeCountryDirectory` takes the generated descriptor, foreign identity
list and static Nigeria catalogue. `prepareCountry` and `prepareCities` fetch
required metadata; `getCatalogue` reads prepared metadata. Evicted foreign rows
must be prepared again. `dispose` aborts owned work and clears resident caches.
The initial admission is 40 Nigeria rows and ten foreign rows. Explicit reviewed
extensions can add countries and cities without changing the protected prefix.

The four baseline `.txt` files are exact C1 source snapshots with fixed hashes.
They allow generation from a shallow checkout without consulting Git history.
No CI checkout settings were changed.

## Actual verification

- All 16 focused generator and browser-reader tests passed, with no failures or
  skips. They cover immutable baseline pins, explicit extensions, metadata
  identity and bounds, cancellation, retry, eviction and rejection paths.
- Actual generation and regeneration check passed. A final check also passed
  with a deliberately failing Git executable in the generator's PATH.
- Independent comparison against Git C1 confirmed all four snapshots and the
  unchanged legacy catalogue, loader and route outputs.
- Independent packaging audit verified all 11 country shards, the index hashes
  and all 50 catalogue rows.
- A real loopback HTTP run compared all 50 rows to C1. It made 11 requests and
  transferred 6,851 bytes for the index and ten foreign shards. Nigeria caused
  no shard request. Repeated selection used the cache; disposal cleared it.

Evidence is retained under `.cache/world-build/evidence/`:
`runtime-country-directory-final-focused-tests.log`,
`runtime-country-directory-gitless-check.log`,
`runtime-country-directory-baseline-snapshot-audit.json`,
`runtime-country-directory-actual-packaging-audit.json`, and
`runtime-country-directory-actual-http.json`.

## Remaining acceptance

Strict TypeScript acceptance is still missing. The whole-tree check was stopped
after more than 120 seconds without output. Two scoped checks each timed out
after 30 seconds. These are incomplete compiler checks, not passes. Their logs
and owned-process termination receipts are retained. No compiler environment,
heap limit, startup budget or baseline was relaxed.

Before release, Integration must migrate the callers, complete exact combined
TypeScript/build/startup gates, verify native Nigeria/save/travel continuity and
the selected new destinations, and verify the sealed deployment. Raw HTTP byte
measurements do not prove compressed startup savings or browser heap use. This
source proposal has no production, browser, CDN or new-country acceptance.

Admission and release should now take priority over generating more queued
sources. There are 52 generated foreign starters, ten deployed and 42 queued;
Moroni is the remaining missing starter in the 54-country source inventory.
