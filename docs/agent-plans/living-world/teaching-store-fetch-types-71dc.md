# Teaching store test fetch typing repair

Baseline: `71dc696f1f37d0b59dac7dba64d1299634c20aef`. This narrow test-only patch updates the two teaching-related `createGame` fetch doubles to accept the platform fetch input union, resolve `string`, `URL`, and `Request` inputs against a local fixture origin, and pass only pathname plus query to the existing fake-server guards. Synthetic held 503 and successful 200 replies use actual JSON `Response` objects with `Content-Type: application/json`; all existing timing, transition, authority, and accepted-life assertions remain intact.

No production code changes. Exact-baseline `git apply --check` passed on a temporary copy. Tests, typecheck, build, and runtime checks were not run; Integration must run the official compiler/test gates before accepting this patch.

```json
{
  "baseline_commit": "71dc696f1f37d0b59dac7dba64d1299634c20aef",
  "patch_sha256": "6d6fe6c37c3d278d5f957fbc78bf888e3af3943bb709a149999a55c8bace0ccd",
  "runtime_model_evidence": "Parent assignment identifies this worker as previously runtime-verified Luna; no fresh turn_context timestamp was supplied for this patch turn.",
  "changed_files": [
    {
      "path": "src/app/state/game.test.ts",
      "base_sha256": "794d678cfa5935d49e8a4f3488f522435c3d35c7327831de32a23e8c1476ed4c",
      "proposal_sha256": "60b2d7e4f4d799dddb48bc1b61d85c5b9af3cefc15519740d7d73f6c2a6a3c4f"
    }
  ],
  "source_only_checks": {
    "exact_baseline_git_apply_check": "passed on temporary exact-baseline copy",
    "typecheck": "not run",
    "tests": "not run",
    "build": "not run"
  },
  "status": "unapplied test-only proposal; Integration owns assembly and verification"
}
```
