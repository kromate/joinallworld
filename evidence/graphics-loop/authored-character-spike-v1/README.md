# Authored parametric human spike

This is an offline asset-structure and morph-pruning experiment, not a production character or visual acceptance. It pins and retains the upstream CC0 attribution/license files, then repacks the original GLB while preserving the base geometry and only a selected set of named sparse morph targets.

## Source and provenance

- Upstream repository: [nirholas/three.ws](https://github.com/nirholas/three.ws)
- Pinned commit: `ec8d1d270b93b8e2e87e8a6160bb908665fe1fcd`
- Upstream asset: `public/avatars/parametric-base.glb`
- Upstream GitHub file/blob SHA reported by Contents API: `652ee3882097d41e7920c7de0454e1c73a94a507`
- Local source file SHA-256: `6627588660aa6c754aaa2edb181bc01a8ca60c3b4c534efa3e87f636ce5cda18`
- The exact upstream attribution and CC0 license copies are [PROVENANCE-README.md](PROVENANCE-README.md) and [CC0-LICENSE.md](CC0-LICENSE.md). They identify the body data as MakeHuman/MPFB2 core data from NAVER Anny. Only the CC0 character data is used here; no upstream build script or runtime code is included.

## Repack result

| Measure | Pinned source | Morph-pruned output |
|---|---:|---:|
| GLB bytes | 6,806,984 | 2,692,984 |
| Sparse morph accessors | 395 | 47 |
| Body morph targets | 306 | 34 |
| Meshes/materials | 4 / 4 | 4 / 4 |
| Skeleton joints | 52 | 52 |
| Body vertices / triangles | 14,517 / 26,756 | unchanged |
| All-mesh triangles | 27,676 | unchanged |
| Animation clips / image textures | 0 / 0 | 0 / 0 |

The output is 60.4% smaller by raw GLB bytes, while retaining these classes of controls: body-family proportions (`bodyFeminine`, `bodyMasculine`, build/height/shoulder/hip/bust); face shape (head/jaw/nose/cheeks); and a small expression set (`mouthCornersUp`, `mouthCornersDown`, `mouthLowerLipMiddleDown`, `jawDrop`, eyelid and brow targets). These generic targets are not a complete FACS set. See [the exact measured JSON](parametric-base-expressive.report.json) for per-mesh counts and all retained names.

The asset is still not small enough to adopt without a follow-up budget review: its body has about three times the triangles of Allworld's current 9,002-triangle source body. The 52-bone skeleton has no embedded animation clips, so Allworld animation mapping/retargeting is still required. The GLB has no image textures and uses four material factors; that is compact, but not yet a finished skin/hair/outfit presentation. No render or mobile-device test was performed.

## Reproduce

The repacker uses only Python's standard library and rejects files larger than 16 MiB. From the repository root:

```sh
python3 evidence/graphics-loop/authored-character-spike-v1/retain-morphs.py \
  evidence/graphics-loop/authored-character-spike-v1/parametric-base.glb \
  evidence/graphics-loop/authored-character-spike-v1/parametric-base-expressive.glb
```

The run on the pinned file completed in 0.08 seconds with 41,893,888 bytes peak RSS as reported by macOS `/usr/bin/time -l`. The repacker only drops unused sparse morph payloads and repacks kept values; it does not alter source vertex positions, normals, UVs, joints, weights, indices, materials, or animations. Its supported input contract is intentionally narrow: one embedded GLB v2 buffer, one primitive per morph mesh, sparse float-VEC3 morphs plus implicit-zero morph accessors, and no extension-based accessor indirection. It fails on structures outside that observed contract.

## Next validation before considering adoption

1. Open both pinned source and repacked GLBs in the same Three.js fixture; compare neutral, feminine/masculine body, oval/round face, smile, jaw-open and blink at identical pose/light/camera.
2. Inspect profile, hairline/eyes, mouth interior, neck and full-body silhouette. The current file provides no authored hair or clothes, and it has not been shown to match Allworld's warm reference.
3. Measure a proper mobile rendition: reduce topology while preserving skinning and morph correspondence, author one atlas/hair/outfit path, retarget Allworld clips, then record total transferred bytes, decoded textures/morph storage, draw counts, device frame pacing and input latency.

Until those checks pass, treat this as evidence that an obtainable CC0 base with usable body/face-shape controls exists—not as proof that the asset solves the character quality or mobile requirements.
