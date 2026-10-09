# Campaign lease and global shard accounting draft

Status: proposal only. This document specifies no implemented global admission,
does not authorize another namespace or source request, and does not change any
campaign, usage journal, source cache, index namespace, Fiji record, or quota.
The per-namespace shard plan/admission remains bounded to its existing caps; it
does not establish finite whole-campaign or whole-world capacity.

## Why the existing locks are insufficient

`campaign.ts` calls `ensureCampaign` before `acquireCampaignLock`. The campaign
lock is a `wx` PID/UUID file. On collision, `acquireCampaignLock` checks the PID
and then unlinks the path without comparing the inode it inspected to the inode
at unlink time. Two stale-lock recoverers can both inspect the old file; one can
unlink it and create a new owner file, then the other can unlink that new file.
The release closure likewise reads the owner text and unlinks in a later
operation, without an inode-conditional unlink. It is a useful cooperative
single-runner check, not a kernel lease proof for global quota state.

`withAcquisitionBuildLock` in `acquire.ts` has the same class of race. Its stale
check compares device/inode before calling `rm`, but the path can still be
replaced between that check and removal; release has the same check-then-remove
shape. This lock coordinates the shared acquisition cache, not the campaign's
global index budget.

`Ledger.claim` uses SQLite `BEGIN IMMEDIATE`, a time-based `lease_until`, and a
token sequence. `heartbeat`, `complete`, and `fail` are fenced by the live token
and expiry. This protects individual job transitions, but an expired claim can
be reclaimed while a delayed worker still performs external work. It does not
serialize `usage.jsonl`, namespace creation, or a multi-file global reservation.
The real campaign runner lock is therefore required around global accounting;
the SQLite token remains an additional job-completion fence.

## Reusable POSIX lease

