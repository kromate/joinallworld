# Country-lazy selected-place preview

The independent preview now reads the accepted selected-place product by country. It verifies the manifest and selected country's bytes, SHA, source, parent inventory and point envelope before drawing. Real source coordinates and IDs remain unchanged. This layer provides selected city/town references; it does not provide buildings, routes or playable destinations.

## Accepted checks — 8 October 2026

Full World TypeScript, **436/436** World Node tests and the separate Vite preview build pass. Reader tests include **11** cases with phase-controlled cancellation, concurrency, queues, byte limits, cache eviction, parent mismatch and a receiver-sensitive native-fetch regression. Marker planning has five cases; shared atlas framing has four. Integration tests use temporary data, not the actual output/ledgers.

The first browser attempt exposed native `fetch` being called with the reader as its receiver. The corrected default calls `globalThis.fetch`. Browser testing then exposed an Antarctic polygon with explicit pole vertices but zero normalized longitude winding. The camera now recognizes explicit pole vertices and uses the full longitude span. This changes camera framing only; source geometry and identities remain intact. The full suite/build above ran after both fixes.

| Browser case | Observed result |
|---|---|
| Ghana | 17 points; first load 76,709 decoded bytes including 72,668-byte shared manifest; repeat adds zero requests/bytes |
| Accra focus | Exact source ID and coordinates (-0.218662, 5.55198); search/focus do not fetch |
| Djibouti | Five points; shared manifest reused, only 1,438 new decoded bytes |
| United Kingdom | 57 points; 13,052-byte asset; 50 then seven list rows on two pages without additional traffic |
| London focus | Exact source ID and coordinates (-0.118668, 51.501941); no new requests |
| Bir Tawil / South Sudan | Explicit missing point coverage; zero point requests, old rows/markers cleared |
| Nigeria | Local protected return; no outline/point replacement; zero additional selected-place requests/bytes, rows and markers zero |
| Fiji / Suva | Four country points; compact dateline frame; source coordinates unchanged; Suva (178.441707, -18.133016) can be focused |
| Antarctica | 40 points visible after camera correction; `0 301.032418 720 58.96758199999999`, no longitude wrapping |
| United States | 769 points loaded; 256 markers and 50 list rows; 513 markers explicitly deferred, searchable/paged rows remain available |
| Wrong hash | Rejected before traffic; verified rows/markers cleared; restoring the pin reuses verified cache |

Actual desktop **1280×720** and narrow **390×844** viewport dimensions match requested overrides. Document width matches viewport width; no horizontal overflow. Captured console errors are zero. The 3D frame counter stays at two through the point interactions, consistent with demand rendering in this unloaded-pack check. This is not a physical-device FPS or extended soak result. The final six-country selection sequence uses **275,817 decoded body bytes / seven requests**, including one shared manifest; cached bytes match. A development hot reload reset the cache between initial and final camera checks; the raw receipt retains that reset and the original fetch failure.

## Reader and display limits

- Same-origin exact hash-addressed manifest/point routes only; no raw source, audit, inspection report or other-country eager download. Point cap **512,000 decimal bytes**, manifest **256 KiB**.
- Raw verified-byte LRU **5 MiB / 256 entries**. Cache objects are parsed/validated afresh. Failed/partial decoded bodies count toward lifetime observed traffic.
- At most **two concurrent** fetch/body/hash/validation loads; queue **32**, total per-load deadline **25 seconds**, cancellation and no automatic retry. Cumulative request starts are a diagnostic, not a two-request lifetime quota.
- At most **256 SVG markers** and **50 list rows**. Deferred/outside-view counts stay visible. Paging, search and source-point focus operate on downloaded rows.
- Country/layer changes clear presentation and cancel stale loads. Manifest URL/hash inputs persist across country changes; cache and lifetime counters persist until page reload.

Vite reports **712.27 kB minified / 186.39 kB gzip JavaScript**, **12.01 / 3.48 kB CSS**. Its existing 500 kB chunk warning remains. This bundle is isolated from the game's startup imports; it is not a game startup measurement.

## Reproduce locally

Reuse the existing WORLD preview at port 5191. Otherwise launch `node_modules/.bin/vite --config world/preview/vite.config.ts` in this isolated worktree, subject to the shared server-slot policy. Use query fields `directory`, `directoryHash`, `settlement`, `settlementHash` or enter the following pins in the two panels:

- Directory `/world-output/country-inventory/manifests/b3fb51b5660ed22b2ee354235c60291d6857b3dd9245afbabec3fc15918c8501.json`, hash is its filename stem.
- Places `/world-output/selected-places/manifests/17932383d2d75ce733a3cfae8e455d053be778fc09dcaa5ca06707416e55b61e.json`, hash is its filename stem.

Select a region/country, then **Load selected places**. These query fields configure pins; points load only after selection and the explicit load action. The browser serves manifests/points only; inspection-report routes return 404. It cannot publish or repair builder products.

Evidence is under `.cache/world-build/evidence/`: `settlement-preview-accepted-{tests.tap,typecheck.stdout,typecheck.stderr,build.log,build.stderr}`, `settlement-preview-browser.json` and `settlement-preview-{us-1280,fiji-390,antarctica-1280,london-1280}.png`. Tracked receipt: `settlement-preview.json`. Actual source audit SHA remains `b7f506e785c136e3bfa0fd606b44d9d350538946a77ca58f2cea61e7e9dbdea2`; source attempts/output/pins are unchanged. Temporary viewport overrides and the browser resource guard were released; owner servers were preserved.

## Next work

Attach cached, sourced monthly climate to the three African pilot packs as a separately derived immutable product, after freezing exact base-pack/sidecar/region/point bindings. Preserve native-grid, 1991–2020 baseline limitations and distinguish live weather. Terrain attachment still requires geoid/datum evidence. The source-bound SSD→SDS crosswalk has supporting pinned metadata but is not implemented: require a separately versioned explicit mapping and preserve the existing point manifest; SJM/TKL remain unresolved. Then extend African building/road detail through bounded campaigns. Worldwide playability, physical-device/soak checks, distribution and gameplay integration remain open.
