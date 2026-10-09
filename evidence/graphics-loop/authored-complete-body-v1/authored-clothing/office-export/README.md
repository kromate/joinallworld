# Authored office suit source bake

This directory contains two separate native-hm08 suit bakes for the current office outfit: the masculine male_elegantsuit01 and feminine female_elegantsuit01. The exporter reads the existing ../export.py helpers but does not edit that shared exporter. It produces suit meshes and source-face hide maps; it does not alter the authored body, rig, viewer, or presentation adapter.

## Source and license

Both garments and their materials come from [s20220526/makehuman-assets](https://github.com/s20220526/makehuman-assets/tree/8cf9645b975a98eea056b140df11a1d278da0d10) at commit 8cf9645b975a98eea056b140df11a1d278da0d10, under base/clothes/{male,female}_elegantsuit01/. The pinned repository README and root license are copied under source/; their SHA-256 digests are 400def805e639a6365d14ecf0fedf926c5b338d63c6a62610f9473cacecb7a23 and a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499. Each exact MHCLO, OBJ, and MHMAT file has a CC0 September 2020 release statement; each byte length, SHA-256, and Git blob ID is recorded in the generated hide map and was checked against the immutable commit before baking.

The source MHMAT references male_elegantsuit01_diffuse.png and female_elegantsuit01_diffuse.png. Their Git LFS pointer files are retained under source/textures/. The pointer OIDs are eba3c9b662a35f145f28c8932fe96c01db258080daf1a1c09807def5497e3420 (1,945,326 bytes) and ebe6f2afcbaadbe56d5cee6e00bab45e97ce482f0be0e34491d16ca5f98b38ac (1,996,561 bytes). The pinned LFS objects were fetched and SHA-256 verified. The embedded RGBA diffuse textures were resized from 2048×2048 to 512×512 with macOS sips -Z 512; the retained derivatives are 203,838 bytes and 271,608 bytes. Their hashes and original LFS pointer hashes are embedded in the hide-map source provenance. Both images have fully opaque alpha after downsampling, so the glTF material stays OPAQUE. The exported glTF uses the diffuse map as sRGB base color and no normal map.

The body base, Mixamo-compatible 52-bone rig, source weights, and macro targets are from nirholas/three.ws at commit ec8d1d270b93b8e2e87e8a6160bb908665fe1fcd, matching the audited authored body source. The exporter transfers weights from the exact MHCLO anchor vertices, clamps negative blended bone lanes to zero, keeps the strongest four, and normalizes them. If the positive sum is zero, it deterministically falls back to the source anchor with the highest barycentric coefficient (ties use the lower source vertex ID). There is no nearest-neighbor or opposite-family substitute.

## Geometry and family fit

| Output | Authored triangles | UV-split vertices | Native family morph | Family fit max (hm08 units) | Source body triangles hidden |
|---|---:|---:|---|---:|---:|
| office-male.glb | 14,956 | 8,522 | bodyMale | 0.302930 | 6,748 |
| office-female.glb | 4,192 | 2,446 | bodyFemale | 0.347889 | 5,010 |

Each suit's MHCLO mapping uses exact original hm08 anchor IDs, barycentrics, and axis-scaled offsets. Every anchor is within source helper-tights vertex range 15328–18001. The source OBJ's vertex/UV corner pairs are preserved, including authored UV seams. The asset morph target names are `bodyMale` and `bodyFemale`; the actor adapter maps each exact source name to the corresponding native family morph (`bodyMasculine` / `bodyFeminine`) after checking the source name. Family morph positions are recalculated from the exact one-third African + one-third Asian + one-third Caucasian young macro target recipe for the corresponding sex. The fit metric is the distance from the source garment OBJ position to its family-shaped mapped position in hm08 units; it does not imply visual or pose acceptance.

Each *-body-hide-map.json records the original MHCLO delete_verts IDs and conservatively hides a body quad only when all its four source vertex IDs are listed. The triangle IDs refer to the source body OBJ face order with each quad emitted as two fan triangles. This preserves partial boundary faces, so source-space verification does not guarantee no visible skin intersections. The female asset's MHCLO Y-offset range includes a minimum of −2.17955; inspect its waist/hem in the later native render.

## Rebuild and verification

Run the bounded export and independent source decode checks from the repository root:

  python3 evidence/graphics-loop/authored-complete-body-v1/authored-clothing/office-export/export_office.py
  python3 evidence/graphics-loop/authored-complete-body-v1/authored-clothing/office-export/test_office_export.py

Export uses only Python standard library plus ../export.py helper functions and bounded pinned downloads; the 512×512 texture derivatives are hash-checked inputs in source/textures/. The test independently decodes the GLBs, recomputes family mapping from pinned hm08 targets, compares mapped positions and morph deltas within 2e-7 metres, checks authored triangle counts and exact body-hide face IDs, validates all 52-bone indices and normalized nonnegative weights, and verifies embedded texture hashes and output size under 1.3 MB each.

No local browser, app build, Blender, or rendered acceptance was run for this source bake. The root should attach each mesh to its same-family actor skeleton and family morph, apply only the matching body-hide map, and review native renders before treating the office outfit as accepted.
