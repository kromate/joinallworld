# Authored casual outfit bake

`export.py` is a stdlib-only, bounded offline converter for the pinned MakeHuman `male_casualsuit01` MHCLO/OBJ pair. It maps the authored garment vertices to the hm08 base through the MHCLO's actual barycentric anchor rows, keeps OBJ UV seams, transfers weights through those same anchors, and emits one accessory GLB plus a body-hide map. It does not create a substitute shirt/eyeballs, alter the original body asset, or add runtime dependencies.

From the repository root, run:

```sh
python3 evidence/graphics-loop/authored-complete-body-v1/authored-clothing/export.py
```

The clothing output is `evidence/graphics-loop/authored-complete-body-v1/authored-clothing/out/male_casualsuit01.glb` and `.../out/body-hide-map.json`. The same converter exports the pinned hair assets into `authored-hair/out/` with `--asset short02` or `--asset afro01`; see that folder's README/report for texture proof and per-asset fit notes. Inputs are individually downloaded into `/tmp/joinallworld-authored-clothing-cache`; every file is checked against its pinned SHA-256 and (where recorded) byte count. Downloads are capped at 5,000,000 bytes to accommodate only the exact-pinned 2048px CC0 hair textures; all other sources are smaller, and unexpected hash/size values fail. `--cache-dir` and `--output-dir` can override those locations.

## Adapter contract

The GLB carries authored garment positions, UVs, smoothed normals, `JOINTS_0`, `WEIGHTS_0`, and the `bodyFeminine` and `bodyMasculine` position morph targets. It also keeps source proof in `_MH_SOURCE_VERTEX` (original clothing OBJ vertex index), `_MH_ANCHOR_VERTICES` (the three hm08 IDs), and `_MH_ANCHOR_BARYCENTRICS` (their exact MHCLO weights); UV seam splits duplicate these attributes without changing their source IDs. Negative barycentric bone blends are clamped to zero before strongest-four selection; the final four are normalized. If a future row has zero remaining sum, the documented fallback chooses its highest-weighted anchor (tie by lowest source ID) and transfers that anchor's positive weights, failing if none exist. It intentionally has no duplicate skeleton. On integration, create a `THREE.SkinnedMesh` from the loaded geometry/material and bind it to the actor's existing 52-bone skeleton. `meshes[0].extras.jointNames` gives the exact joint index order; remap the `JOINTS_0` values by bone name if the actor's skeleton order differs. Copy the actor's two identity morph influences to the outfit. The single material is a neutral dark-blue palette placeholder; texture/material design and rendered fit remain open.

`body-hide-map.json` lists the source body quads and their two fan-triangulated body triangle indices. It follows MPFB2's conservative delete-mask behavior: a quad is removed only when all its hm08 source vertex IDs occur in the MHCLO's `delete_verts`; partial boundary quads remain. The upstream body baker triangulates each of these quads into the same two source-order triangles. Use these indices against the source-order body primitive or build a source-face lookup at the presentation adapter boundary. The original body GLB stays immutable.

## Source pins and license

Body source: `nirholas/three.ws@ec8d1d270b93b8e2e87e8a6160bb908665fe1fcd` (`base.obj`, rig, weights, and six macrodetail targets). Clothing source: `s20220526/makehuman-assets@8cf9645b975a98eea056b140df11a1d278da0d10`, directory `base/clothes/male_casualsuit01/`. The pinned repository README documents the 2020 CC0 release, the exact MHCLO and OBJ each carry a CC0 header, and the repository root includes CC0-1.0 text. This converter uses those exact files and hashes; it does not adopt the older mirror copies with stale AGPL headers.

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| `base.obj` | 1,749,303 | `8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c` |
| `basemesh_vertex_groups.json` | 81,984 | `8cb1417bc55ae5ec8aa99f90734e81ed5fbb556511ff6a2c00e0534b70911444` |
| `rig.mixamo.json` | 84,107 | `b4e491bacdcae797e53b7692169cf6a160c50fcc1eda5f0982e92fac1561ae56` |
| `weights.mixamo.json` | 2,372,203 | `4561be4d7c0093d70e3dba4fbacbbbb6d66781573779fb12a0509cefa181b8ae` |
| `male_casualsuit01.mhclo` | 570,419 | `78503ed7f56c149843d85e06e1164bc6871ce7319b2ef689237046352cc90de4` |
| `male_casualsuit01.obj` | 699,545 | `001921d237e408c35103720d046aa37f9c5512db1a179a5ede6a065cd504ba89` |

The six target gzip hashes are pinned in the exporter. The target recipe mirrors the source builder's one-third African, one-third Asian, one-third Caucasian young target per sex. For each body identity, the MHCLO map is evaluated against the shaped body and the axis offset scales are recalculated from the pinned MHCLO reference vertices. Outfit deltas are the mapped identity shape minus mapped neutral. The output follows the upstream transform: MakeHuman Y-up, +Z-facing, 0.1 metres per source unit, with the pinned `joint-ground` centroid subtracted from Y.

## Bounded source checks and limits

`test_export.py` is an offline check of the generated GLB container, primitive/accessor sizes, morph and skin attributes, source hide map, and source evidence. It can be run with `python3 evidence/graphics-loop/authored-complete-body-v1/authored-clothing/test_export.py`. Re-running the exporter is bounded to these source files and finishes in under 10 seconds on the current machine; it uses no browser, renderer, or project build.

The source scan reports 8,426 authored garment vertices, 8,984 UV-split vertices, and 16,672 authored triangles. All 8,426 map rows use the 2,284-vertex `helper-tights` anchor set; all anchors have exact source skin weights in the pinned 52-bone weight file. Each clothing vertex receives the strongest four barycentric weight contributions, renormalized. The result hides 3,364 complete body quads (6,728 triangles), preserving partially affected boundaries.

The male-shaped MHCLO location check against the authored OBJ is mean 0.141, p95 0.220, maximum 0.301 MakeHuman source units (1.41 cm / 2.20 cm / 3.01 cm after scaling). This proves the input recipe and coordinate mapping match source geometry; it does not establish a good render or motion fit. The suit is a male-authored silhouette; its feminine target is only a deformation mapped from the exact feminine body recipe. Other body morphs (muscle, weight, height, age, face) are not present in this first bake. Rendered acceptance and animation clipping review remain required before production use.
