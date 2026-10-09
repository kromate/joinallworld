# Hair source diagnosis

The V6 render showed fragmented, nearly black afro strands and a patchy short-hair cap with a broken-looking forehead edge. Inspection of the pinned sources found two exporter defects that explain those symptoms.

Both pinned MakeHuman material files (`source/afro01.mhmat` and `source/short02.mhmat`) declare a white diffuse color (`1, 1, 1`). The exporter had instead multiplied each diffuse map by a hand-selected brown factor (`[0.18, 0.11, 0.065]` for afro and `[0.36, 0.23, 0.13]` for short02). The hair exports now use the source material's white factor so the pinned texture supplies the hair color without a second tint.

The exporter also copied OBJ `vt` V coordinates directly into glTF. The Khronos glTF 2.0 specification defines `(0, 0)` at the upper-left of the image, so hair V needs to be inverted when these OBJ UVs are transferred. A bounded source check sampled seven interior barycentric points on every triangle in the pinned hair OBJ against the pinned RGBA texture alpha channel. Alpha coverage changed as follows:

| Asset | Direct OBJ V: nonzero alpha / mean alpha | Flipped V: nonzero alpha / mean alpha |
| --- | ---: | ---: |
| `short02` (3,344 triangles; 23,408 samples) | 59.14% / 143.71 | 79.02% / 189.66 |
| `afro01` (2,192 triangles; 15,344 samples) | 57.91% / 106.44 | 97.64% / 175.47 |

The exporter now applies `1 - v` to hair only; clothing UVs remain unchanged. A source-vertex/UV test checks every exported hair vertex against the exact flipped source OBJ UV set. The hair tests, mobile texture tests, and clothing exporter tests all pass. The mobile GLBs preserve the same source images and geometry; only the hair UVs, material factor, and embedded texture size serialization differ from V6.

The refreshed mobile assets are `short02-mobile.glb` (504,432 bytes, SHA-256 `a2637b4d14055cbd537b9b0f6e46c695b4a5bdc99e7d779956d58218ffc626a0`) and `afro01-mobile.glb` (659,456 bytes, SHA-256 `3d37f4a379c19b4d64a9c21bb08418858ede79317a477b34b3fdfb965fd11474`). This is source/UV evidence, not rendered acceptance; the corrected assets still need a remote render review.

The correction retains glTF `alphaMode: BLEND` and double-sided rendering, following the source material's `transparent True` and `backfaceCull False`. If the new render still shows card-order artifacts, the next separate investigation should compare MakeHuman's alpha-to-coverage behavior to the target Three.js blend/depth settings. That behavior was not changed here because it is not established by the source check above.

Reference: [Khronos glTF 2.0 specification, texture coordinate origin](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html).
