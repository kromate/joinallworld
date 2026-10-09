# Terminal shard reopen: accepted worker phase

Exact e9eb7bbfd915e6e4d5fbb7c1b8bf96add66ebd27 is accepted at the worker level,
not yet integrated into the campaign runner. It
verifies previously admitted complete V3 plans; it does not ingest captures,
execute V2 windows, generate geometry, or establish country coverage.

## Caller contract

`index_registry_controller.verify_terminal_shard_admission` takes the same pinned
namespace, aggregate budget, tooling/source bytes, Python executable and runtime
as the original startup. Supply the original CPU, wall, RSS and attempt limits,
the unchanged V1 base binding and complete externally pinned shard plan, and an
actual caller-held namespace lease. The durable receipt must contain exactly:

- `controllerRecordSha256` from the successful original terminal startup;
- `registryAnchorSha256` from that namespace's durable registry anchor;
- `shardAdmission` from the original complete-plan worker report.

Retain the receipt before releasing the original lease. Reopening must use the
same permanent root/lock identities and immutable pins. Do not regenerate a
receipt from unexpected current files or replace a namespace to bypass quota.

## Verification and preservation

The parent validates actual lease ownership, complete persisted V3 header,
limits, receipt pins, child bindings/identities and absence of pending execution
or reclaim slots. It never opens SQLite or invokes charged startup. The fixed
`index-registry-verify-plan` worker receives the complete plan pipe and read-only
base binding descriptor under the existing supervision and snapshot allowance.

The worker requires the latest terminal attempt to carry the exact initialized
settlement. It opens only an existing checkpointed sidecar-free database with a
read-only immutable SQLite URI, validates schema/integrity/metadata, and compares
all reservation hashes, binding bytes and amounts to the complete plan and any
unchanged optional V1 base reservation. It verifies database identities and
metadata, anchors and child identities again before returning bounded output.
Only a successfully reaped worker under the same caller-held lease can mint a
fresh sealed handoff. No attempt, reservation, record, anchor or namespace budget
is reset or refunded. An uncertain worker retains its actual process/snapshot
handle through the existing supervision boundary.

SQLite's [URI documentation](https://www.sqlite.org/uri.html) explains that
`immutable=1` opens read-only and skips SQLite locking/change detection; the
actual namespace flock and before/after file checks therefore remain mandatory.
The [WAL documentation](https://www.sqlite.org/wal.html#read_only_databases)
describes immutable read-only WAL support. Missing or uncheckpointed sidecars
are not repaired by this verifier.

## Acceptance evidence

[Run37923993054](https://github.com/kromate/joinallworld/actions/runs/37923993054)
is terminal success on Linux and macOS. The exact
[acceptance receipt](index-shard-reopen-acceptance.json) records504 distinct tests,
three policy checks and World TypeScript, with20 repeated Mac executions.
All35 artifacts,16 changed source/workflow files and45 fixed inputs match the
tested source. Source allowance892928/control1048576B and original worker/time/
output/attempt caps remain unchanged. Failed v36–v40 runs remain provisional.

Remote Linux runs the complete existing index/controller/session regression,
World TypeScript, policy checks, and the new `test_index_shard_reopen` cases.
Remote macOS repeats actual reopen cases with the owned copied Python executable,
after Linux. Both platforms exercise paired campaign/acquisition FD6/FD7
transport with actual surviving-worker ownership. All original source rounding,
45 fixed inputs, storage allowance and worker limits must remain unchanged.

The reopen tests must show two separate held-lease windows after one original
admission, identical attempts/record/anchor/database/child identities, no parent
SQL, and refusal of changed receipt/plan/base/header/runtime/limits, failed latest
settlement, sidecars and same-total altered reservation rows. Acceptance must
pin exact source, terminal CI results and retained artifacts; static syntax and
file-size checks alone are insufficient.

## Platform pipe validation

Apple's [XNU pipe implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/sys_pipe.c)
reports anonymous pipes with mode0660, device0 and link count0. The candidate
recognizes that exact Darwin shape, retaining UID, FIFO, endpoint access,
nonblocking and before/after identity checks. Linux retains its existing0600
shape. This applies to anonymous transport endpoints only; permanent file/lock
permissions are unchanged. macOS CI records actual raw pipe identities and must
pass complete-plan transport and reopen before acceptance.

Actual v40 diagnostic0cda3150/run37923223595 isolated six identical failures:
the parent write endpoint's flags changed5 to65541 after a real write, with all
other identity fields unchanged. XNU's
[fcntl header](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/fcntl.h)
defines kernel-only `FWASWRITTEN=0x10000`;
[write implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/sys_generic.c)
sets it after writing bytes, and
[F_GETFL implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_descrip.c)
returns it. The accepted v41 source masks only this history bit on Darwin anonymous
pipe comparisons. Linux and regular-file/lease checks remain unchanged. Endpoint
access, nonblocking and every other flag must still match. No flags are repaired.
Mac CI retains actual raw identities before/after a one-byte write/read as well
as exercising complete worker transport and changed-nonblocking refusal.

## Remaining integration

Replace actual campaign/acquisition PID-path locks with inherited leases before
any mutable state is touched, propagate both leases through all worker paths,
and charge every verification/window within finite cumulative campaign limits.
Prove a migration barrier for old runners; a dead coordinator PID cannot fence a
surviving old worker. Then implement actual V2 multi-session windows and complete
source-union accounting before scaling real country ingestion. This candidate
makes no mixed-version, hostile-owner or network-filesystem guarantee.
