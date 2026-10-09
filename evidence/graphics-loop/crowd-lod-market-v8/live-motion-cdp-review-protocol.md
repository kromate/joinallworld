# Bounded v8 live-walk CDP review protocol

Use only after the v8 static package has been built from the pinned manifest and its uploaded `build-manifest.json`/files have been independently verified. This is a remote browser protocol; this file does not run Chrome. Keep the existing `remote-gpu-review-v3` artifact immutable.

## Scope and limits

- Actors: `graphics-host-crowd-02` (male hoodie) and `graphics-host-crowd-03` (female Owambe), selected from the frozen 12-actor Market inventory.
- Browser: remote Linux headless Chrome/ANGLE SwiftShader. Treat pixels as diagnostic, never as phone FPS, battery, or hardware-GPU evidence.
- Bound the process group to 1280 MiB RSS and 60 seconds. Capture 12 PNGs total: three elapsed-walk checkpoints × source/compact mode × two actors. Keep `idle` and `interact` as separate static-pose controls; do not label them timed clips.
- Use the full-body fitted camera for live movement. Keep its camera transform fixed across each source/compact pair. Require `fullBodyProjection.fullyVisible === true` for both modes at each capture.

## Capture sequence

For each actor, load the saved identity once and record its normalized look, seed, body family, asset hash, topology signature, and initial source pose checkpoint. Select the full-body framing and walk pose, set phase to zero while paused, then call `window.__marketLodLiveWalk.play()`.

Observe at least two distinct non-null bone checkpoints and a changing phase while `playing` is true. Wait until `state().elapsedSeconds >= 2.4` before the first saved image. For each of three samples, pause and wait one browser task so the final pose is stable. Save the source image and telemetry, switch geometry to compact while still paused, and require the same pose checkpoint and identity/topology/look. Save the compact image at that exact paused phase. Switch back to source, verify the checkpoint still matches, then resume. Before samples two and three, allow another bounded positive wall-clock interval (for example 0.6 seconds) and verify `elapsedSeconds` continues increasing and the phase/bone checkpoint advances.

Record each sample's elapsed seconds, phase, actor/seed/look, mode, source and compact triangle counts, actual renderer calls/triangles, compact typed-geometry byte count where mode permits, bone-pose checkpoint, projected actor bounds, and PNG SHA-256. Match the source/compact pair by the identical frozen checkpoint, not by an assumed slider value. If the screenshot event takes long enough for phase changes, pause before switching mode and check the checkpoint equality again before capturing.

After each actor, pause and verify `playing === false`; wait briefly and confirm elapsed time, phase, pose checkpoint, and render counters remain unchanged without user input. Dispose by loading the next identity. At end, pause, navigate away, and verify pagehide cleanup through the browser/runner receipt. Any failed visibility or checkpoint assertion rejects that capture; do not replace it with a different actor or pose.

## Acceptance limits

This protocol proves only that the fixture's production stride phase advances over elapsed wall time and that geometry toggles preserve one actor's live skeleton at the captured paused checkpoints. It does not prove all-look coverage, continuous interact/action animation, scene budgets, mobile performance, or visual quality acceptance. A person still needs to inspect all 12 pixels, especially hands, feet, face, hair, clothing edges, and floor contact.
