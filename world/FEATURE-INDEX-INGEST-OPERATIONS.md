# Supervised verified-capture ingestion

`tooling/index_ingest.py:ingest_index` runs one fixed Node worker against an
already charged index root. It receives the caller's actual namespace and index
leases, immutable binding, source configuration, complete tooling manifest,
pinned Node executable, two retained capture paths and exact capture expectation.
It does not acquire data, reserve a namespace itself, register campaign
observations, complete a campaign job or refund an attempt.

The parent checks the extract and receipt through owned, single-link, readonly
no-follow descriptors. Their exact lengths and SHA-256 pins must match; canonical
paths and inode/timestamp identity must stay unchanged. An extract is bounded at
20,000,000 bytes and a receipt at 1,000,000 bytes. There is no raw-extract copy or
arbitrary command/path argument in the worker. Existing acquired input storage
remains external to the index reservation.

A canonical envelope, at most 64,000 bytes, carries the expected request/pins and
two raw descriptor numbers. It is opened readonly and unlinked before launch.
The guard accepts its descriptor/hash only for the two registered ingestion
workers. It checks all three descriptor access modes with `F_GETFL`, exact roles,
distinctness from both lease descriptors, owned regular files and link counts.
Node checks the envelope hash, exact fields, duplicate/nonfinite JSON, dedicated
descriptor integers and stable bigint filesystem identity, then rereads and
rehashes both raw files.

Before any SQLite open, the worker verifies the frozen source configuration and
binding pins, reconstructs the source-bound request and receipt, validates the
capture, and requires its layers to belong to the admitted index. It then uses
the accepted atomic bootstrap/reopen path and the existing `FeatureIndex` engine.
Every original ordinal gets a disposition in the existing transaction. A fresh
worker recomputes raw replay; it never treats a previously emitted report as
proof of index membership. Integrity and foreign keys are checked before close
and the final database inode, root and both lease inodes are checked afterward.

The execution snapshot and actual anonymous-envelope allocation are deducted
from the live index allowance. Admission retains the conservative four-file
database/sidecar ceiling and 2 MiB margin. The guard applies the existing CPU,
per-file, wall, heap and sampled RSS limits, and requires confirmed terminal exit.
The report's process peak RSS must also fit the bound. Failed transactions and
committed WAL state are preserved. Unconfirmed exit preserves the exact frozen
snapshot and exposes `retained_capture_descriptors` on `IndexWorkerUnreaped`;
these handles must stay owned until actual worker termination is confirmed.
Never delete the retained raw cache paths when releasing those handles.

## Actual acceptance

The focused suite passes 11 tests in 9.480 seconds; process maxRSS is
161,103,872 bytes. Combined index tooling regression passes **178 Python tests**
in 32.612 seconds, terminal exit zero, process maxRSS 186,351,616 bytes. Original
guard/registry/controller tests are included. The first focused launch failed
before running tests because its relative wrapper path used the wrong working
directory; that receipt is retained. The corrected launch and final suite pass.

The separately recorded actual worker evidence uses the two immutable cached
Dakar captures: **473 and 1,810 source rows, 2 captures, 2,283 ordinals, 1,810
unique versions, 473 overlapping duplicate ordinals and 0 conflicting keys**.
Fresh workers replay both captures with zero inserted versions and identical
disposition hashes. Reacquiring the charged root preserves one reservation and
the same database inode. No network request or actual acquisition/campaign write
occurs. Nine protected current capture/ledger files and **877 historical pinned
files** remain byte-identical before and after the experiment.

The fixed crash witness receives only these three boundary names:

| Boundary | Actual interrupted state | Fresh-worker result |
| --- | --- | --- |
| `before-transaction` | Initialized index, no admitted capture | Inserts the original 473 rows once |
| `after-commit` | Capture committed; nonempty WAL before checkpoint | Raw replay returns existing capture, inserts no versions |
| `after-checkpoint` | Capture durable before report | Raw replay returns existing capture, inserts no versions |

All three witnesses actually receive SIGKILL and emit no success report. Recovery
preserves the database inode and one reservation, checks all 473 raw ordinals,
and closes the WAL. Quota failure on the larger capture preserves the earlier
capture and allows a fresh worker to verify its exact replay. Invalid source
request, out-of-binding layers, changed input and duplicate receipt keys refuse
before creating a feature database. Descriptors cannot be reused as leases or
passed to another worker. Unconfirmed-exit retention has explicit fixture
coverage; actual guard lifecycle tests remain in the combined suite.

The current complete declaration has **36 source inputs**, 367,210 source bytes
and a 4,547-byte manifest with SHA-256
`b2e6bc0de4de3a0ac3829dcc52803a3d4785d7f8f27c970bd7c75bbaf07faf6d`.
The actual readonly execution snapshot charges 438,272 bytes and the envelope
4,096 bytes. The separate actual acceptance verifier finishes in 6.43 seconds
with process maxRSS 159,793,152 bytes. The 23 guarded engine fixtures also pass.
These pins describe this source, not an earlier manifest or runtime deployment.
Compiler and exact committed-source policy acceptance are recorded in PROGRESS.md.

Receipts under `.cache/world-build/evidence/`:

- `feature-index-ingest-focused-v2.{stdout,stderr}` and `feature-index-ingest-all-v1.{stdout,stderr}`
- `feature-index-ingest-tooling-manifest-v1.json`
- `feature-index-ingest-actual-v1.json` and `feature-index-ingest-crashes-v1.json`
- `feature-index-ingest-engine-v1.json` and `feature-index-ingest-source-acceptance-v1.json`
- `feature-index-ingest-acceptance-v1.{stdout,stderr}`

## Remaining pipeline work

This is a supervised single-capture boundary, not the complete unattended
controller. The caller still supplies externally admitted namespace/index state.
Next bind supervised admission and persistent per-index capture attempt/input
ownership to the accepted registry controller, then validate frozen campaign
membership and fence its observation/completion. Run the independent raw/index
ordinal audit before compiling owned country geometry and publishing sharded
streaming packs. Existing campaign, capture and index identities and charges
remain authoritative; no reset or fabricated coverage is permitted.

The guard is not an OS sandbox. Source copies and readonly descriptors narrow
accidental mutation; they do not defeat malicious same-user filesystem changes.
Sampled RSS plus process peak reporting is not a kernel hard memory bound. These
crashes do not prove power-loss recovery, arbitrary corruption repair, global
capacity, full-country throughput, phone performance or two-day completion.
Nigeria and game state, country products and runtime production are unchanged.
