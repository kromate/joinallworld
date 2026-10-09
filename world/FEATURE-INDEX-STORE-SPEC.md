# Compact feature-index engine — focused acceptance

Frozen execution and atomic SQL startup now pass **103 Python/23 engine checks and
World TypeScript**, including four actual Node SIGKILL startup/reopen boundaries.
This supersedes pending startup statements below, while the complete supervised
registry opener, capture/controller crash, measured quotas, campaign hook and raw
audit remain open. Current tooling declaration has26 files; older22/20 receipts
remain tied to their original source. See PROGRESS.md for final source/evidence pins.

Charged-directory/binding publication passes **71 focused Python checks**, including
11 root/9 publication cases and actual abrupt binding-worker exits at three boundaries.
Read-only22-input tooling verification passes. This does not initialize the actual
registry/engine or certify engine crash recovery. Older94-check acceptance below
applies to73e090c9. Concurrent browsers/bounded agents are human-authorized;
warning/critical memory defers new expensive work, with small measured serial checks.

Latest continuation: the supervisor process/disposal split, inherited Node descriptor
witness, tooling pins, binding, footprint and charge helpers now pass45 new fixtures,
12 old resource/10 lease/22 engine cases and World TypeScript: **89 focused checks**.
Cached real-engine replay remains exact with0 network. Actual20-file tooling and
Node-binary pin reads pass; declared binding is not a real allocation. See PROGRESS.md
for exact receipts and outstanding opener/bootstrap/crash/campaign/raw-audit gates.
Source73e090c9 also passes5 actual release-source policy checks in its clean archive:
**94 focused checks plus compiler** for this phase. No full runtime build/deployment.

`feature-index.ts` passes 22 guarded isolated fixture cases, the World compiler at
1536 MiB, ten writer-lock cases and cached real-engine Dakar replay. The modified
fixed resource registry passes all twelve existing resource cases again. All
commands are terminal exit zero. **The engine and lease primitive are accepted;
the durable opener, aggregate quotas, abrupt index crash recovery, fenced campaign
hook and independent raw audit are not.** GRAPHICS explicitly closed its owned
QA/server/browser resources and handed WORLD this sole intensive turn.
Committed source `86736a148a2cbba816ba94c6f9ee8ecab29f2ad1` additionally passes all
five actual release-source policy tests in its clean Git archive. Receipt paths
and source/evidence bindings are recorded in PROGRESS.md. This does not certify a
full runtime build or deployment.

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

### Focused frozen execution and atomic engine startup

`verified_execution_snapshot` verifies actual canonical manifest/configuration
pins, reads only fixed26 inputs plus world/acquisition-sources.json through bounded
no-follow descriptors, and copies them to an owned private temporary tree outside
the repository. Directories are0700 and files0400; hashes/sizes/stable inodes and
the exact path inventory are rechecked. Logical/allocated file and directory blocks
are charged. Caller must reap all workers before leaving the scope; cleanup then
removes only that owned snapshot. If the guard cannot confirm exit after its bounded
wait, IndexWorkerUnreaped retains the actual process/root/execution handles and both
snapshot/public experiment runner preserve their owned trees. Pipes/selectors still
close. Persistent unresolved-process supervision remains a controller requirement.
Readonly mode and cooperative ownership are not
OS immutability against an uncooperative process owned by the same user.

`bootstrap_index` requires its actual ChargedIndexRoot, verifies the Node executable
by bounded SHA/size/inode reads before and after execution, and compares tool/source
pins to the canonical binding before SQL. A conservative live allowance includes
four per-file ceilings (database/WAL/SHM/rollback journal), snapshot blocks and2MiB
metadata/directory margin; this remains a candidate, not measured global capacity.
The private guard launches only the registered fixed worker from that verified
snapshot with inherited permanent lease and binding CPU/file/wall/V8/sampled-RSS
limits. Failed workers are reaped before inventory/snapshot disposal; database/WAL
state is preserved. This path does not create/supervise the namespace registry.

The Node worker verifies the root, lease, canonical binding SHA, actual version
constants, Node/SQLite versions and source bytes/provider/release before SQL. Full
capture/request/source-policy reconstruction still occurs at later ingest admission.
Only bootstrap.sqlite may initialize. Final features.sqlite must already carry the
engine application ID/version; schema/limits are verified by the engine. Staging
must have zero data rows. Integrity/foreign-key checks and strict engine checkpoint
precede close; sidecars must disappear through normal SQLite close before file fsync,
cooperative atomic rename and directory fsync. It refuses unknown, mixed, foreign
or orphan state without manually deleting/truncating files. Final replay preserves
the database inode. Registry admission and campaign completion remain external.

