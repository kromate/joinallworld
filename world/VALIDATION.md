# First foundation validation — 8 October 2026

This milestone is a runnable independent compiler and preview, implemented across six GPT-6 Luna workstreams against the coordinator's contract. It is not the completed global world or an integrated playable city.

## Verified result

The committed, sanitised Accra pilot contains 251 OpenStreetMap ways converted to GeoJSON. The compiler publishes 11 tiles containing 158 building footprints and 93 road lines. A road line may contain multiple rendered segments. Heights without direct measurements remain labelled estimates; ground elevation and climate are explicitly unavailable. There are 53 coverage notes, mostly retained features crossing the requested boundary, plus missing terrain/climate and unresolved OSM relations. This is a small bounded extract, not all of Accra.

| Measured data | Bytes |
|---|---:|
| Pinned source GeoJSON | 70,637 |
| Manifest JSON | 11,393 |
| All tile JSON | 68,280 |
| Total published JSON | 79,673 |
| Manifest Brotli estimate, quality 5 | 1,917 |
| All tiles' individual Brotli estimates | 14,316 |
| Largest raw tile | 7,933 |
| Largest Brotli tile estimate | 1,664 |

The local preview serves raw JSON. Brotli figures above are packaging measurements, not observed transferred bytes. Preview JavaScript and CSS are additional: the standalone production build reports approximately 146 KB gzip JavaScript and 2.72 KB gzip CSS. Vite warns that its single Three.js-containing chunk exceeds 500 KB minified. This preview bundle is not imported by the game.

Manifest SHA-256: `0b5ba1e9ea50a7b632158a1ca0926d4bad30ec503d7d3d050eb005f2c5d89a6b`.

The real CLI run completed on its first attempt. Running the same plan again verified the manifest and every referenced tile and reused the same output hash. Real pilot status now contains one completed job; development test-ledger artifacts from early integration work were preserved separately under `.cache/world-build/evidence-pre-isolation/`. Final integration tests run in unique temporary copies and do not mutate the preview's data.

## Checks performed

```sh
node_modules/.bin/tsc --noEmit -p world/tsconfig.json
node --experimental-strip-types --test --test-concurrency=1 world/*.test.ts world/preview/*.test.ts
node_modules/.bin/vite build --config world/preview/vite.config.ts
node --experimental-strip-types world/cli.ts run world/pilots/accra-config.json --max-jobs 1 --duration-ms 30000
```

Typechecking, all **35 tests**, standalone preview build and the repeated CLI run passed. Tests cover coordinate axes, exact poles, antimeridian geometry, polygon holes and invalid topology, London DST, polar daylight, climate/live provenance, deterministic hashing, source checks, geometry/byte budgets, clustered subdivision, stale leases, bounded retries, immutable collisions, symlink/path isolation, worker deadlines, runner exclusion, corruption detection and queue payload identity. Source download timeout tests use a stub; no bulk acquisition performance claim follows from them.

Browser QA used the separate local preview at port 5191. Verified:

- Real footprint extrusion renders, with estimated-height and attribution notices.
- First district loaded 30 buildings and 16 rendered road segments from two source road lines; the frame counter reported 610 triangles and four render calls.
- Selecting a second district increased data downloads; returning to the first reused the cache without increasing the byte counter.
- UTC input changed approximate solar altitude and the displayed Accra local time; midnight on 21 December produced a negative solar altitude.
- A wrong manifest hash produced a visible rejection and cleared the prior pack.
- The shareable local manifest/hash URL restored the pack after reload.
- Desktop 1280×900 and narrow 390×844 layouts rendered. The narrow document and canvas were 390 pixels wide with no horizontal overflow. The viewport override was reset afterwards.
- No captured browser console errors in the completed preview check.

Screenshots and raw logs are local ignored artifacts under `.cache/world-build/evidence/`: `accra-desktop.jpg`, `accra-mobile.jpg`, `metrics.json`, `resume.json`, `tests.tap`, and `preview-build.log`.

## Isolation and remaining milestones

All tracked changes are confined to `world/` in a managed worktree. The primary checkout remained clean at `4832b7e7507914db8a4d721a7f6e5d6ad21d91e1` during final verification. No game source, catalogue, Nigerian map, server/database code, root dependencies or game budgets changed. No production deployment, paid API call, cloud purchase, external publication or unattended continent run was started. The main game build/download checks were performed during the earlier research audit; they were not rerun for this isolated module because it has no imports into the game.

The current CLI accepts bounded local plans and processes a local queue. It is not yet a global source-discovery service, continent campaign scheduler, persistent browser offline manager or CDN deployment. Missing/corrupt published output fails closed and requires operator repair. See README for the precise recovery boundary. The runner's default/hard limits are pilot-sized; a two-day campaign requires the next orchestration milestone, rather than silently ignoring a duration cap.

Before claiming a worldwide unattended build: implement pinned bulk ingestion and the hierarchical global inventory; ingest and validate terrain/climate; benchmark representative African, London, polar and dateline regions; run interruption/disk/network soak tests; measure physical low-end Android FPS/memory; validate the distribution/licensing setup; then introduce a separately reviewed gameplay reader and server capacity plan. Those tasks have decisions, lane ownership and acceptance gates in ROLLOUT.md. The present test counts and tiny-source throughput are not evidence that every country can be built in 48 hours.
