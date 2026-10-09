# Whole authored-body presentation prototype

This is an isolated CPU/source prototype for the pinned MPFB/Anny character. It keeps the complete authored head, eyes, teeth, tongue, body mesh, skeleton, and shape keys. It does not transplant the older head or use Allworld's generated shirt/robe lofts.

## Pinned input and measured coordinates

Input: `../authored-character-spike-v1/parametric-base-expressive.glb`, SHA-256 `0152129ce2c6022911747f9d7a6df3fdb72a9e6e1bea73db414da1cb8f483077`.

The source has four sibling skinned meshes, one 52-joint Mixamo skeleton, no image textures, and 34 retained body morph targets. `Body` has 14,517 vertices and 26,756 triangles. Its native bounds are X `[-0.49627, 0.49627]`, Y `[0.001545, 1.667435]`, Z `[-0.10154, 0.32147]` metres. The authored hips/spine/neck/head chain places the hips near Y `.912`, spine2 near `1.251`, neck near `1.407`, and head near `1.466`. The separate eye mesh spans Y `1.533–1.561`.

The source has one body material and no `COLOR_0` region attribute. Clothing ownership therefore comes from the authored mesh surface, native coordinates, and its skin weights. The copied triangles retain their source joint, weight, UV, and morph attributes. The only body change is a private geometry wrapper with an index that omits triangles replaced by the presentation surfaces; the template geometry and its index remain shared and unchanged.

## Prototype API and construction

`presentation.ts` exports `applyCharacterPresentation(root, look)`. Call it after the actor's cloned scene is attached to its root, and dispose its return value before disposing the actor rig. It adds a warm fitted shirt and trousers from complete authored triangles, plus two hair draws: a scalp patch copied from actual authored scalp triangles and a set of curls rooted at sampled scalp triangles. The outfit is a close surface fit with a 5–6 mm normal offset, not a loose-cloth simulation. The hair cap follows the body's 34 morphs; curl anchors use source-triangle barycentric morph deltas and normalized skin-weight interpolation. All presentation skinned meshes share the actor's skeleton, mesh transform, and live morph values.

Hair has a hard 7,000-triangle limit, with the copied scalp selection capped at 3,500 triangles. A bounded source GLB pass found 3,950 initial scalp-rule faces in 33 components; the largest shared-edge component contains 1,812 faces. The implementation uses only that connected component, leaving the other eye/mouth/ear-region islands on the visible body. It then allocates 72 curls from the remaining triangle budget (5,184 triangles), for 6,996 total hair triangles on this pinned source. Curl geometry uses six longitudinal segments and six radial sides per curl. The bun variant gives 16 rear scalp anchors more depth and radius; this is a restrained gathered silhouette, not a separate authored bun asset. Total added draw count is four: shirt, trousers, scalp, and curl details.

At the measured counts, newly allocated presentation buffers total 2,117,388 bytes (about 2.02 MiB), including the private body index, offset surface positions/indices, and interpolated curl morph arrays. Shared immutable body attributes are excluded. The added hairstyle uses 6,996 triangles; the body loses 8,089 faces replaced by the outfit/hair surfaces, so actor triangle count rises by a net 5,184 before eyes/teeth/tongue, with four extra draws.

`presentation.test.ts` is a bounded synthetic lifecycle check. It verifies source-index immutability, face replacement, morph propagation, normalized curl weights, triangle/draw limits, and disposal restoration. It passed with `node --max-old-space-size=32 --experimental-strip-types --test evidence/graphics-loop/authored-complete-body-v1/presentation.test.ts`. A separate small GLB geometry scan measured 3,421 shirt faces and 2,856 trouser faces under the current region rules; this is a source-space count, not visual acceptance. Remote rendering must still check hairline/ear clearance, scalp coverage, clothing fit across the 34 morphs, and animation motion before any acceptance.

## Current limitations

- Region thresholds are derived from the pinned asset's native coordinates and Mixamo bone names; unusual retargeted scales or a different authored asset fail to be supported rather than auto-fit.
- Clothing follows the source body surface closely and may read as painted-on fabric. The prototype establishes a stable clothed body presentation without face/body transplantation; it does not yet establish relaxed shirt drape.
- The scalp selection follows source triangles and leaves frontal/ear regions by explicit normal/height rules. It avoids radial bin holes, but only actual images can verify the hairline and silhouette.
- The synthetic test and authored-GLB browser review remain unexecuted. No mobile cost, production visual quality, or complete character acceptance is claimed.
