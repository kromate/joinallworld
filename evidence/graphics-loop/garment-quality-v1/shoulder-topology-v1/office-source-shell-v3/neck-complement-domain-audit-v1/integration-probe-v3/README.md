# Neck-domain probe v3 (prepared, not run)

V3 preserves the v2 source/domain experiment and fixes its browser launch contract. Run `37905711660` passed the build and synthetic checks, then the browser controller exited before Chrome because the bounded runner did not export its already-created per-run result directory as `RESULT_DIR`.

The v3 runner now derives an explicit absolute result root for browser mode and passes it through the monitor-gated child environment. The controller and runner share `browser-result-contract.mjs`; a focused Node test verifies the root is absolute, output artifacts live in a separate `browser-artifacts/` subdirectory, and stale inherited `RESULT_DIR` values cannot leak into non-browser modes. This test is included in the bounded synthetic test command and the snapshot/import-closure checks.

The existing build, synthetic, and headless diagnostic limits are unchanged. The candidate remains unaccepted: no v3 remote build, tests, GLB checks, or screenshots have run. A successful launch would still require pose checks, artifact inspection, and independent visual review.
