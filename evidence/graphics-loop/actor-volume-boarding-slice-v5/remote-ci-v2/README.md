# Remote actor-sampler v5 test recipe (prepared, unrun)

This recipe tests the isolated v5 production-adapter sampler against the real shipped male/female body GLBs and walk clip. It is not production integration and it does not certify collision, clearance, or boarding behavior.

The workflow is intentionally branch-scoped to `codex/graphics-actor-sampler-v5`. It checks the exact source snapshot and local TypeScript import closure before installing dependencies, then runs exactly one Node 24 test under `--max-old-space-size=96`, a 220 MiB process-group RSS ceiling, and a 25 second wall limit. It does not invoke the full test suite or change project budgets. Snapshot and import-closure checks are small preflight steps; only the test subprocess is subject to the stated runtime cap.

The package manifest and lockfile pin the third-party dependency tree. The workflow uploads the raw log and receipt even when the focused test fails. A successful result requires test exit 0, source hashes unchanged, cleanup verified, and both limits respected. This source recipe has not been executed; no test pass is claimed.

When root publishes this proposal, place the workflow under `.github/workflows/`; its `EXPECTED_SNAPSHOT_SHA256` value is the exact hash of `snapshot-files.json`. The snapshot manifest deliberately excludes itself and the workflow to avoid self-referential hashes; the resulting manifest hash pins every test/runtime input and lockfile.
