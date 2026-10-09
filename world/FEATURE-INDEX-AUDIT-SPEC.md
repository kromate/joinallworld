# Feature index raw and observation audit

**Status: specification only; unimplemented.** This document defines a bounded, independent audit of a retained feature index against the exact raw captures that produced it. It does not authorize repairing, migrating, rebuilding, or silently replacing an index.

## Purpose and qualification

The audit must independently establish that every retained raw capture and ordinal in the declared complete input set is represented by the actual SQLite index, and that every indexed row is justified by those raw captures. It must also distinguish campaign observations that are required because their campaign index jobs completed from observation pins that merely occurred in historical attempts. A prepared attempt, failed attempt, or crash after SQLite COMMIT may pin an observation without that observation being present in SQLite. Therefore, equality between SQL observations and every non-null attempt pin is not an invariant.

The result has separate qualifications:

- **Raw/index conservation**: the complete retained capture set was reconstructed and both directions of relational correspondence were verified.
- **Campaign observation completeness**: every canonical observation belonging to a completed campaign index job exists exactly in SQL, and every SQL observation is attributable to a known allowable campaign observation pin. Historical pins are allowable evidence, not required rows.
- **Read-only state preservation**: the audit observed no changes to the database, WAL, SHM, capture record, raw inputs, or index storage footprint while auditing.

Global completion may be reported only when all three qualifications pass for the declared full scope. If the retained record, campaign ledger, historical observation contexts, raw inputs, or SQLite state do not cover the full declared scope, report `incomplete` with bounded reason codes. Never omit an unrecognized row or infer completeness from counts alone.

## Immutable inputs and scope

The audit input is a frozen snapshot consisting of:

1. The existing index binding and tooling manifest, including their exact hashes and runtime pins.
2. The durable capture-controller record and its exact encoded-byte hash.
3. Every capture job in that record, including its canonical expectation pin and immutable raw extract and receipt paths.
4. The campaign ledger rows that define the expected capture membership and canonical observations. Required campaign observations come from completed index rows whose immutable descriptor and completion receipt revalidate against the frozen source query and index binding. Completion itself is fenced by the live token at commit time; completed rows do not retain a live lease, and inspection must not invent one.
5. The actual feature-index database and any existing WAL/SHM state.

Capture membership is reconstructed from the frozen source-query jobs and their validated schema-2 captures. It is not reconstructed from whichever rows happen to be present in SQLite. Existing source-query jobs, receipts, source results, acquisition charges, and lifetime usage remain unchanged. Legacy completed query/captured jobs are re-enqueued for indexing only through the existing distinct indexing phase; they do not become indexed by implication.

Existing binding, tooling, and initialized index state are immutable. An audit requiring a different worker/tooling hash or admission binding must fail with an incompatibility status. Do not migrate or rewrite an existing binding, create a replacement namespace, or reset any acquisition or indexing quota as an audit fallback. Any future explicitly admitted new namespace is a separate operation, outside this audit.

## Durable campaign fence

The campaign ledger remains the scheduler and source of truth. A completed campaign indexing row is successful only after actual raw replay and an atomic result commit made with its current live lease token. A stale worker may have changed SQLite but cannot complete the campaign row. Its observation, if committed, remains an allowable historical observation pin, not a completed campaign observation.

The audit claim is a distinct exact-kind ledger phase, for example `campaign-index-audit`; it must not be claimed by the grid-query loop or counted as a source query. Its immutable payload binds the index hash, controller-record hash, complete capture-set hash, canonical required-observation-set hash, and audit format. Claim, heartbeat, retry, and completion use the existing token fence. A failed or incomplete audit never changes acquisition results or source query coverage.

Run the global audit only when the declared capture set is complete and all its campaign indexing rows are terminally completed. A partial campaign may expose per-capture indexed progress, but global audit coverage remains incomplete. Keep audit coverage additive and separate from source-query coverage, indexing coverage, and any compiled/playable claim.

Audit work must itself be durably bounded. Allow one audit job for a frozen final input tuple, with a finite retry count no greater than the campaign's existing retry limit. Each retry is a ledger attempt and consumes the configured audit work budget. No hidden retries, uncharged reruns, or new work on read-only status inspection. If the capture set or observation set changes, it is a different explicitly bounded audit input; never mutate an existing audit payload. The first implementation admits at most one final audit job per campaign/index binding, with at most eight attempts and no more than the frozen campaign attempt limit. Changing final membership must refuse that immutable job; an unlimited sequence of new audit IDs is not a recovery mechanism. Cross-shard/global audit admission is separate required scaling work. Preserve all existing limits: 256 session capture calls, 16 admission attempts, 8 attempts per capture, and the current CPU, wall-time, heap/RSS, storage, and output caps. A later design may allocate explicit audit budget under those same worker ceilings; it must not increase a cap implicitly.

## Raw-to-index conservation

The worker revalidates each raw capture from its pinned extract and receipt, reconstructs canonical feature identities and dense ordinals using the fixed feature-index identity implementation, and compares them with the existing index. It must not instantiate the mutating `FeatureIndex` constructor or call ingest as an audit shortcut.

