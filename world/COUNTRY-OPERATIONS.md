# Bounded country capture and source inspection

Run from the isolated world-builder repository. These commands do not write game data, update the existing geographic manifest, or generate a replacement Nigeria outline.

```sh
node --experimental-strip-types world/country-cli.ts verify-source world/country-capture.json
node --experimental-strip-types world/country-cli.ts inspect world/country-capture.json --duration-ms 60000
```

Both commands require the retained metadata/source cache and use zero network bytes. The explicit network command is:

```sh
node --experimental-strip-types world/country-cli.ts capture world/country-capture.json --duration-ms 120000
```

It has already completed once. Reuse the cache; do not rerun discovery or delete source accounting to observe the result. `inventory-10m-sources.json` freezes the captured raw SHA-256 and actual 258-feature denominator. `inventory-sources.json` remains the unchanged default 110m pin. The new pin is not an instruction to run the legacy publisher: four complete raw country outlines exceed its asset limit.

## Source identity and accounting

The only admitted capture URL is the Natural Earth repository's `geojson/ne_10m_admin_0_countries.geojson` at a reviewed full 40-hex commit. Cached contents metadata must match its exact hash/length, artifact path, raw URL, Git blob URL/SHA and byte length. It is not moving-release discovery. Natural Earth describes its map data as public domain in its [terms](https://www.naturalearthdata.com/about/terms-of-use/); that source-specific evidence does not resolve other providers' rights or authorize external publication here.

Raw SHA-256 is computed after capture. A separate Git blob SHA-1 verifies the reviewed metadata identity, hashing the byte-length blob header plus raw bytes, as documented by [Git](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects). The Git blob ID is not substituted for a raw SHA-256 pin.

Admission uses the shared build lock, a 120-second deadline including elapsed preparation/lock time, identity encoding, manual redirect refusal, an initial and sampled 512 MiB process RSS gate, 100 MiB free disk plus a 16 MiB response allowance, and a 64 MiB source subtree. Scans stop at 4,096 entries/depth eight. Network allowance is cumulative **16 MiB per immutable release/path/blob/length identity**, independent of descriptive attribution changes. Remaining allowance must cover the expected full source before contact. No automatic retry, LFS resolution or additional source request occurs.

An fsynced start record reserves remaining allowance before contact. Complete responses charge measured delivered body bytes; stale or interrupted responses retain their full reservation. Whole delivered chunks are metered even when crossing allowance, while retained bytes are capped. Protocol overhead and transport-level overshoot are not measured. Fetch/body cancellation is cooperative; stream cancellation is awaited before unlocking. Geometry parsing uses a separately terminable worker. Corrupt audits, metadata, caches or receipts fail closed; files are retained. Verified cached bytes remain available after allowance exhaustion. Missing receipts may be restored with explicit verified-cache provenance, without relabelling the original acquisition as zero network.

Source bytes are published immutably before a receipt. Durable attempts live in `.cache/world-build/country-source-cache/attempts/`, capped at 512 events/2 MiB with 8 KiB records and two-record headroom. Partial responses are retained for diagnosis, not automatically promoted or resumed.

## Inspection and measured result

The cache-only inspector rechecks source/baseline bytes and uses the exact existing 110m pin. A fixed worker has a 60-second deadline, 256 MiB old/32 MiB young heap limits and sampled 512 MiB process RSS ceiling; termination and worker closure precede shared-lock release. Private reports are immutable and hash addressed under `country-inspections/reports/`; durable attempts precede worker launch. The complete tree is capped at 8 MiB/512 entries/depth eight; attempt records at 128 entries/1 MiB/8 KiB each, with replacement headroom. The worker report is capped at 256 KiB. No preview manifest is published.

One HTTP 200 capture measured **13,287,234 response-body bytes**, raw SHA-256 `239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255`, matching Git blob `5ebc66e25fc1af01edaebe9375c546655e04cf1e`. Its attempt took 6,369 ms and sampled peak RSS was 114,851,840 bytes. There is no unknown outstanding network reservation. The earlier 1,229-byte metadata capture is separate accounting.

First/repeated inspections took **804/1,021 ms**, zero network, and produced the same **42,535-byte** report, SHA-256 `f8fc7bed183b758c19255f1301bb759e035600f8b6630654eb400df1d3bffd74`. They measured 258 source units, 267 hierarchy nodes, 257 non-Nigeria outlines, 548,471 source positions and 546,699 non-Nigeria outline positions. All 177 prior `NE_ID` country IDs are retained, 81 are added and none are missing. These are map units, not sovereign-state or playable-city counts.

| Complete raw outline | Bytes | Positions | Largest whole polygon, bytes |
|---|---:|---:|---:|
| Russia | 820,222 | 36,756 | 510,427 |
| United States of America | 844,791 | 35,981 | 288,426 |
| Canada | 1,573,724 | 68,193 | 463,090 |
| Antarctica | 560,977 | 23,815 | 372,523 |

The entire outlines exceed 512,000 bytes; every individual polygon fits. The fixed source can therefore use whole-polygon groups without clipping, simplifying, dropping holes or changing coordinates. The separate directory described below implements this bounded representation and its lazy reader. Keep the existing asset and vertex limits, preserve old manifests/Rwanda bindings, and verify original-to-part conservation before publication. The source pin/inspection does not establish full polygon topology, spherical validity, correct disputed boundaries, global city coverage or playability.

