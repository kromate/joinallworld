# Campaign lease bridge and complete processing windows

Status: accepted exact diagnostic source **3880c17f25509ab13175784d5b1a794923bafa78**,
run [37915503802](https://github.com/kromate/joinallworld/actions/runs/37915503802),
terminal SUCCESS on both Linux and macOS. **495 distinct tests +3 policy checks**
and World TypeScript pass; macOS repeats5 Python and6 Node lease tests.
All32 artifacts, eight changed source/workflow files and45 fixed inputs match
this exact source; see [campaign-lease-window-acceptance.json](campaign-lease-window-acceptance.json).
The same-byte owned0755 interpreter copy preserves strict pin admission. The
helper restores Node22.19 macOS-cleared O_NONBLOCK only after exact descriptor
validation and retains post-flock checks. Runtime/storage ceilings are unchanged.
This accepts the bridge and planning windows, not campaign ownership integration,
paired transport, V2 execution, global accounting or country completion.

## Actual lease interface

`openCampaignLease(root, configuration, options)` takes an existing canonical,
owned 0700 builder directory and the original trusted Python/helper byte pins.
The helper path is fixed to `world/tooling/index_writer_lock.py`; executable
selection belongs to frozen runner configuration, never a job payload. Pin
verification establishes exact bytes, not the provenance of a caller's pins.
The helper remains in the existing 45-file tooling closure. It applies reduced
one-second CPU and 65,536-byte file limits; Node supervises a maximum five-second
wall interval, sampled 96 MiB RSS, and 4,096 bytes each of stdout/stderr.
Sampling is not a kernel guarantee for aggregate memory.

The permanent empty owned 0600 single-link `writer.lock` is created exclusively
or opened with no-follow/nonblocking read-write flags. Existing unsafe contents
are preserved and refused. Node passes its original descriptor at child FD 6;
the fixed helper validates physical identities, acquires nonblocking flock,
rechecks identities/modes/flags, and emits one canonical ready frame. Node must
observe actual terminal success and recheck runtime/source pins before returning
the privately branded frozen handle. Helper readiness alone is insufficient.

`campaignLeaseWorkerStdio(lease, existingStdio)` explicitly places the same open
file description at FD 6. Slots 3–5 remain available to a caller; existing lists
that consume slot 6 are refused. Future mutating workers must retain this
reference throughout their work and must never call `LOCK_UN`. Closing a parent
reference leaves surviving inherited references locked. The permanent inode is
never unlinked to recover stale ownership. `CampaignLeaseUnreaped` retains the
actual child/group and lease; `CampaignLeaseRetained` exposes a descriptor that
could not safely close after an identity failure. Preserve state and handles on
those failures; do not treat them as permission for a second writer.

The bridge does not replace `campaign.ts` or `acquire.ts` PID locks yet. It does
not provide global accounting, source membership, namespace admission, or an
unattended controller. Actual inherited-FD propagation through every acquisition,
capture/bootstrap/ingest/audit subprocess remains an integration gate.

## Complete windows

`deriveFeatureIndexShardWindows(plan, expectedPlanHash)` revalidates the complete
externally pinned plan. It emits every request/context ordinal in deterministic
shard order, with at most 256 capture calls per window, followed by one exact
membership audit window per shard. A request with multiple observation contexts
consumes multiple calls and retains its original attempt ceiling. A window grants
no new namespace or retry allowance.

The structural maximum is 4,096 requests × eight contexts = 32,768 calls,
128 capture windows, plus at most 256 audit windows. The 24 MiB planning-object
bound is not a wire, memory, disk, or storage entitlement. Before persistence,
the complete planned controls must fit the original campaign's measured physical
budget. Runtime frames remain at 128,000 bytes, each session at 600,000 ms and
96 MiB coordinator RSS, and audit descriptors at 512,000 bytes. One audit per
window retains the original bounded reply model.

`validateFeatureIndexShardWindows(receipt, plan, expectedPlanHash)` recomputes
all windows and compares bounded exact fields without evaluating accessors or
stringifying caller objects. Prefixes, omissions, reordering, duplicate contexts,
changed resource metadata and changed audit membership refuse. The output remains
`planning-only` / `not-executed`; context ordinals reference the original pinned
observation set and are not invented observations or runtime completion evidence.

## Acceptance and next integration

The diagnostic retains the existing serial Linux index/audit suite and adds real
helper/OFD, Node worker inheritance, coordinator SIGKILL, helper timeout and full
window checks. A dependent standard macOS-15 job runs only actual lease cases,
after Linux succeeds. This public repository was verified through GitHub's API;
standard public-repository runners have no compute charge under
[GitHub's documented runner policy](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
No larger runner, new paid service, cache allowance or quota reset is introduced.
Exact runtime and source receipts must pass on both platforms before claiming
cross-platform lease acceptance. Local memory pressure prohibits optional heavy
validation starts; remote results do not constitute phone or browser acceptance.

Next integrate the lease before any campaign/usage/ledger mutations and through
all surviving workers; retain compatibility with any existing active runner.
Implement the bounded global header/journal anchored in original campaign state,
charge deterministic namespace paths before creation, then connect explicit V2
workers and durable multi-session windows. Reconstruct the complete captured
source union under the real campaign lease before dispatch and token-fence every
completion. Global geometry ownership, streamed compilation, Nigeria adaptation,
rights and physical-phone acceptance remain separate required gates.
