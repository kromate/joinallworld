# Complete-plan validation and bounded transport

Status: accepted exact successor `019f917942bdeaa2d5ee6e1950f28389363337d5`,
GitHub diagnostic run [37898985723](https://github.com/kromate/joinallworld/actions/runs/37898985723):
432 tests, three policy checks and World TypeScript pass. Root verified all 22
artifacts, 14 exact source/test blobs and the one removed witness file; see
[index-shard-plan-validation-acceptance.json](index-shard-plan-validation-acceptance.json).
Preceding run 37898339451 failed SDK/fixture checks; its actual complete-plan
transport and cross-language comparison passed but do not establish acceptance.
This phase validates and carries a complete namespace-batch plan. It does not
admit roots, compile geometry, qualify campaign coverage, or release a game map.

## Semantic boundary

`index_registry_worker.validate_shard_plan(raw, expected_pin, base_binding_bytes)`
accepts canonical ASCII bytes and an externally retained exact SHA-256/length.
It recomputes all requests, greedy partitions, totals, identities and namespace
charges. It checks the unchanged v1 base configuration/tooling pins and physical
reservation minimum before deriving sorted v2 opaque reservation entries.
It performs no SQL or filesystem allocation. The admitted-operation contract
requires 1..4,096 requests; the pure TypeScript planner also permits empty plans.

The v2 identity mapping is specified in [INDEX-SHARD-PLAN-SPEC.md](INDEX-SHARD-PLAN-SPEC.md).
Actual campaign/source/context hashes and physical descriptor sizes must still
be reconstructed from frozen retained evidence before connected admission.
Structural consistency does not certify caller-provided data or give an SDK
audit-proof brand. A caller cannot rehash an alternate plan and reuse the old pin.

## Transport boundary

The private fixed supervisor's `index-registry-plan-witness` mode receives at
most 2 MiB through two anonymous nonblocking pipes while holding the namespace
lease. Only one 32,768-byte window is outstanding. Each complete window requires
an exact eight-byte sequence/length ACK before the next write; the final ACK
closes the parent input, and the worker then proves EOF, full length and SHA-256.
The reader returns immutable bytes and a compact receipt. No regular plan spool,
new control file, shell command or arbitrary worker payload is introduced.

Both sides validate endpoint identities, access flags and private ownership;
the worker also verifies the named namespace lock before and after transfer.
Partial pipe-allocation failures close only descriptors allocated by that call.
EINTR/EAGAIN do not extend the supervisor's original wall deadline. Reap failures
retain the actual process handle, bounded plan input and surviving owned parent
descriptors. The synthetic wait-failure fixture checks that preservation branch;
it does not establish an actual unreapable live child. The separate inherited-pipe
fixture exercises a real fork and verifies lease release before deleting scratch.

The V3 controller record pins one `admit-plan` operation (plan/base SHA and byte
lengths) across all original 16 lifetime attempts. This is an immutable codec;
the current real controller and legacy session/openers remain v1/v2 paths and
do not yet dispatch batch admission.

## Storage and execution limits

The fixed source inventory has 46 inputs. Its former standalone lease-witness
code now runs as the registry worker's exact `--lease-witness` mode, and the
plan witness runs as the admission worker's exact `--plan` mode. Removing that
8 KiB snapshot bucket offsets the registry worker's 16-to-24 KiB bucket growth.
Measured source allowance remains 892,928 bytes and total control allowance
1,048,576 bytes. The aggregate, per-file, CPU, wall, RSS, descriptor and output
limits are unchanged. This consolidation does not migrate old bindings or
reinterpret earlier tooling-manifest pins.

## Acceptance and next work

The accepted serial remote workflow runs all existing audit/session/campaign/recovery
checks, new transport faults, immutable-controller fixtures and actual
TypeScript-to-Python greedy/full-4,096-request comparisons. The latter compares
the complete plan hash and every derived binding against the SDK codec.
Local heavy execution remains deferred while memory pressure warns.

Next connect the immutable operation to a supervised batch worker: verify full
frozen evidence, reserve the entire batch atomically before any mkdir, create
roots sequentially with paired leases, and recover an unchanged committed charge
set and root prefix. Explicit v2-aware namespace/root/publication and subsequent
session paths need separate contracts. Global finite disk/network/retry accounting
must precede unattended expansion beyond one admitted namespace batch.
