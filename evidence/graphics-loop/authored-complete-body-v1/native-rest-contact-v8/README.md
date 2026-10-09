# Native rest-contact V8 (isolated candidate)

V8 is a separate candidate copied from V7. V6 and V7 evidence remain unchanged; no production source is modified.

V8 adds three measured corrections while keeping all existing contact limits:

- Rest anchoring now targets a 16.5 mm maximum gap, giving 1.5 mm of rounding margin inside the unchanged 18 mm acceptance threshold. The minimum permitted penetration remains 4 mm.
- Lie alignment includes the sampled head-back region in the non-penetration interval. If a bounded 12-degree spine adjustment cannot make pelvis, torso, and head compatible with the same prop translation, it tries a contact-derived neck adjustment up to 25 degrees; otherwise the pose fails closed.
- Prop anchoring is deferred until the mapped rest posture is physically reached: lying checks engage once the actor is no longer upright; soak/wash engage after 75% of the named transition. Upright transition frames still require actual floor samples, no sole penetration beyond 4 mm, and at least one planted sole. At the prop-contact phase, the full sampled posterior regions are checked again. This addresses the V6 bed-entry case where the actor was still upright but the prop anchor was already being applied.
- Wash support now has an explicit host anchor contract: `headZone.anchorWorld()` returns the transformed source showerhead point in world space. V8 moves the actor root in XZ toward that point, solves the actual floor contacts again, and rechecks the exact head-zone predicate. The home fixture derives it by transforming source-local `(-0.2, 1.98, -0.2)` through the shower item's actual world transform. The runtime persists the measured XZ delta across `put()` and removes it when constructing transition origins, so placement calls do not erase or accumulate it.
- During seat entry/exit, V8 keeps the selected planted sole on its measured support. It preserves the other foot's animated height unless one of its sampled sole points is below the floor; then it raises only that foot enough to clear the penetration. Final checks still reject any sole more than 4 mm below support and require at least one planted side.

The V6 wash failures identified a host-placement mismatch. The recorded shower soles were within 1.2 mm of the tray, but both head-zone tests failed. Under the recorded parent transform, the new model's head fell just outside the source spray box. The candidate keeps the source box unchanged and uses its exact transformed center as the placement anchor.

## Verification status

V8 has not had a TypeScript, CPU, browser, build, or actual-GLB run. V6/V7 failures remain the last executed evidence until the parent runs this candidate. V6 and V7 remain preserved separately.
