# Bounded Admin 1 planar evidence

The topology runner is a separate local builder operation over the already published Natural Earth Admin 1 product. Its input and output never enter the game database or startup bundle. It preserves all original geometries, immutable manifests and protected Nigeria. Read [ADMIN1-TOPOLOGY-SPEC.md](ADMIN1-TOPOLOGY-SPEC.md) for the frozen interface and [ADMIN1-OPERATIONS.md](ADMIN1-OPERATIONS.md) for source and publication provenance.

## Run and resume

From the world worktree, use the shared heavy slot:

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- node --experimental-strip-types world/admin1-topology-cli.ts --manifest-hash 66f79ac4b88c39873976a3b43284e08585bb16b5bb3a5fdae3d4de8dcae8a616
```

The private Python 3.12 runtime, DuckDB 1.5.6 and exact cached Spatial extension must already exist. This command installs nothing and uses no network. The independent publication verifier runs first in a cancellable child. Python then verifies the pinned raw source and evaluates each supported non-Nigeria feature. Repeating the command re-verifies publication and the saved report, then reuses that report without another Python computation attempt.

Exit **0** means all nonprotected rows passed in the supported planar domain. Exit **2** means the report was successfully published with invalid or unsupported findings; retain and inspect those findings. Exit **1** means execution, integrity or resource failure. Protected Nigeria alone does not produce exit 2. SIGINT/SIGTERM terminates and awaits the live child; interrupted starts stay charged. A process killed before its terminal journal write leaves a retained pending attempt that a later run can resume around. Never edit or reset actual attempt history to obtain more retries.

Completion is checked again after terminal durability and lock release. If the deadline expires during the terminal filesystem sync, the command rejects the result even though that already-written row may describe the published report as success/findings. A journal row alone therefore does not prove the caller finished within its deadline. This bounded terminal cleanup is not an OS-level guarantee that a stalled filesystem call can be interrupted.

Canonical reports live at `.cache/world-build/admin1-topology/reports/<request-hash>/<report-hash>.json`. The small immutable pointer `requests/<request-hash>.json` is published last. Durable starts and terminal records live at `attempts/<request-hash>.jsonl`. A missing or corrupt report referenced by the selected request's pointer or successful journal entry is an integrity failure. All journal records receive bounded shape/hash/count checks; report bodies for the selected request additionally receive full current source/inspection binding checks. Verified cache reads remain available after computation-attempt exhaustion.

## Bounds and interpretation

The operation shares the acquisition lock. Its deadline is at most 120 seconds including preflight; combined controller/live child RSS is sampled against 512 MiB. Source limits are 64 MiB, 10,000 features, three million positions and 100,000 positions per feature. Python uses one DuckDB thread, a 128 MB engine limit, no temporary spill, and no automatic extension downloads. Report/stdout is at most 2 MiB; request 64 KiB; stderr 16 KiB. The topology tree is bounded to 16 MiB, 512 entries and depth five. Audit limits are 128 files, 1 MiB total, 8 KiB per record and eight lifetime computation attempts per immutable request. Admission requires 100 MiB free plus temporary report/pointer and terminal audit headroom. Unsafe paths and symlinks fail.

`ST_IsValid` and `ST_IsEmpty` evaluate a derived two-dimensional, unwrapped longitude/latitude image. The original source bytes and higher ordinates remain preserved in the published product. Polar, global-span and ambiguous longitude images are explicitly unsupported. This does not prove spherical validity, shared-border agreement, complete coverage, official hierarchy, currentness, boundary recognition or playability. The original publication's `topology: unverified` flag remains immutable; do not convert the source to fine-v2 or repair it silently.

## Acceptance evidence

Actual first/repeat runs published the identical report **`02591aec6d163a247f5e650949c41252e61f118aeeb03a79efdff3645dbcb23f`**, **1,466,461 bytes**, for request `625b0080d50ff2cb714a3df61b64c9c16d5018ff13466620c218153cc221cfda`. All **4,596** source rows are represented: **4,554 valid, three invalid, two unsupported and 37 protected Nigeria**; **4,557** were submitted to supported planar predicates. First/repeat took **18,177 / 9,272 ms**, used **zero network**, and sampled combined peak RSS **510,754,816 / 493,223,936 bytes**, below 512 MiB. Both correctly exited 2 for findings. The repeat was a verified cache hit; the journal still contains exactly one computation start and one findings terminal.

| Source key | Source label / country | Result |
|---|---|---|
| `NE_ID:1159309897` | Goiás / Brazil | Invalid in the derived planar image |
| `NE_ID:1159313109` | Chukchi Autonomous Okrug / Russia | Invalid in the derived planar image |
| `NE_ID:1159313293` | Northern / Fiji | Invalid in the derived planar image |
| `NE_ID:1159315599` | Antarctica / Antarctica | Unsupported polar/global-span image |
| `NE_ID:1159315601` | Unnamed source row / Antarctica | Unsupported polar/global-span image |

These are validator results, not diagnoses of the exact defect or authority to repair the source. Preserve each original feature. Any later stronger product must keep these exceptions explicit and establish its own admitted geometry/scope.

The independent result audit imports no compiler, binder or publisher. It rechecks original raw SHA/Git blob, immutable publication and inspection bytes, every source key/ordinal/feature hash/identity/country binding, Nigeria protection, predicate tuples, summary conservation, tooling hashes, request pointer and journal. It completed in **1,974 ms**, sampled RSS **250,527,744 bytes**. It is an independent byte/identity/count audit, not a second geometry engine. Evidence under `.cache/world-build/evidence/`: `admin1-topology-{first,repeat,independent,repeat-audit,findings}.json` and retained stderr/stdout receipts.

The broad suite passed **365 World Node tests**; the final reviewed runner passed its **eight** focused cases, quality binding **nine** and private Python worker **nine**. Full World TypeScript passes. Focused checks cover more than 32 units, a valid polygon above the old 40,000-position limit, holes, invalid/overlapping polygons, dateline/higher-ordinate images, polar ambiguity, schema/key/hash/count/resource failures, Nigeria protection, cache corruption, charged interruption/resume and lifetime attempt limits. Fixtures use temporary repositories and copies of the pinned extension, never the real build ledger. The first typecheck launch could not obtain a shared heavy slot; its wait failure is retained separately and the actual subsequent typecheck passed.

No browser/runtime reader changed in this wave. The accepted lazy Admin 1 preview and separate Nigeria renderer therefore retain their prior visual evidence; no new device or soak result is implied.
