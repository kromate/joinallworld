# Regional extract reuse — accepted local operations

The additive fan-out compiler/publisher derives immutable local child inputs from one pinned parent. It reuses existing campaign jobs; it adds no source downloader or scheduler. Shared contract: [REGIONAL-FANOUT-SPEC.md](REGIONAL-FANOUT-SPEC.md). Exact code, source, product and evidence pins: `regional-fanout.json`.

## Actual products

| Experiment | Parent rows | Owned buildings / roads | Outside owners | Declared cells | Pack bytes | Tiles |
|---|---:|---:|---:|---:|---:|---:|
| Cached Dakar | 473 | 370 / 46 | 57 | 4 | 154,555 | 19 |
| Larger Dakar | 1,810 | 1,432 / 300 | 78 | 16 | 640,327 | 72 |

No unsupported or duplicate rows occurred. Every owned source part retains its exact ID/coordinates, including whole crossing geometry. Outside owners remain unresolved, not discarded from accounting. These overlapping versions are separate experiments, not packs to combine. Their builder indexes plus child inputs use 496,462 and 1,965,822 bytes; these are distinct from player pack bytes. Completion receipts add 1,029 and 3,200 bytes; generated campaign configuration is additional local tooling data.

The larger 0.008-degree-square parent used one acquisition attempt, 9,110,946 measured response bytes, 624,174 input bytes and 46,035 ms adapter time. External process measurement observed 46,888 ms wall time and 165,953,536 bytes sampled process-tree RSS. This is sampled process memory, not a guaranteed peak or physical device/wire measurement. All 473 smaller-extract features were conserved unchanged in the 1,810-row parent. This measured case obtained 3.83 times the features for 2.8% more response bytes; it is not a country/global forecast.

Both derivations and local campaigns replay identically with zero acquisition/network and no attempt increment. All 43 original pinned input/ledger files remained unchanged. The new acquisition journal retains one started/finished successful attempt; never reset old journals, reservations or products.

## Cache-only build and resume

Run from the WORLD worktree. These commands require the already captured pins; they do not acquire missing sources. Publication verifies collisions and fails closed on corrupted completed output. Checked-in relative paths resolve before request hashing, so invocation identities include this checkout's absolute paths.

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- node --experimental-strip-types world/regional-fanout-cli.ts build world/regional-fixtures/dakar-cached-v1.json
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- node --experimental-strip-types world/regional-fanout-cli.ts build world/regional-fixtures/dakar-larger-v1.json
```

Use the returned `campaignPath` with the existing campaign CLI, and pin the inventory manifest explicitly. The larger accepted path is:

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- node --experimental-strip-types world/campaign-cli.ts resume .cache/world-build/regional-fanout/dakar-larger-fanout-v1/campaigns/c0193761d5080ab3947a36bda5b7166a63060cf6df9fe57108db0800c8157fff.json --inventory-manifest /Users/anthonyakpan/.codex/worktrees/world-foundation/joinallworld/.cache/world-build/output/inventory/manifests/8c40558c7cd6eff38be2c6d94bdaaafc04bfdc3f601fb45c4441d16b4b7d0a4f.json --max-jobs 17
```

Check the inventory path against actual storage before invoking; its hash is authoritative. Country rollups have one Senegal source unit, one compiled and one protected Nigeria. The separate index has 16 cells. Empty-owned cells are retained with dependencies in the index but are not zero-tile campaign jobs. Neither empty-owned nor protected-only operational completion proves physical empty geography.

Independent verification uses a root-relative `index-path` and exact SHA. For larger Dakar:

```sh
python3 world/tooling/verify_regional_fanout.py --root .cache/world-build --index-path regional-fanout/dakar-larger-fanout-v1/indices/737721a5531b8a6056d99ec8e0bc4ee1389e41f2ed35c358fa32732f45e59cc4.json --index-hash 737721a5531b8a6056d99ec8e0bc4ee1389e41f2ed35c358fa32732f45e59cc4
python3 world/tooling/verify_regional_campaign.py --root .cache/world-build --index-path regional-fanout/dakar-larger-fanout-v1/indices/737721a5531b8a6056d99ec8e0bc4ee1389e41f2ed35c358fa32732f45e59cc4.json --index-hash 737721a5531b8a6056d99ec8e0bc4ee1389e41f2ed35c358fa32732f45e59cc4 --report-path evidence/regional-fanout-dakar-larger-campaign-first.json --report-hash 29c51067a59b8debbbf7014d7677e39af7c1ff1c29f1160b8e13af368de0b21b
```

## Verification and next gate

Full World suite: **482/482**, no failed/skipped/cancelled cases, 75,135.6 ms. Full World TypeScript, 12 independent Python fixtures and the final local campaign integration fixture pass. The integration fixture covers crossing-road ownership, an empty-owned dependent child, partial run/resume, immutable replay, and independently rejecting coordinate changes even after tile/manifest/report rehashing. Tests use separate temporary products/ledgers.

One representative larger child was inspected at actual 1280×720 and 390×844. It used 3,626 triangles / 15 calls, eight resident tiles / one explicit deferral, zero failures or console errors, no narrow overflow/controls overlap, cache reuse and stable separated idle readings. A later browser restoration reset frame/byte counters; final default viewport reads stayed at ten idle frames. This is one child and emulated widths, not all cells, physical-device performance or dependency loading. No preview code changed in this milestone. These new packs have unknown climate and no terrain attachment.

Next freeze a complete source-bound country grid/coverage denominator for Senegal, then connect bounded regional extraction batches, global owner identities and cross-pack dependencies. Dense extracts must split deterministically within existing caps. Preserve country/source identities, Nigeria, all attempts/reservations and old products. Do not substitute further isolated city samples for country coverage.
