# V4 phase and placement diagnosis

The V3 actual prepared-GLB run reached the correct 3af home geometry and passed the ordinary pose calls, but combined rest checks still produced 14 failures. Lie/soak transitions were measured as if their time-zero upright source frame were already the final posterior pose; wash transitions also ran stable foot correction and shower-head-zone requirements before the actor had entered the shower loop. Those failures are real lifecycle mismatches, not a missing-prop case.

V4 carries an explicit `contactPhase` from the runtime sampler into the prepared pose port. A transition is accepted only if the source-mapped frame is finite, sampled back-region points do not penetrate the real prop by more than 4 mm, sampled soles do not penetrate the registered world floor by more than 4 mm, and an upright frame has at least one sole planted within 4 mm. The transition branch does not move hips, force both feet to the stationary prop plane, or assert shower head-zone occupancy. At `sampleStill` and `sampleUse`, the phase is `still`; the prior strict full checks remain in force.

The phase decision comes from whether the runtime is sampling its active named transition clip. `finish()` clears that transition before sampling the stable endpoint. Thus an intermediate frame cannot silently inherit stable contact, and the stable endpoint cannot bypass it. The phase is evidence metadata, not a capability or pass flag.

For prop placement, `supportForTransition` attaches the actual world floor derived from the registered seat or active work placement. The check examines actual source shoe contact samples and back-region samples from the visible skinned body/garment. It is still a bounded-region check, not whole-mesh collision proof; animated arms, front-side intersections, and pixels remain open.

The host calls `sitOn`/`workOn` before `show`, so `seat.lying` may reflect the previous pose when a lie-down starts. `put()` now treats the requested `lie` pose as a lying anchor, avoiding the old `seat.top - sitContact * scale` placement on that first transition frame. Static and seated anchors otherwise remain unchanged.

The V3 receipt reported 14 combined rest failures: both families failed stable lie/soak posterior compatibility; wash entry/exit failed floor/head-zone or foot conditions. V4 does not alter those stable thresholds. Actual V4 results are pending.
