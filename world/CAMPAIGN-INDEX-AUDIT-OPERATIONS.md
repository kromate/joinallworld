# Campaign index audit operations

The schema2 campaign has a separate final `campaign-index-audit` child on its
existing Ledger. Its qualification concerns raw feature conservation, preserved
index state and complete campaign observation membership. Geometry remains
`not-compiled`; no new country or destination becomes playable through this job.

## Running and pausing

Supply the original immutable feature-index configuration used for ingestion.
The final audit runs by default only after every requested query root is captured
without an exception, every captured leaf has a verified completed index row,
and no index work is pending, leased, failed, untracked or capacity-blocked.
Subdivided parents are excluded; completed children supply the actual contexts.
Partial campaigns report incomplete audit coverage and do not launch this job.

```sh
node --experimental-strip-types world/campaign-cli.ts resume campaign.json \
  --inventory-manifest /absolute/manifests/inventory-sha.json \
  --country-grid-plan /absolute/plans/plan-sha.json \
  --feature-index-config /absolute/index-session-config.json \
  --max-jobs 0 --max-index-jobs 16 --max-audit-jobs 1
```

`maxAuditJobs:0` / `--max-audit-jobs 0` pauses this separate phase. It does not
qualify the campaign, enqueue a final audit or reset its attempt count. If there
is already complete indexing, an enabled campaign still reports the outstanding
audit. `maxIndexJobs:0` pauses ingestion; it does not pause an eligible final
audit of previously completed indexing. Use both controls to pause both phases.
Status needs no executable configuration and never creates absent index state.

## Frozen input and live completion

`auditCaptures(inputs, attemptLimit, {beforeAudit})` prepares defensive bounded
input copies and holds the actual index and namespace leases. It reads the entire
private capture record before sending an audit frame. Every historical nonnull
observation pin must map to a canonical context independently reconstructed from
the completed frozen campaign leaf/index rows, and every required context must
have a durable attempt pin. Missing or foreign history refuses before launch.

The callback binds the exact capture-record pin, complete capture-set hash,
required canonical-context hash and logical audit-input hash into one immutable
`${campaignId}:feature-index-audit:${indexHash}` descriptor. It enqueues and claims
only this distinct kind on the same Ledger, with the original campaign retry
limit (one to eight), and starts a sticky heartbeat. A changed final corpus
conflicts at the same ID. The SDK rereads the corpus after the callback; changes
refuse before launch. An ordinary callback refusal permits a verified close of
the still-ready session and does not masquerade as a pending audit operation.

The actual fixed worker report and private controller record must match. Python
compares exact raw ordinals and SQL in both directions, including observations,
using its charged snapshot, and checks original files and controls before/after.
The SDK registers a deeply frozen proof in a private WeakSet only after that
verification. Pure report validation, copied JSON and hash-shaped objects cannot
register a proof. The campaign completion helper additionally binds that actual
proof and worker digest to the frozen descriptor. The worker's physical envelope
hash and the logical corpus hash are different; neither is substituted for the
other.

Completion requires the current heartbeat-verified token and deadline. A stale
token cannot finish a job even if the raw audit succeeded. A later live claim
replays the retained audit without a new controller attempt when evidence is
unchanged; the new scheduler attempt is still charged. Scheduler and controller
attempt counts are separate. Re-enqueue never resets either quota. Unknown or
incompatible namespaces, missing evidence and exhausted budgets need explicit
operator action; the runner never creates a replacement namespace to evade them.

## Read-only status

`auditCoverage` is additive and separate from query/index/compiled coverage.
Pending, leased, failed, exhausted and incomplete results cannot qualify the
campaign. Completed results are independently reconstructed on every status read
from current validated campaign membership, actual capture/audit records and
immutable anchors, the exact worker report and saved terminal guard.

The reader opens original database/sidecar bytes only as regular `O_RDONLY` files,
never through SQLite. It streams one 64 KiB buffer, respects each frozen file
ceiling and the index reservation, and stops after a fixed ten-second hashing
bound. The original-state digest uses exact bigint nanosecond identities matching
Python; converting those timestamps to JS numbers would lose precision. Unknown,
staged, orphan or unfinished state refuses. It rereads control bytes and stable
names and checks root/lock identities. It does not enqueue, expire a lease, open
admission, repair a journal, launch a process or mutate the index. This is a
point-in-time saved-evidence check, not a newly acquired writer lease.

## Validation scope

The exact-source serial diagnostic workflow includes portable actual campaign
fixtures and the two real retained Dakar captures with synthetic contexts. The
separate retained production Senegal campaign fixture requires its original
protected local ledger/inventory/cache and is explicitly excluded from portable
CI; packaged raw copies do not supply those missing materials. Never describe
synthetic campaign fixtures as real geographic country completion.

The latest successful exact source/run and measured counts are recorded in
PROGRESS.md. Full specified corruption/physical-interruption acceptance, bounded
global shard admission, country compilation/streaming, Nigeria renderer
integration, distribution rights and physical-device performance remain separate
requirements of the whole-world goal.
