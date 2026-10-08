# Compact feature-index engine — focused acceptance

`feature-index.ts` passes 22 guarded isolated fixture cases, the World compiler at
1536 MiB, ten writer-lock cases and cached real-engine Dakar replay. The modified
fixed resource registry passes all twelve existing resource cases again. All
commands are terminal exit zero. **The engine and lease primitive are accepted;
the durable opener, aggregate quotas, abrupt index crash recovery, fenced campaign
hook and independent raw audit are not.** GRAPHICS explicitly closed its owned
QA/server/browser resources and handed WORLD this sole intensive turn.

The prior published resource phase remains accepted at ba78e147. This source adds
an engine-test entry to its fixed-worker registry. Run it only
after the explicit terminal handoffs, through one heavy lease:

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- env NODE_OPTIONS=--max-old-space-size=1536 .cache/world-build/tooling/venv/bin/python -I world/tooling/index_resource_limits.py --node /usr/local/bin/node --worker index-engine-tests
```

The fixture entry runs directly as a node:test program in the monitored process,
without `--test` child isolation. [Node 22.19 test-runner documentation](https://nodejs.org/download/release/v22.19.0/docs/api/test.html#test-runner-execution-model)
describes regular-script execution of node:test modules. The actual guarded run
reports terminal exit zero, all 22 TAP tests passing and zero skips/cancellations.
It creates/closes/deletes only unique SQLite
fixtures inside the guard's owned TMPDIR; it reads the tracked public source
configuration, never actual captures, ledgers, output, saves or the network.
This registry entry is not an arbitrary-script or real-index runner.

`tooling/profile_feature_index.ts` passed through the guard, registered
as `index-engine-capacity`. Run it through the same guard only after the fixture
and compiler gates. It reads the two already pinned Dakar products and public
configuration, constructs the actual engine in owned disposable scratch, requires
2,283 ordinals / 1,810 versions / 473 duplicates / zero conflicts or exceptions,
then closes the writer, opens a fresh connection using the same SQLite version and
requires exact replay with no extra rows. It records source hashes, physical sizes,
guarded process evidence and raw replay digests. No network, real index, ledger or
output writes occur. Engine limits and per-file guard are each 4 MiB for this pilot;
they are not durable aggregate admission. SQLite integrity/foreign-key checks and
same-version ordinary reopen are not abrupt-crash or independent raw-audit proof.
Final compact layout stores 2,908,160 database bytes, zero WAL bytes and 32,768
shared-memory bytes, versus the initial same-data layout's 4,038,656 database bytes.
Both conserve all counts and replay digests. Complete compact ingest plus reopen
replay took 264.24 ms inside the worker / 406.64 ms guarded wall time, with
152,496 KiB Node peak RSS; these are a two-capture measurement, not global throughput.
Retain both receipts. The improvement uses bounded remaining version metadata
(body byte count, anchor and position count), retaining tuple/key/body/owner in
dedicated columns, and WITHOUT ROWID tables for keys, versions, conflicts and
occurrences. [SQLite's layout documentation](https://www.sqlite.org/withoutrowid.html)
explains the storage tradeoff; the retained same-data receipts measure this case.

## Accepted engine contract

The engine receives a dedicated caller-owned SQLite connection and all explicit
limits. It refuses a nonempty unrelated database before journal/settings/schema
writes, recognizes exact schema SQL/format/identity hashes, applies page caps and
verifies actual WAL/FULL/foreign keys. It does not own connection close, paths,
writer/root locks, process supervision or aggregate storage reservations.

The prepared tables retain:

- Exact capture request, byte-pair stamp, compiler/configuration pins, original
  feature denominator, ordinal digest and admitted/exception totals.
- Exact source-key tuples and every complete-body version, with derived owner
  and compact identity metadata. Full geometry remains in pinned raw captures.
- One disposition per original ordinal, including duplicates and fixed explicit
  exceptions. Primary/foreign keys and admitted-or-exception checks are structural
  constraints; replay separately checks every original ordinal and dense counts.
- Conflict markers whenever one source key has multiple body versions. Paged
  owner reads return all versions with conflict flags, verify marker consistency
  and never choose a winner or silently omit conflicted geometry.
- Distinct campaign/plan/job/query observations referencing the same capture.
  Query roots accept the existing0–16 grid levels; feature owners remain fixedl1.
  The campaign must validate plan membership/depth/request/job fencing separately.

`ingest` always calls `bindConfiguredCapture` on raw snapshots before its index
transaction. An existing request with different extract/receipt/configuration
pins fails. Exact replay recomputes identities and compares stored tuples,
versions, dispositions, counts, digest and conflict state; it adds only a genuinely
new observation. A reused campaign/job cannot bind a different capture/query.
All capture ordinals/versions/conflicts/observation commit in one immediate
transaction. A failed post-commit TRUNCATE leaves index state committed while the
future ledger stays pending; a reopened writer must verify exact raw replay.
Failed writers cannot continue ingesting. No engine method completes a job.
Source review added pre-insertion conflict/key-membership checks: a new version
cannot repair a missing marker or orphan key. Paged reads compare the separate
source-key tuple as well as derived identity. Capture-loop statements are prepared
once per transaction; no general speedup is claimed. Schema inventory uses a
literal `sqlite_` prefix through GLOB, avoiding LIKE's single-character underscore
wildcard ([SQLite expression documentation](https://www.sqlite.org/lang_expr.html#like)).
Passing fixtures cover these corruption paths, body conflicts across different
owner cells, and complete rollback at each capture/occurrence/version/observation
quota. These focused checks do not certify full raw/index conservation independently.

Paged identity metadata is not raw-geometry/source authentication. A later reader
must follow the explicit key/body source reference, verify actual pinned bytes and
reconstruct the complete body before compilation. Independent raw/index audit
remains a required promotion gate. Schema recognition/counts are not a corruption
or physical-device performance certificate.

## Resources and unresolved integration

### Accepted writer lease primitive

`tooling/index_writer_lock.py` adds a POSIX lease primitive, with ten passing
fixtures in `test_index_writer_lock.py` (21 ms, terminal exit zero). It requires an existing canonical
owned 0700 directory and a regular empty 0600 single-link `writer.lock`. It opens
relative to the held directory descriptor, refuses symlinks and changed inodes,
and takes a nonblocking kernel exclusive flock. The permanent inode is retained
after release; no timestamp/PID timeout or automatic stale deletion is used.

The future supervisor must pass this descriptor through `pass_fds` to its fixed
worker, then close its reference only after terminal cleanup. A live worker's
inherited reference must keep the lease if its coordinator exits. Do not explicitly
unlock: [Apple flock documentation](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/flock.2.html)
states that duplicated/forked references share a lock and explicit unlock affects
all of them. Fixtures cover a competing descriptor, duplicated-reference lifetime,
a fixed child inheriting the lease, exception release, permanent-inode reuse and
unsafe/unknown path/file rejection. The fixed child inherited the descriptor and
retained exclusion after the parent's reference closed. Full coordinator
SIGKILL/worker lifetime and actual index bootstrap/crash
acceptance remain required.

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- env NODE_OPTIONS=--max-old-space-size=1536 .cache/world-build/tooling/venv/bin/python -I -m unittest discover -s world/tooling -p test_index_writer_lock.py -v
```

