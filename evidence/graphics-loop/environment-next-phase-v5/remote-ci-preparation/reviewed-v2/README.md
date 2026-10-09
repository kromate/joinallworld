# Reviewed v5 CI package recipe, compile-only phases

This version replaces the earlier v5 preparation attempt while leaving its scripts and receipts untouched. The earlier copied builder used synchronous iteration over Node's async `Dir` at `collectGenerated`, and its builder copied all public files before the finalizer attempted the same `wx` copy again. The reviewed v2 recipe makes the stages explicit and prevents both failures:

1. Seal current `src/`, all `public/`, Three r180 core/addon sources, lockfiles, and the exact v5 host/private candidate fixture closure. The candidate source record must match both current production source hashes and clone-output hashes or sealing stops.
2. Compile only: emit both installed Three r180 build siblings (`three.core.js` and `three.module.js`), the exact used addon entrypoints, full production host/city split graph, import-mapped HTML and hashed compile record. The module sibling-import closure is checked across static imports, export-from clauses and literal dynamic imports against emitted outputs or import-map targets. `collectGenerated` uses `for await` over `opendir`; this phase copies no public files.
3. Seal the compile record and each compiled output.
4. In a separate Node process, verify source and compiled pins, then stream-copy and hash the full public tree exactly once. It writes the final route/import-map manifest and verifies all 40 pinned city-map sources have 40 emitted map chunks.
5. Stage a hardlink-only review root and run the v5-specific copy of the strict v4 manifest validator. The static listener is not launched by CI.

The workflow is branch-only and staged here because `evidence/` is ignored. Root must copy the reviewed `workflow.yml` into `.github/workflows` when preparing the dedicated review branch. Node 22, 96 MiB old-space, 220 MiB owned process-group RSS and 25 seconds total remain unchanged. The Python runner launches each Node phase serially in one isolated process group so esbuild/compiler memory is released before finalization; it does not raise any resource cap. Existing v4 bundle/settings are retained, including no esbuild `minify` option.

No command, build, test, host, or browser was run for this preparation. `compile-v5-record.json`, `build-manifest.json`, and the local host are produced only on the remote workflow after root review. This is diagnostic packaging, not production download, visual, GPU, or phone acceptance.
