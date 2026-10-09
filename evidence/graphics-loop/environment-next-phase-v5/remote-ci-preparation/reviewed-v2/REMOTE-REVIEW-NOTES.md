# Root review notes

The prior `environment-next-phase-v5/remote-ci-preparation/workflow.yml`, `pipeline-v5.mjs`, `run-bounded-linux.py`, and root `build-v5.mjs` remain preserved as preparation failure evidence. Do not run those inputs: the builder's generated-file enumeration uses synchronous iteration of `opendir()` and it copies `public/`, which conflicts with a second public copy in the finalizer.

Use only the `reviewed-v2/` workflow and phase scripts. The workflow is staged here because all evidence paths are ignored; publish/copy it to `.github/workflows` only after root review. This branch is exact-name push-only. The source pin sealer checks the v4 candidate source record and candidate clone hashes. If production source changed after the clone was made, the safe result is a prebuild failure until root refreshes the fixture; no mismatch is silently blessed.

No v5 build was executed. The remote-only runner keeps the same 96 MiB Node old-space, 220 MiB process-group RSS and 25-second end-to-end wall clock bound. The four/separate Node stages run serially under the same Python-owned process group; compile process exit releases the esbuild heap before public packaging.

The v4 static output remains immutable failure evidence: its `vendor/three.module.js` imports and re-exports from `./three.core.js`, while the v4 output manifest has no such sibling. Reviewed v5 pins the installed `three.core.js`, emits it beside the module wrapper, and requires an import-closure receipt for all compiled JS static imports, export-from clauses, and literal dynamic imports. The restricted server also requires both Three sibling routes and that receipt. No browser/runtime execution has confirmed this repair yet.