This primitive is not wired to the engine/supervisor/campaign, does not create a
durable index root, admit/reserve bytes or open a database, and is not the shared
heavy/browser/server memory slot. It is advisory for cooperating local POSIX
processes in private directories, not an adversarial filesystem sandbox or a
network-filesystem certificate. The existing acquisition/campaign lock and charged
reservations are unchanged.

Candidate ceilings are64MiB database,4,096 captures,250,000 occurrences,100,000
versions and16,384 observations, with all caller bounds explicit and metadata
preflighted to4KiB. These are **unmeasured engine ceilings**, not a frozen global
capacity or world-completion promise. Prepared fixtures use4MiB and much smaller
row limits. Node SQLite native heap accounting remains disabled; the prior sampled
RSS/V8/CPU/wall controls and their overshoot limits still apply.

Before production use, implement the guarded canonical file opener/bootstrap and
shared writer/root lock; admit/check database+WAL+SHM+bootstrap/audit against durable
aggregate reservations; measure worst-case rows/metadata/conflicts/page/WAL and
same-version crash behavior; then freeze quotas. Preserve database and WAL together
on every failure. A bounded full store stops explicitly; further worldwide capacity
needs measured sharding/distribution rather than a quota reset or silent omission.

Only after those gates, connect the existing schema2 query runner: index before its
fenced ledger completion; replay indexed-but-pending jobs; retain legacy completed
capture receipts and source usage; reject failed/subdivided/missing acquisition
markers. Do not introduce another scheduler or declare indexed query rows as
country geometry coverage. Independent full conservation/crash audit, compilation,
streaming and country rollout remain next. Nigeria/game data and IDs stay separate.
