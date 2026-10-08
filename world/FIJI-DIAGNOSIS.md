# Fiji antimeridian acquisition diagnosis

This diagnosis uses only the retained acquisition attempts, the campaign ledger, local acquisition code, and the already-cached Overture STAC item index. No network request, download, retry, attempt reset, or cache mutation was performed during this investigation.

## Evidence

Both Fiji attempts used request hash `50dca48498a75f98b449a48be7bdc3fef4897ffd9c5fe7e57ab2a29f60bca38a`, release `2026-09-23.1`, layers `buildings` and `roads`, and bounds `[179.998, -16.8004, -179.998, -16.7964]`. They ended at `2026-10-08T01:36:17.442Z` and `2026-10-08T01:48:16.923Z`, about 162 seconds after each start. Both are below the campaign and request duration cap of 600 seconds and report the same adapter error: `Server returned nothing (no headers, no data)`. Both failure records have `networkBytesMeasured: null` and a 32,000,000-byte reservation upper bound. This rules out a recorded campaign timeout or byte-budget failure, but does not establish how many bytes reached the source before the failure.

The cached release index is internally receipt-verified: 640 items, 268,822 bytes, SHA-256 `e725a41d1bede4ecd02ba16073f77ccc220096304688eb046d5bd6cc9fb9746c`. Applying the same antimeridian split as `split_bounds` to the retained Fiji bounds finds one building and one road item on each side of the meridian (four selected assets total). Their pinned item IDs are `00331` and `00000` for buildings, and `00101` and `00000` for roads. The STAC index path was cached and selected assets exist, so missing STAC/index coverage and an empty dateline selection do not explain this error.

The best-supported diagnosis is a failure along the DuckDB-to-local-range-proxy/upstream HTTPS path. In `world/tooling/acquire.py`, `RangeProxy.Handler._serve` catches `BudgetExceeded` and general exceptions, then closes the local HTTP connection without recording the caught exception. A DuckDB request receiving EOF before the proxy sends response headers can therefore surface as `Server returned nothing (no headers, no data)`, concealing whether the underlying event was an upstream disconnect, TLS/socket failure, or an upstream response rejected by the range-response checks. The retained logs do not contain response statuses, Range headers, the failing asset, or the caught exception. The precise transport cause remains unknown; the message is not enough to label this an S3 outage or a bad Fiji selection.

## Implemented observability change

`world/tooling/acquire.py` now records up to eight bounded range-proxy failures under a lock with layer/item ID, HTTP method, requested Range, phase, exception class, bounded message, upstream status when available, and bytes observed so far. Before sending a successful local response, the proxy buffers only the body covered by its already-reserved range; this lets read failures return a bounded `502` before DuckDB sees success headers. `BudgetExceeded` returns a bounded `429`, while upstream/protocol failures return a bounded `502`. The first recorded proxy diagnostic is attached to the final adapter error, which the existing Node wrapper persists in the attempt reason.

`world/tooling/test_acquire.py` now uses a local fake upstream to check budget rejection (`429`), disconnect-before-headers (`502` with asset/Range context), successful bounded `206` responses after failure, and release of network reservations and the proxy semaphore. The tests use no production cache or preview files. The existing static STAC test continues to cover offline dateline splitting; the retained Fiji item index independently selected four assets.

No `world/acquire.ts` or production-type change was needed: its existing stderr capture persists the richer reason in the schema-v1 attempt record. `networkBytesMeasured` remains null for failures and campaign reservations are unchanged; `networkBytesObserved` is diagnostic evidence only. The diagnostic-only change does not alter request selection, compiler identifier, emitted feature bytes, cache key, request hash, or source identity.

## Remaining limitation

This explains why Fiji's present failure is not evidence that the date-line split selected no source data, and identifies the lost error context. It does not prove which of the four assets or which upstream transport event failed. The new diagnostics will make a future bounded attempt distinguish those cases; the retained historical attempts cannot be retroactively resolved.