`world/tooling/index_writer_lock.py:index_writer_lease` already implements the
local lock-file validation patterns on macOS and Linux: an existing canonical
owned `0700` directory, a permanent empty `0600` single-link `writer.lock`, and
nonblocking exclusive `flock`. The global protocol must preserve those checks
and use one shared open-file description (OFD) for the whole runner tree.
Duplicated/inherited descriptors retain the same flock until the final
reference closes, while explicit `LOCK_UN` releases it across all references;
see the [Apple flock documentation](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/flock.2.html)
and [Linux flock documentation](https://man7.org/linux/man-pages/man2/flock.2.html).
The lease is advisory and local-filesystem only; do not claim network-filesystem
or hostile-owner guarantees.

The global runner should own a dedicated private `0700` accounting directory
under the existing campaign state directory. Node opens its permanent lock file
with no-follow flags and validates the named and opened device/inode and mode.
A fixed, pinned Python helper receives that same inherited descriptor, verifies
its identity, and applies `flock` to it; it must not reopen the pathname and
accidentally lock a separate OFD. After a bounded ready response, it closes its
reference and exits without `LOCK_UN`. Node retains its own reference through
all journal, `usage.jsonl`, campaign-ledger, and ordered inventory mutations.
Every mutating Python worker receives the same descriptor through explicit
`stdio`/`pass_fds` inheritance and verifies the same inode. Allocate a dedicated
descriptor greater than 2 and distinct from the current worker lease,
namespace, capture/binding, plan, and acknowledgement descriptor roles; pass it
explicitly rather than relying on ambient inheritance. Do not call `LOCK_UN`:
the helper's exit cannot release the lock while Node or any surviving worker
still holds a reference to that OFD. The permanent lock inode is never
unlinked.

If the helper fails before the validated ready response, Node aborts before
global mutations and closes its descriptor only after its child processes are
accounted for. If Node dies while a worker survives, that worker's inherited
reference keeps a second runner out until the worker exits. If worker
termination is uncertain, preserve state and refuse recovery or another
writer. Normal completion closes references only after all workers have exited
and their outcomes are accounted for. The helper is a fixed mode in the
existing pinned Python/resource-supervision closure, not arbitrary Python text,
a new interpreter, package, or download. Retain bounded CPU/wall/RSS/output
limits. PID values and pipe EOF are lifecycle hints, never the lease proof.

## One global account, one finite plan

The account is keyed by the canonical campaign identity: immutable campaign
configuration hash, inventory hash, country-grid plan hash, source-configuration
hash, tooling-manifest hash, unchanged V1 base-binding hash, and the original
campaign budget fields. A different campaign ID with the same source universe
must resolve to that same account or refuse; it cannot mint a fresh usage ledger.
The existing `campaign.json`, `ledger.sqlite`, and `usage.jsonl` remain the
source of campaign identity and source usage. Never create a replacement
campaign directory to evade exhausted attempts or budgets.

Before admitting batch one, reconstruct the complete captured-leaf denominator
from the existing campaign ledger and verified extracts/receipts. Build one
canonical, externally pinned global inventory containing every unique request
and its complete deduplicated observation-context set exactly once. Sort it by
the established request hash order, then partition the full sequence into a
finite ordered list of the existing per-batch plans. Each batch plan keeps its
current 2 MiB, 4,096-request, 256-shard, per-namespace 512 MiB and registry
256-row bounds. No omitted request, arbitrary caller slice, changed batch order,
quota-derived identity, or implicit replacement batch is accepted. A request's
contexts cannot be split between batches.

The global inventory pins the original campaign/source/tooling/base inputs, the
global request count and membership hash, every ordered batch ordinal/hash,
each batch's request range/membership, and the original per-request retry
ceiling. It is planning evidence until the locked runtime reconstructs actual
capture bytes, receipt bytes, descriptor/envelope sizes, and all physical
preflights. It does not qualify feature ownership, geometry, or coverage.

## Durable records and accounting interface

Use a strict canonical global header plus a bounded append-only journal in the
private accounting directory. Publish the header with a private pending-prefix,
file fsync, rename, and directory fsync. Retain its exact bytes and hash. Add a
small durable anchor to the existing campaign ledger/usage state so loss of the
header or journal is detectable; if either side of the anchor pair is missing
or disagrees, fail closed. Never synthesize a missing header from current
namespace contents or rebase on a new plan. A partially written final journal
record is recoverable only as the exact next canonical prefix; contradictory
bytes, skipped sequence, missing middle record, or replaced inode are preserved
and refused.

The global header is immutable and includes the exact batch inventory, original
campaign network/input/output/disk/retry limits, the immutable global plan hash,
and the frozen accounting method. The journal has one-based contiguous sequence
numbers and exact transitions for each batch: `reserved`, `namespace-bound`,
`charged`, `roots-published`, and `terminal`. A pre-creation `reserved` record
contains the batch ordinal/hash, its one deterministic planned namespace path,
aggregate budget, worst-case physical disk debit, cumulative disk/network/
attempt totals, and the exact prior record hash. It cannot contain a namespace
inode that does not exist yet. After creation and identity checks, append a
`namespace-bound` record with the actual root and lock device/inode. Retries
reuse that same batch and path; a bound namespace must retain the recorded
inode. If recovery finds an unbound reservation, it may inspect or create only
that deterministic path. It accepts an existing path only when its private
mode and contents match the exact empty or recognized resumable stage. Unknown
or contradictory data is preserved and refused. It cannot refund the pending
debit or substitute another path. Once a reservation may have reached the
filesystem or worker, it is never refunded; uncertain exit keeps the full
reservation. Reclaim may remove only the fixed controller snapshot through its
existing verified recovery procedure. It never removes a namespace, registry
row, source attempt, or global charge.

Before a namespace directory or worker can be created, atomically append and
fsync its `reserved` record under the held lease. After validating the newly
created namespace, append and fsync `namespace-bound` before registry writes
or worker launch. Charge the complete worst-case
physical namespace allocation against the original campaign-wide disk ceiling,
including its registry, every child reservation, database/WAL/sidecars,
control files, and allocated directory blocks. Keep logical registry charges
and measured physical footprint as separate fields; `reservedBytes` is not a
physical measurement. Include existing campaign output/cache/state and
previously allocated namespaces when calculating remaining capacity. The total
of all batch reservations must fit the original disk allowance before admission;
measured occupancy after each step must remain within that allowance. Keep
every batch namespace at its original permanent path and inode.

Do not duplicate or reset source accounting. `campaign.ts:recordUsage` appends
the original acquisition reservation before adapter launch and `usageTotals`
charges each unique input pin once while summing network/output/acquisition
disk entries. Continue using that same `usage.jsonl` and same campaign identity
for source network; do not charge a new allowance per namespace or campaign ID.
`GRID-QUERY-OPERATIONS.md` freezes the Senegal campaign at 64,000,000 network,
32,000,000 unique input, 32,000,000 output, 256,000,000 disk bytes and one
source attempt per unit. Preserve all existing rows and the separate retained
Fiji lifetime budget. Do not recalculate, edit, or replenish prior usage.

The global journal separately retains the original index retry ceiling for
each unique request across all batches and each namespace controller attempt.
The existing per-batch controller's 16-attempt ceiling is a local maximum, not
a new allowance multiplied by the number of batches. Reserve each attempt
before launch. A killed or unconfirmed attempt remains consumed; a retry is
available only within the original campaign and request ceiling.

Keep the total journal and header inside the already admitted campaign disk
budget. Bound record size/count from the complete campaign denominator and
remaining physical control allowance before writing; refuse a plan that cannot
fit. The batch-plan 2 MiB cap remains per plan, not permission for unbounded
global control growth. Store batch plans as the exact retained batch inputs
under the charged namespace/controller snapshot where possible, with only
bounded hashes and ordinals in the global header.

## Required recovery and concurrency tests

Use only disposable campaign/namespace trees and offline pinned captures. Keep
the exact original fixture budgets, including Fiji's retained charged state.

1. Race two actual process trees at an empty accounting lock. Exactly one
   obtains the POSIX lease; the other performs no campaign, usage, journal, or
   namespace mutation. Verify Node, helper, and worker use the same lock inode
   and OFD, and that a contender remains blocked when helper and coordinator
   references close while a worker reference remains.
2. Reproduce the stale PID-file interleaving against the old `wx` lock and show
   the new lease path prevents both owners from entering. Test helper death
   before and after its ready response. Kill the coordinator while a worker
   retains its inherited descriptor; a contender must remain blocked until
   that worker exits. EOF alone must not release the lease. After all
   references close, prove a new process can acquire the same permanent lock
   inode. If stopping or reaping a worker is unconfirmed, fail closed without a
   second writer. Run descriptor-inheritance cases on actual macOS and Linux
   process launches, including Node's explicit `stdio`/`pass_fds` path.
3. For one full frozen inventory, SIGKILL after global reservation, after
   namespace registry charge, and after root publication. Resume the same
   ordered batch, prove identical namespace and lock inodes, identical charges,
   monotonically consumed attempts, and byte-identical completed batch plan.
   Then admit the next batch and verify cumulative disk and original usage totals
   across both namespaces.
4. Remove or replace only the header, only the journal, only its campaign-side
   anchor, and each journal prefix in turn. Every missing, mismatched, or
   non-prefix state must stop before worker launch or directory creation and
   preserve all surviving bytes. A byte-identical replacement namespace or
   registry with a different inode must fail.
5. Change batch order/hash, campaign ID, source/base pin, retry limit, or quota
   after batch one. Verify refusal before process launch; never accept a fresh
   campaign directory or altered budget as a replacement account.
6. Duplicate, omit, reorder, or split a request/context set across batches;
   alter the complete captured denominator; and exceed the cumulative physical
   disk, network, or retry allowance. Each case must fail before the next
   reservation. Network tests use existing pinned cache-only inputs and prove
   zero new network traffic; they do not use a live source.
7. Exhaust the original lifetime allowance after a batch is charged, then
   attempt another namespace. It must refuse before `mkdir`/worker launch while
   retaining the exhausted charge and all original source/usage/Fiji records.

Acceptance requires actual process races and kills, not mocked PID checks or
`Ledger` token-only tests. Until those checks pass, global accounting is not
implemented and multiple namespace batches must not be advertised as whole-
campaign capacity.
