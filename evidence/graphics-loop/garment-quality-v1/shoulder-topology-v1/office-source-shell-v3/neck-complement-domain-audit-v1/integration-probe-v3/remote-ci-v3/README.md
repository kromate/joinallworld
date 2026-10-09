# Bounded remote neck-domain review, v3

This distinct recipe fixes the v2 failure at controller startup: the runner computed a unique `remote-results/<run-id>` directory but failed to pass it to the gated browser child. The browser controller requires an absolute `RESULT_DIR`, and stores screenshots beneath `RESULT_DIR/browser-artifacts` while its stages, logs, and receipts remain in the per-run parent directory.

`browser-result-contract.mjs` is imported by both the runner and the browser controller. Its focused tests cover absolute-path validation, the separated output/stage paths, overriding stale inherited values, and clearing `RESULT_DIR` for non-browser workloads. The test is part of the existing bounded synthetic phase. This makes the regression executable before any Chrome launch rather than relying on static workflow inspection.

The build and synthetic phases retain their 96 MiB Node heap, 220 MiB process-group RSS, and 25-second limits. Browser review retains its 2 GiB and 60-second limits. Every phase keeps its positive actual-Node RSS witness, process cleanup, exact source snapshot, and uploaded failure receipts. No run has yet been performed for v3; no visual or integration acceptance is implied.
