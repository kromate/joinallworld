# Isolated index resource and recovery witnesses — 8 October 2026

## Persistent fixed-registry controller — 9 October 2026

Use `tooling/index_registry_controller.py:restartable_registry_startup` with the
same explicit pins and runtime as `startup_index_namespace`. The additional
`attempt_limit` defaults16; CPU10s/wall15s/RSS96MiB limits and source/budget/runtime
bindings are immutable for this namespace. Each admitted attempt retains its full
wall reservation, even after controller death. No actual source capture or campaign
job is dispatched by this API. Source/version changes need explicit migration,
not quota reset or overwriting the existing record with new pins.

Records, execution and reclaim have fixed namespace-relative names. The parent
holds the permanent namespace flock before copying and the fixed native worker
inherits it. Busy means preserve and wait; no remembered-PID signalling. After
reacquiring the lease, incomplete record/source prefixes resume only against the
same pinned bytes. A complete owned execution slot is verified before reclamation;
partial deletion verifies its surviving subset. The initialized-registry witness
prevents missing/replaced ledger files from becoming an empty successful registry.
Lost attempt/witness files and identity-free witness prefixes fail closed; never
delete them to regain an attempt budget. Initial legacy adoption interrupted after
the ledger witness but before its attempt record is deliberately preserved for
explicit reconciliation. No arbitrary snapshot directory is removed.

Current acceptance is167 Python/23 engine checks and the actual controller-loss/
fresh-controller fixture; exact source pins, measurements and failed historical
receipts are in PROGRESS.md. This is cooperative local POSIX ownership, not an OS
sandbox or proof against manual valid-record rollback. It does not establish
power-loss durability, native capture transaction/campaign recovery, global
throughput, physical-phone performance or a background service while the app sleeps.

## Fixed registry startup — 9 October 2026

The latest phase passes146 Python and23 engine checks. See PROGRESS.md for exact
source pins, receipts and measurements; older counts below describe prior phases.

Use `tooling/index_registry_startup.py:startup_index_namespace` for a supervised
initialize/reopen report. Supply the existing canonical owned0700 namespace,
immutable aggregate allowance, repository root, canonical complete tooling manifest
and exact bytes/SHA pins, retained source configuration and its pin, absolute Python
executable, and exact Python/SQLite versions/executable bytes/SHA. CPU and wall
limits default10/15seconds; sampled RSS defaults96MiB, per-file ceiling4MiB. The API
acquires the actual namespace lease before frozen snapshot creation and delegates
SQL to the fixed Python worker. It returns only after the worker exits; it does
not yield a live writer for later campaign operations. Do not wrap an unsupervised
long-lived `open_index_namespace` around production work and call that this API.

An actual controller-death fixture verifies inherited lease/snapshot survival and
replacement refusal. The fixed lease witness is test-only, not an acquisition/job
endpoint. Selector setup/cleanup failures preserve reaping/retention semantics;
leader exit with open inherited pipes is bounded and fails with
`IndexWorkerUnreaped`. That exception retains its actual process handle and frozen
snapshot while this controller lives. A terminal leader alone does not establish
descendant exit. Never delete a preserved namespace, snapshot or lock based only
on that leader's return code or a vanished controller.

Persistent pre/post-spawn records and orphan reconciliation remain unimplemented.
Do not claim unattended recovery until that durable mechanism and real controller
loss are exercised together. CPU/file/core limits are kernel enforced; RSS remains
sampled plus worker-reported peak, not a kernel hard group-memory bound. The Python
binary/version pin does not hermetically bind every imported runtime file. No paid
jobs, new country captures or production runtime artifacts are involved.

## Current namespace opener and worker integration — 9 October 2026

Latest focused implementation adds `tooling/index_namespace.py` and paired namespace
and child descriptor inheritance to the fixed bootstrap worker.126 Python/23 engine
checks and World compiler pass; exact receipts and measured bounds are in PROGRESS.md.
The older experiment descriptions below are historical, not the current complete
worker list or acceptance count.

Use `open_index_namespace(existing_private_root, immutable_aggregate_bytes)` only
inside the eventual bounded controller. It requires an existing owned0700 directory
and a finite kernel per-file limit no greater than4MiB. It acquires the permanent
namespace lock, verifies/resumes canonical metadata and the staged/final registry,
and yields its actual lease and live `IndexReservations`. Pass those directly to
`charged_index_root`, then the resulting admission to `bootstrap_index`. Do not
fabricate descriptors or rename/delete lock inodes. A live native worker inherits
both references; only confirmed worker termination permits normal release/reopen.

Metadata pins the actual Python SQLite runtime as well as format/schema and budget.
A runtime/schema/budget change is a separate explicit migration namespace, never a
silent update/refund of the existing ledger. Foreign, mixed, unbound, oversized,
or corrupt state fails closed. Interrupted expected prefixes and valid bootstrap
files resume in place; neither caller nor helper deletes unknown SQLite sidecars.
SQLite read-only connections occur after the kernel lease because shared-memory
sidecar changes are possible even with mode=ro.

**Still external/unaccepted:** persistent controller state and PID/snapshot recovery,
registry CPU/wall/RSS process supervision, controller SIGKILL recovery, capture
transaction crash/blocked-checkpoint pressure, measured global/shard limits,
fenced campaign completion and independent source/index audits. Passing the library
fixtures is not permission to run an unbounded real namespace or claim unattended
country coverage. Power-loss durability is not established by process-exit tests.


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
Actual typed sourcea27bbe170477e87739c8238eccc8d088508085d0 passes World TypeScript
at1536MiB, all12 guard cases (3.001s), both guarded profiles and all five clean
release-policy tests (141.38ms). The exact archive has133,352,146 logical bytes;
its owned temporary archive/checkout were removed. Receipts include
`index-resource-world-typecheck-corrected.{stdout,stderr}` (empty, exit0),
`index-resource-clean-release-policy.{tap,stderr}` and
`index-resource-typescript-binding.json` with actual source/evidence hashes.
Initial compiler failure is retained separately. This is a targeted repository-
policy check, not a full game or release build.

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
The current typed stress peak is242,336KiB (approximately237MiB); cached profile
peak139,312KiB (approximately136MiB). Supervisor wall times377.96/296.53ms are
distinct from inner profiling times and are not country throughput forecasts.

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