Fixed crash witness is distinct from the ordinary bootstrap API and accepts only
four named startup boundaries. Actual SIGKILL with the same NodeSQLite3.50.4 runtime
at empty-file/schema-checkpointed/before-rename/after-rename preserves the stage/final
inode and one charge through ordinary recovery. Schema-checkpointed is an open
native connection after the schema transaction/checkpoint, not a killed ingestion
transaction. This is not power-loss, partial-capture or controller-death proof.
Five snapshot fixtures and nine bootstrap fixtures pass within the103 Python total,
including injected unconfirmed-reap preservation without leaving a real orphan.
The engine adds an empty foreign-user_version preservation regression (23 total).

### Focused charge-before-create directory admission

`tooling/index_root.py` prepares a context receiving the actual namespace lease,
its existing IndexReservations connection and strict canonical binding bytes. The
connection must name private reservations.sqlite with no attached/unexpected temporary
state and retain actual WAL/FULL/page settings. A per-file kernel soft limit≤4MiB
must already be applied; this helper does not alter process limits or initialize
the registry. CPU/wall/RSS/native supervision remains caller-owned and mandatory.

Bounded entry scans reject unknown/unreserved paths, linked/nonprivate registry
files, contradictory charge/binding amounts and registry overhead beyond17MiB.
Existing charged directories require their exact binding before data is accepted;
an empty root/permanent lock alone may be an interrupted allocation. Every existing
root is inventoried under its nonblocking writer lease and declared allowance.
A live inherited child writer blocks new admission before its reservation write.
This is cooperating local filesystem exclusion, not proof against a forged lease
object or an uncooperative same-user filesystem writer.

The new reservation must commit and strictly checkpoint before the SHA-named0700
child is allocated/fsynced. Allocation failure preserves the charge; exact replay
can create the missing root without charging twice. Per-index lease/inode and
terminal footprint are checked before yielding and on normal scope exit. No binding,
database, source snapshot, output or worker is created; new roots contain only their
permanent lock. Incomplete/contradictory existing data is preserved, never adopted,
deleted or repaired. The caller must actually wait for any inherited worker to be
terminal before scope exit; the shared lease descriptor alone does not prove a
writer gap. Namespace/root locks are not the shared agent memory slot.

Eleven disposable fixtures cover ordering/replay/failure, unknown files, symlinks,
changed binding, missing native cap, binding/amount mismatch, existing footprint
overflow and an actual busy child lease. **All11 pass.** Registry canonical bootstrap,
source/tool admission, stable execution tree, atomic binding/database initialization,
physical worst-case quotas and engine/controller crash/ledger/raw audit gates remain.
The tool manifest's fixed input list includes these new helpers (now22); old20-input
accepted manifests are not silently normalized into this new local declaration.

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- env NODE_OPTIONS=--max-old-space-size=1536 .cache/world-build/tooling/venv/bin/python -I -m unittest discover -s world/tooling -p test_index_root.py -v
```

### Focused atomic binding publication

`tooling/index_binding_publish.py` receives the actual ChargedIndexRoot and checks
canonical binding/hash/amount against the private SHA-named root/lease. Only fixed
binding.pending/binding.json are accessed. An owned600 single-link staged file with
0–4096bytes may resume only if its bytes are the exact expected prefix, with no final
or other data files present. A nonprefix, linked/unsafe file or mixed staging/data
state is preserved and refused. The helper appends only missing expected bytes,
fsyncs/verifies the complete file, checks target absence while the exclusive lease
is held, renames and fsyncs the directory. This is atomic publication for cooperating
writers in a private local directory, not an adversarial no-clobber syscall promise.

Exact final replay flushes file/directory without rewriting its inode/bytes. Failure
before rename retains the staged prefix; failure after rename retains the final file
for exact replay. It never truncates or deletes a contradictory file. Root admission
recognizes the narrowly defined staging prefix and rechecks binding on normal scope
exit. The file inventory now bounds binding.pending to4KiB but does not parse or
authenticate it; semantic recovery belongs to the binding barrier, before SQL/data.

Nine fixtures cover new/replayed publication, empty/partial prefixes,
contradictions, rename failure/retry, changed final bytes, root mismatch and symlink
targets, replaced replay descriptors and three actual abrupt worker exits. **All9 pass.**
The abrupt fixture worker inherits the actual root lease, exits77/78/79 after17
prefix bytes, before rename after file fsync, or after rename before directory fsync.
Its terminal status precedes reopened root/publication, conserving one charge and
the original file inode. This is binding process-exit recovery, not power-loss or
Node SQLite engine/controller crash acceptance. Publication itself does not verify actual source/tool pins,
initialize SQLite, launch workers or complete a campaign job. Database bootstrap,
stable source/runtime admission and same-version crash/ledger/raw audit remain next.

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- env NODE_OPTIONS=--max-old-space-size=1536 .cache/world-build/tooling/venv/bin/python -I -m unittest discover -s world/tooling -p test_index_binding_publish.py -v
```

