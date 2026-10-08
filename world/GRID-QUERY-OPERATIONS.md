# Bounded country-grid query operations

The schema2 runner acquires source-query evidence against a complete, immutable country-grid denominator. It reuses the existing campaign/ledger/acquisition mechanisms and keeps state under this worktree's world-build cache. It does not compile geometry, alter Nigeria, write game data, deploy or publish externally.

## Actual Senegal pilot

Fixture `grid-query-fixtures/senegal-v1.json` pins all100 Senegal root cells, directory `b3fb51b5660ed22b2ee354235c60291d6857b3dd9245afbabec3fc15918c8501`, grid `cee5d9a270d5daa263c3ee56497e797e3acd04a302675a54e4098b2860061d9c`, Overture release2026-09-23.1 and both buildings/roads layers. Each source attempt is bounded by16MB response traffic,1MB output,5,000 supported rows,90s,1,024MiB and128MB acquisition disk. The frozen campaign has cumulative64MB network/32MB input/32MB output/256MB disk quotas, one job attempt,10,000 total retained jobs and max subdivision depth4. Its120s duration is PER INVOCATION, not a lifetime two-day supervisor budget.

The first invocation admitted one job; the second admitted four. Actual retained state is **108 jobs: two completed density subdivisions, three captured zero-supported-feature queries,103 queued, zero failed/leased**. All **100 roots remain pending** because no root has all leaf queries captured. Counts.compiled is0, stages.compile/validate are0. No source feature count is claimed for the failed dense parent queries. Zero-supported child captures are raw evidence, not physical emptiness or explorable geography.

Independent audit confirms **23,687,479 measured response bytes /1,272 input bytes /1,272 output bytes /19,264 shared acquisition-cache growth bytes**. Both dense queries have one typed feature-row-budget attempt:5,960,788 and5,960,764 measured bytes. Each retained source attempt ran once. The producer failed before publishing an extract/receipt; all four children appeared atomically. The first request took27,105ms; successful zero-row children took36,539/18,747/19,111ms. These are bounded pilot measurements, not country/world throughput forecasts.

First and resume stdout, source attempts, receipts and an independent reconstruction are pinned in `grid-query.json`. A no-claim replay verifies the exact paused report and source files with zero network/attempt increments; status correctly reports running/pending. The older schema1 larger-Dakar terminal report also reproduces unchanged with zero network. All **877** preserved prior source, grid, product and ledger pins remain identical. Historical exhausted Fiji/Namibia evidence and reservations are untouched.

## Commands and safe continuation

Run from the isolated world worktree. These commands can consume the remaining frozen budget; do not run them merely to inspect status.

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- node --experimental-strip-types world/campaign-cli.ts resume world/grid-query-fixtures/senegal-v1.json --inventory-manifest /Users/anthonyakpan/.codex/worktrees/world-foundation/joinallworld/.cache/world-build/output/country-inventory/manifests/b3fb51b5660ed22b2ee354235c60291d6857b3dd9245afbabec3fc15918c8501.json --country-grid-plan /Users/anthonyakpan/.codex/worktrees/world-foundation/joinallworld/.cache/world-build/country-grids/senegal-country-grid-v1/plans/cee5d9a270d5daa263c3ee56497e797e3acd04a302675a54e4098b2860061d9c.json --max-jobs 4 --python /Users/anthonyakpan/.codex/worktrees/world-foundation/joinallworld/.cache/world-build/tooling/venv/bin/python3.12
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- node --experimental-strip-types world/campaign-cli.ts status senegal-grid-query-v1
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- python3 world/tooling/verify_grid_query_campaign.py --root /Users/anthonyakpan/.codex/worktrees/world-foundation/joinallworld/.cache/world-build --campaign senegal-grid-query-v1
```

Run the Python immutable SQLite audit only after the writer has stopped. It refuses active runner locks/nonempty WAL or SHM rather than ignoring uncheckpointed state. Run/resume owns crash recovery; the verifier never repairs source files or ledgers. CLI exit2 means bounded work remains; exit1 means an exception/invalid input. No background automation was installed. The machine must stay awake and the process/session active for execution to continue. Never delete a ledger, reset quotas or raise a frozen campaign's caps in place.

The no-claim API uses `maxJobs:0`; CLI accepts positive max-jobs only. Use a saved .mjs/TypeScript entry point when calling worker-based grid loaders from code: Node's stdin `--input-type=module` flag is inherited by a Worker and is not valid for its file entry point. The standard documented CLI does not pass that flag. The failed stdin replay evidence is retained separately; the final saved-file replay passes.

## Validation and scope

The full World suite passed **529/529** tests. After adding three status/recovery regressions, the final focused campaign suite passed **9/9**. World TypeScript passes. Python acquisition tests pass **eight existing plus three protocol cases**; independent campaign tests pass **14/14**, including full synthetic capture/split graphs, tampered receipts/rehashed bounds, current-zero-network success versus cache-hit, historical interrupted starts, and SQLite safety. Root reran the actual independent audit after final fixes. An intermediate verifier ordering error is preserved in failed stderr evidence; the corrected current verifier passes. No browser code changed; prior pack/streaming QA is not a new source-query rendering acceptance claim.

Captures bind exact source request/receipt/extract bytes. Audit selection/hash/quad logic is independent Python, including source-cut country-grid reconstruction. Shared source journals can later append valid cache hits or larger-cap captures without invalidating historical accepted jobs; the verifier binds the matching historical terminal evidence and retains unmatched interrupted starts/conservative usage. Source index files and future range caches are separate from published extracts. Python/JavaScript rare shortest-digit ties can fail closed as previously documented.

Factory-only scaling generated all25,467 Antarctic root requests as a19,794,001-byte canonical config in402.341ms (543.724ms repeat), within the64MB config gate. The three-country factory profile's sampled peakRSS was312,197,120 bytes. It performed no acquisition, publication or ledger writes. This proves bounded request generation, not global query/ledger throughput.

## Next implementation

[GRID-QUERY-EFFICIENCY-RESEARCH.md](GRID-QUERY-EFFICIENCY-RESEARCH.md) records repeated Parquet URLs/ETags across the three captured queries. Success receipts omit range spans; actual duplicate interval bytes and potential savings are unknown. Implement and test a bounded exact-range cache in the existing proxy before a country sweep, preserving release/URL/strong-validator/range/hash identity and charging HEAD/miss traffic. Keep partial overlap assembly out of the first cache version.

Then add durable release-qualified feature dedup/global owners and owner dependencies before country geometry compilation. Query cells touch boundaries and include areas outside the cartographic country outline; summed query rows are not unique or country-assigned buildings. Country/global ledger throughput, source coverage exceptions, terrain/geoid, regional conditions, source rights, long unattended soak, physical devices and the tested game/Nigeria adapter remain open. This checkpoint does not prove whole-world or48-hour completion.