For each capture, verify the exact capture row identity and metadata against the durable expectation and raw/receipt contents. Stream reconstructed features in ordinal order and use prepared indexed lookups to verify every expected occurrence, including its request hash, ordinal, tuple hash, canonical tuple/body, source owner, and derived fields. Verify exact dense ordinal coverage and the expected admitted/exception counts. Duplicate raw occurrences remain distinct by ordinal.

Then scan SQLite in bounded row order and perform reverse checks. Every SQL occurrence must correspond to one reconstructed raw capture/ordinal; extra, duplicate, dangling, or mis-keyed occurrences fail. Every version must be justified by at least one exact raw occurrence with the same key, body, and owner; every expected raw version must exist. Every feature key must be justified by its versions and raw occurrences, with the exact tuple hash. Conflict rows must exactly reflect whether each key has more than one distinct retained body. Preserve every conflicting version and owner; never select a preferred owner or discard a version. Verify capture totals and all relational conservation results against independently computed values, not only SQLite's own counts, integrity check, or metadata counters. Verify SQLite integrity and foreign-key consistency as additional checks, not substitutes for these comparisons.

Memory use is bounded independently of index size. Reconstruct one bounded capture at a time and stream SQL one row at a time. Do not retain all raw feature tuples, all ordinals, or an index-sized JavaScript map. Use ordered scans, indexed prepared queries, and reverse dangling/version/key/conflict checks to prove both directions. If the engine cannot make progress inside its declared operation, memory, or time ceilings, return incomplete/failure; do not expand limits or fall back to an unbounded in-memory join.

## Observation invariants

Construct two distinct sets from the frozen campaign ledger and durable capture record:

- **Required canonical set**: exact canonical observations attached to campaign index jobs whose successful results were committed under their current live tokens. For each such row, independently recompute the observation pin and bind it to the corresponding capture request hash.
- **Allowable historical set**: observation pins present on any durable attempt for the corresponding request, including prepared, failed, and terminal attempts. These pins can explain a SQL observation committed before a later failure or lost campaign completion. They do not require an SQL row.

The SQL observation table must contain every required canonical observation with exact request association, digest, byte count, and canonical bytes. Every SQL observation must also match a known allowable pin and a known canonical campaign context. Extra SQL rows, rows attached to another request, duplicate/ambiguous identities, invalid canonical bytes, or rows whose context is not present in the frozen inputs fail the global observation qualification. Do not silently omit rows because their job is pending, failed, legacy, or absent from the current campaign view. Where a historical pin cannot be mapped to its canonical context, mark observation qualification incomplete; do not treat the pin hash alone as proof of campaign membership.

An allowable historical pin may be absent from SQL without failure. A known historical pin may be present even though its attempt did not complete, provided its exact SQL row is valid and attributable. Required completed observations may not be absent. This rule handles the interval between SQLite commit and fenced ledger completion without confusing process success, controller settlement, or a stored observation hash with campaign success.

## Read-only mode and mutation evidence

The audit runs only while holding the existing paired exclusive namespace/resource and writer leases for the entire snapshot, open/read/close, and post-audit state check. It must establish that no admitted writer or capture worker is active and that no durable prepared attempt owns the execution slot. It records the actual device/inode and bounded identity of the database, WAL, SHM, lock files, capture record, and raw inputs before reading and again after closing SQLite.

Use a WAL-aware SQLite read-only mode. Do not use SQLite's `immutable=1` assumption when a WAL may contain uncheckpointed committed data; ignoring that WAL cannot establish the actual index state. Do not issue mutating pragmas, checkpoint, recover, create schema, clean sidecars, or call an index-ingest API. Read-only SQLite opens can still create or alter sidecars. Consequently, “opened read-only” is not sufficient evidence of preservation.

The audit reports `read-only-state-preserved` only for original retained state, when its before/after checks prove the database, WAL, SHM, locks, controller record, raw files, and storage inventory are unchanged, including file identity and bounded content/size evidence. Direct access qualifies only if sidecars remain unchanged. If direct SQLite access creates or changes an original sidecar, or quiescence cannot be established, preserve the state and return incomplete. Do not remove the sidecar or claim an audit pass. Any separately designed recovery/checkpoint operation must be explicitly named, durably admitted, and reported as mutation; it is not this read-only audit.

The audit worker and its SQLite access must use the fixed, pinned runtime/tooling path and existing worker supervision. Before implementation acceptance, demonstrate that the chosen SQLite mode reads an uncheckpointed WAL correctly while the paired leases are held, and that the audit either leaves all database sidecars byte-for-byte unchanged or refuses qualification. No `immutable` URI shortcut is acceptable evidence.

