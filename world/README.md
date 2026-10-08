# Independent world-data builder (M1)

The standalone builder compiles a pinned local GeoJSON plan into immutable tiles and a manifest under `.cache/world-build/output/`. It does not connect to game saves or databases. The published Accra pilot manifest is served by the separate preview at `/world-output/manifests/<manifest-sha256>.json`; its tile URLs are relative to that output root.

From the repository root, inspect the plan, run one bounded job, inspect durable job status, and start the local preview with:

```sh
node --experimental-strip-types world/cli.ts plan world/pilots/accra-config.json
node --experimental-strip-types world/cli.ts run world/pilots/accra-config.json --max-jobs 1 --duration-ms 30000
node --experimental-strip-types world/cli.ts status
npx vite --config world/preview/vite.config.ts
```

Input bytes and SHA-256 must match the plan. Jobs are keyed by source/config/compiler/schema identity. Compilation runs in a worker that is terminated at the wall-clock limit. Output is content-addressed, immutable, and the manifest is published last. Re-running a completed job checks manifest and tile hashes; missing or altered output is a surfaced failure. Build files and the local SQLite ledger stay inside `.cache/world-build/`; the builder rejects Nigeria plans.

`COMPILER_VERSION` in `world/pipeline.ts` is a manual cache and job identity version. Bump it whenever a compiler behavior change can alter output bytes, even if the schema stays the same. Schema changes use the schema version in the world contract.

Only one CLI run can hold the local runner lock at a time. A run can process earlier queued jobs before reaching the plan just submitted; its JSON reports completed, queued, leased, and failed jobs. CLI exit code `2` means its job or the bounded queue still needs a later run; exit code `1` means failed work or invalid input.

The runner accepts bounded local GeoJSON plans only. It does not execute shell commands, make model calls, download input data, fetch outside URLs, or build the global world. Coverage remains foundation-level, with no terrain or climate ingestion and no game adapter. Preview and pilot claims remain limited to the source extract captured in the plan. Performance, whole-country completion, and playable-world claims require later measured milestones.

A completed job with missing or corrupt output fails closed. There is no automatic or CLI repair command yet. For operator recovery, stop all world CLI runs, preserve a copy of `.cache/world-build/`, move only the reported damaged content-addressed file out of `output/` (if it exists), then move `world.sqlite` and any `world.sqlite-wal`/`world.sqlite-shm` files to an evidence directory under `.cache/world-build/`. Rerun the same plan; the new ledger will compile again and immutable valid files will be hash-checked and reused. Keep the preserved evidence until the rebuilt manifest and tiles verify.

For the complete contract and future rollout gates, see [IMPLEMENTATION.md](IMPLEMENTATION.md), [ROLLOUT.md](ROLLOUT.md), and [RESEARCH.md](RESEARCH.md). Accra source attribution and conversion details are in [pilots/README.md](pilots/README.md).

Run the world-specific checks with:

```sh
npx tsc -p world/tsconfig.json --noEmit
node --experimental-strip-types --test world/*.test.ts
```
