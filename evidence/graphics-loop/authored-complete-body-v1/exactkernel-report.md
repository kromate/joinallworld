# Exact indexed body-surface kernel (prepared, not executed)

`native-body-surface.ts` now evaluates every distinct vertex referenced by the mesh's current visible draw range and material groups. It no longer approximates the extremal surface by direction/blend buckets or rejects bodies above the former 4,096-candidate ceiling.

Per mesh, the implementation caches morph-adjusted base positions until the morph influence/attribute signature changes. Each sample updates the actor world matrices and skeleton palette once, then runs a tight vertex/lane loop using Three's Float32 `skeleton.boneMatrices`: base position → bind matrix → four weighted palette transforms → bind inverse → mesh world transform. The post transform and scratch storage are reused; the loop does not allocate a vector or matrix per vertex. Skin weights are consumed with `BufferAttribute.getComponent`, preserving normalized integer-attribute semantics and the original (possibly non-unit) sum.

The probe observes active geometry groups, material visibility, index, and `drawRange`. It refreshes its unique-vertex list if those range inputs change, and it rejects invalid references or array materials without groups. Hidden meshes/ancestors are excluded from bounds. `sourceVertexCount` reports full position-attribute counts; `candidateCount` reports the referenced unique vertices at probe construction. The existing solver constructs the probe after presentation/body masking, which is the relevant production order.

`verifyAgainstThree()` is a diagnostic oracle, not part of the runtime sample loop. It compares every active kernel point to `SkinnedMesh.getVertexPosition()` followed by the same current `matrixWorld`, reporting maximum 3D point error and bound errors. The intended gate is `maxPositionError <= 1e-6 m`; it must not be loosened to make a result pass. The independent comparison also exercises current morphs, bind matrices, family correction, and Float32 bone-palette values.

## Prepared check

`exactkernel-check.mjs` loads pinned body, clip, casual/office, and shoe GLBs through the existing image-free loader path; constructs both family actors with the native family correction and actual authored outfits; then runs idle, walk, cook, and sit samples. For each it compares the batched kernel against both `verifyAgainstThree()` and an independent full active-index bounds loop. It reports active mesh/index/group/draw-range counts and exact maximum errors. It does not claim rendered-contact quality or mobile performance.

Run when the shared remote execution slot is assigned:

```sh
node --max-old-space-size=128 --experimental-strip-types evidence/graphics-loop/authored-complete-body-v1/exactkernel-check.mjs
```

Only syntax checks have been run locally. The actual GLB check, precision threshold, and runtime cost remain unverified until the bounded remote run completes.
