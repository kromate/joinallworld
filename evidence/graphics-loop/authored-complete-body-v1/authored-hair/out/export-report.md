# Hair source bake report

The converter exported two independently pinned CC0 hair assets with source textures and mapped 52-bone weights. No source body, runtime module, rig, presentation layer, or viewer was changed.

| Asset | GLB bytes / SHA-256 | Source topology | Body anchor support | Texture |
| --- | --- | --- | --- | --- |
| `short02` | 3,808,368 / `2ebb82af65352ccf72e1108c8d4a7e2ec206b991061abc5018a44bd54343abee` | 1,755 source vertices, 2,061 UV-split vertices, 3,344 triangles | 1,755/1,755 MHCLO triples correspond to a possible triangle of the source body quads | 2048×2048 RGBA, 3,553,543 bytes, `47fe33831a3929567c733356dd66243116e05df2ace1f884ddca0080b728229f` |
| `afro01` | 5,080,104 / `510b3d92625608892299a9e2e1edd64ae8fea4adc87a5cd41f891224c614fa68` | 2,196 source vertices, 2,276 UV-split vertices, 2,192 triangles | 2,182/2,196 triples match a possible body-quad triangle; the other 14 valid authored MHCLO triples are preserved exactly, not remapped | 2048×2048 RGBA, 4,817,185 bytes, `dc0db7dd8a13802f02303ca7e49844b219e09db134471b7061538a8af8f7c7fb` |

Each MHCLO row maps directly to three weighted source body IDs. All referenced source IDs have exact weights from the pinned Anny `weights.mixamo.json`; each hair vertex receives the strongest four barycentrically blended influences, with negative blends clamped to zero before normalization. Neither hair asset needed a clamp or zero-sum fallback in this export, and independent GLB decoding confirms nonnegative normalized lanes. Both exports retain `bodyFeminine` and `bodyMasculine` position morphs from the existing one-third ethnicity recipes, and neither source MHCLO has a body delete mask.

The texture bytes were fetched individually from the official MakeHuman mirror. The exact pinned repository files are Git LFS pointers: short02 pointer SHA-256 `27e0a8d958c8d00ae7ff0dd3d59d4b6712f9a3c2b33d34c5fa5154aaa809b5ef`, afro01 pointer SHA-256 `f558e275ba7fe28b213ad12e462ab8f63fd6a6de2f42497e7b7509c9ff91269f`; both pointers name the corresponding PNG hashes and byte sizes above. The pinned MHMAT files reference these `diffuseTexture` paths and specify transparency; the resulting GLB materials embed the verified RGBA PNG, set `alphaMode: BLEND`, and are double-sided.

The regenerated GLBs use the pinned MHMAT's white `diffuseColor` as baseColorFactor. Hair `vt` values are converted with `v_glTF = 1-v_OBJ`; clothing UVs retain the existing mapping. A source-triangle alpha-coverage analysis that motivated these corrections is documented in `hair-source-diagnosis.md`.

The pinned-hair OBJ comparison against the converter's mapped source positions gives these source-unit errors:

| Asset | Neutral mean / p95 / max | Feminine mean / p95 / max | Masculine mean / p95 / max |
| --- | --- | --- | --- |
| `short02` | 0.924 / 1.004 / 1.040 | 1.580 / 1.666 / 1.678 | 0.196 / 0.216 / 0.236 |
| `afro01` | 0.028 / 0.055 / 0.066 | 0.706 / 0.841 / 0.898 | 0.726 / 0.831 / 0.865 |

These measurements describe the original hair OBJ fit to source body recipes; they do not predict rendered clearance or appearance. Notably, short02 is close to its masculine target, while afro01 matches the neutral base more closely. The adapter should pass the corresponding identity morphs and remote render review should check hairline, scalp coverage, texture alpha, and movement. The afro's connected-card topology has 342 components and 1,516 boundary edges; the short mesh has one component and 164 boundary edges. No browser or render was run.

`test_hair_export.py` passed. A cached afro export measured 0.58 seconds wall time and 83,869,696 bytes maximum resident set (about 80.0 MiB), within the 45-second / 128-MiB limit. The pinned texture imports account for most of each output size; no unreferenced texture or asset archive was downloaded.
