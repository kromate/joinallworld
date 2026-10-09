# Trouser sock trim A/B (diagnostic only)

This fixture tests the visually attributed male calf defect from `calf-component-toggle-v1`: the pale calf patch belongs to the authored `shoes01` sock mesh, not the body. `trouser-sock-trim.ts` clones only the actor's shoe `BufferGeometry` and filters its index above the actual per-side hem of the current posed garment. Position, normal, UV, color, skin-index, skin-weight, morph and material data remain shared and untouched. Source geometry is restored when the lease is disposed.

The A/B viewer samples the same actor in idle and four stride phases. It unions sock triangles that rise above the trousers in any sampled phase and unions sole-contact triangles that must be protected in any phase. It then compares that fixed private index with the original shoe index at the same look, pose, camera and skeleton. This is a finite diagnostic sample, not proof over every continuous clip frame.

Female office is an explicit skirt no-op. The female and male casual looks use trousers. The helper does not alter body hide maps or authored assets. It is not connected to production. Production integration would need to call the helper after footwear creation and before `createAuthoredFootContacts` caches sole support, as confirmed by the garment owner; the viewer's V29 factory creates contacts earlier, so it proves rendered appearance and sole-preserving indices, not production contact-cache ordering.

The same component run attributed the female office tan chest patch to the Body mesh because it disappears in clothes-only rendering. The previous 26-triangle torso candidate did not visibly remove that patch; this fixture does not claim or change that unresolved body coverage issue.

## Inputs and ownership

- Body/family, animation, wardrobe and footwear loading use the frozen V29 prepared factory snapshot `../native-prepared-factory-v29.ts` (`ecf30896371cdf65317894e5f2add34eb7679f0f8b9c5f72210457159f38f5e2`).
- Shoe trim helper: `../trouser-sock-trim.ts`.
- Shoe source asset: `../../authored-footwear/out/shoes01-mobile.glb` (`8f4060a275356489205f298bed9874da83920c166aeacffd36746e760a465557`).
- Body source: `../../authored-body-compression/outcompressed/parametric-base-facial-meshopt.glb` (`dfa53941f0fb77d69e59f59fa017f72efa45eddd7e6e8b8414b4a4dba332d552`).
- Male casual clothing: `../../authored-clothing/out/male_casualsuit01.glb` (`1f8d4fd4b867785226a9c057562289381ae071cf5acbcca248133a3216ae476f`).
- Female casual clothing: `../../authored-clothing/casual-female-export/out/casual-female.glb` (`7063492e52bb8817981349df45e141e0bc70dbe3e339d4d2dac8df3bdc3342bd`).
- Female office clothing used as the skirt no-op control: `../../authored-clothing/office-export/out/office-female.glb` (`fd3f4ac0985dae3d6f46469fc8f22ea22d84628c83829c77802a79b1f8f3c053`).

## Review gates

Compare source and trim for male casual and female casual in idle and the two visible walk phases, front/profile/back. Confirm the gray sock patch is gone without a hole, sole or visible leg change; confirm the female office source and candidate index/count are identical. Verify the same source index bytes, attribute object references, material and skeleton survive; trimmed geometry is actor-private and is released on teardown. A remote render and parent visual review are still required. No pixel or gameplay acceptance is claimed here.
