# Independent world-data builder

The builder creates immutable geographic packs and a lazy world inventory under this worktree's `.cache/world-build/`. It runs separately from the game, its saves and its database. Current evidence covers a coarse global inventory and small real-source pilots; see [PROGRESS.md](PROGRESS.md) and [M2-VALIDATION.md](M2-VALIDATION.md) for current results and remaining gates.

The expanded 258-unit directory now supports explicit administrative bindings and a durable cache-only campaign. Its first/repeat run verified Rwanda and recorded every remaining country exception; see [FINE-CAMPAIGN.md](FINE-CAMPAIGN.md) for exact commands, evidence and next tasks. Latest integrated checks: 236 Node tests, world TypeScript and preview build pass (648.99 KB minified / 169.68 KB gzip JS). Nigeria's requested visual improvement is implemented separately on `codex/nigeria-rendering`, commit `6ad7579b`, with 24 map tests passing.

## Local foundation and preview

```sh
node --experimental-strip-types world/cli.ts plan world/pilots/accra-config.json
node --experimental-strip-types world/cli.ts run world/pilots/accra-config.json --max-jobs 1 --duration-ms 30000
node --experimental-strip-types world/cli.ts status
node_modules/.bin/vite --config world/preview/vite.config.ts
```

This M1 CLI compiles a pinned local GeoJSON plan. Input bytes and SHA-256 must match. Jobs are keyed by source/config/compiler/schema identity. Compilation runs in a worker terminated at the wall-clock limit. Output is content-addressed and immutable; the manifest is published last. Re-running completed work verifies manifest and tile hashes. The local SQLite ledger is separate from campaign ledgers.

Only one foundation CLI run holds its local runner lock. Exit code 2 means the job or bounded queue needs another run; code 1 means failed work or invalid input. This CLI does not acquire source data. For a damaged M1 output, preserve evidence and identify the exact hash before repair; do not remove a campaign ledger or valid shared source cache.

## Inventory, real acquisition and campaigns

`bootstrap-cli.ts` builds or reuses the pinned Natural Earth 110m root/continent/country inventory. Country outlines load on selection. The source-unit denominator and resolution omissions remain explicit; countries with outlines are not declared playable. Nigeria stays with its protected legacy provider.

`fine-cli.ts build` adds a separate, cache-only ADM1 directory bound to that exact coarse inventory. The accepted Rwanda pilot has five source divisions and 2,158,301 published bytes; an identical repeat verified every immutable collision and kept the same manifest with zero new network bytes. The preview lazily loads division outlines after country/manifest verification. Its compiler has bounded source/output/worker/disk/scan limits and explicit identity migrations. See [FINE-INVENTORY.md](FINE-INVENTORY.md) for source evidence and limits. Ghana remains excluded because its OSM licensing metadata is inconsistent.

[FINE-OPERATIONS.md](FINE-OPERATIONS.md) documents the frozen 199-row metadata catalogue, exact pinned-source acquisition and supervised planar validator. Fine compiler/inventory/manifest v2 now requires the exact source-bound planar report, all source units valid, and original source geometry equality before publication. The cache-only runner verifies report bytes, hash-addressed request identity, source SHA and exact feature keys; the preview verifies the report before exposing division buttons. Rwanda first/repeated builds took 3,889 / 5,372 ms with zero network and identical manifest `6c82e8966f933bfd24225a869cff1daf3aaf8d52f35d835b4771a397ab5b9055`, 2,159,566 logical bytes. The same 1,073-byte report (`3b1f22719ea6bd995154010af47ff9c894d63e9bc57f7d753fba2e308c9ddea1`) records five valid, zero invalid and zero unsupported divisions. Index, registry, outlines, all 58,470 positions, country ID and coarse hash remain unchanged. Legacy schema 1 remains readable with a mandatory structural-check warning. Planar checks do not establish spherical validity, boundary correctness or distribution rights. Next implement resumable fine campaign stages using existing acquisition, topology and compiler interfaces, bounded larger-layer partitions and explicit missing-country/level policies. First expand the 177-unit coarse denominator through the measured candidate contract in [GEOGRAPHIC-COVERAGE.md](GEOGRAPHIC-COVERAGE.md); preserve existing IDs and old coarse/fine bindings. The 10m source is captured, inspected and published as a separate 258-map-unit directory; the old inventory and Rwanda bindings remain unchanged. See COUNTRY-OPERATIONS.md for the accepted build and lazy preview. Discovery and licensing strings do not authorize public distribution. Do not retry Fiji or reset its unknown 64 MB reservation.

The [private tooling guide](tooling/README.md) installs pinned DuckDB without changing game dependencies. `acquisition-cli.ts` accepts only a bounded, pinned Overture request. Network response bytes, rows, output, process resources and time are bounded; receipts and attempt evidence survive interruption. Compiler v2 filters transportation to roads. Historical v1 extracts remain preserved.

