# Phase-stable v8 diagnostic CPU package, v1

This is a separate diagnostic package for the copied phase-stable viewer. It does not modify or replace the original v8 fixture, motion-v3 failure evidence, or the reviewed v8 CPU package. It uses the same complete production import closure and locked dependencies as the v8 v2 recipe, while replacing the entry with `phase-stable-diagnostic-v1/viewer-market-gpu-v8-phase-stable.ts` and the copied HTML.

The source copy preserves the exact applied RAF walk phase separately from the quantized slider control. Yaw selection only changes the camera. The package builder pins the copy, HTML, Market inventory, both real body assets, complete production closure, package files, builder and runner. Output is isolated under `static-fixture-market-gpu-v8-phase-stable-v1/`; it is not visual or runtime acceptance.

The Linux recipe follows the reviewed v2 budget: Node old-space 96 MiB, process-group RSS 220 MiB, 25 seconds, before/after source hashes and verified group cleanup. Root must publish this exact frozen source snapshot before execution. No package build or browser run is included here.
