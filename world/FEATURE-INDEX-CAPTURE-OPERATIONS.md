# Durable verified-capture attempts

`tooling/index_capture_controller.py:ingest_capture_job` runs within a held
`supervised_charged_index` session. The existing campaign Ledger remains the
scheduler. This endpoint owns one immutable request's ingestion attempts; it
does not download data, register a campaign observation or complete a campaign
claim. Namespace startup/admission's existing 16 lifetime attempts stay unchanged.

Before allocating execution files or launching SQL, the controller verifies
the actual paired leases, source/tooling/runtime pins and readonly retained
extract/receipt. The capture record fixes both canonical cache paths and a
SHA/length pin of the complete canonical capture expectation, which includes
the exact request and both raw byte pins. A request cannot be redirected to
another path or expectation. A fresh worker still rereads and rehashes the raw
data before SQL; the parent never opens SQLite.

The owned private index contains only four additional fixed control files:
`capture.json`, `capture.pending`, `capture.anchor.json` and
`capture.anchor.pending`. Record and pending record each have a **512,000-byte**
ceiling; anchors each have a 4,096-byte ceiling. Immutable header limits allow
at most **256 distinct requests / eight lifetime attempts per request**. These
are ceilings for one bounded index shard, not a whole-world request count.
Exhaustion preserves state and refuses more work; neither failed attempts nor
successful replay refund/reset a charge. Larger campaigns require separately
admitted shards and measured partitioning, which remain future work.

Each request moves from prepared input ownership to fixed snapshot identity
and terminal settlement. The explicit `current` request owns the sole execution
slot, preventing old attempts from becoming ambiguous when a directory inode
is reused. The terminal digest is deterministic attempt settlement; it is
**not proof that the capture exists**. Every successful API call, including a
previous terminal request, performs a fresh fixed-worker raw replay through the
actual feature index and validates ordinal conservation, report and physical
state. This verification consumes another bounded attempt.

The permanent quota anchor binds the exact root/lock/index identity and limits.
A missing initialized record or a missing post-launch anchor refuses recovery;
it never starts a new ledger. Only the first unlaunched record can finish an
interrupted initial seal. Fsynced pending writes resume only when they are an
exact prefix of the deterministic next state. Contradictory state is preserved.

`capture.execution` is one private, readonly, source-pinned execution tree;
`capture.reclaim` is its interrupted cleanup slot. Both are explicitly admitted
into the index footprint and share a **1 MiB physical allowance**. Admission
reserves both maximum record slots, the execution allowance, block padding,
four database-file ceilings and the existing 2 MiB margin inside the original
index reservation. No registry/index/process cap increases. Persistent execution
already belongs to the root footprint and is not charged twice as an external
temporary snapshot; the anonymous capture envelope is charged separately.

The fixed worker inherits both permanent lock descriptors and all three
readonly capture descriptors. An unconfirmed exit preserves the exact snapshot,
record, raw descriptors and database/WAL. The same lease object is poisoned and
cannot start another request. Recovery must leave that session and acquire the
actual kernel leases afresh; a surviving worker blocks acquisition. Recovery
never kills a PID remembered in a state file. After the writer gap is proven,
the old attempt remains charged, the verified owned snapshot is reclaimed,
and another fresh attempt replays the exact raw input. Partial cleanup verifies
every pinned readonly survivor before deletion; foreign paths are preserved.

The bootstrap worker allows only final capture record/anchor and the private
live execution slot. Pending record/anchor, reclaim, unknown paths, mixed SQL
staging and foreign databases refuse before opening SQLite. The footprint check
includes all declared capture control files and both bounded execution slots.

## Validation and remaining work

Actual forced-worker and native-controller-loss evidence, exact source pins,
resource measurements, retained failed fixtures and regression results are
recorded in [PROGRESS.md](PROGRESS.md). Tests use disposable namespaces with two
retained Dakar captures; actual acquisition/campaign/output/Nigeria/game state
is untouched. No runtime build/upload or additional explorable city is implied.

Next validate exact claimed query membership against the frozen campaign/grid
plan, pass the bound observation into the engine's existing atomic transaction,
and complete the campaign Ledger only with its current live lease token after
actual index verification. Indexed-but-pending claims must replay safely, and
legacy completed capture jobs need explicit reconciliation. Then independently
reconstruct all raw ordinals/index membership before publishing owned country
geometry and sharded streaming packs. Full-country throughput, global conditions,
terrain, phone performance and the unattended whole-world objective remain open.

This is a cooperative local POSIX ownership boundary, not an OS sandbox or a
power-loss/arbitrary-corruption repair guarantee. Deleting both colocated quota
record and anchor outside the owned API is outside this mutation model; source
pins and actual leases do not prevent a hostile process owned by the same user.
