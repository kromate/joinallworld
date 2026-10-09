# Supervised complete-plan admission

Accepted source `ab0589e67db3d8dfc8f79733f180753204b67c5b` passes
[run 37905609552](https://github.com/kromate/joinallworld/actions/runs/37905609552):
467 tests, three policy checks and World TypeScript. All 22 diagnostic artifacts
and the 12 changed source/workflow blobs are hashed in
[index-shard-batch-admission-acceptance.json](index-shard-batch-admission-acceptance.json).

This milestone connects a complete frozen shard plan to the actual supervised
registry worker. It admits storage; it does not capture source features, compile
geometry, complete a country or change the production game.

## Dispatch and authority

The Python controller's explicit `_plan_input` contains exact immutable plan
bytes and their SHA-256/length pin. The unchanged V1 base binding supplies the
source, release, tooling and engine limits. The V3 durable controller operation
freezes both pins. Every attempt mirrors that same operation; changing to another
coherent plan refuses before allocating an execution snapshot.

Startup validates the full plan, aggregate budget, private execution snapshot
identity and frozen source configuration before dispatch. The fixed
`index-registry-admit-plan` selector routes to `index_admission_worker.py --shards`.
The binding travels through its private anonymous descriptor; the complete plan
uses the existing bounded two-pipe acknowledged transport. All descriptor,
nonblocking, identity and completion checks remain in force. The parent never
opens registry SQL.

Inside the worker, the streamed plan and base binding reconstruct the accepted
plan authority before SQL. The worker checks the whole namespace, anchors the
database inode, verifies a deterministic existing root prefix, and reserves every
planned row in one atomic `reserve_many`. The exact row/binding/amount set is
verified before any new child directory is created. Roots and bindings publish
in sorted reservation order through the paired namespace/child leases. Only the
last existing prefix root may have an unfinished binding publication.

SQL closes before the terminal report. The report includes the exact plan hash,
shard count, reserved byte sum and hash of the complete physical root/lock
identity list. Startup recomputes that summary and validates the original runtime,
resource and namespace fields before accepting the reaped worker. This receipt
is not a campaign source-membership proof or an ingest/audit completion.

## Limits and recovery

The original source inventory has 45 files. Its rounded snapshot allowance is
892,928 bytes and the full registry control allowance is exactly 1,048,576 bytes.
There is no increase to the 1 MiB ceiling. Per-file source caps, 2 MiB plan,
256 registry rows, aggregate budget, CPU/wall/RSS and process output limits remain
unchanged. An optional existing V1 base row counts against both row and physical
byte limits. Declarative fixed-worker tables moved to the existing tooling module;
no wildcard worker or new runtime source input was added.

Actual disposable subprocess tests send SIGKILL before charge, after full charge,
and after the first published root. Each verifies the original database inode
anchor and resumes the same frozen operation. Durable rows and already-created
root inodes remain unchanged; interrupted attempts stay charged against the
original retry limit. Additional tests refuse root gaps, insufficient space with
an existing base, changed coherent plans and exhausted attempts.

The maximum-request test sends an actual 4,096-request plan through the guarded
controller, admits all 16 derived shards, verifies all rows and physical bindings,
and preserves the original 96 MiB worker RSS limit. The requests are structural
fixture descriptors. They are not 4,096 real downloads or compiled features.

## Next integration

Reconstruct campaign source membership under the actual campaign lease before
dispatch; the read-only source producer is a point-in-time snapshot. Add explicit
authority-gated V2 child bootstrap/capture/ingest/audit sessions while retaining
legacy V1 defaults and existing per-session caps. A sequential child session must
use the held namespace lease and verified admission receipt without opening
registry SQL in its parent. Admit the batch once, rather than spending one of the
16 registry attempts per child or session window.

The final campaign audit must prove that disjoint child request sets exactly cover
the original captured request/context union, including durable observation history.
Per-shard key/version/conflict totals cannot be presented as globally deduplicated
counts. Finite cumulative namespace accounting must precede a second batch;
creating another campaign or namespace cannot reset charges or retry allowances.
Country geometry, streaming, Nigeria rendering/gameplay integration, distribution
rights and physical-phone acceptance remain separate required milestones.
