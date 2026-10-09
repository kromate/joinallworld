# Mobile hair texture variants

These mobile variants replace only the last embedded diffuse-image bufferView in the refreshed hair GLBs with a premultiplied-alpha Lanczos-resized PNG. The GLBs also contain the source-correct white base color factor and flipped OBJ-to-glTF hair V coordinates. The helper tries 1024px first and falls back to 512px when optimized PNG bytes exceed 500,000. Both 1024 candidates exceeded the limit; the 512px textures are under budget.

| Asset | Mobile GLB bytes / SHA-256 | RGBA texture bytes (resolution) | GLB bytes saved | Texture bytes saved |
| --- | --- | --- | ---: | ---: |
| `short02-mobile.glb` | 504,432 / `a2637b4d14055cbd537b9b0f6e46c695b4a5bdc99e7d779956d58218ffc626a0` | 249,608 (512×512) | 3,303,936 | 3,303,935 |
| `afro01-mobile.glb` | 659,456 / `3d37f4a379c19b4d64a9c21bb08418858ede79317a477b34b3fdfb965fd11474` | 396,542 (512×512) | 4,420,648 | 4,420,643 |

Alpha verification found transparent and opaque pixels in both source and resized images, and each output retained alpha extrema `[0, 255]`. The GLB materials still declare `alphaMode: BLEND` and `doubleSided: true`. The test decodes the actual embedded PNG, checks its size/alpha, confirms the exact output SHA, and proves the pre-image geometry/accessor bytes plus mesh/accessor declarations match the original GLB.

The original source textures were SHA/LFS-pointer verified by the exporter; no new source image or asset was introduced here. The mobile rewrite ran with bundled Pillow 12.3.0 in 1.1 seconds. No viewer or render was used; image resize quality and alpha fringes still need the remote rendered review. See `hair-source-diagnosis.md` for the source-UV and material-factor findings.
