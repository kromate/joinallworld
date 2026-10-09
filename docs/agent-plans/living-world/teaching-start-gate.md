# Interactive teaching start gate — owner review only

Status: **unapplied proposal**. Patch base: `ab27b2ea822b006ab153cee95c674c3aed5ba744`. This artifact does not modify game/runtime source and makes no test, build, browser, or deployment claim.

The safety boundary is narrow: new teaching markers are created only when the engine receives `interactiveTeachingStarts === true` in its trusted context. The engine default is false. The marker-creation event is the only behavior behind the gate. A saved marker that has already been created remains readable and answerable while the gate is off, and existing legacy teaching shifts without markers continue to use their timed completion path. The gate does not change wages, completion, cancellation, save normalization, or answer validation.

The companion patch is in [`teaching-start-gate.patch`](./teaching-start-gate.patch). It proposes changes to `LifeContext`, strict context construction, marker creation and view facts, the `CareerView` contract/key list, and the Jobs label. It deliberately contains no host or route changes.

There is a client-display contract gap before the positive gate can be enabled. `src/app/state/game.ts` currently recomputes `viewLife(life, { now, cityId })` locally; it does not consume a server-projected `CareerView`. Consequently, the proposed career view field would be false in the client’s locally derived view even when a server action host opts in, and the Jobs label would continue to show the timed-shift caption. `VIEW_FIELD_KEYS` is the engine’s view-shape/test contract; it does not transport that value from the server. A later integration must define a small server-owned display capability in the existing response/client state path, expose it to the Jobs label for display only, and keep it out of client-controlled action payloads and saves. The authority decision must still come exclusively from Node/Worker host code. Until that display contract is reviewed and wired, the timed-shift caption is correct for the default-off baseline; the positive interactive caption is not accepted.

Before applying it, the integration owner must wire the trusted opt-in in both authoritative Node and Worker contexts. Set the flag from a code-owned feature policy, never from the HTTP request, save data, query string, or client action. Keep it absent/false in ordinary engine calls, untrusted preview contexts, and tests that are not explicitly testing the interactive start. Node and Worker must use the same policy for start actions and the server-owned display capability; otherwise the client may advertise a mode that the action host does not create, or fail to advertise one that it does. Review `server/host-context.ts` player-action call sites and `server/life-service.ts` context construction together with `src/app/state/game.ts` and the actual response/client-state path. The display capability is informational only; it must never authorize a start or answer.

Acceptance should cover both hosts at the engine boundary:

- Default/false context: starting a teaching activity emits the ordinary timed shift, leaves `teachingGeneration` unchanged, creates no `teaching` marker, and pays through the existing timed completion path.
- Explicit trusted true context: a newly started shift increments generation once and creates the authored marker; the view and Jobs label advertise interactive teaching.
- Gate turned off after a marker exists: strict save restoration preserves the marker, accepted answers can finish that same generation, and its normal completion pays once. The gate must not erase or downgrade it.
- Legacy saved timed shift without marker: load, wait, cancellation, and completion retain existing semantics under either gate value.
- False, absent, and non-boolean context inputs do not opt in. Public action payloads cannot set this field.
- Node and Worker tests exercise their real context constructors and confirm the same behavior. Existing save fixtures and timer-shift coverage remain intact.

Integration remains blocked on explicit review of this patch and the trusted-host wiring. Do not claim active interactive teaching is safely enabled until that wiring and the paired Node/Worker acceptance pass.

Selected trusted host contract: Node `ServerOptions.interactiveTeachingStarts` defaults false; Worker enables starts only for `INTERACTIVE_TEACHING_STARTS === '1'`. Private positive fixtures explicitly opt in. Production configuration carries no enabling binding. Integration alone wires the host paths; the display capability remains a separate activation requirement.
