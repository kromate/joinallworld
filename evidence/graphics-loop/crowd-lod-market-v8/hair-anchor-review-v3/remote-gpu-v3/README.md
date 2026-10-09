# Hair-anchor v3 GPU review recipe (package pin pending)

This recipe is a separate v3 copy of the bounded v2 same-actor A/B runner. It uses the v3 viewer and keeps strict actor/load-generation, exact-pose, source/compact, viewport, and network checks. The capture matrix remains two actual saved identities × two hair placements × source/compact × front/profile. Compact captures are refused unless the same hairstyle’s remapped item range, scalp marker samples, hair attributes, and both eye-UV reports are present.

The recipe is not runnable yet: `artifact-pin.json` and the workflow contain explicit `PENDING_CPU_*` fields. Root must first publish and verify the v3 bounded CPU package, then replace those fields with its actual run ID, commit, artifact name, builder SHA, and manifest SHA. Do not substitute the prior v2 package. The source manifest hash in the workflow pins this recipe independently from the CPU source manifest in `artifact-pin.json`.

The SwiftShader job remains a diagnostic. It cannot establish hardware GPU fidelity, mobile performance, continuous scalp contact from vertex proximity, or pixel-level eye visibility from UV rays. Candidate hair pixels and all compact checks require independent review; no candidate capture exists yet.
