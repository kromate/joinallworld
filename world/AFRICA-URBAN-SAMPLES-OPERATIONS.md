# African urban sample expansion

The existing bounded Overture campaign now publishes separate Dakar, Addis Ababa and Dar es Salaam sample packs. This is real captured footprint/road data in three 0.004° source-selected cells. It is foundation coverage, not complete cities, national urban coverage, navigable streets or playable destinations. All buildings have estimated heights; terrain and climate remain unknown in these three new packs. Existing climate products and Nigeria remain unchanged.

Read the frozen [selection](AFRICA-URBAN-SAMPLES-SPEC.md), [anchor provenance](africa-urban-samples-anchors.json), [campaign](campaign-fixtures/africa-urban-samples-v1.json) and [receipt](africa-urban-samples.json). Natural Earth coordinates select reproducible city-reference samples, not civic centres or addresses. Dar's obsolete capital classification remains provenance and is not a present-capital claim.

| Sample | Captured buildings / road lines | Tiles | Local pack bytes | Measured source response bytes | Acquisition ms |
|---|---:|---:|---:|---:|---:|
| Dakar | 409 / 64 | 19 | 187,937 | 8,862,456 | 40,754 |
| Addis Ababa | 858 / 51 | 35 | 324,184 | 8,878,866 | 38,034 |
| Dar es Salaam | 1,414 / 176 | 59 | 650,254 | 19,549,513 | 48,710 |

Three immutable manifests and 113 tiles occupy **1,162,375 bytes / 116 files**. Captured inputs total **1,087,971 bytes / 2,972 features**. Measured source responses sum to **37,290,835 bytes**, below the 96,000,000 campaign cap. Elapsed values are acquisition-worker metrics, not end-to-end player loading or a global forecast. Runtime memory caps were enforced; actual peak RSS was not recorded for this batch.

Accepted manifest hashes:

- Dakar: `7c885b4c127b29047d91bbde14ed8866169232f7b8753e77e772f41821e817f0`.
- Addis Ababa: `b427bd5514021f266419072f9c2c0899460ac7c1c31eeaafccbcedf7108ca688`.
- Dar es Salaam: `3935e3be0d66b7fac0f618a139404e667a56413f7759a541f6fd231c087a1a97`.

Each source job succeeded once. The final campaign has three compiled source units, one protected Nigeria entry, no exceptions/unknown units and no queued or leased work. This operational `complete` applies only to the four-entry frozen campaign. It does not override each pack's foundation coverage or its 96 / 74 / 139 geometry/source limitations. The final repeat returns the identical report, verifies completed manifests/tiles and changes no source attempts, usage journal or published bytes. All 43 prior captured climate/base/ledger files remain byte-identical.

## Reproduce and preserve accounting

Use the existing pinned Python runtime and inventory. An identical terminal resume verifies output without starting new source jobs:

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- \
  node --experimental-strip-types world/campaign-cli.ts resume world/campaign-fixtures/africa-urban-samples-v1.json \
  --inventory-manifest "$PWD/.cache/world-build/output/inventory/manifests/8c40558c7cd6eff38be2c6d94bdaaafc04bfdc3f601fb45c4441d16b4b7d0a4f.json" \
  --python "$PWD/.cache/world-build/tooling/venv/bin/python3.12" --max-jobs 1
```

Retain this campaign, source caches and journals. Changed selections require a distinct version. Unknown-transfer reservations remain charged; do not erase attempts or retry the old Fiji campaign. No game/database writes, deployments, paid jobs or external publication occurred.

## Verification scope

Root independently hashes each captured source, manifest and tile, checks every emitted source part ID and exact coordinate sequence against the captured GeoJSON, and proves each source part appears once across its pack. All 2,972 captured features have 2,972 emitted parts. This audit imports no production compiler. It does not prove source completeness, independent topology, height accuracy, source intersection or distribution rights. The retained audit script and receipts live under `.cache/world-build/evidence/`.

The selection regression passes, as do World TypeScript and the separate preview build. The preceding climate milestone passed the full 459-test World suite; that is a separate gate from this added fixture check. Preview JS remains **717.31 kB minified / 188.15 kB gzip**; CSS is **12.32 / 3.56 kB**, with the existing JS chunk warning. No game startup import changed.

Browser checks cover all three at 1280×720 and 390×844, Dakar district switching/cache return, Dar manifest-only cache reload and stable final idle frames. Long mobile titles initially overlapped view controls; separate control/title space fixes the observed layout. An intermediate viewport returned to 595 pixels after reload; reapplying the override verified actual 390-pixel sizing. Both earlier observations remain in evidence. Final tested widths have no overflow or title/control overlap, and captured console errors are zero.

The preview retains eight tiles and explicitly defers 11 / 27 / 51. Initial desktop workloads are **2,826 / 16**, **3,102 / 15** and **5,798 / 18** triangles/calls; narrow workloads are **2,814 / 15**, **2,642 / 13** and **5,418 / 17**. Dakar's alternate district view reaches 3,818 / 16. Initial rounded body counters are **82.2 / 92.0 / 125.9 KB**; Dakar's return adds no traffic after the alternate view, and Dar cache reload fetches only its **46.2 KB** manifest. These are decoded-body observations, not exact wire bytes, physical-device FPS or a prolonged soak.

## Next implementation

Use the measured samples to implement reusable regional extraction with deterministic local fan-out through the existing campaign/compiler interfaces. The STAC metadata index is already cached, but nearby distinct requests still re-read remote parquet ranges. Start by consuming one verified regional extract into a frozen set of child cells, retaining original IDs/coordinates and explicit crossing-feature ownership. A new remote multi-region adapter is needed only if the measured extent/query cannot be expressed through the existing bounded acquisition path.

Freeze a country cell denominator and source-bound ownership/index before a country sweep. Distinguish not-started, empty, failed, deferred and verified output; completion of sampled cells never establishes complete settlement coverage. Preserve old pilot products and release provenance. Terrain/geoid, spatial climate, routing, distribution, physical-device checks and gameplay integration remain unfinished. The retained scaling review provides code seams and constraints; do not create another scheduler or treat more isolated tiny samples as the world-building endpoint.
