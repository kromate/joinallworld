# Isolated remote neck-complement check

This is an artifact-only diagnostic. It does not touch production source or publish anything. The workflow is intentionally triggered only by a push to its dedicated review branch. Root owns branch publication and review.

The run pins the complete fixture, production import closure, actual male/female body GLBs, clip pack, package manifest/lock, and probe source in `snapshot-files.json`. It first verifies hashes and all local imports/asset URLs, installs the locked dependencies, and bundles the viewer under a 96 MiB Node heap, 220 MiB process-group RSS, and 25 second limit. It then runs the focused coverage/closure tests under the same limits. Only when both pass does it launch the remote browser review, capped at 2 GiB process-group RSS and 60 seconds; cleanup must be verified. Artifacts upload even on failure.

The browser uses the runner's preinstalled Chrome ELF and records its version and hash. ANGLE SwiftShader is forced into a single-process topology to stay within the isolated diagnostic cap. This result is not representative of normal browser process topology or mobile performance.

The browser verifies both actual body families and the production office mask, source chart, shader programs, and candidate face-area closure. It checks the source-corner position equation at eight named sampled poses per body family, then captures paired baseline/candidate frames: eight idle yaws and selected reach, walk, and sit angles. Every paired frame checks that the candidate adds exactly the reported one draw and complement triangles. The images and JSON/Chrome logs are retained as artifacts for independent visual review. Any shader/runtime/HTTP/uncanceled network error, mismatch, incomplete image set, or source drift fails the run.

No remote job has been run for this revision. Passing a source or synthetic check will not imply visual acceptance; only the actual captured pixels can establish whether the neck continuity improves without creating holes or material leaks.
