# Campaign source indexing

This phase connects captured schema2 grid queries to the existing feature index.
It does not compile country geometry, publish map packs, change Nigeria or make
new destinations playable. A separate final independent raw/index audit now
runs on the same Ledger; see [CAMPAIGN-INDEX-AUDIT-OPERATIONS.md](CAMPAIGN-INDEX-AUDIT-OPERATIONS.md).
Deterministic bounded multi-shard ownership remains the next scaling gate.

## Inputs and resume

`runCampaign` accepts `featureIndex: FeatureIndexSessionConfiguration`,
`maxJobs` (source-query claims) and `maxIndexJobs` (index claims,0..256), plus `maxAuditJobs` (final audit,0 or1).
Setting `maxJobs:0` indexes retained captures without acquisition. Setting
`maxIndexJobs:0` records the eligible indexing backlog without opening admission.
Schema1 behavior remains unchanged; indexing requires schema2 and its complete
frozen grid plan and inventory.

The CLI accepts a private prepared configuration file:

```sh
node --experimental-strip-types world/campaign-cli.ts resume campaign.json \
  --inventory-manifest /absolute/manifests/inventory-sha.json \
  --country-grid-plan /absolute/plans/plan-sha.json \
  --feature-index-config /absolute/index-session-config.json \
  --max-jobs 0 --max-index-jobs 16
```

The configuration has exactly these fields. Paths below are placeholders; the
manifest, binding and runtime pins must describe the actual reviewed tools.

```json
{
  "format": "campaign-feature-index-configuration-v1",
  "pythonExecutable": "/absolute/python3",
  "pythonRuntime": {
    "pythonVersion": "3.12.14", "sqliteVersion": "3.53.1",
    "pythonBytes": 1, "pythonSha256": "replace-with-actual-64-character-sha"
  },
  "nodeExecutable": "/absolute/node",
  "namespaceRoot": "/absolute/private-index-namespace",
  "aggregateBytes": 67108864,
  "repositoryRoot": "/absolute/world-worktree",
  "manifestPath": "/absolute/tooling-manifest.json",
  "sourceConfigurationPath": "/absolute/acquisition-sources.json",
  "bindingPath": "/absolute/index-binding.json"
}
```

The namespace must already be owned,canonical and0700, inside the isolated
builder's `feature-index` tree or canonical system temporary state. The bridge
requires explicit pinned Python and Node executables; it does not discover or
install dependencies. Configuration bytes are defensively prepared before the
first await. Campaign configuration pins and namespace identity are immutable.
Source configuration,release and layers must match acquisition exactly.

Resume with the original pins and namespace. An enabled campaign without its
configuration still reports its backlog but cannot start new ingestion. Never
create a new namespace,delete records or reset quotas to evade exhaustion.
Preparing operator materials automatically remains separate from this consumer.

## Scheduling and evidence

Source claims select only `campaign-grid-query`; index claims select only
`campaign-index-capture`. Captured descendants qualify; subdivided parents do
not. Every index descriptor reconstructs membership and rechecks retained raw
and receipt hashes. Source rows,results,attempts and network journals are retained.
The index descriptor fixes campaign/inventory/plan,source job,configuration,
canonical paths,request and raw pins,plus the exact observation.

One persistent JSONL Python session holds the actual paired admission leases
while processing sequential captures. The existing fixed worker performs SQL.
Node verifies the complete guarded report and canonical observation/capture pins
before completing only the current live Ledger token. If SQL committed but the
token expired,a later live claim raw-replays the same observation with another
charged ingestion attempt. No fake successful ingestion hook is available.

`indexCoverage` is explicitly `recorded-source-feature-index`,
`geometryCoverage:not-compiled`, with independent audit still required.
`captured = indexed + pending + leased + failed + untracked`. Index rows never
enter query denominators or subdivision caps. Scheduler admission is limited to
256 rows per campaign shard; overflow stays untracked with `capacityBlocked`.
The immutable engine/database/occurrence/version/observation budgets can stop a
shard earlier. Campaign retry limits above eight refuse indexing before binding.
These limits are not a claim that one shard can build an entire country.

Schema2 status performs no enqueue,worker launch,lease expiration or journal repair.
Schema1 retains its historical bounded journal-repair behavior.
SQLite can create sidecars on read-only opens,so Ledger inspection queries a
private stable copy of the database and WAL,each capped at64MiB. Source inode/
size/timestamp changes refuse the snapshot; the original is never declared
immutable and its WAL is not ignored. Owned scratch is removed after closing.
Missing/corrupt retained source,bindings or index files refuse. Recorded receipts
and file checks alone do not replace the separate qualified independent raw/SQL audit.

## Limits and interruption

INIT is bounded at256,000bytes; subsequent JSONL input/output lines at128,000;
source/manifest at64,000; binding/observation at4,096. Sessions have at most256
calls and600,000ms,with bounded total stdout/stderr and sampled96MiB Python
coordinator RSS. Existing guarded worker,
database,namespace,registry-startup and per-capture lifetime quotas remain.

SIGTERM/SIGINT handlers set a flag. The guard observes it inside its protected
worker loop,then kills/reaps the actual owned worker in `finally`. Signal handlers
cannot interrupt cleanup. Idle input polling also observes the flag. A safe done
frame is emitted only after held contexts unwind. Node confirms done plus actual
terminal exit and pins; forced kill or missing proof retains an unconfirmed owned
handle and all state. Never signal a remembered PID or delete unknown state.

Acceptance includes synthetic split/zero-row/legacy/backlog fixtures, actual
retained Senegal frozen-query evidence, actual idle/in-flight SIGTERM, and stale
completion after actual ingestion. Run checks through the shared heavy slot,
one after another; see PROGRESS.md for terminal evidence and remaining gates.
