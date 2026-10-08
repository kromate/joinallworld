# Isolated index resource and recovery witnesses — 8 October 2026

The fixed-worker Unix supervisor in `tooling/index_resource_limits.py` now applies
kernel file-size/CPU limits, disables core files, caps V8 old-space, samples the
owned process RSS, bounds stdout/stderr and waits for terminal cleanup. It accepts
only three repository workers and fixed witness cases; it never accepts a shell,
code string, arbitrary script or real index path. Its own temporary directory is
removed after the worker exits, including signal/timeout cases. This is a
disposable experiment supervisor, not the durable campaign/index runner.

Actual focused acceptance: **12/12**, terminal exit0. These include nine SQL/worker
witnesses plus invalid admission, stricter inherited limits and fail-closed live
RSS-measurement failure. All checks are serialized through the existing heavy
slot; no browser/server, acquisition, source-attempt increment or game write.
Evidence is under `.cache/world-build/evidence/`; retain earlier failed experiments.
Current typed-source receipts: `index-resource-typescript.json` / `.stderr`,
`index-guarded-positive-typescript.json` / `.stderr`, and
`index-identity-stress-typescript.json` / `.stderr`. The focused receipt binds the
executed guard/witness/test sources; the separate acceptance binding records
positive/stress receipt hashes and the unchanged feature helpers.

GRAPHICS' distinct PR22 CI37845576239 caught the inherited tracked capacity `.mjs`
outside the exact release JavaScript allowlist. WORLD converted all three fixed
workers to `.ts` and added strict types; no policy allowlist/cap changed. The
initial World compiler exposed three typing errors, corrected before acceptance;
earlier logs remain preserved. The clean release source gate is run on an exact
committed Git archive to exclude real ignored caches without deleting them.
This is a targeted repository-policy check, not a full game or release build.

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- env NODE_OPTIONS=--max-old-space-size=1536 .cache/world-build/tooling/venv/bin/python -I -m unittest discover -s world/tooling -p test_index_resource_limits.py -v
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- env NODE_OPTIONS=--max-old-space-size=1536 .cache/world-build/tooling/venv/bin/python -I world/tooling/index_resource_limits.py --node /usr/local/bin/node --worker capacity --file-bytes 2097152
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- env NODE_OPTIONS=--max-old-space-size=1536 .cache/world-build/tooling/venv/bin/python -I world/tooling/index_resource_limits.py --node /usr/local/bin/node --worker identity-stress
```

Use the actual absolute local Node executable. This machine has Node22.19.0 /
SQLite3.50.4 in the writer and private Python SQLite3.53.1 in the independent
disposable reopen. The tests do not establish same-version replay or real ledger
crash recovery. The Python environment and game dependency pins are unchanged.

| Witness | Observed outcome |
| --- | --- |
| Commit | Independent reopen retains baseline plus four committed rows |
| Kernel per-file cap128KiB | WAL stops at131,072bytes; Node fails with SQLITE_IOERR_WRITE778; no new row committed |
| Database16-page limit | SQLITE_FULL13; complete write transaction rolled back |
| Abrupt SIGKILL |255,472bytes of actual uncommitted WAL frames; reopen retains only baseline and integrity_check=ok |
| CPU1second | SIGXCPU; baseline survives |
| Wall1second | Supervisor kills and reaps only its owned process group; baseline survives |
| Sampled RSS64MiB | Bounded96MiB native allocation is observed above threshold and killed; baseline survives |
| Stdout1,000,000bytes | Oversized fixed output kills worker before extending the buffer past its cap |
| Live RSS unavailable | Guard fails closed and waits for owned worker termination |

The receipt stores source hashes, real return codes/signals, limits, observed RSS,
physical pre-recovery sizes, SQL error codes and independent recovery results.
Short workers can finish before another RSS sample: sampled values are not peak
measurements. Node `resourceUsage().maxRSS` is recorded separately for positive
capacity and stress workers. Neither quantity certifies total laptop memory.

The guarded cached Dakar profile conserves the prior result:2,283 ordinals,
1,810 unique versions,473 duplicates,0 conflicts,0 network. The2MiB per-file guard
admits its1,800,472byte WAL and1,630,208byte checkpointed database. The profile
deletes only its own scratch; the supervisor also owns its TMPDIR so fatal worker
exit cannot strand uncharged temporary output outside that experiment directory.

Synthetic stress:19,000,177byte complete Feature parses, admits and matches a
separate literal canonical ASCII byte/hash vector, with four positions and stable
owner. The20,000,001byte input is rejected before decode/traversal. Observed peak
RSS was241,888KiB (approximately236MiB) in the initial guarded receipt; the typed
rerun records its own peak separately. This is a near-byte-cap string case, not maximum
node/depth/geometry/capture-row/index or whole-world throughput acceptance.

## Native heap capability correction

Our actual Node SQLite build has `DEFAULT_MEMSTATUS=0`. PRAGMA hard_heap_limit
reports8,388,608, but the controlled allocation still returns8,388,608bytes of text:
the limit is **not enforced**. Earlier expected-SQLITE_NOMEM tests failed and are
preserved in `index-resource-focused.stderr` and `index-native-heap-{first,second}.json`.
The final capability fixture measures this fact; it never calls it a heap-cap pass.
SQLite documents that disabled memory accounting prevents heap-limit enforcement:
[SQLite allocator limits](https://www.sqlite.org/c3ref/hard_heap_limit64.html).

Do not freeze a native hard-heap contract for this Node runtime. Keep bounded input
and individual SQL payloads, small explicit cache/temp policies, V8 limits and
fail-closed process supervision. RSS sampling has a100ms interval plus measurement
time, so allocation can overshoot between readings; it is not a kernel hard RSS
limit. The96MiB allocation witness deliberately demonstrates that distinction.
Python/Apple document CPU/file limits separately from memory:
[Python resource](https://docs.python.org/3/library/resource.html),
[Apple getrlimit](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/getrlimit.2.html).

## Durable store requirements still open

FSIZE bounds each file, not aggregate disk, file count, reservations or mapped
memory. Current defaults4MiB/file, CPU10s, wall15s, V8 heap256MiB, sampled RSS384MiB,
stdout1MB/stderr64KB are **experiment limits**, not country-store quotas.
Inherited stricter soft/hard limits are retained. No experiment deletes a real WAL,
reduces an unknown reservation or retries a source acquisition.

Next implement the actual compact index schema and bounded transaction writes,
then measure its largest admitted capture, metadata/exception/conflict pressure,
same-version reopen, blocked checkpoint and altered-pin replay. Freeze database,
WAL/shared-memory, audit, transaction and aggregate reservation limits from that
schema; enforce them before existing fenced query completion. A full shard must
stop with evidence, not reset its reservation or silently omit features. Preserve
database and WAL together on every failure. Link complete capture pins and every
original ordinal, retain all body versions, and distinguish duplicate observations
from conflicts. Independent raw/index conservation and ledger-after-index crash
replay remain mandatory before country compilation/streaming promotion.
