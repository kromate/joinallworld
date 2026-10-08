# Grid-query efficiency: measured Senegal evidence and next bounded cache

## What the first query wave measured

The retained run files are `.cache/world-build/evidence/grid-query-senegal-first.json` and `grid-query-senegal-resume.json`; the acquisition attempt records are under `.cache/world-build/acquisition-attempts/<request-hash>/attempts.jsonl`, and the exact successful extracts/receipts are under `.cache/world-build/acquisitions/<request-hash>/`. The resumed ledger snapshot has five terminal query jobs: two `feature-row-budget` subdivisions and three captured zero-row extracts. It remains only source-query evidence: the report is stopped, has 100 requested roots, one source unit, zero compiled units, and one unknown unit.

| Query cell | Terminal result | Measured network | Extract bytes | Features |
| --- | --- | ---: | ---: | ---: |
| `geo-grid-v1:l1:x324:y209` | subdivided: feature-row-budget | 5,960,788 B | no extract receipt | — |
| `...:q0` | captured | 4,545,131 B | 424 B | 0 |
| `...:q1` | subdivided: feature-row-budget | 5,960,764 B | no extract receipt | — |
| `...:q10` | captured | 3,610,388 B | 424 B | 0 |
| `...:q11` | captured | 3,610,408 B | 424 B | 0 |
| **Total** | **5 jobs** | **23,687,479 B** | **1,272 B** | **0** |

The three successful receipts name the same two release-pinned Parquet asset URLs, each with the same ETag on all three captures. Their recorded per-request URL totals are:

- Buildings `part-00099-e6394e64-4930-59c0-9df2-4c2562e77824-c000.zstd.parquet`: 2,290,795 B (`q0`), 1,618,678 B (`q10`), 1,618,678 B (`q11`), total 5,528,151 B.
- Transportation `part-00036-e8acd769-e478-5f77-a7bc-fe51ed544d87-c000.zstd.parquet`: 2,254,336 B (`q0`), 1,991,710 B (`q10`), 1,991,730 B (`q11`), total 6,237,776 B.

These are measured repeat reads of the same asset URLs, not proof of identical or overlapping byte intervals. Success receipts aggregate bytes per URL and ETag without `Range` or `Content-Range`; the two typed subdivision attempts retain measured network totals but no successful upstream URL breakdown. Therefore avoidable duplicate range bytes and savings are **unknown**, not the 11,765,927 B aggregate from the three successful receipts. The latter is only the repeated-URL byte total visible in those receipts.

## Existing path and useful invariants

Each campaign query calls the existing `acquireRegion` path with the same pinned Overture release, a distinct region/request identity, and the existing per-request network/output/features/duration/disk limits. The Node acquisition path serializes work with `withAcquisitionBuildLock`; it validates cached extracts by request hash and receipt before returning them. The Python adapter caches STAC collection/item metadata and the selected item index in the release-scoped `sourceIndexDir`, but each fresh request creates a new `NetworkBudget` and `RangeProxy`.

`RangeProxy` maps DuckDB HTTP reads to allowlisted asset URLs. It validates byte ranges and `Content-Range`, identity encoding, pinned asset length, and ETag consistency within that adapter process. It reserves the requested response span plus bounded header allowance before network access; successful upstream response headers and body bytes are charged to that request. Its `upstream` receipt rows combine traffic by URL/ETag, not by range. The proxy has a per-process semaphore of two and records range details only for failures. It does not persist successful Parquet ranges between query requests.

## Smallest next implementation

Extend this same `RangeProxy` with a release-scoped, bounded, immutable **exact-range cache**. Keep STAC discovery, selection, DuckDB, source compiler, campaign ledger, and request/cache identities intact; do not introduce another downloader or scheduler.

A cache entry must bind the exact release, exact validated asset URL, STAC `file:size`, strong ETag, requested inclusive start/end, returned status and exact `Content-Range`, identity encoding, body length, and SHA-256. Weak or absent ETags are not eligible for persistent reuse. Only a validated 206 byte-range body is stored; do not cache whole-file responses or HEAD responses. Names should be content-addressed by the canonical identity tuple, with a bounded canonical sidecar. Re-read through no-symlink bounded file APIs and verify metadata, body length, and hash before use; a corrupt entry is a cache miss or a fail-closed integrity error, never trusted bytes.

A cross-invocation hit cannot assume that a previously observed ETag remains current. Before serving persistent bytes, obtain a bounded upstream HEAD for that exact URL and verify the current strong ETag and file length against the cache entry (using `If-Match` where supported). Charge those actual HEAD response bytes to the current request. If validation fails or the origin lacks a strong validator, fetch the requested range normally and account every response byte; never serve stale cached content. Same-process cache reuse can use the ETag already validated by that proxy. Cached body bytes do not count as network bytes, but no network reservation is waived for an actual upstream miss, HEAD validation, or retry.

Place the cache under the existing canonical allowed root and release-scoped acquisition index, e.g. `acquisition-index/<release>/ranges/`, so existing shared-root path checks and cumulative disk accounting can cover it. Add one aggregate cache byte/entry cap and preflight before atomic writes; include temporary-write headroom and the normal free-space reserve. The cache is opportunistic: if its quota or disk headroom is full, skip the write and serve the verified upstream response without exceeding the acquisition’s network, disk, or duration caps. Do not evict or rewrite STAC index/extract/receipt artifacts. Continue using the existing acquisition build lock; use per-key single-flight inside the adapter for concurrent identical misses, and publish a complete body plus metadata atomically only after all HTTP checks pass.

The first version should reuse only exact `(URL, ETag, start, end)` spans. It can eliminate byte-for-byte repeated footer/row-group ranges, but it will not merge partially overlapping ranges. Keep that limit explicit; a range-interval assembler should require measured range traces and separate tests before admission.

Add bounded success telemetry for range-cache hit/miss, requested span, response span, ETag, cache body hash, and upstream bytes, with a strict row/byte cap. Preserve existing schema-1 acquisition receipts and cache identities; add a backward-compatible optional diagnostics record or versioned audit envelope rather than changing the existing `upstream: [{url, etag, bytes}]` interpretation. This telemetry is necessary to prove savings: compare identical pinned release/URL/ETag/span tuples across separate requests, and keep saved body bytes separate from measured network bytes. Cache hits must not change request hashes, outputs, selected features, source manifests, or compiler behavior.

## Acceptance before enabling it for more queries

Use only a local fake HTTPS/range server in tests. Cover exact hit, HEAD ETag match/change/missing/weak validator, changed file length, malformed/short/oversized `Content-Range`, non-identity encoding, corrupt or symlinked cache entries, atomic interruption, two concurrent identical misses, a full cache quota that safely skips writes, and an upstream miss whose full bytes still hit the original per-request budget. Assert that `NetworkBudget.total` counts actual headers and bodies only, that local cache hits do not erase or rewrite old acquisition receipts, and that output bytes/features/request hashes are identical with cache enabled and disabled.

Only after those checks should a later bounded real query wave collect exact range evidence and measure actual cache hits/saved bytes. The current receipts establish repeated Parquet URLs, but they do not establish overlapping ranges or a numeric savings forecast.
