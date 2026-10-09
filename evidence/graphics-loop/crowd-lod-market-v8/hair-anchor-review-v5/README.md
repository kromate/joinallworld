# Hair-anchor v5 exact-hair experiment

This is an ignored-fixture-only diagnostic. Its production source import closure and GLB inputs are pinned to the frozen hair-anchor CPU source snapshot from commit `a6674737d1b35e9d217c86d79c8efbf39041ad3d`; it does not use current drifting production edits. The only mesh-recipe change is that compact mode gathers each hair item's original contiguous vertex range and exact triangle index order while body and non-hair wardrobe keep the v4 compact maps.

The rendered matrix contains two saved identities (male afro/hoodie and female bun/owambe), hair anchor `source` and `candidate`, body/wardrobe `source` and `compact`, and front/profile yaw. That is 16 captures. Camera and walk phase are reused within each actor/yaw pair. The strict guard remains in place for look identity, actor pose, head/scalp, generated hair attribute signatures, hair vertex/triangle count, and camera equality.

The single remote workflow packages under the established 220 MiB / 25 second / 96 MiB CPU guard, then renders only after the package job succeeds. The render job downloads the artifact from that same workflow run and creates its pin from that job's run ID, commit, branch, and actual manifest SHA. The remote Chrome job remains diagnostic-only with 2 GiB group RSS, a 60 second bound, and normal multi-process Chrome plus ANGLE SwiftShader.

No browser/build/GPU run has been performed for v5. Passing pure contracts only proves the exact hair index remap and copied diagnostic contracts; visual, runtime, memory, hardware GPU, phone, and production acceptance remain open.
