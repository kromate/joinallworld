# Authored suit rest-frame and waist-boundary audit

## Finding

The V6 waist color edge is produced by the adapter's per-triangle material classifier, not by two authored garment components or material groups. The pinned MakeHuman OBJ has 8,336 faces, no `g` groups, no `usemtl` tags, and one edge-connected component. The exporter consequently writes one 16,672-triangle primitive with one neutral material. The V6 adapter splits that primitive into shirt and trouser material groups using triangle-center height **and** average leg-bone influence.

Replaying that exact V6 rule on the pinned suit GLB assigns 8,766 triangles to the shirt and 7,906 to trousers, matching the captured V6 review metadata. The resulting material boundary has 118 shared source-topology edges and spans Y=0.86877–0.91772 m (4.89 cm), with edges in six one-centimetre bins. That broad, irregular assignment is consistent with the visibly ragged salmon/green waist edge in the settled woman idle-front render.

As a diagnostic comparison, assigning whole triangles by their center Y alone at the same 0.91 m threshold yields 8,692 shirt and 7,980 trouser triangles. Its shared boundary spans 0.90500–0.91772 m (1.27 cm), with edges in two one-centimetre bins. This is evidence that the leg-weight condition causes most of the boundary spread. The height-only result is a control, not a visually accepted fix; it still assigns whole triangles, so some faceting can remain.

## Frame and topology checks

The current pinned complete-body GLB and regenerated suit GLB both place their mesh nodes at identity local transforms. The body mesh has 52 skin joints; the suit carries the same 52 joint names in the exact order recorded in its bake metadata. Both assets use the same Y-up, +Z-facing, metre-space convention: the body POSITION bounds are approximately `[-0.496, 0.002, -0.102]` to `[0.496, 1.667, 0.321]`, and suit bounds are `[-0.454, 0.079, -0.109]` to `[0.450, 1.429, 0.192]`. The exporter applies the source builder's 0.1 scale and `joint-ground` floor offset. The inspected V6 adapter copies the body mesh transform and bind matrix and binds the outfit to the actor's existing skeleton, so there is no separate outfit skeleton or obvious node-space offset in this path.

This confirms the coordinate and joint-name contracts at source level; it does not measure actual GPU bind behavior or outfit-to-body clearance. The render's `idle` state is sampled through the retargeted idle clip, so the shoulder appearance should be judged again in the incoming native-rest view before attributing it to the garment shape. The exporter reports male MHCLO-to-OBJ fit error mean 1.41 cm, p95 2.20 cm, maximum 3.01 cm. That source fit statistic does not establish the female fit or the rendered animated contact.

## Smallest next experiment

For a no-triangle-growth diagnostic, replace the per-triangle `Y < 0.91 && legInfluence >= 0.12` material rule with the measured Y-only rule and compare the same native-rest and idle camera frames. This isolates the cause while keeping every triangle and the body-hide map unchanged. The source OBJ has no authored top/bottom groups or separate connected component to use as a semantic split. A true authored waist seam therefore needs new source annotation or a deliberately generated contour; it cannot be recovered as an existing group boundary from this asset. Do not claim the Y-only classifier is a source-authored seam.

The shoulder/sleeve appearance remains unresolved by this audit. It is not evidence that the bind frame is wrong, and the waist classifier result does not diagnose sleeve coverage or fit.

## Inputs and reproducibility

`clothing-rest-audit.mjs` fetches the exact pinned source OBJ and verifies its SHA-256, then reads the pinned body GLB, current suit GLB, and hide map. It reports the OBJ's groups/components, body/outfit local transform and bounds, joint-order agreement, and both material-split boundary measurements. It does not load a renderer, mutate assets, or claim visual acceptance.

Current input SHA-256 values:

- Body GLB: `0152129ce2c6022911747f9d7a6df3fdb72a9e6e1bea73db414da1cb8f483077`
- Suit GLB: `1f8d4fd4b867785226a9c057562289381ae071cf5acbcca248133a3216ae476f`
- Body hide map: `dbe0c82a3e31da4e6ce37f4f1d9dc8611143c7c9e6dbef72ffea8d281aebe099`
- Source suit OBJ: `001921d237e408c35103720d046aa37f9c5512db1a179a5ede6a065cd504ba89`

The bounded Node run completed with exit 0 at 133,545,984 bytes peak process-group RSS against the 128 MiB ceiling (134,217,728 bytes). No build, browser, or production source was changed.
