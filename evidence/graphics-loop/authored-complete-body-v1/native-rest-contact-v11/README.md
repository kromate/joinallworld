# Native rest-contact V9 (isolated candidate)

V9 is a new candidate copied from V8. V6, V7, and V8 evidence and sources remain unchanged; this folder does not edit production files.

## Changes motivated by V8 failures

- Lie fitting now solves the spine first for a feasible pelvis/torso interval, then searches a separate neck bend for head clearance while preserving that interval. Both are source-rest-relative rotations bounded by the existing 12-degree spine and 25-degree neck limits. Posterior corrections target 16.5 mm inside the unchanged 18 mm contact limit; no penetration gate is relaxed.
- Upright lie-entry frames only prevent pelvis/prop penetration and retain floor grounding. The full posterior/head alignment is deferred until the actor is no longer upright.
- Stable soak anchoring repeats floor solve, measurement, and bounded root adjustment until the posterior target remains inside the allowed interval after foot IK. It does not accept the initial pre-foot-solve measurement as final.
- Shower alignment searches the shortest path from the current head position toward the host's exact showerhead world point. A candidate must remain over actual shower support and avoid sole penetration; stable wash requires the unchanged source head-zone predicate plus a 2 mm inward margin when available. The host callback remains `headZone.anchorWorld(): readonly [number, number, number]`.
- Seat-transition solving keeps one measured planted foot and preserves the other foot's animated height unless actual sole samples penetrate the floor; only then may it raise that foot. It never pushes the swing foot down to force a two-foot stance.

## Verification

Only JavaScript syntax and whitespace checks have run locally. No V9 TypeScript, CPU, browser, build, gameplay, or actual-GLB run has been performed. V8's remote failures remain the last executed evidence; this candidate has no acceptance claim.
