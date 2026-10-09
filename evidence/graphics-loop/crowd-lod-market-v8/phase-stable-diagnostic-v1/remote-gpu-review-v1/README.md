# Phase-stable v8 live-walk source/compact diagnostic, v1

This is a separate, unrun remote diagnostic recipe for the phase-stable CPU package. Its artifact run ID, commit, builder SHA, source manifest SHA, and package manifest SHA intentionally remain placeholders until the distinct CPU package succeeds. It refuses incomplete pins.

For each of the same two saved identities, the harness starts production stride and requires at least 2.4 seconds of RAF playback, distinct phase/bone witnesses, and changed final bone pose. It pauses and checks for a settled exact checkpoint, then captures a source frame immediately before any yaw or mode event. It captures the eight source/compact front/side comparisons at that same paused phase; all ten PNGs and pose witnesses are reported. Exact applied phase is compared against separate slider-control telemetry. No tolerance or phase rebasing is used.

The wrapper follows the reviewed diagnostic limits: Node96, 2048 MiB process-group RSS, 60 seconds, pre/post source snapshot checks and verified process-group cleanup. Chrome is constrained to single-process ANGLE SwiftShader; those pixels are diagnostic only, not hardware GPU or mobile performance evidence. Static `interact` remains untested as a timed animation. Root must replace placeholders with the successful CPU package pins, review, and publish this recipe before it can run.
