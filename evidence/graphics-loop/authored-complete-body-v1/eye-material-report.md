# Authored eye material spike

## Source evidence

The check loads the pinned `parametric-base-expressive.glb` from the sibling spike directory and verifies SHA-256 `0152129ce2c6022911747f9d7a6df3fdb72a9e6e1bea73db414da1cb8f483077`. The named `Eyes` primitive has 160 vertices, 840 indices (280 triangles), `POSITION`, `NORMAL`, `TEXCOORD_0`, `JOINTS_0`, and `WEIGHTS_0`, plus four retained morph targets. It is already skinned and indexed; this change leaves its geometry, skin data, and morph targets in place.

The source UVs separate the two eye shells. The two forward poles (vertices at each eye's maximum local Z) map to UV centers `(0.807233, 0.049460)` and `(0.766176, 0.049460)`. Each shell's measured UV half extents are approximately `(0.019256, 0.018974)`. The shader selects the nearer normalized center per fragment and uses those measured extents for a centered limbal ring, brown iris, and dark pupil. No face-space socket guess or texture image is involved.

## Implementation and check

`eye-material.ts` clones the existing Eyes material, sets a warm ivory sclera, and adds the procedural UV masks in `MeshStandardMaterial.onBeforeCompile`. The source material remains untouched. The function returns a disposal handle that restores the prior material and releases the clone. It creates no geometry, texture, or draw call. Hex colors are represented as `THREE.Color` values and feed the standard material shader's linear lighting/output path.

The bounded CPU check loads only the pinned 2.7 MiB GLB with Node's old-space limit set to 64 MiB. It verifies the source hash, eye attribute/index counts, measured UV islands, material clone, shader patch/uniform contract, geometry byte-for-byte stability, and restoration on dispose. It completed in 21 ms. The shader check inspects Three.js shader-template injection and uniforms; it does not compile GLSL on a GPU or establish visual acceptance.

Run it from the repository root with:

```sh
node --max-old-space-size=64 --experimental-strip-types evidence/graphics-loop/authored-complete-body-v1/eye-material-check.mjs
```

## Limits

The authored eye has only 140 triangles per eye, so iris detail is limited to smooth procedural bands and restrained angular grain. This does not add catchlights or authored eyelid makeup. The iris diameter uses 0.58 of the UV shell diameter, with pupil diameter about 0.30 of the shell diameter; final scale, orientation, highlights, and appearance in the project's remote renderer still need visual review. No browser, build, render, or user-facing acceptance was run as part of this spike.

## Actual v3 image rejection and correction

Remote run 37944333253 compiled the shader, but root rejected both face images because the masks covered the exposed eye with pupil/iris. A bounded actual GLB position/UV scan found the front 2.69mm ring has normalized UV radius .033 and the front 5.7mm ring .066. The prior full-shell mask radius .34 was inappropriate: the UV shell includes the back of the eye, while the visible front surface occupies only a small part of that domain. V2 masks use iris radius .065–.074, limbal .074–.081 and pupil .023–.030. These match measured front rings and still need fresh rendered review. The earlier full-shell diameter statement is superseded.