### Focused fixed tooling input verification

`tooling/index_tooling.py` prepares canonical manifest recognition and actual byte
comparison for20 fixed engine/source-validator/runtime-helper files, including its
own file. It requires exact paths and pin fields, no extra/missing entries, per-file
length1–1,048,576bytes, aggregate≤16MiB and retained manifest≤64,000bytes. Decode checks
the actual manifest pin before parsing, duplicate decoded keys and exact canonical
ASCII. It never derives a new pin from damaged source or executes imported source.

Read-only verification traverses directories by no-follow descriptors and reads
bounded64KiB chunks. Owned directories/files may be readable but cannot be writable
by group/world; files must be regular and single-link. Exact source length/hash,
stable descriptor/named inode, timestamps, modes and observed directory/root identity
are checked. Links, missing source or contradictory bytes are preserved and refused.
These checks are for a cooperating local owned filesystem, not an adversarial code
attestation or a promise that every file stays immutable after its check returns.

Seven disposable synthetic source-tree fixtures pass. Actual current20-file byte
verification also passes (200,768source/2,461manifest bytes); the retained manifest
has not been admitted to a durable worker or namespace. The fixed input list is scoped from
current imports; it does not discover new imports, include a future ingestion worker,
verify the Node binary/runtime or prove a stable snapshot for later module execution.
Before wiring, pin/review the actual complete worker closure and execute only from
a stable verified source snapshot. Changing dependencies or code changes its binding;
it cannot silently reuse an old charged index. Source-config admission still belongs
to bindConfiguredCapture. This helper changes no acquisition/campaign/game state.

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- env NODE_OPTIONS=--max-old-space-size=1536 .cache/world-build/tooling/venv/bin/python -I -m unittest discover -s world/tooling -p test_index_tooling.py -v
```

### Focused immutable binding codec

`tooling/index_binding.py` prepares a strict ≤4096byte canonical ASCII config with
exact field sets. It pins engine/identity/capture/source-compiler versions, Overture
release spelling and canonical buildings/roads receipt layers, source configuration
and tooling-manifest bytes/SHA-256, Node executable bytes/SHA-256 and exact runtime
versions, explicit engine/process limits and declared reservation bytes. Pin payloads
are bounded to64,000bytes; executable size to256MiB. Canonical layer order is required,
not silently normalized. Canonical bytes/hash are independent of object insertion order;
alternate raw JSON, duplicate decoded keys and drift do not reopen the same index.

Nine fixtures pass; a932byte declared binding has also been encoded from measured
current tool/configuration/Node pins. No real index reservation was created.
Shape validation is not actual pin
authentication, cross-language equivalence, source admission or runtime support.
The codec permits bounded Node22/SQLite3 version spellings; the actual opener must
match the measured installed versions and binary, not infer compatibility from the
major version. Engine limit ceilings mirror current exports but must be checked
against the actual pinned engine before launch. A source release that passes syntax
still requires existing source-config/request admission. All relevant engine, owner,
canonicalization, validator, worker and supervisor dependencies must be represented
and verified in the future pinned tooling manifest. No manifest reader or real-index
worker exists in this phase. There is no query/campaign identity in the global index
binding: the existing engine stores each fenced campaign observation separately.

Database≤file≤reservedBytes is a necessary shape relation, not worst-case physical
admission. Registry, WAL/SHM, bootstrap, metadata, directory and audit allowances must
be measured, charged and checked by the guarded opener before launch. Changing a
bound requires a distinct index binding, never a quota reset in an existing namespace.

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- env NODE_OPTIONS=--max-old-space-size=1536 .cache/world-build/tooling/venv/bin/python -I -m unittest discover -s world/tooling -p test_index_binding.py -v
```

