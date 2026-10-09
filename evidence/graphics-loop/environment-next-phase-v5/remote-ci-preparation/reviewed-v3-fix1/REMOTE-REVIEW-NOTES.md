# Parent review notes: v3 split-process retry

The authoritative v2 attempt (workflow run `37888843170`, commit `586a5aeb`) is preserved as a memory-limit failure. It crossed the unchanged 220 MiB process-group limit at the full application graph after its compile process had read the complete pin inventory. V3 changes the process boundary, not the resource cap or content scope.

Review before publication:

- Confirm the runner phase sequence is serial and all children remain in the runner-owned process group. On failure it terminates the exact current group, waits, escalates to `SIGKILL` if needed, and writes a failure receipt in `finally`.
- Confirm `source-pins-v3.json` seals `src/`, all `public/`, Three r180 core/module/addon source, package lock, and the exact private fixture/recipe files. Fresh `precompile` and `postcompile` verifier processes rehash that full inventory.
- Confirm each compiler is a fresh Node process. The app/addon onLoad hooks hash the consumed source bytes against the pin table; each phase rechecks its consumed inputs before exit. The output-seal phase rechecks all consumed inputs and every emitted output.
- Confirm the output closure spans app, CSS/assets, vendor, and addon files. The v3 recipe explicitly emits both `three.core.js` and `three.module.js`, scans imports across all generated JavaScript, validates the import map, and requires all 40 Lagos-capable map chunks.
- Preserve all fixed limits: Node 96 MiB old-space, group RSS 220 MiB, pipeline 25 seconds. Do not rerun locally or increase any cap.
- If this remains too large, stop with the exact receipt; do not omit country maps/public assets or stub production modules to reach the cap.

V3 has not been executed. Successful source preparation does not establish a successful build or runnable browser fixture.
