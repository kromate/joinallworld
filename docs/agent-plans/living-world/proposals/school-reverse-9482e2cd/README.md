# Reverse-gear recovery proposal (source-only)

This review packet targets the frozen Integration baseline `eec14690544a4646e4cd8a5ad280d61bbe2709ca`. It does not change the shared checkout and has not been executed. The test-first patch and the implementation patch apply in sequence to an isolated copy of that baseline. No tests, typecheck, build, browser, or server run is claimed.

The proposal adds a genuine server-stepped reverse control because the existing forward-only controls can leave a car stopped at a road edge without a control that moves it back along its accepted heading. That makes this a plausible recovery capability, not a diagnosis or accepted fix for the observed school-lesson failure. The saved school journey must first be reproduced with a red regression at the physics seam; normal progress, assessment, and qualification rules remain unchanged.

## Proposed interface and physics

`DrivingInput` gains an optional `gear: 'forward' | 'reverse'`. Omission means forward, so existing frames keep their meaning. Persisted motion is explicitly versioned per driving record: v1 remains the exact old record and state shape, forward-only with the old nonnegative speed bound; v2 adds a required `gear` state field and keeps `speed` as a nonnegative magnitude. The driving service dual-reader accepts strict v1 or strict v2, and upgrades only this driving record to v2 when an explicit gear field is used. The shared pure reader defaults to strict v1; only the service passes the row's validated version, so the parked mapped-trip adapter cannot accidentally accept v2. This does not bump the global save version or broaden another game system's schema. A v2 reverse record is bounded to 3 m/s; forward retains its existing 16 m/s physics cap. Both readers retain the old reload rule: running records become paused with zero speed before an explicit resume, and v2 defaults back to forward gear.

A direction change brakes the current motion to zero at a bounded rate before switching gear; there is no velocity sign flip. Same-direction forward acceleration/braking and its physics cap remain unchanged. Reverse steering has the opposite yaw response and movement still traverses the existing swept-road verifier. Reverse is capped at 3 m/s for low-speed manoeuvring. A rejected swept step keeps the last accepted position and heading, stops, clears dwell, and retains the existing 25-point off-road penalty. This intentionally changes the old rejected-turn heading side effect: an invalid candidate can no longer pivot the saved vehicle at its safe position. Reverse movement cannot award a checkpoint. Backing out of a full-stop target cancels dwell; reversing into an armed checkpoint marks it blocked until the driver exits, then requires a fresh forward approach. Speed-limit penalties apply to either direction.

The server frame reader accepts either the old exact three-field input or the exact four-field form with a valid gear. It continues to derive every fixed step from authenticated saved state, packet sequence, and server elapsed credit. Retry fingerprints include gear, so changed-direction payload reuse conflicts. Unknown gear and malformed packet shapes are rejected without mutation. No client coordinates, passed flag, direct heading, score, checkpoint, or elapsed-time fields are added.

## Evidence and proposed acceptance

`reverse-road-edge-regression.patch` is the first, test-only red regression for a stopped car near a road edge: a forward step remains at the safe point while reverse should move backward along the same accepted heading, with no checkpoint/pass change. It is red-capable against the baseline because the existing strict reader does not accept `gear`.

After recording that failure, apply `reverse-gear-implementation.patch`; it retains the same regression and adds pure-physics and service fixtures for continued road-bounded recovery, the intentional rejected-turn heading correction, opposite yaw, braking before direction changes both ways, stop-dwell cancellation, reverse entry into an armed checkpoint followed by strict reload and exit, forward legacy compatibility, v1/v2 quarantine, malformed gear rejection, server-derived sequence/retry behavior, and reload pausing a reverse-moving journey at its accepted position with zero speed and forward gear. These fixtures are proposed, not executed.

Before considering the control accepted, run the test-only regression first and record the actual failing assertion. Then run focused physics/service tests and the normal compiler/release gates on the resulting exact source. A real end-to-end check must use an ordinary retained journey and demonstrate that the user can back away with actual keyboard/touch controls, then continue through the same checkpoints and stop dwell without changing qualification or award behavior. A bad or incomplete course must still fail normally; reverse must not clear or forgive its score.

## UI, renderer, and release handoff

`DrivingApp.vue` would need an explicit Drive/Reverse selector with at least 44 px controls, keyboard support, and a clear speed-direction indicator. Existing W/up throttle, S/down brake, and steering inputs should remain available. Gear is an input choice, not evidence of motion; show server-confirmed nonnegative speed with the canonical gear separately, and clear held throttle/brake on blur, hidden state, pause, and context changes. During a shift, show the requested gear separately from canonical motion gear until stopped. After reload/resume, begin in forward gear with neutral held controls.

`drivingScene.ts` currently derives wheel travel from unsigned positional displacement. If the published vehicle pose API treats wheel distance as signed, supply signed displacement so wheels visibly roll backward; otherwise record that limitation instead of altering vehicle geometry. The panel must distinguish requested gear from canonical motion gear while braking: a request to reverse does not mean reverse is engaged until the server returns stopped state with v2 `gear: 'reverse'`. On legacy v1 rows, missing gear always means forward. Renderer motion remains presentation only and cannot affect server state.

The v2 record is not readable by an older server. Before UI enablement, deployment needs a compatible rollback image or an explicit account/record rollback policy; do not silently reset v2 rows under a v1 reader. The parked mapped-trip adapter is outside this proposal, remains disabled, and keeps its own nonnegative state contract. Do not broaden it as part of this work.

**Decision for Root before shared-source adoption:** approve the narrow per-driving-record v2 migration and compatible rollback requirement as written, or require a different versioned record boundary? Do not weaken the strict v1 reader, reinterpret v1 speed, bump the global save version, or let this fixture authorize mapped trips.

The source change also keeps the old score policy. Reverse does not recover points or clear a failed assessment. The observed retained checkpoint had score 0, below the existing 70-point pass threshold. Reverse may let that player move away safely, but that saved lesson cannot earn qualification; the user must start a fresh allowed attempt when the existing service permits it. The sanitized diagnostic did not independently bind that row to a journey UUID, and this proposal does not claim the reverse mechanic explains or repairs the exact native fault.

## Files

- `reverse-road-edge-regression.patch` — apply first; test-only red regression.
- `reverse-gear-implementation.patch` — apply after the red run; contains the final version of that regression plus source and service tests.
- `base/` and `candidate/` — isolated source snapshots used to prepare the patches.

No route clearance, vehicle footprint, boarding, terrain, yield, fleet, allocation, rental, mapped-trip, or permission claim is made here. Existing practice-road validation remains the only motion boundary.
