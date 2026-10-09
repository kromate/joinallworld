# Bounded index shard planning

## Purpose and acceptance boundary

A schema2 country campaign can exceed the current single-binding 256-capture
scheduler limit or its encoded audit/storage limits. The next implementation
creates a deterministic finite namespace-batch plan. It does not admit a new
index, reset an old namespace, ingest features, qualify coverage or compile
geometry. Each namespace retains its 512 MiB aggregate and 256 reservation-slot
ceilings; a batch is not a whole-country or whole-world capacity claim.

The whole-world pipeline still needs a separately frozen global campaign budget,
finite ordered namespace-batch inventory, durable aggregate admission and bounded
resume across those batches. Successful local batch planning cannot authorize an
unlimited series of replacement namespaces or replenish consumed lifetime quotas.
That global admission must precede unattended expansion beyond the first batch.

## Frozen pure interface

`index-shard-plan.ts` exports `planFeatureIndexShards(input)`,
`validateFeatureIndexShardPlan(value, expectedHash?)` and `encodeFeatureIndexShardPlan(input)`.
The encoder returns `{plan, hash, bytes}` using the existing canonical JSON/SHA
conventions. Inputs and outputs are bounded to 2 MiB, with at most 4,096 unique
request units, finite integer fields, exact keys, no accessors/extra array fields,
bounded nodes/depth and defensive immutable output. All SHA fields are exact
lowercase 64-character hex. No paths, raw geometry or executable instructions
belong to the plan.

Input fields are exactly:

- `format`: `feature-index-shard-plan-input-v1`.
- `bindings`: `campaignHash`, `countryGridPlanHash`, `sourceConfigurationHash`,
  `toolingManifestHash`, `baseIndexBindingHash`.
- `policy`: `aggregateBytes`, `registryControlBytes`, `shardReservedBytes`,
  `maxCaptures`, `descriptorBytes`, `envelopeOverheadBytes`, `maxShards`,
  `maxAttempts`.
- `requests`: units with `requestHash`, `captureInputHash`,
  `requiredObservationSetHash`, `requiredObservationCount`, `auditDescriptorBytes`.

Each required-context count is 1..8. A request is assigned once with all of its
canonical contexts; duplicate requests refuse instead of splitting contexts or
choosing one capture. The capture-input and context hashes must subsequently be
reconstructed from validated frozen source/index rows. The pure planner does not
certify those caller-provided hashes or byte charges against actual retained data.

The policy caps aggregate at 512 MiB, registry controls at 1 MiB, shard reservation
at 512 MiB, captures per shard at 256, shards at 256, attempts at 8 and the final
audit envelope at 512,000 bytes. `descriptorBytes + envelopeOverheadBytes` must fit
that final ceiling. The shard reservation is at least65,536 bytes. The existing registry always
charges its fixed17 MiB base allowance. `registryControlBytes` is an additional
reserved planning margin, not a substitute for that base. Total planned namespace
charge is `17 MiB + registryControlBytes + shardCount * shardReservedBytes` and
must fit the frozen aggregate. The total cap is not current free headroom: the pure planner cannot inspect
existing held reservations or occupied slots. Locked runtime admission must check
those independently. `maxAttempts` binds the original per-capture and per-audit
lifetime ceilings (1..8); the registry-controller16-attempt ceiling remains a
separate quota. Every arithmetic operation checks safe integers. Existing
engine, worker, output, admission-attempt, session and lifetime ceilings remain
independent mandatory admission checks.

Sort request hashes and partition contiguous requests greedily under both capture
count and exact prepared descriptor charge, including one array separator per
request. A request that cannot fit an empty
shard refuses the entire plan. A batch exceeding its declared aggregate or shard-count policy also refuses the
entire plan; never omit requests or create another namespace implicitly. Shard
identity binds every global input pin, the complete ordered request membership,
ordinal and the exact members of that shard. Quota-only edits cannot mint new
shard IDs; policy remains part of the externally pinned plan hash and must still
match the immutable admission operation. The output records `scope: namespace-batch`,
`admission: not-admitted` and `geometryCoverage: not-compiled`. Validation
recomputes the deterministic partitions and all totals/hashes; it never trusts a
rehashed caller-supplied membership or aggregate count. Internal consistency is
not immutable provenance: persisted consumers must retain the original encoded
plan hash separately and supply it as `expectedHash`. A fully coherent alternate
plan must fail that original pin.

## Required runtime admission follow-up

Prepared descriptor sizes and envelope overhead are frozen planning allowances,
not evidence that the real worker input fits. Before admission, reconstruct exact
capture expectations, raw byte pins and canonical contexts; recompute ASCII/base64
and historical-pin expansion, all 128,000-byte frames, final 512,000-byte physical
envelope and physical reservation preflight. Refuse if actual values do not fit.
Do not relax a cap or silently repartition an already frozen plan. Plan validation
never yields the private SDK audit-proof brand.

A v1 index binding has no shard identity. Creating distinct child roots by changing
unrelated limits or quota values is forbidden. The next controller milestone needs
an explicit versioned shard binding that pins the shard membership and plan,
while retaining legacy v1 validation/resume. Existing tooling/bindings remain
immutable and incompatible old namespaces must refuse, never migrate silently.
Batch reservation must charge the complete finite plan before creating children,
with one durable bounded operation identity and interruption recovery. Preserve
all already charged attempts/bytes and unknown state. Test real reservation and
startup recovery before calling a plan admitted.

Each admitted shard then uses existing sequential held-session capture ingestion
and same-Ledger audited completion, with distinct immutable per-shard membership.
Country/global audit coverage remains incomplete unless every frozen shard passes
and their request/context union exactly equals the country/global denominator.
Missing or conflicting source units remain explicit exceptions.

## Geometry and distribution follow-up

Merge owner versions through bounded sorted pages, not an index-sized map.
Cross-shard exact key/body matches deduplicate geometry while preserving every
request/ordinal/source reference and observation; conflicting bodies remain
explicit versions, never a preferred-owner guess. Reconstruct full geometry from
pinned raw captures. Emit each complete feature into its existing global level-1
owner cell and record dependencies from every intersecting country cell. Preserve
holes, dateline/polar coordinates and crossing features; do not clip them away to
make a country look complete. Current `sourceReference` exposes only one local
occurrence, so complete reference enumeration needs its own bounded reader gate.

Independently verify all owned outputs and dependencies before manifest-last
publication. Streaming must retain current draw/triangle/resident/download/startup
limits. Country outline coverage, admitted source queries, audited features,
explorable geometry and playable destinations remain separate denominators.
No part of this planner changes Nigeria maps, saves, travel or game databases.

## Planner checks

Test deterministic request reordering/replay, exact complete assignment, repeated
context grouping, count and byte boundary partitions, oversized single units,
aggregate/slot exhaustion, safe arithmetic and input/output byte/count bounds.
Reject forged/rehashed totals and membership, accessors without invocation,
unknown fields, duplicate requests and caller mutation after preparation.
These are pure codec/arithmetic checks, not actual global admission, geometry,
rights, device or unattended throughput evidence.