Prefer a separately charged private DB/WAL snapshot when direct access cannot avoid SHM changes. Copy the exact prechecked DB and existing WAL through fixed64KiB buffers under both leases; reject any named/descriptor identity, size, timestamp or content change before and after the copy and audit. The fixed worker queries that private copy with WAL awareness and may create its own private SHM; it never opens original SQLite state. Require proof that committed WAL-only rows are included. Snapshot directories, files, generated sidecars and metadata have explicit physical/file/aggregate charges within existing admitted caps before launch; existing ingress allowances are not presumed spare storage. If the declared allowance cannot hold the copy and potential sidecars, refuse before copying. This is a named snapshot-write operation that preserves original state, not a claim of zero process writes. Remove only owned snapshot scratch after confirmed worker close; an unconfirmed worker retains scratch/charges and actual handles. Do not delete original sidecars. Input hashes and before/after source checks must establish that comparisons cover the original quiescent index, not an independently generated replacement index.

## Fixed worker and report interface

Implement the audit in a fixed worker included in the exact tooling manifest and fixed-worker registry, under existing process supervision and resource limits. The audit controller/session accepts only frozen hashes and validated campaign descriptors, holds the paired leases, pins the actual files, invokes the worker once per bounded audit attempt, and atomically stores a bounded result. The worker must never fetch source data or modify campaign/source ledgers.

Return a bounded report with exact format/version, scope, index hash, controller-record hash, capture-set hash, required-observation-set hash, audit input hash, database and sidecar identities, raw capture/feature counts, SQL capture/occurrence/key/version/conflict/observation counts, verified required-observation count, bounded cross-owner-conflict count, the three qualification states, and a bounded set of reason codes. Do not return raw feature bodies, unbounded row lists, or private extraction paths. Bind the report digest into the fenced `campaign-index-audit` completion. A report digest or process exit code alone does not constitute qualification.

Proposed coverage shape is additive, for example:

```json
{
  "rawIndexConservation": "complete",
  "campaignObservationCompleteness": "complete",
  "readOnlyStatePreserved": "complete",
  "auditInputSha256": "...",
  "reportSha256": "..."
}
```

Each value may also be `incomplete` or `failed`, with bounded reason codes in the durable audit result. Status and coverage reads remain read-only and never claim completion from a pending or stale-token audit row.

## Implementation points

The audit must integrate at these boundaries without replacing existing source acquisition or indexing:

- Add the fixed audit worker and exact source/runtime pin to the tooling manifest and worker registry. Existing pinned bindings remain unchanged and may report audit tooling incompatibility.
- Add a separate supervised audit operation to the Python admission/controller path. Reuse paired lease acquisition, actual inode snapshots, worker ownership, output bounds, and terminal-child proof. Do not reuse the write-capable ingest worker as an audit worker.
- Add a distinct `campaign-index-audit` ledger claim and token-fenced result. Keep kind-filtered claims so query work cannot claim audit rows.
- Derive the expected capture set from validated schema-2 source query results and durable capture records; derive required observations only from successfully fenced campaign-index rows. Preserve and account for all historical attempt pins separately.
- Expose audit coverage as a separate additive field in campaign status/results. Do not fold it into query coverage, mark query jobs indexed, or infer compilation/playability.

These are proposed integration points, not implemented behavior.

## Acceptance evidence

Acceptance requires a real retained nonempty namespace and the actual fixed worker/controller path; synthetic reports or mocked success do not qualify.

1. Audit multiple actual retained nonempty captures and a real frozen-plan zero-feature capture without altering their bytes. Demonstrate exact raw/index conservation and bounded peak memory while streaming. Separately marked synthetic raw fixtures cover exception ordinals, repeated identities and cross-owner conflicts; do not claim those conditions occurred in the retained real source unless independently observed.
2. Demonstrate required observations from fenced completed campaign rows; demonstrate absent and present SQL observations for settled failed/after-COMMIT pins are handled according to the required/allowable rules. Any currently prepared attempt must first refuse quiescent audit; normal existing recovery may settle it before a fresh charged audit claim. An unexplained SQL observation must fail or make scope explicitly incomplete.
3. Corrupt or remove one input at a time: raw capture, receipt, controller record, binding/manifest, database, WAL/SHM, capture row, occurrence (missing/extra/swapped ordinal), tuple hash, feature key, version/owner, conflict marker, required observation, and observation association. Each case must fail closed with a precise bounded reason and preserve the evidence.
4. Exercise audit interruption before open, during streaming, and after comparison but before the fenced ledger commit. Unconfirmed worker termination must retain ownership evidence and prevent cleanup or qualification. A stale audit token must not complete the ledger row even if the read completed.
5. Prove paired lease/quiescence, WAL-aware behavior, and before/after identity and content evidence for database, WAL, SHM, controller record, raw inputs, and storage inventory. No acquisition usage or source query result changes; no network activity; no original index mutation; no original sidecar cleanup; all owned snapshot writes explicitly charged; no expanded worker or capture limits.
6. Verify partial campaigns, incompatible old bindings, missing historical context, prepared attempts, incomplete capture membership, and audit retry exhaustion report incomplete/failed audit coverage without changing already truthful query/capture/index progress.
