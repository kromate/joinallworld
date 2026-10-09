# MakeHuman clothes feasibility for the pinned authored body

## Finding

An authored MakeHuman garment can be converted into a skinned, morphable Three.js clothing mesh from the pinned Anny/MakeHuman source data. It can keep real hems, seams, cuffs, and folds from the garment OBJ, and can follow the current 52-bone rig and identity morphs without a runtime helper-cage draw. The conversion is an offline asset bake: the current expressive GLB does not retain the original vertex IDs or the helper-tights anchors required by the clothes mapping, and its builder deliberately drops helper-tights.

The small male `male_casualsuit01` pair is a workable first geometry candidate. Its metadata says `basemesh hm08`; the pinned source's `base.obj` is byte-identical to the official MakeHuman hm08 `base.obj`. The older 1.1 mirror copy still has stale AGPL headers, but the pinned MakeHuman assets repository at commit `8cf9645b975a98eea056b140df11a1d278da0d10` contains the same MHCLO map and garment geometry with per-file CC0 headers. Its README explicitly says all bundled assets were released under CC0 in September 2020 and that legacy AGPL/GPL headers are a migration issue; it allows use under those earlier licenses as an option. The repository root has the CC0 1.0 license text. Use the exact pinned-repository pair below, not the older mirror byte versions.

## Exact source and measured compatibility

