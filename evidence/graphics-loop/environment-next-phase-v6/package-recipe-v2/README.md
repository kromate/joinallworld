# V6 diagnostic package recipe — unrun

This is a new distinct v2 retry of the v6 split-compiler/finalizer recipe after v1 exposed a missing pinned README path. It changes only the ignored evidence fixture. It validates every literal file/tree input before hashing. It must be reviewed and pinned before remote execution.

The recipe seals all production `src/`, `public/`, and Three addon files plus the exact v6 actual-host viewer, candidate copies, control helpers/tests, package scripts and workflow. It verifies the complete seal in separate pre/post processes. Fresh Node processes compile the shared Three core/module pair, actual Three addons, and the real full-host/city graph. Consumed source buffers are checked against the seal and rechecked. The output seal resolves app, vendor, addon and all forty city-map chunks, including the import-map targets. A distinct finalizer copies public files once and records a diagnostic static manifest.

Resource limits match the successful diagnostic recipe: 384 MiB owned process-group RSS, Node 96 MiB old-space, total 25 seconds, serialized stages with `GOMAXPROCS=1`. This is remote CI build headroom only. The package's raw bytes, if produced, are not a release-size, production, phone, or quality certificate.

The workflow template expects branch `codex/graphics-environment-next-phase-v6-package-v2` and uploads artifact `environment-whole-slice-v6-package-v2-<run-id>`. No compilation, test, package artifact, or workflow run has been performed for this copy.