Independent evidence is under `.cache/world-build/evidence/`: `ne-10m-country-independent-verification.json`, capture/cache-verification/first/repeat reports and stderr logs, `ne-10m-country-polygon-size-probe.json`, and `country-source-coarse-regression.json`. The coordinator independently reread raw SHA/Git blob/metadata hashes, exact feature sets, position counts, source receipt, acquisition reservations and both completed inspection attempts. The old manifest still reproduces `8c40558c7cd6eff38be2c6d94bdaaafc04bfdc3f601fb45c4441d16b4b7d0a4f`, 354,201 bytes, with zero network. All 186 integrated Node tests and world TypeScript pass; the final acquisition follow-up passes 10 tests. Browser code/assets did not change in this source-operations milestone.

## Separate directory publication

The bounded representation and independent lazy preview are now implemented. Build from the verified cache without source discovery or downloads:

```sh
node --experimental-strip-types world/country-cli.ts build-directory world/country-capture.json
```

This creates immutable assets only under `.cache/world-build/output/country-inventory/`. It leaves the legacy `inventory/` product and Rwanda's fine bindings unchanged. The CLI freezes the reviewed baseline manifest `8c40558c7cd6eff38be2c6d94bdaaafc04bfdc3f601fb45c4441d16b4b7d0a4f`; the runner verifies its exact source pin and complete hierarchy before compiling the candidate. Compilation admits only exact raw bytes, preserves all baseline identities, and prohibits Nigeria geometry. A private compiler admission fingerprint prevents later mutation or forgery of a publication input.

Each geometry file contains a deterministic source-order group of whole polygons, including all holes. The outline index retains the original Polygon/MultiPolygon type, contiguous polygon offsets, position counts and exact part bytes. Each part is capped at 512,000 bytes; a country including its outline index is capped at 2 MiB and 100,000 positions. One polygon that exceeds the part limit fails explicitly. No clipping, simplification or coordinate rounding is used in the data product. Publication preflights all assets and the 16,000,000-byte logical aggregate before creating output; the manifest is last. Existing immutable assets are independently hash/length verified before reuse, and corrupt files fail closed.

A fixed worker has a 120-second deadline, 256 MiB old/32 MiB young heap limits and sampled 512 MiB process RSS ceiling. Abort/deadline termination and worker closure precede shared-lock release. Durable attempts precede launch. Output is capped at 40 MiB, 4,096 entries and depth eight; attempts at 128 entries/1 MiB/8 KiB per record with atomic replacement headroom. Free space must cover a 100 MiB reserve plus the complete output allowance. Partial output remains available for a verified subsequent build; no failed attempt is silently reported as successful.

The actual first build took **48,775 ms**. After improving grouping and verified file reuse, the cache-only repeat took **2,491 ms** and reproduced manifest **`b3fb51b5660ed22b2ee354235c60291d6857b3dd9245afbabec3fc15918c8501`**, **12,689,994 logical bytes**. Both used zero network. The directory contains **258 map units, 267 hierarchy nodes, 257 non-Nigeria outlines, 263 geometry parts and 789 immutable files**. Independent reconstruction verified all **4,271 polygons and 546,699 positions**, unchanged geometry types, order, holes and coordinates against the pinned source. The largest part is **511,456 bytes**. All 177 prior identities remain, 81 are added, none are missing, and Nigeria remains `legacy-ng` without a replacement outline. Original coarse and Rwanda v2 manifest bytes still match their existing hashes.

Open the independent preview with `directory=/world-output/country-inventory/manifests/<hash>.json` and `directoryHash=<hash>`, or use its World Geography panel. Root/category/node/identity/index/part bytes and SHA-256 are checked before use. Country geometry loads only after selection, under a shared two-request gate and a 5,000,000-byte raw-response cache. Parts must conserve the complete indexed geometry before drawing; generation changes prevent an obsolete selection from replacing the current one. The directory does not silently bind existing fine data to a different coarse manifest. Small-country rendering uses finer SVG precision while the source coordinates remain unchanged.

Evidence: `.cache/world-build/evidence/country-directory-{first,repeat}.stdout.json`, corresponding stderr logs, and `country-directory-independent-verification.json`. These are a geographic foundation and measured local builds. They do not establish complete streets, real houses, topology, spherical validity, boundary correctness, global playability, phone performance or a two-day completion time. Next deepen country administration through resumable, source-bound fine campaign stages, then settlement packs and separately tested gameplay integration.

Directory acceptance: **211 integrated Node tests** pass; the final changed reader also passes its 11 focused tests. World TypeScript and the independent Vite preview build pass. Browser evidence at actual **586×804**, document width 586, verifies Monaco, Canada and return-cache reuse, Antarctica, Fiji, protected Nigeria with no fetched-byte increment, invalid manifest identity clearing rows/provenance/geometry, recovery, original Rwanda v2 rendering, and clearing that fine binding on a new-directory selection. No browser console errors were observed in this run. Saved evidence: `country-directory-browser-qa.json`, `country-directory-monaco.jpg`, `country-directory-antarctica.jpg`, `country-directory-fiji.jpg`. Polar display is equirectangular and distorted; these are outline checks, not a photorealistic globe. Fiji outline QA reuses this geographic cache and does not retry the failed city campaign. Content corruption and delayed request cancellation are isolated fake-fetch tests, not faults injected into the real output. The initial parallel integrated run exposed a timing assumption in a prior inspection-abort test; synchronization now uses durable admission, and the serial integrated run passes.

Final independent preview build: 648.79 KB minified / 169.57 KB gzip JS, 11.40 KB CSS / 3.34 KB gzip, with the existing >500 KB warning. The compiler/preview remain isolated from the game bundle. The reader's final aggregate preflight rejects an index plus its declared parts over 2 MiB before requesting geometry; its 11 focused tests pass after the 211-test integrated run.