The upstream body builder is pinned at [`nirholas/three.ws` commit `ec8d1d270b93b8e2e87e8a6160bb908665fe1fcd`](https://github.com/nirholas/three.ws/blob/ec8d1d270b93b8e2e87e8a6160bb908665fe1fcd/scripts/build-parametric-base.mjs). It reads `avatar-sources/anny/3dobjs/base.obj`, scales MakeHuman's decimeter coordinates by `0.1`, subtracts the ground height from Y, and makes each output vertex from that OBJ's original `v` index. The same commit's exact `base.obj` is 1,749,303 bytes with SHA-256 `8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c`. It is byte-identical to both the current Anny `src/anny/data/mpfb2/3dobjs/base.obj` and MakeHuman Community's `makehuman/data/3dobjs/base.obj`. This gives a direct, measured hm08 topology and index match rather than a coordinate-space guess.

For structural analysis, the files were first fetched from the individual official 1.1 mirror paths [`male_casualsuit01.mhclo`](https://download.tuxfamily.org/makehuman/assets/1.1/base/clothes/male_casualsuit01/male_casualsuit01.mhclo) and [`male_casualsuit01.obj`](https://download.tuxfamily.org/makehuman/assets/1.1/base/clothes/male_casualsuit01/male_casualsuit01.obj). Each file was fetched separately below the 2 MiB per-file cap; the 267 MiB system-asset pack and all large texture files were not fetched. Those older mirror files have these exact hashes and obsolete AGPL headers:

| File | Size | SHA-256 |
| --- | ---: | --- |
| `male_casualsuit01.mhclo` | 570,969 bytes | `c5cd932fa410618f33dcf284ef5392fe3feb819b288480bbd5d3a29e1d9ad673` |
| `male_casualsuit01.obj` | 700,113 bytes | `7994ee5dd0e4d300302c9098e84be08770e9e4077101c3f0f19a79d25c2a851e` |

The adopted source should instead be the individually fetched pair at the pinned [`s20220526/makehuman-assets` commit `8cf9645b975a98eea056b140df11a1d278da0d10`](https://github.com/s20220526/makehuman-assets/tree/8cf9645b975a98eea056b140df11a1d278da0d10/base/clothes/male_casualsuit01):

| Pinned file | Size | SHA-256 | Git blob SHA-1 |
| --- | ---: | --- | --- |
| `base/clothes/male_casualsuit01/male_casualsuit01.mhclo` | 570,419 bytes | `78503ed7f56c149843d85e06e1164bc6871ce7319b2ef689237046352cc90de4` | `614c0ea5177946c0c08a269e6ea991c0991dc00c` |
| `base/clothes/male_casualsuit01/male_casualsuit01.obj` | 699,545 bytes | `001921d237e408c35103720d046aa37f9c5512db1a179a5ede6a065cd504ba89` | `81e941c3a40e5a396e81544f77baf263f84e3386` |

The Git blob IDs above were verified with `git hash-object` against the fetched pinned bytes and match the GitHub contents API. This repository's `.gitattributes` only assigns LFS to PNG, JPG, TIF, and BMP, so the OBJ has no LFS OID; it is a normal Git blob. The pinned MHCLO explicitly marks itself CC0. Its contents after `verts 0` are byte-for-byte equal to the older mirror's mapping section; the OBJ's `v`, `vt`, and `f` records also match byte-for-byte. Only the header/provenance bytes differ, making this a same-geometry and same-map CC0 release with exact file identity.

The pair contains 8,426 MHCLO vertex maps, exactly matching the OBJ's 8,426 `v` records; the OBJ also contains 8,984 UV records and 8,336 face records. The map rows have three source vertex indices, three barycentric weights, and three offset values. All row weight sums are within `0.00001` of 1. The 25,278 anchor references use 2,284 unique source indices, all in the pinned source vertex group `helper-tights` (`15328–18001`); none reference the visible `body` group (`0–13379`).

That helper range is absent from the current output. At the pinned builder revision, the emitted submeshes are only `Body`, `Eyes`, `Teeth`, and `Tongue`, and its `(source vertex, UV index)` split is not written back as a source-index attribute. The current expressive GLB retains the body morphs and rig, but a runtime loader cannot index its `Body` vertex buffer with the MHCLO's `15328–17975` references. The mapping is compatible with the source hm08 OBJ, not directly addressable in the reduced GLB.

The source targets provide the missing shape data. In the pinned `macrodetails/african-female-young.target.gz` sample, all 19,158 source vertices are represented; all 2,674 vertices in `helper-tights` have nonzero deltas. This proves that the helper anchor surface is designed to move with body identity, rather than being a static rest-pose cage. The upstream builder combines target deltas by source vertex index and then emits the subset belonging to each chosen submesh; extending that same offline pass to clothing is compatible with its existing data model.

The coordinates also match the garment's intended male base. I evaluated its MHCLO formula using the pinned source positions plus the builder's `bodyMasculine` recipe (one third each of African, Asian, and Caucasian young-male targets), and used the declared reference vertex pairs to scale the offsets. In MakeHuman source units, the mapped garment bounds are X `[-5.201, 5.165]`, Y `[-7.466, 7.078]`, Z `[-1.247, 2.398]`; the garment OBJ bounds are X `[-5.220, 5.184]`, Y `[-7.460, 7.289]`, Z `[-1.212, 2.393]`. Corresponding mapped points differ from the OBJ positions by 0.141 source units on average (1.41 cm after the builder's `0.1` scale), with a 95th-percentile difference of 0.220 units (2.20 cm) and 0.301-unit maximum. On the unmodified neutral hm08 positions, mean difference is 0.617 units (6.17 cm); this confirms the outfit should be baked against the masculine identity shape. This is a source-coordinate comparison, not a rendered fit judgment.

## Proposed bake path

1. Parse the pinned hm08 OBJ, the MHCLO map, the garment OBJ, `weights.mixamo.json`, and the same source target recipes that produce the retained body morphs. Do this in the existing offline asset-bake stage. Preserve source vertex IDs through mapping; do not infer them from approximate spatial nearest-neighbor matches.
2. For each garment vertex, evaluate its three MHCLO anchor points from the source positions and barycentric weights, then add the MHCLO's per-axis scaled offset. Apply the body's existing `0.1` scale, floor translation, and +Z-facing transform after that evaluation. MHCLO's published location formula is `w1*r1 + w2*r2 + w3*r3 + (sx*d1, sy*d2, sz*d3)`; its `x_scale`, `y_scale`, and `z_scale` values define those offset scale factors.
3. Transfer the 52-bone skin influences by barycentrically blending the three source anchor vertices' weights, then retain the strongest four and renormalize as the existing builder does. For each supported identity morph, barycentrically blend the corresponding three source target deltas to create the garment's morph delta. The current Three.js actor can then share its existing skeleton and copy the same body morph influences onto the garment mesh.
4. Translate the clothing `delete_verts` mask through the source body faces while building the GLB, using MakeHuman's own hide-face semantics. The visible body must have the mapped under-clothing faces removed; adding a correctly skinned outer garment alone will not fix the current skin poke-through. Do this alongside the offline source-index mapping so face ownership is exact.

This yields one ordinary clothing `SkinnedMesh` with authored OBJ topology and UVs; the helper-tights points are only bake-time anchors, not a second runtime mesh or draw. It can preserve current animation through transferred source weights and preserve the current identity morph set through mapped deltas. The MHCLO's axis-scaled offsets should be evaluated against the selected base-body identity when generating each garment variant, since the offset scale references depend on body dimensions.

The `.mhclo` + `.obj` pair totals about 1.21 MiB before GLB packing. The mirror directory also lists separate AO (767 KiB), diffuse (5.2 MiB), and normal (1.6 MiB) maps. The OBJ has UVs, so the runtime can start with a palette material and no maps; adopting its textures is optional and adds their download cost. This is an asset-size estimate only, not a mobile GPU or visual-quality result.

## License chain and limits

The pinned pair's per-file CC0 notices, root repository README, and root CC0 1.0 license text establish the license for the exact pinned hashes above. The upstream README states that the 2020 CC0 release supersedes the older default and identifies remaining AGPL labels as a header migration bug. The official [MakeHuman FAQ](https://static.makehumancommunity.org/makehuman/faq/are_makehuman_files_free.html) confirms that core assets are CC0 “whether used through MakeHuman or copied through some other means”; the official asset catalogue also lists `male_casualsuit01` as CC0. These statements support using the pinned CC0 pair despite the stale AGPL text on a different, older mirror copy. The body and clothes remain separate CC0 source lineages.

No browser, build, large-pack download, or visual render was used. The evidence here proves source-index compatibility, map structure, and source morph coverage, not fit quality through animation. The MHCLO delete-face rule and final multi-morph behavior need a source-faithful offline bake and remote render review.

## References

- [Pinned body baker at `ec8d1d270b93b8e2e87e8a6160bb908665fe1fcd`](https://github.com/nirholas/three.ws/blob/ec8d1d270b93b8e2e87e8a6160bb908665fe1fcd/scripts/build-parametric-base.mjs)
- [Pinned Anny hm08 base OBJ at the same commit](https://github.com/nirholas/three.ws/blob/ec8d1d270b93b8e2e87e8a6160bb908665fe1fcd/avatar-sources/anny/3dobjs/base.obj)
- [Pinned African female source target used to check helper-tights morph coverage](https://github.com/nirholas/three.ws/blob/ec8d1d270b93b8e2e87e8a6160bb908665fe1fcd/avatar-sources/anny/targets/macrodetails/african-female-young.target.gz)
- [Official MPFB2 MHCLO parser and mapping documentation](https://github.com/makehumancommunity/mpfb2/blob/master/docs/entities/clothes/mhclo.md)
- [Official MakeHuman MHCLO coordinate and offset formula](https://static.makehumancommunity.org/oldsite/documentation/file_formats_and_extensions.html)
- [Official CC0 system-assets catalogue](https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html)
- [Pinned MakeHuman asset repository README](https://github.com/s20220526/makehuman-assets/blob/8cf9645b975a98eea056b140df11a1d278da0d10/README.md)
- [Pinned CC0 MHCLO file](https://github.com/s20220526/makehuman-assets/blob/8cf9645b975a98eea056b140df11a1d278da0d10/base/clothes/male_casualsuit01/male_casualsuit01.mhclo)
- [Pinned CC0 garment OBJ](https://github.com/s20220526/makehuman-assets/blob/8cf9645b975a98eea056b140df11a1d278da0d10/base/clothes/male_casualsuit01/male_casualsuit01.obj)
- [Pinned root CC0 1.0 license text](https://github.com/s20220526/makehuman-assets/blob/8cf9645b975a98eea056b140df11a1d278da0d10/LICENSE.txt)
- [Pinned repository LFS attributes](https://github.com/s20220526/makehuman-assets/blob/8cf9645b975a98eea056b140df11a1d278da0d10/.gitattributes)
- [Official MakeHuman FAQ on asset use and copying](https://static.makehumancommunity.org/makehuman/faq/are_makehuman_files_free.html)
- [Official individual asset mirror directory and per-file sizes](https://free.downloads.tuxfamily.net/makehuman/assets/1.1/base/clothes/male_casualsuit01/)
