# Planned shard namespace and root admission

Exact source `87dff05f7f6f0babc0c65aa15ab5662889b107ad`, remote run
`37901132435`, passes **448 tests, three policy checks and World TypeScript**.
The coordinator verified all 22 diagnostic artifact hashes and the six changed
source/test files. See [index-shard-root-acceptance.json](index-shard-root-acceptance.json).
This acceptance concerns structural storage primitives; no new map detail or
production runtime was uploaded.

## Explicit interfaces

`prepare_index_shard_plan_authority(raw, expected_pin, base_binding_bytes)`
recomputes the complete canonical plan through the fixed validator and freezes
its sorted `(indexHash, bindingBytes, reservedBytes)` entries. The private seal
is a cooperative API guard, not a sandbox or source-provenance proof.

`open_index_shard_namespace(root, authority, inherited_lease=...)` verifies the
authority before filesystem work. Under the actual namespace lease it accepts
only an empty registry, the exact optional V1 base row, the complete planned
V2 set, or that set plus the exact base. Partial, foreign and wrong-amount rows
are preserved and refused. Its successful context exit requires the full plan.
Namespace metadata/schema remain unchanged; no migration or refund occurs.

The caller performs one `reserve_many` transaction for the complete plan before
using `precharged_index_shard_root`. The root primitive never calls a reserve
method. It verifies every stored hash, binding and amount, the complete set and
aggregate before any child mkdir, and verifies them again after yield. A change
to individual amounts that preserves the total is still refused.

`publish_index_shard_binding(admitted, authority)` requires the exact V2 entry
and actual paired parent lease. It retains bounded prefix recovery, private
inode checks, fsync and atomic rename; parent/child identities are rechecked
before returning. A failed final check preserves the written files and charge.
The default V1 openers and publisher still reject V2 bindings.

## Evidence and limits

The synthetic integration fixture charges the complete two-child batch,
publishes both final bindings, closes and reopens the namespace, and checks
exact bytes, lock/binding inodes and publication replay. Other fixtures cover
partial/foreign/wrong-amount/aggregate refusal, exact optional base, incomplete
successful-body refusal, inherited-lease retention and parent-lock replacement.
Existing actual worker/session/audit/recovery fixtures also pass in this run;
they do not establish actual interrupted V2 batch-controller recovery.

The 46-input inventory retains the same **892,928-byte rounded source allowance**
and **1,048,576-byte control ceiling**. The root, namespace and publisher stay
within their existing 16,384 / 32,768 / 8,192-byte source buckets. The six raw
fixture copies remain **797,134 bytes**. SQL's 256-row and 512 MiB namespace caps,
attempt budgets and other process/frame/envelope limits remain unchanged.
An optional base row consumes one of the 256 slots; a future batch controller
must reject a 256-child plan alongside that row before transaction mutation.

## Next connected milestone

Derive all request/raw/context hashes and physical descriptor charges from the
verified frozen campaign leaves, independently of completed index rows. Rebuild
the same pinned plan before dispatch. Connect the fixed supervised V3 batch
operation to atomic full-set charge and deterministic same-plan root-prefix
recovery, then route held capture/audit sessions to exact V2 members. Per-shard
audit proof and complete campaign request/context union are separate gates.

Finite global disk/network/retry admission must precede expansion beyond the
first namespace batch. Country geometry, streaming, Nigeria rendering integration,
distribution rights and physical-phone acceptance remain open.
