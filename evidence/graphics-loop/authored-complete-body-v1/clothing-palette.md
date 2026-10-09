# Authored suit palette material experiment

`createAuthoredClothingPalette()` in `clothing-palette.ts` creates a private `MeshStandardMaterial` clone and applies two look colors across the existing connected suit. The vertex shader exports each garment vertex's authored local `position.y`; the fragment shader uses `smoothstep` across a 2 mm band centered at 0.91 m to blend trouser color below into shirt color above. The palette is multiplied after the standard map stage, so standard material lighting, texture alpha, normals, roughness, and other source material state remain in the ordinary Three.js pipeline.

This is a continuous **palette zone** over one garment surface, not an authored shirt/pants seam. It changes no vertices, indices, skin weights, body masking, morphs, or geometry bytes. The caller must remove the old two material groups and render the geometry with this one material if it wants the expected one-draw path; that adapter change is outside this module's ownership.

Each factory call owns its cloned material and independent `THREE.Color` uniforms. `setColors()` updates already-compiled shader uniforms for that actor; `dispose()` is idempotent and disposes only the clone. A stable cache key identifies the shader version while keeping palette values as uniforms, allowing actors with different colors to share the same shader program.

The bounded CPU check, `clothing-palette-check.mjs`, loads the exact current GLB through Three.js's GLTFLoader, creates two independent palette clones from its actual `MeshStandardMaterial`, applies the hook to Three's standard shader sources, verifies the typed uniform values and live color updates, and confirms that source material disposal is not triggered. It passed at 88,276,992 bytes peak process-group RSS under the 128 MiB / 45 second limits. It does not compile a GPU program or prove rendered color appearance.

## Remaining visual checks

- Compare native-rest front, side, and back for both body morphs to ensure the fixed authored-Y band lands at the intended waist.
- Inspect idle and walk with the existing geometry groups removed, checking that no sleeve or shirt tail receives trouser palette unintentionally.
- Confirm the transition remains visually clean when the body-feminine/body-masculine position morph moves the garment while the varying remains tied to base authored `position.y`.
- Measure actual draw calls after the root-owned geometry-group update; the palette factory alone does not remove existing groups.

The material colors are created as `THREE.Color` values, so six-digit hex inputs are converted to Three.js linear working color before uniform upload. The report makes no claim about GPU compilation, visual acceptance, or mobile performance.
