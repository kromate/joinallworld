# Admitted shard handoff and source capacity

Accepted exact source `cfb5c3b1a12d80d1bb94aa7b3bf3e0c75c63d323` passes
[run37908535625](https://github.com/kromate/joinallworld/actions/runs/37908535625):
478 tests, three policy checks and World TypeScript. All22 artifacts and10 changed
source/workflow blobs are hashed in
[index-shard-handoff-acceptance.json](index-shard-handoff-acceptance.json).
The earlier v28 run also passed; its evidence is retained separately because the
final serialized-summary comparison arrived after that source was frozen.
All45 fixed source inputs remain exact and the original source/control allowances
remain892928/1048576 bytes. No passing subset or quota relaxation was promoted.

## Held namespace to child

`restartable_registry_startup(..., _plan_input=..., _inherited_lease=lease)`
returns an internal `_shardHandoff` only after the actual batch worker succeeds,
its runtime and report are checked, and controller settlement and snapshot cleanup
finish. The caller must hold the original namespace lease through child work.
The controller's default locally acquired lease closes on return and never yields
a usable handoff. V1 return objects and binding decoders remain unchanged.

The handoff stores the exact local plan authority, namespace lease object,
namespace root/lock identity, immutable controller-record and registry-anchor
hashes, and complete child identity summary. A private identity registry admits
only the exact minted object; copying its dataclass or supplying a dictionary
does not confer access. This is a local structural storage receipt, not source
provenance, an ingest result or a campaign-completion proof.

`open_admitted_shard(handoff, namespace_lease, authority, index_hash)` selects one
exact plan member and acquires its existing child writer lease. It creates no
directory, reserves no storage and opens no registry SQL. Before use and after
normal completion, it checks the still-held namespace lease, original durable
record and registry anchor, absent pending/execution slots, complete root/lock
summary, exact final bindings and original physical storage allowance. The anchor
also binds namespace metadata bytes and the original registry database inode.

Child access leaves namespace attempts and charges unchanged. Namespace and child
locks keep their permanent inodes. Closing a descriptor never explicitly unlocks
references inherited by a worker. Exceptional exits preserve the original
exception and owned-worker handle rather than masking it with final filesystem
checks. The caller still must confirm each worker's reap before ordinary child
handoff; a context manager by itself is not that lifecycle proof.

The new fixtures run actual supervised batch workers in disposable namespaces.
They exercise both children under one inherited namespace lease with parent SQL
forbidden and unchanged controller record/attempt count. They refuse closed or
fabricated handoffs, busy children, changed durable records, and replaced metadata,
registry databases, bindings, child roots or child locks. Exception preservation
uses an explicit sentinel handle; it does not claim an actual unreaped worker
was safely settled. Existing real crash/recovery tests remain part of the suite.

## Source-derived engine capacity

`prepareCampaignIndexShardPlan` now checks the encoded plan against the original
base binding's engine limits before returning it. The helper revalidates the full
deterministic plan and requires exact accessor-free engine-limit fields. Every
shard's request count must fit that child's capture limit, and its required-context
count must fit that child's observation limit. Global totals may exceed one
child's limits when every deterministic shard fits. The helper reuses the existing
engine ceilings; it never changes a policy, binding or quota automatically.

An actual campaign fixture captures four synthetic zero-row subdivision leaves,
then refuses an oversized shard under each reduced original row cap. An explicitly
smaller frozen partition fits both caps while leaving the original source Ledger,
usage journal and namespace untouched. This validates source-to-plan gating, not
real country coverage. Occurrence/version counts, historical observations, actual
database space and processing time still require runtime admission and audit.

## Remaining lifecycle

The current handoff lasts only as long as its real held namespace lease and local
receipt. It does not yet implement restartable multi-session windows. The full
4,096-request plan requires multiple bounded sessions without re-running the
16-attempt registry controller for each window. See
[INDEX-SHARD-SESSION-INTEGRATION-DRAFT.md](INDEX-SHARD-SESSION-INTEGRATION-DRAFT.md)
for the unaccepted design. A restarted window needs a guarded read-only verifier
of the original complete charge, durable window ownership and source membership.
It must never reconstruct privileged proof from caller-supplied receipt JSON.

Authority-gated V2 bootstrap/capture/ingest/audit, the exact full campaign source
union, finite cumulative namespace charges, real compiled geometry, streaming,
Nigeria integration, distribution rights and phone acceptance remain required.
This implementation adds no production map detail and changes no Nigeria data.
