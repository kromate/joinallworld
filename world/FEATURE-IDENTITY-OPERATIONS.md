# Strict capture and positive overlap acceptance — 8 October 2026

The builder now verifies bounded, unambiguous raw JSON; exact extract/receipt
pins and original ordinals; and request identity reconstructed from the retained
source configuration. Use `bindConfiguredCapture` for the later ingestion hook.
Existing acquisition/cache readers, game IDs/data, Nigeria and output pins are
unchanged. This is builder acceptance, not a deployed gameplay change.

Focused capture/identity/country-grid/pack checks passed **53/53**, terminal0,
1,069.44ms. This includes22 new capture cases and31 existing cases. World
TypeScript passed at the unchanged1536MiB heap. Evidence:
`.cache/world-build/evidence/capture-ingestion-focused.{tap,stderr}` and
`capture-ingestion-world-typecheck.{stdout,stderr}`. No full-world/game-suite pass
is claimed.

Run the focused checks sequentially through the shared heavy wrapper:

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- env NODE_OPTIONS=--max-old-space-size=1536 node --experimental-strip-types --test --test-concurrency=1 world/capture-json.test.ts world/capture-binding.test.ts world/capture-request.test.ts world/feature-identity.test.ts world/country-grid.test.ts world/pack.test.ts
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- env NODE_OPTIONS=--max-old-space-size=1536 node node_modules/typescript/bin/tsc -p world/tsconfig.json --pretty false
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- env NODE_OPTIONS=--max-old-space-size=1536 node --experimental-strip-types world/tooling/profile_feature_identity.mjs
```

The last command is a cache-only, disposable experiment using accepted Dakar
pins0/1 in `regional-fanout.json`. It does not call acquisition or alter real
ledgers/output; missing/corrupt inputs fail, with no network fallback. Temporary
SQLite state is closed/deleted in `finally`. Keep resource ownership/handoff rules.

| Measured item | Actual result |
| --- | ---: |
| Original rows |473 +1,810 =2,283 |
| Admitted / exceptions |2,283 /0 |
| Unique keys and body versions |1,810 /1,810 |
| Exact duplicate observations / conflicted keys |473 /0 |
| Aggregate extract/receipt bytes read |793,794 |
| Network bytes |0 |
| Maximum canonical Feature / compact version |1,108 /494 bytes |
| Maximum positions in a Feature |36 |
| Before checkpoint: DB / WAL / shared memory |4,096 /1,800,472 /32,768 bytes |
| After checkpoint: DB / WAL / shared memory |1,630,208 /0 /32,768 bytes |
| Experiment time / peak RSS |151.17ms /133,664KiB |

Runtime: Node22.19.0/SQLite3.50.4, verified WAL/FULL/foreign keys. Every original
ordinal has one admitted/exception disposition and capture/version foreign keys;
per-capture count/min/max conserve dense ordinals. Completed TRUNCATE counters
are busy0/log0/checkpointed0, with measured WAL zero. All observed duplicates have
identical complete-body versions; no real conflict was exercised by these pins.

Actual receipts: `.cache/world-build/evidence/feature-identity-positive-capacity.json`
and `feature-identity-capacity-acceptance.json`. The latter binds the script/output
hashes, terminal checks and current helper-source hashes. Source configuration:
1,297 bytes/SHA `7ac2f2babcab7e4dd330a2f2e3476708129653022ba7bd0a94c9cbf69184656c`.

These measurements do **not** freeze production DB/WAL/lifetime caps or prove
worst-case memory, crash recovery, index replay, independent raw/index auditing,
country coverage, source-wide omission counts or playability. The database holds
compact metadata/references, not full canonical geometry bodies. Next measure
bounded worst-case/failure behavior, freeze enforceable quotas, implement durable
transactions and fenced ledger integration, then independently audit raw captures
and replay before country geometry compilation. Preserve all reservations and pins.
