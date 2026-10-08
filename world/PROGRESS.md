# World builder checkpoint — 8 October 2026

The full objective remains active. Work is isolated on `codex/world-foundation` at `/Users/anthonyakpan/.codex/worktrees/world-foundation/joinallworld`. All source changes are under `world/`; mutable assets are under this worktree's `.cache/world-build/`. The primary checkout was clean when inspected and is advancing independently; do not reset it or assume its earlier HEAD is current.

## Verified foundation

Commit `c6e246e`: pinned Accra GeoJSON, deterministic compiler, immutable packs, bounded resumable local queue, geometry/geodesy/time helpers and standalone 3D preview. Thirty-five foundation checks passed; see `VALIDATION.md` for measured bytes and browser evidence. No gameplay integration or global-detail completion is implied.

## Global coarse inventory

Natural Earth source pinned to commit `ca96624a56bd078437bca8184e78163e5039ad19`, exact 838,726-byte GeoJSON SHA-256 `6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f`. There are 177 source units, 186 hierarchy nodes, 176 outlines; Nigeria is a protected `legacy-ng` entry. Source categories include Seven Seas separately from continents. The 1:110m source omits microstates and small territories; finer admin-0/admin-1/city inventories remain required.

`node --experimental-strip-types world/bootstrap-cli.ts` recreates or reuses the pinned source, verifies its denominator, and publishes lazy immutable inventory assets. Country node IDs are independent of source release; source feature references retain the release. Missing/corrupt source recovery quarantines exact damaged files with a repair cap. Hierarchy validation rejects cycles, unresolved references, malformed geometry and generated Nigeria outlines. Publication uses the existing fsynced atomic immutable store.

Latest inventory manifest: `728224f88d4b5c2c7995d38a7e86af5ac2d6e3db74ef8ff1083e35305494500b`, at `.cache/world-build/output/inventory/manifests/`. Logical published size: 350,709 bytes. Eight focused inventory checks and the bootstrap acquisition/cache/repair check passed. Browser consumption is being implemented; the older manifest remains as an immutable earlier artifact.

## In progress, not yet accepted

- `acquire_m2`: real Overture adapter, TS orchestration, bounded static STAC item index, HTTP range proxy, receipts and tests. Official release `2026-09-23.1` verified; building collection has 512 items and road-segment collection 128. The coordinator reviewed real catalogue documents and asset URLs. A live extract remains an acceptance gate; current stub checks do not prove production acquisition.
- `campaign_m2`: durable isolated campaigns, stage journals, interruption/resume, corruption quarantine, resource reservations, runner exclusion and focused tests. Eight focused checks were reported passing after review fixes; coordinator integration and real-acquisition testing remain outstanding.
- `inventory_m2`: now owns standalone preview inventory UI, lazy hierarchy navigation, sourced outline view and bounded hash-verified fetching. Coordinator owns inventory/bootstrap code following review.

Builder tooling: official DuckDB 1.5.6 arm64 Python 3.12 wheel, exact SHA-256 `dcccce20965e6986cd083fdf192c461685ad0b93cd1ccd0b2a8207f1185f078b`, installed in `.cache/world-build/tooling/venv`. Official `spatial` and `httpfs` extensions installed and successfully loaded from `.cache/world-build/tooling/extensions`. No game dependency changes. Tool installation traffic is separate from regional acquisition budgets.

## Next actions

1. Finish acquisition review: explicit Parquet bbox pushdown plus exact intersection, native geometry handling, extension path in nested campaigns, durable catalogue item cache, bounded upstream accounting and complete attribution. Run one capped real Accra extract; inspect source receipt and compiler compatibility before other pilots.
2. Integrate campaign changes, verify failed/crashed-attempt reservations and source-cache reuse across reduced resource limits. Run real two-region campaign, interruption/resume and exact corruption recovery.
3. Rerun world typecheck/tests/build on settled changes. Browser-QA lazy inventory, Nigeria protection, dateline/polar outlines and existing Accra preview at desktop/narrow viewport.
4. Commit verified milestone(s), then finish all representative pilots and measured coverage/throughput report before scaling. Terrain/climate ingestion, finer global administrative/city inventory, automatic visible-cell streaming, device benchmarks and gameplay adapter remain incomplete.

No paid jobs, deployment, merge or external publication has been started. A two-day run budget does not establish two-day world completion. Agents work while this session remains active; persistent execution needs the bounded resumable runner and an awake machine.
