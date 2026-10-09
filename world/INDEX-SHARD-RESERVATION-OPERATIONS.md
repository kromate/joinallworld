# Atomic reservation batches

Exact source `19dbfe1664c533c1f667badd12eb8934fc02c2f7`, run
[37893670937](https://github.com/kromate/joinallworld/actions/runs/37893670937),
passes 406 tests, three release-policy checks and World TypeScript. The downloaded
22 diagnostic files, source hashes, suite counts and storage preflight are recorded
in [index-shard-reservation-acceptance.json](index-shard-reservation-acceptance.json).
This is the existing opaque SQLite reservation primitive; it does not admit a
shard plan or create an index directory.

## API and durable behavior

`IndexReservations.reserve_many(items)` takes a concrete list of 1..256 native
dicts, each with exactly `indexHash`, `bindingBytes` and `reservedBytes`. Binding
bytes are immutable, 1..4096 bytes, and match the exact lowercase SHA-256 key.
Allowances are integers from 65,536 bytes through 512 MiB. Duplicate hashes refuse
the complete call. Receipts are sorted by hash and retain the existing single
reservation shape: `{indexHash, reservedBytes, replayed}`. `reserve()` delegates
one entry and retains its existing contract.

All inputs are checked before SQL. Under one `BEGIN IMMEDIATE`, validate the
existing schema, rows, charge totals and digest, then compare every existing
binding and amount. Check all new rows against occupied slots and held bytes
before inserting any. The fixed 17 MiB registry allowance, immutable aggregate
ceiling of at most 512 MiB and 256 total slots remain unchanged. Commit all new
rows and updated totals once. The caller must retain the namespace lease and
existing supervised process, file and physical-footprint bounds.

Failure before commit rolls back every new row. Failure after commit preserves
every committed charge. SQL/checkpoint failures poison that writer; close its
owned connection and reopen the same registry and WAL under the original lease
and budget before exact replay. Reordered and mixed old/new replay do not charge
existing bindings again. A conflicting amount refuses the whole batch. There is
no deletion, refund, resize, quota-reset or automatic replacement-namespace API.
An existing caller transaction is refused and preserved.

## Actual recovery evidence

Seven additional fixtures exercise complete and mixed replay, aggregate and slot
exhaustion, changed existing charges, invalid input/caller transactions, injected
mid-transaction failure, post-commit checkpoint failure, and actual SIGKILL before
and after commit. The SIGKILL fixture kills only its own confirmed child process,
then opens the same private disposable SQLite registry. Before commit it sees no
new rows; after commit it sees both rows and their original charges. Unknown child
death preserves scratch. These fixtures run on the remote Ubuntu runner, with no
local Mac worker, server or browser started during memory warning pressure.

The six raw copies remain 797,134 bytes; the source snapshot allowance remains
892,928 bytes and registry/control preflight remains 1,048,576 bytes. No resource
limit was raised to pass the milestone.

## Next runtime boundary

The pure [shard plan](INDEX-SHARD-PLAN-SPEC.md) still says `not-admitted` and
`not-compiled`. Its current occupancy is unchecked. Before creating child roots,
the held controller must reconstruct exact capture/context/descriptor pins,
derive explicit versioned membership-bound child bindings, reserve the complete
finite batch, and persist/recover one immutable operation under existing lifetime
attempt limits. Keep v1 bindings and namespaces unchanged; never vary unrelated
quotas to obtain another root. A separate finite global namespace inventory and
durable aggregate disk/network/retry bank must precede unattended expansion.

Country geometry, complete cross-shard occurrence references and ownership,
manifest-last publication, streamed gameplay, Nigeria rendering integration and
physical-phone acceptance remain separate gates. This milestone changes no game
data, maps, saves or production runtime.
