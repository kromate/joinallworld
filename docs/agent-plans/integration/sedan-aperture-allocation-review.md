# Sedan aperture allocation review

**APPROVE with the explicit finite contract in the companion JSON.** Allocate only the two new files server/living-world/sedan-aperture.ts and server/living-world/sedan-aperture.test.ts to the existing idle Cloud vehicle writer on public 3e3e0876fc50f3166a0d0968f8616b577da27870. Both files are absent there. All four actual source hashes match the complete LIVING document at d40f66bc2e68aeb5006e78c7ed15e8556742d53a. No existing files, startup imports, shared assets, routes or rejected385 payload are allocated.

Implement a frozen pinned descriptor and pure bounded analyzeSedanAperture function. Inputs are a validated static rigid body transform, bounded door/steering intervals, and at most64 finite capsule-sweep enclosures with declared provenance. Return conservative geometric results and structured refusal reasons; canBoard and authoritativeClearance are always literal false. No runtime Three/app imports. The companion JSON fixes numeric input bounds, tests and failure behavior so this is an implementation allocation, not another proposal.

The source aperture in [z,y] is (-.05,.49),(.89,.49),(.89,1.27),(.7325,1.48),(-.05,1.48). Rotate the moving panels about(-.96,.93,.89), not their nominal center(-.96,.93,.42), through[0,.55π]. Keep the roof/hood/sill/opposite cap, glass/trim, floor, four cushions/backrests, dashboard and dynamic steering as obstacles. A rectangle at roof1.48 is not the opening and is not a free corridor.

Use conservative Float32/contact bounds and complete angular interval enclosures. Endpoint-only angle tests and anchor-center trajectories cannot prove clearance. Static yaw/pitch/roll/translation must be explicit; moving or unknown body poses fail closed. Actual scene entry starts sit easing while sliding into the seat; exit slides while seated then stands outside. Test normal and reduced-motion phases without claiming the provisional .6m exit distance is certified.

Required proof includes source/generatedFloat32 correspondence, taper/hinge/contact counterexamples, intermediate-angle and between-sample collision cases, all interior solids and steering bounds, rigid-frame equivalence, malformed/oversized refusals and authority flags staying false. Full clothed clip sweeps, support/terrain, mapped motion and renderer proof remain separate gates.

No implementation or tests executed. Exact pins and detailed acceptance contract are in /tmp/allworld-sedan-aperture-allocation-review.json.
