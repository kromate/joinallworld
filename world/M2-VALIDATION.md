# Production ingestion checkpoint

This extends the historical M1 report in `VALIDATION.md`. It records small real-source pilots, not global detailed or playable coverage.

## Reproduce and inspect

Run from the isolated world worktree after the private tooling setup in `tooling/README.md`:

```sh
node --experimental-strip-types world/bootstrap-cli.ts
node --experimental-strip-types world/campaign-cli.ts status representative-real-v2
node --experimental-strip-types --test --test-concurrency=1 world/*.test.ts world/preview/*.test.ts
node_modules/.bin/tsc --noEmit -p world/tsconfig.json
.cache/world-build/tooling/venv/bin/python3 -m unittest discover -s world/tooling -p '*test*.py'
node_modules/.bin/vite build --config world/preview/vite.config.ts
```

The config is `campaign-fixtures/representative-real.json`. Resume with `campaign-cli.ts resume` and the pinned absolute inventory manifest path plus an explicit `--max-jobs`; review remaining caps before a fresh run. `run` and `resume` both reuse durable stages and verify immutable output. Source, ledger and receipt files are never exposed by the preview route; it serves only bounded hashed manifests, tiles and inventory assets.

## Actual evidence

Ignored artifacts live under `.cache/world-build/evidence/`. `accra-overture-acquisition-v2.json` records 314 features, 113,357 output bytes, 16,519,093 response bytes, 44,826 ms; extract SHA `16fa23b6761af554a7cb11c9fa979bef5ddaed46cf2216b006e92094923fe26d`. `representative-v2-first-job.json` records cached Accra compiled with zero new network data: 12 tiles, 233 buildings, 81 roads, 127,539 serialized bytes. Neither sample supplies measured ground elevation or exact house facades/interiors.

The historical v1 extract fetched 18,586,592 response bytes. An early cache-budget recovery experiment fetched another 16,317,010 bytes after incorrectly treating a valid cache over a reduced budget as corrupt. That behavior was fixed and regression-tested: valid over-budget caches now fail without quarantine or redownload. Including the fresh v2 request, these three known runs consumed 51,422,695 measured response bytes. Tool installation and separately pinned Natural Earth/climate source downloads are separate. A campaign's zero-byte cache hit does not mean development fetched zero data.

Tests use unique temporary roots/injected adapters, including interrupted resume, exact damaged-output repair, cache verification, durable failure reservations and shared-lock exclusion/cancellation. Actual previews and their source/output caches are not fault-injected. Successful receipts retain measured bytes; failed/interrupted attempts explicitly store an unknown measurement and a conservative reserved upper bound rather than claiming zero.

Browser artifacts include `inventory-fiji-desktop.jpg`, `inventory-fiji-mobile.jpg`, `inventory-antarctica-desktop.jpg`, `inventory-nigeria-protected.jpg`, and `accra-v2-desktop.jpg`. Fiji's wrapped outline and Antarctica were inspected; Nigeria remains a protected legacy entry. Accra is geographic footprint geometry with explicit estimated heights, not a playable destination. Desktop/browser emulation is not a physical-device performance measurement.

## Remaining acceptance gates

The current world suite passes 78 tests and world TypeScript validation passes. Complete final Python and preview-build checks and record exact results. Complete all representative acquisitions, including measured empty results for sparse/polar probes; report unknown or failed coverage honestly. Further gates include finer global inventory, terrain datum handling and ingestion, climate attachment, multi-cell streaming, physical-device and journey measurements, distribution licensing and the gameplay adapter. No whole-world deadline is supported by these pilots.
