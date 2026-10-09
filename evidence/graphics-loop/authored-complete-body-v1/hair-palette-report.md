# Authored hair color palette

`hair-palette.ts` adds an actor-private `MeshStandardMaterial` clone that keeps the pinned hair texture, alpha mode, sidedness, and depth-write setting. After Three's standard diffuse-map sample, it rescales the texture's linear RGB by the per-asset measured alpha-weighted mean and multiplies by the requested linear hair color. A requested palette color therefore sets the approximate alpha-weighted average color while the source map continues to supply strand and highlight variation. The shader clamps output to `[0, 1]` to avoid unbounded HDR values; this can compress the brightest texture details and needs visual review.

The references were measured from the complete 512×512 embedded RGBA PNGs after sRGB-to-linear conversion, weighting each alpha-positive texel by alpha. These exact GLBs were hashed before decoding:

| Asset | GLB SHA-256 | PNG SHA-256 | Alpha-weighted source mean, linear RGB |
| --- | --- | --- | --- |
| `short02-mobile.glb` | `a2637b4d14055cbd537b9b0f6e46c695b4a5bdc99e7d779956d58218ffc626a0` | `08f29e13294d7ddd499fbb77f2c468d55b9348a887abfd6d8cc397a2850acfbb` | `[0.07420745, 0.04820924, 0.03399736]` |
| `afro01-mobile.glb` | `3d37f4a379c19b4d64a9c21bb08418858ede79317a477b34b3fdfb965fd11474` | `3dbac3a8a31444fe2f84e4a57fb71ec070ed5102bd574ae98b773c4f2ceb3411` | `[0.00714685, 0.00295244, 0.00291767]` |

The afro map is extremely dark on average; multiplying it directly by another dark color would leave the hairstyle nearly black. The source-relative rescale avoids that result. It retains transparent alpha and standard lighting, but it is not a visual approval of recolored hair. The safe next check is a matched render for both styles and several light/dark saved hair colors, including front/profile and motion, with the source map and geometry pinned.

Run `node --max-old-space-size=32 --experimental-strip-types evidence/graphics-loop/authored-complete-body-v1/hair-palette-check.mjs` from the repository root. The check verifies the exact asset and texture hashes, alpha-weighted color references, same texture and alpha/depth material settings after cloning, shader insertion/cache key, per-actor uniform updates, and exactly-once private-material disposal. Latest bounded run passed at 104,824,832 bytes peak process-group RSS in 0.212 seconds. It checks shader source and ownership only; it does not compile a GPU program or render pixels.
