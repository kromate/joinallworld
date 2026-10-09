# Supervised charge-before-create admission

`tooling/index_admission.py:supervised_charged_index` supplies the charged-root
prerequisite for verified capture ingestion without parent-process registry SQL.
It holds the permanent namespace lease before entering the persistent controller,
runs a fixed Python admission worker, then acquires the verified child lease
without releasing the namespace lease. It yields `(ChargedIndexRoot, report)`
for the existing `ingest_index` endpoint. The caller must confirm its ingestion
worker terminal before leaving the context.

The admission binding must match the complete tooling/source configuration pins,
provider, release and configured layers. New admission namespaces use controller
format `feature-index-controller-v2`. Each attempt includes an exact operation
and its binding SHA-256/length before launch. Startup-only v1 encoding, phases,
limits and existing data stay unchanged. Admission against a v1 namespace refuses
header incompatibility; this is not an implicit migration or quota reset.

The binding input is an anonymous, owned, private, readonly regular descriptor,
at most 4,096 bytes. The supervisor and fixed worker both check its access mode,
length, hash and stable filesystem identity. The worker checks the durable
prepared operation and frozen source configuration before opening SQLite.
Only registered admission workers receive that descriptor/hash environment;
it must be distinct from the namespace lease. Its actual allocated bytes share
the existing 17 MiB registry allowance with the persistent execution snapshot
and record/witness slots. No disk, attempt, CPU, wall or RSS ceiling was raised.

The fixed worker uses the accepted namespace opener and `charged_index_root`.
Reservation commit and checkpoint precede directory creation; binding publication
follows admission under the child lease. SQLite closes before the report. The
parent verifies physical root/lock inodes, exact binding, counters and worker
runtime/peak RSS, settles the durable attempt, then hands the same held namespace
lease to ingestion. It returns no unsupervised SQLite connection.

## Actual acceptance

Nine focused admission tests pass in 8.300 seconds, process maxRSS 161,497,088
bytes. The final combined run passes **192 Python checks** in 43.291 seconds
(43.45 seconds process), maxRSS 186,597,376 bytes, terminal session 44518 exit zero.
It includes the original controller/guard tests, five new pure v2 record checks
and nine actual admission cases. The separate 23 guarded engine checks pass.
No TypeScript source changed; all 18 previous compiler execution-input pins are
identical, so that prior compiler receipt remains prior evidence.

The end-to-end test and separately recorded experiment patch parent
`sqlite3.connect` to refuse every call. The actual fixed worker initializes the
registry, reserves and admits the index; Node then ingests both retained Dakar
captures. A new admission invocation and fresh ingestion workers replay them.
The registry/index/lock inodes and one reservation remain unchanged. Results are
**2 captures, 2,283 ordinals, 1,810 versions, 473 overlapping duplicate ordinals,
0 conflicted keys**, with no duplicate versions on replay. The actual namespace
and index flocks remain held throughout the handoff.

Actual SIGKILL witnesses verify these admission boundaries:

| Boundary | Interrupted state | Fresh admission |
| --- | --- | --- |
| `reserved` | Durable charge, no child directory | Replays the reservation, creates its root once |
| `binding-published` | Charged root and exact published binding | Preserves the root inode and replays the reservation |

Neither witness emits a success report. Restart retains both full attempt/wall
charges and one reservation, then actual ingestion verifies all 473 input rows.
Two distinct binding admissions retain their separate operation pins and both
charges. Exhaustion, insufficient aggregate budget, invalid pins, missing
initialized attempt records and incompatible v1 namespaces fail without quota
reset or parent SQL.

The controller-loss fixture uses an actual native worker with the inherited
namespace lease and anonymous binding descriptor. It SIGKILLs only the owned
controller while the worker is paused before SQL. A fresh API invocation cannot
allocate while that worker holds the lock. The surviving worker then performs
actual admission despite loss of the parent descriptor; after confirmed exit,
a fresh controller replays one reservation with two attempts/30 reserved wall
seconds and ingests the original capture. Recovery uses durable records and the
actual lease, without supplying or signalling a remembered worker PID.

Two failed full-suite receipts are preserved. The first found a missing closing
brace in a new expected-JSON test literal; the v1 encoder was unchanged. The
second exposed an older fork-fixture cleanup race when the exact known child
appeared as a terminal zombie. That fixture now checks exact PID/status and
reacquires the permanent lock before cleanup. It still preserves unknown live
identity and never signals remembered PIDs. The production guard's unconfirmed
exit behavior did not change. Its old failed scratch remains preserved.

The independently recorded actual admission/ingestion/crash verifier finishes
in 5.30 seconds with process maxRSS 160,808,960 bytes. Nine current capture/ledger
files and **877 historical pins** remain unchanged. Current declaration:
**40 execution inputs, 389,326 source bytes, 5,070 manifest bytes**, SHA-256
`72923fc8a3f8144e45b064cf9b44dc1c315eddf46e25ad9d8ca969dbe879752d`.
Actual persistent snapshot charges 466,944 bytes and binding input 4,096 bytes.
Final source/test acceptance binds 60 pins; only the cleanup fixture changed
after the actual-source verifier, explicitly recorded in the final-v2 receipt.
The initial-v1 receipt's Python count is the intended suite size; full acceptance
is established by `all-v3` and final-v2, not that earlier count alone.

Receipts under `.cache/world-build/evidence/`:

- `feature-index-admission-focused-v1.{stdout,stderr}`
- `feature-index-admission-all-v{1,2,3}.{stdout,stderr}`
- `feature-index-admission-tooling-manifest-v1.json`
- `feature-index-admission-actual-v1.json` and `feature-index-admission-crashes-v1.json`
- `feature-index-admission-engine-v1.json` and `feature-index-admission-acceptance-v1.{stdout,stderr}`
- `feature-index-admission-source-acceptance-v{1,2}.json`

## Remaining work

Namespace admission is now supervised and restartable. Persistent **capture job
and input ownership**, frozen campaign membership/observation/completion fences,
independent raw/index conservation and full-country geometry/sharding/streaming
still need implementation. The namespace's unchanged 16-attempt limit is a
lifetime admission/startup bound; it is not a per-building or per-capture loop.
Do not reopen admission for every feature. A held admitted context supports
multiple captures under its existing engine/process/storage limits.

This is not a complete unattended country runner, OS sandbox, hard aggregate
memory guarantee, power-loss/corruption repair service, global capacity proof or
two-day completion forecast. Tests and measurements use disposable namespaces
and retained raw inputs. No acquisition, actual campaign/output/Nigeria/game
write, new country-detail promotion or World runtime upload accompanies this
phase. Nigeria rendering, regional conditions/terrain and phone-visible global
detail remain part of the full objective.