`campaign-cli.ts` combines acquisition, compilation and validation in separate durable campaign directories. See [campaign fixtures](campaign-fixtures/README.md) for exact run/status/resume commands, inventory binding and caps. A shared source-root lock protects incremental cache accounting. Failed attempts keep conservative reservations when response-byte measurements are unavailable. Only exact damaged output is quarantined and repaired with a limit. Resume does not reset spent budgets. A bounded runtime is not a completion promise.

The independent preview now streams visible campaign cells. Browser smoke QA verified Accra and London, returned to Accra without a new downloaded-byte increment, and observed stable idle-frame counts. The observed viewport was 586×804; the attempted viewport override did not apply. The latest fine-preview build passed but its main bundle (619.05 KB minified / 162.19 KB gzip) exceeds the 500 KB warning threshold. This does not establish mobile-device performance or an extended streaming soak.

The bounded `representative-real-v2` campaign is terminal: four sources compiled (Accra, Cape Town, London and Nairobi), three exceptions (Sahara and Antarctica empty, Fiji transport failed twice), and protected Nigeria remained excluded; no work is queued or leased. Cumulative campaign accounting is 113,303,391 bytes (49,303,391 measured and 64,000,000 reserved with Fiji transfer unknown). Priority ordering and migration fixes are accepted. See [M2-VALIDATION.md](M2-VALIDATION.md); this is not whole-world coverage.

## Regional conditions and representations

[ENVIRONMENT.md](ENVIRONMENT.md) documents six pinned NASA POWER/MERRA2 point climate normals for 1991–2020. Cache-only rebuilds require no new download. They are separate immutable sidecars and are not yet attached to packs. The bounded terrain importer has completed a reproducible cache-only verification from its retained extract and sidecar; terrain conversion and pixels are not attached to campaign packs, and the initial bounded DEM download measured 3,511,272 response-body bytes. See [M2-VALIDATION.md](M2-VALIDATION.md) for measured hashes and samples. Climate normals are distinct from current weather; Africa has multiple climates. Building heights and missing elevation are explicitly labelled. Exact facades/interiors and photorealism require further source rights and measured rendering budgets.

The user-authorized Nigeria rendering improvement is isolated on `codex/nigeria-rendering`, commit `6ad7579b`. Its visual changes preserve Nigeria geography, IDs, saves, catalogue, routes and database. Builder ingestion still excludes Nigeria.

## Validation and next milestones

A bounded Natural Earth 10m capture and cache-only inspector are implemented. One exact source capture measured 13,287,234 bytes, SHA `239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255`; it has 258 map units, retaining all 177 prior country IDs and adding 81 with no missing IDs. First/repeated inspections (804/1,021 ms, zero network) reproduced report `f8fc7bed183b758c19255f1301bb759e035600f8b6630654eb400df1d3bffd74`. Four complete outlines exceed the current asset cap, but each whole polygon fits, enabling bounded polygon groups without coordinate changes. The old 177-unit manifest and Rwanda binding remain active and independently reproduce unchanged. The distinct bounded directory now publishes all 258 source map units locally, preserves the old directory and has passed lazy preview checks; see `COUNTRY-OPERATIONS.md`.

Latest source-operations validation: **186 Node tests** and world TypeScript pass, plus 10 focused acquisition tests after final audit/deadline fixes. Evidence is `country-source-tests.tap`, final acquisition and typecheck logs. No browser graph changed; the accepted prior build remains 619.05 KB minified / 162.19 KB gzip JS with the >500 KB warning. Earlier topology/acquisition/terrain Python results and visual evidence remain preserved.

```sh
node_modules/.bin/tsc -p world/tsconfig.json --noEmit
node --experimental-strip-types --test --test-concurrency=1 world/*.test.ts world/preview/*.test.ts
.cache/world-build/tooling/venv/bin/python3 -m unittest discover -s world/tooling -p '*test*.py'
node_modules/.bin/vite build --config world/preview/vite.config.ts
```

Earlier fine-v2 integrated checks: **162 Node tests**, zero failures, and world TypeScript pass. Preview production build succeeds at **619.05 KB minified / 162.19 KB gzip JS**, plus 11.40 KB CSS / 3.34 KB gzip, with the existing >500 KB warning. Evidence: `.cache/world-build/evidence/fine-v2-tests.tap`, separate test/typecheck logs and `fine-v2-build.{stdout,stderr}`. The unchanged topology Python checks retain their prior 7 groups; acquisition/terrain Python retain prior 8/8 results. These checks do not establish physical-device performance or global completion. Global administration/cities, terrain/geoid and climate attachment, distribution rights and gameplay integration remain required. Agents run during an active session; the resumable runner also requires an awake machine.

Current administrative source-promotion/preparation policy, real Djibouti acceptance and retained Namibia mismatch are documented in [FINE-PROMOTION.md](FINE-PROMOTION.md). Read [PROGRESS.md](PROGRESS.md) for current checks and [HANDOFF.md](HANDOFF.md) for the Sol/Luna continuation prompt, including the separately accepted Nigeria rendering upgrade.
