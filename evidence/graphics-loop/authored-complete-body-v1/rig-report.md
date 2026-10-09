# Whole authored body rig adapter: bounded CPU check

The isolated adapter loads the pinned expressive parametric body and retargets the existing world `idle`, `walk`, and `dance` clips onto its named 52-joint Mixamo skeleton. It uses a per-Kit shared template/clip cache, a SkeletonUtils clone per actor, per-actor materials and morph weights, and shared immutable template geometry.

The bounded check passed with Node 22 using `node --max-old-space-size=48 --experimental-strip-types evidence/graphics-loop/authored-complete-body-v1/rig-check.mjs` (about 0.2 seconds). It verified the source hashes, four skinned parts, 27,676 total triangles, three retargeted clips with 23 tracks each, distinct skeletons and materials for two actors, geometry sharing, isolated walk/dance poses, expression/body morph application, per-actor material disposal, shared-geometry retention, Kit teardown, and rejection when loading through an already-disposed Kit. The report is in `rig-check-result.json`.

Input pins:

- Authored expressive body: `parametric-base-expressive.glb`, 2,692,984 bytes, SHA-256 `0152129ce2c6022911747f9d7a6df3fdb72a9e6e1bea73db414da1cb8f483077`.
- Existing animation pack: `clip-pack.glb`, 338,060 bytes, SHA-256 `89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47`.

The clip pack contains named animation nodes but no glTF skin, so the check builds its 23-node source skeleton wrapper from that hierarchy before retargeting. All four authored skinned parts have separate Skeleton wrapper instances but share the same posed Bone objects; the adapter validates the bone references rather than requiring wrapper identity.

This is loader, rig, ownership, and CPU-pose evidence only. It does not establish rendered skin-tone matching, facial naturalness, clothing coverage, hair/accessory parity, age variation, feet/floor alignment, GPU cost, mobile performance, or production integration. The authored body retains 34 morph targets and renders 27,676 triangles; a later measured optimization can bake static identity morphs per actor while preserving the shared source for look rebuilds. Current face/body morph values are provisional pending actual image review.
