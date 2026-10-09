# v8 bounded remote package preparation

This separate CI recipe wraps only the frozen v8 static viewer build. It pins v8 viewer/HTML/builder inputs and all production assets/modules consumed by the builder; it does not change the v8 viewer or execute a browser.

The Linux wrapper limits the Node build process group to 220 MiB RSS and 25 seconds while the child uses a 96 MiB V8 heap. It records group and per-process peak RSS, terminal/zero-RSS breadcrumbs, child exit code, cleanup verification, exact source hashes before/after, and a canonical SHA-256 over every packaged file. A successful receipt requires a positive RSS sample, clean terminal exit, verified process-group cleanup, unchanged source pins, and a valid package manifest. The wrapper is diagnostic CPU packaging only.

`workflow-template.yml` is prepared for `workflow_dispatch` and pushes to `codex/graphics-market-lod-v8-cpu-review-v1`. It is not an active GitHub workflow until installed under `.github/workflows/`. It verifies the source snapshot, runs `npm ci`, invokes the bounded wrapper, and uploads package files and receipt even if the build fails. It does not claim browser animation, full-body framing, visual quality, or mobile performance.
