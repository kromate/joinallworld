# Environment review fixture v6 — source-only candidate

This isolated fixture changes only review control and readiness bookkeeping. It does not alter production scenes, actors, geometry, collision, or maps. It must be packaged from the exact v6 fixture inputs before remote execution; the v5 package and all v5 render recipes remain immutable and cannot serve this viewer.

## Readiness and request evidence

The production `jaw:home-frame` event carries no host, entry, or body-generation payload. V6 therefore treats it only as a redraw hint. The Home gate observes the current host after selection and requires the fixture's current host generation and Home entry, fixed seed/look identity, `avatarRendering === canonical`, `canonicalBodyEligible === true`, and a render count newer than that entry's baseline. A cached body can be reused on a time change only when the current entry has rendered again. Host rebuilds invalidate the body witness. Unknown/fallback avatars never satisfy the Home gate. The reported body generation is a fixture witness serial; production exposes no body-mesh identity/hash, so it is not presented as one.

Readiness waits have monotonically owned IDs. Selection, time/crowd/variant changes, resize, rebuild, and dispose synchronously invalidate the active ID. A stale async waiter cannot write the newer status, ticket, or final receipt. Recent waits and movement requests are included in structured snapshots. Walk requests persist as immutable request records; subsequent movement observations carry the matching request ID instead of replacing the request with transient status text.

`readiness-protocol-v6.test.mjs`, `remote-review-v1/scope-plan-v1.test.mjs`, and `remote-review-v1/remote-control-v1.test.mjs` are small source-level checks. They do not exercise Three.js, the actual host, browser rendering, or visual quality.

## Remote review partition

The future remote run is deliberately split into three independent jobs at `max-parallel: 3`, each retaining the previously reviewed remote-only limits of 2 GiB owned process-group RSS, Node 96 MiB old-space, and 60 seconds:

- `scene-pair-home-neighbourhood`: Home and Neighbourhood, day and night.
- `scene-pair-market-beach`: Market and Beach, day and night.
- `lifecycle-only`: one fixed Market/day anchor, walk request, dispose/rebuild, then permanent dispose.

Each capture must append and fsync its own diagnostics record immediately after saving its image. A later timeout or kill must not erase already completed captures. A scene-pair job stops after the first pending/invalid capture rather than spending its whole 60-second budget on later scenes. Transition polling reads `window.__graphicsReviewV6.snapshot()` structured place/time/host state, never status text. It clicks Wait once, obtains that wait's monotonic ID, and observes only that ID's receipt. Lifecycle verification does not replay all eight scene captures. The limits are per job; this design does not increase the aggregate remote cap, phone budget, or production budget.

`remote-review-v1/scope-plan-v1.mjs` defines these partitions, validation rules, and append-only progress receipts. `remote-review-v1/remote-control-v1.mjs` provides the structured transition/wait polling and fsync'd per-image receipt helper for the eventual CDP controller. The remote browser recipe is not yet sealed, packaged, executed, or visually reviewed. No run, screenshot, remote artifact, mobile result, or quality acceptance is claimed here.
