# Native curl hair prototype

This is a source-guided solid-hair diagnostic for the existing afro look. It uses the exact pinned afro geometry as a spatial guide, then places one actor-owned InstancedMesh of simple solid curl clumps. It does not alter the saved look, change the low-cut hairstyle, modify the source GLB, add a new asset dependency, or edit presentation/viewer code.

## Source and construction

The guide is the pinned CC0 afro01 mobile GLB at SHA-256 3d37f4a379c19b4d64a9c21bb08418858ede79317a477b34b3fdfb965fd11474. It contains 2,276 vertices and 2,192 triangles. The prototype samples actual source triangle centroids after a deterministic 1.2 mm position deduplication, then uses farthest-point coverage to select 600 placements. Each placement is an eight-triangle octahedral curl clump. The full hairstyle is 4,800 triangles in one instanced draw, with 38,400 bytes of private instance matrices. The tiny unit geometry is shared by actors; each actor owns its color material and placement buffer.

The source guide's bodyFeminine and bodyMasculine targets are copied from the actor body and applied before placement. A body identity change recomputes the guide positions and instance matrices. Curl instances are children of the actor's actual mixamorigHead bone. The module captures the native rest head transform and expresses the source-root guide coordinates in that head-local frame, so later head animation moves the clumps with the bone. The caller must keep the original loaded alpha-card guide hidden while retaining it as the source guide; the module deliberately does not mutate its visibility or geometry.

This is a deliberately simple low-poly clump surface. It reuses the authored afro's volume and silhouette as its placement guide, but it does not recreate strand flow or exact authored curl topology. The source hair weights are predominantly Head (about 98.2% of summed guide weight), with about 1.8% on Neck and negligible residual influences; rigid Head parenting is consequently close to the original source weighting while remaining slightly different around the lower hairline.

## CPU evidence

The check parses the exact authored body, motion rig, and pinned afro GLB, creates masculine and feminine complete actors, and evaluates guide alignment and head following. The source guide positions and morph arrays remain unchanged, body geometry identity stays unchanged, one actor's color/matrices do not affect another, and disposing one actor leaves the other actor's shared unit geometry usable.

| Body family | Guide root bounds X / Y / Z (m) | Curl-center bounds in native Head local space (m) | 95th percentile distance from any source-triangle centroid to a curl center |
|---|---|---|---:|
| Masculine | X −0.0978 to 0.0978; Y 1.5441 to 1.7593; Z −0.0867 to 0.1569 | X −0.0635 to 0.1206; Y 0.1193 to 0.3343; Z −0.1635 to 0.0484 | 8.01 mm |
| Feminine | X −0.0941 to 0.0941; Y 1.4112 to 1.6160; Z −0.0775 to 0.1362 | X −0.0670 to 0.1099; Y −0.0053 to 0.1940; Z −0.1217 to 0.0618 | 7.34 mm |

Every generated center matches a source triangle centroid within 15 nanometres of the CPU transform math. Switching the body target blend from its native family endpoint to a half-and-half test blend moves a curl center about 71.46 mm, proving the generated cap responds to the loaded source family morph. A head-bone rotation check confirms the instance position follows the same native bone transform exactly. These are source and transform checks, not rendered acceptance.

## Integration boundary and limitations

The new module is native-curl-hair.ts. Its factory takes the hidden pinned guide Mesh, the actor root, actual Body SkinnedMesh, native Head Bone, the guide SHA-256, and saved hairColor. It returns an InstancedMesh lease with refresh, recolor, metrics, and dispose. Dispose every actor lease before disposing the factory. A render review is still needed to judge whether the faceted clumps read as natural curls at gameplay camera distance and whether the forehead edge needs more source-guided coverage. No browser, app build, Blender, or screenshot render was used.

Run the bounded CPU check with:

  node --experimental-strip-types evidence/graphics-loop/authored-complete-body-v1/native-curl-hair-check.mjs

The check result is retained in native-curl-hair-check-result.json. The isolated TypeScript type check passed. The CPU check completed in under one second and peaked at 127,361,472 bytes (121.5 MiB) resident memory.
