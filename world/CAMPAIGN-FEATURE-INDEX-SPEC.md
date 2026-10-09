# Campaign indexing integration

This contract is implemented by the campaign phase and persistent JSONL session.
It uses the existing campaign Ledger and fixed supervised ingestion controller.
Implementationa75c59af passes228 Python +43 Node +five exact source-policy checks
and full World TypeScript. Read CAMPAIGN-FEATURE-INDEX-OPERATIONS.md and PROGRESS.md.
Independent raw/index audit, global shard admission and country geometry remain open.

## Scheduler and identities

Schema2 acquisition claims only `campaign-grid-query`, using the Ledger's optional
exact-kind filter. Indexing claims only `campaign-index-capture`. Schema1 and
existing unfiltered Ledger callers retain their behavior. Lease expiration stays
global; attempts/token sequences and priority ordering retain their semantics.

For each completed source query with `result.status === 'query-captured'`, first
reconstruct its exact unit through `validateClaimedQueryUnit` against the frozen
campaign, inventory and grid plan. Reverify its retained bytes/request/receipt
through `verifyQueryCapture`. Failed, queued, leased, missing, foreign and
subdivided source jobs are not eligible. Subdivided parents never enter the index;
captured descendants do. Preserve protected Nigeria handling.

Index job ID: `${campaign.id}:feature-index:${sourceJob.id}`. Its observation is
`{campaignHash, planHash, jobId: sourceJob.id, rootCellId, queryPath}` with the
exact reconstructed query identity. The index scheduler ID and lease token are
not observation identities. Payload and inputHash bind campaign/inventory/plan,
source job, exact request, both raw pins and canonical paths, and observation.
Use the original source job's frozen attempt limit for this separate phase.

Enqueue eligible index jobs idempotently on resume and after acquisition, without
modifying source rows/results, original acquisition attempts or usage.jsonl.
Do not requeue completed acquisition jobs or reset charged network reservations.
An existing index ID with different immutable payload is an error.

## Held session and completion

The production bridge must be an actual bounded persistent Python JSONL session.
It holds one `supervised_charged_index` admission across sequential calls to
`ingest_capture_job`; admission is not repeated for each capture/building. Bind
source/tooling/runtime/limits once per session and validate exact duplicate-free
bounded input lines. Stdout is protocol-only. Do not import campaign, Ledger or
the game into the fixed worker's source closure. No arbitrary shell commands,
PID recovery targets, cloud jobs or dependency discovery are accepted.

Node owns the campaign claims and heartbeats. It validates membership and sends
the reconstructed capture expectation and observation. After a fresh worker
raw-replays the actual index, Node verifies all returned identities/counters and
the exact canonical observation hash, then calls Ledger.complete with the current
token and current time. A stale/expired token must never complete the job even if
SQL committed. A later live claim raw-replays and verifies the same observation.
Do not attempt to fail a job through an already stale token.

Session exit/guard failures preserve database/WAL, attempt records and held worker
descriptors. Confirm actual terminal process/worker state before cleanup or a new
session; unresolved inherited locks remain authoritative. Keep existing wall,
CPU, file, aggregate, heap, RSS, source-snapshot and lifetime attempt ceilings.
The first bridge is bounded by the admitted shard's256 requests/eight attempts;
it must stop explicitly at exhaustion. Deterministic multi-shard partitioning and
global aggregate admission are separate required scaling work, not implicit quota
resets or unlimited new namespaces.

## Coverage and validation

All query projections and subdivision-cap calculations filter query-kind rows.
Index rows cannot consume the frozen query denominator/maxJobs. Add explicit
indexCoverage with eligible captured, pending, leased, failed and verified indexed
counts, labeled source-feature-index / geometry-not-compiled. Keep compiled and
playable coverage unchanged. A read-only status command reports missing index rows
as untracked without enqueuing or launching workers; untracked contributes to
the unfinished backlog. Specify source/index phase work
limits so a paused source batch leaves its indexing backlog visible and resumable.

Acceptance must include a real retained frozen-plan query capture, not only
synthetic observation contexts. Use disposable copied state and preserve actual
ledgers/output/raw inputs byte-for-byte. Cover zero-row observation, captured
split children with parent excluded, legacy captured jobs with zero acquisition
calls, bounded pause/resume, changed membership/pins, expired/stale completion
after actual commit, process interruption, and exact replay with unchanged source
charges. Synthetic nonempty fixtures test machinery; retained Dakar observations
test transaction behavior but do not establish actual grid-plan membership.

After campaign integration, independently reconstruct raw/index conservation and
crossing-feature ownership, then compile and publish owned country geometry as
streamed shards. Whole-world throughput, global conditions, phone performance,
Nigeria rendering integration and production country detail remain required.
