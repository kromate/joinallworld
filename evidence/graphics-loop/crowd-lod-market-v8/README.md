# v8 live-walk source/compact diagnostic preparation

This is a new fixture derived from the frozen v7 viewer, HTML, and static-package builder. It keeps the v7 saved actors, geometry recipes, saved-look checks, exact source pins, A/B toggle, and deterministic pose/yaw/phase controls. The v7 package and its remote results remain unchanged.

The v8 viewer adds an explicit fixture-only `window.__marketLodLiveWalk` API (`play`, `pause`, `state`) and a Play/Pause button. Play advances the existing production `SkinnedBody.stride` call from `performance.now()` on a requestAnimationFrame loop with a 2.4-second normalized cycle; telemetry publishes elapsed seconds, phase, mode, actor/seed, bone checkpoint, renderer counts, and whether playback is active. Pause cancels the outstanding frame request. Actor load and pagehide stop playback and dispose through the existing fixture cleanup path. The API does not change production code or claim that SwiftShader frame rate represents phone performance.

The original detail camera remains available for matched static screenshots. Full-body framing computes the currently deformed body and wardrobe bounds with Three's `SkinnedMesh.computeBoundingBox`, fits a perspective camera around their combined sphere, and reports projected pixel bounds plus `fullyVisible` in the status JSON. Root must verify these pixels and both families during the remote review before calling the framing verified. In the Play loop the camera stays fixed after fitting; capture telemetry recomputes the live deformed bounds to catch any walk pose that clips.

Walk is now continuously sampled using the existing production stride solver. `interact` is still only the existing static pose; this fixture does not invent an interaction animation or action timeline. No production or mobile acceptance is implied. The package builder is prepared but has not been run locally or remotely in this task.

## Planned bounded remote build

The prepared workflow template `remote-compile.yml` verifies the pinned source manifest, installs the exact repository lockfile in GitHub Actions, packages the viewer with Node's 96 MiB heap cap, and uploads the resulting static fixture. It is not an active workflow until root installs it under `.github/workflows/`. It is manual-dispatch only. No Chrome capture is part of this workflow; a separate review must use the resulting artifact and verify true advancing phase, matched source/compact checkpoints, visibility of the full posed body, stop/dispose behavior, and the unchanged source look.