### Focused retained-process and file-inventory boundary

Private `_run_fixed_process` retains its caller-owned directory and reports owned
worker terminal state before inventory. Public `run_worker` still creates/removes
only disposable scratch. The private helper accepts only fixed repository workers,
checks canonical owned 0700 roots, applies private worker umask, inherits a checked
permanent lease descriptor via pass_fds and rechecks root identity before inventory.
Descriptor/inode equality does not prove a flock is held: its trusted caller must
supply the actual `index_writer_lease`. The fixed Node witness checks descriptor
survival across exec; all four boundary fixtures pass. No public
real-index CLI or durable worker request has been exposed.

`index_storage_footprint.py` passes eight file-only fixtures. It accepts
the actual lease, checks fixed final/bootstrap DB/WAL/SHM and bounded metadata/audit
names, and totals max(logical, allocated) file bytes plus directory allocation.
Unknown files, orphan sidecars, links, nonprivate state and overflow stop explicitly,
preserving every file. Missing/empty sidecars are reported as inventory states; no
row, format, geometry or source completeness is inferred. It never opens SQLite,
parses a binding/reservation or repairs/deletes state. Use it only after the actual
writer is terminal or before launch while the exclusive writer gap is established.

Neither this inventory nor its candidate file/aggregate argument ceilings freezes
production quotas or provides a hard in-transaction aggregate cap. The namespace
reservation registry, immutable binding and guarded atomic bootstrap are still
required, followed by actual same-version engine/parent-worker crash tests and
independent raw conservation. These helpers and modified guard pass the focused
checks above; no durable cache, ledger, game/Nigeria data or source usage changed.

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- env NODE_OPTIONS=--max-old-space-size=1536 .cache/world-build/tooling/venv/bin/python -I -m unittest discover -s world/tooling -p test_index_process_boundary.py -v
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- env NODE_OPTIONS=--max-old-space-size=1536 .cache/world-build/tooling/venv/bin/python -I -m unittest discover -s world/tooling -p test_index_storage_footprint.py -v
```

### Focused immutable namespace charges

`tooling/index_reservations.py` prepares an append-only charge primitive on a
caller-owned idle autocommit Python SQLite connection. It recognizes exact schema,
application/version and six metadata records, refuses unrelated state before
journal mutation, and applies actual WAL/FULL plus a4MiB database page cap.
The immutable aggregate argument includes a candidate17MiB registry overhead;
individual allowances are64KiB–512MiB, binding bytes1–4096, at most256 rows.
These ceilings need measured pressure/physical acceptance and parent process/file
limits before production use. This is not the acquisition/source budget or a queue.

An index hash is the exact SHA-256 of its opaque binding bytes. Each record also
stamps its byte length, amount and binding under this format. Exact replay charges
once; changing the amount or namespace budget is refused. Held-byte total, row count
and a sorted-record digest are updated in the same immediate transaction as the
new reservation. Row deletion or damaged summary is rejected; no reconciliation
operation silently releases or reconstructs the charge. These hashes detect
contradictory state, not an attacker rewriting all database records and metadata.

A failed writer must reopen; a post-commit checkpoint failure leaves its reservation
committed. Strict successful TRUNCATE is required before returning success. A caller's
already active transaction is refused and preserved. Snapshot is a bounded integrity
read, not permission to continue a poisoned writer. Seventeen fixtures cover replay,
overflow, row limits, changed/deleted records, damaged totals, foreign state and
checkpoint/transaction behavior, including a partial summary-write fault;
**all17 pass**. The injected fault is not actual process-crash acceptance.
They own only disposable synthetic
databases and do not admit a real production binding.

The primitive does not own a path, lease, connection close, filesystem allocation or
worker launch. A future guarded namespace opener must authenticate binding semantics,
reserve before creating an index root, hold the actual namespace lease, supervise
registry file/WAL/SHM/journal bounds and preserve uncertain committed state. Index
terminal footprints must fit their own charged allowance. A failed reservation or
unrecognized file is not authorization to reset, delete or retry source acquisition.

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- env NODE_OPTIONS=--max-old-space-size=1536 .cache/world-build/tooling/venv/bin/python -I -m unittest discover -s world/tooling -p test_index_reservations.py -v
```

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
