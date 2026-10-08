# Independent world-data builder

The builder creates immutable geographic packs and a lazy world inventory under this worktree's `.cache/world-build/`. It runs separately from the game, its saves and its database. Current evidence covers a coarse global inventory and small real-source pilots; see [PROGRESS.md](PROGRESS.md) and [M2-VALIDATION.md](M2-VALIDATION.md) for current results and remaining gates.

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

The [private tooling guide](tooling/README.md) installs pinned DuckDB without changing game dependencies. `acquisition-cli.ts` accepts only a bounded, pinned Overture request. Network response bytes, rows, output, process resources and time are bounded; receipts and attempt evidence survive interruption. Compiler v2 filters transportation to roads. Historical v1 extracts remain preserved.

`campaign-cli.ts` combines acquisition, compilation and validation in separate durable campaign directories. See [campaign fixtures](campaign-fixtures/README.md) for exact run/status/resume commands, inventory binding and caps. A shared source-root lock protects incremental cache accounting. Failed attempts keep conservative reservations when response-byte measurements are unavailable. Only exact damaged output is quarantined and repaired with a limit. Resume does not reset spent budgets. A bounded runtime is not a completion promise.

The independent preview now streams visible campaign cells. Browser smoke QA verified Accra and London, returned to Accra without a new downloaded-byte increment, and observed stable idle-frame counts. The observed viewport was 586×804; the attempted viewport override did not apply. The final build passed but its main bundle (595.78 KB minified / 155.73 KB gzip) exceeds the 500 KB warning threshold. This does not establish mobile-device performance or an extended streaming soak.

The bounded `representative-real-v2` campaign is terminal: four sources compiled (Accra, Cape Town, London and Nairobi), three exceptions (Sahara and Antarctica empty, Fiji transport failed twice), and protected Nigeria remained excluded; no work is queued or leased. Cumulative campaign accounting is 113,303,391 bytes (49,303,391 measured and 64,000,000 reserved with Fiji transfer unknown). Priority ordering and migration fixes are accepted. See [M2-VALIDATION.md](M2-VALIDATION.md); this is not whole-world coverage.

## Regional conditions and representations

[ENVIRONMENT.md](ENVIRONMENT.md) documents six pinned NASA POWER/MERRA2 point climate normals for 1991–2020. Cache-only rebuilds require no new download. They are separate immutable sidecars and are not yet attached to packs. The bounded terrain importer has completed a reproducible cache-only verification from its retained extract and sidecar; terrain conversion and pixels are not attached to campaign packs, and the initial bounded DEM download measured 3,511,272 response-body bytes. See [M2-VALIDATION.md](M2-VALIDATION.md) for measured hashes and samples. Climate normals are distinct from current weather; Africa has multiple climates. Building heights and missing elevation are explicitly labelled. Exact facades/interiors and photorealism require further source rights and measured rendering budgets.

The user-authorized Nigeria rendering improvement is isolated on `codex/nigeria-rendering`, commit `6ad7579b`. Its visual changes preserve Nigeria geography, IDs, saves, catalogue, routes and database. Builder ingestion still excludes Nigeria.

## Validation and next milestones

```sh
node_modules/.bin/tsc -p world/tsconfig.json --noEmit
node --experimental-strip-types --test --test-concurrency=1 world/*.test.ts world/preview/*.test.ts
.cache/world-build/tooling/venv/bin/python3 -m unittest discover -s world/tooling -p '*test*.py'
node_modules/.bin/vite build --config world/preview/vite.config.ts
```

Latest checks: 100 Node tests passed; TypeScript passed; acquisition Python tests 8/8; terrain Python tests 8/8; preview production build completed. The independent preview bundle is 595.78 KB minified JS / 155.73 KB gzip, plus 11.40 KB CSS / 3.34 KB gzip; it exceeds the 500 KB warning threshold. See [M2-VALIDATION.md](M2-VALIDATION.md) for evidence paths, measured terrain values and remaining gates. Finer global administrative/city inventory, terrain geoid conversion and pack attachment, climate attachment, streaming soak/device measurements, distribution licensing and a tested gameplay adapter remain required. Agents only work while the session is active; unattended execution requires the bounded runner and an awake machine.
