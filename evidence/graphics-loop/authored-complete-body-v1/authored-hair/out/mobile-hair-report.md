# Mobile hair texture variants

The original 2048×2048 hair GLBs remain unchanged. These mobile variants replace only the last embedded diffuse-image bufferView with a premultiplied-alpha Lanczos-resized PNG. The helper tries 1024px first and falls back to 512px when optimized PNG bytes exceed 500,000. Both 1024 candidates exceeded the limit; the 512px textures are under budget.

| Asset | Mobile GLB bytes / SHA-256 | RGBA texture bytes (resolution) | GLB bytes saved | Texture bytes saved |
| --- | --- | --- | ---: | ---: |
| `short02-mobile.glb` | 504,432 / `9e2f77d23b6bcf34b5e4fef12c672d73496f5d43ed6a88b7dbf48748dc680a8c` | 249,608 (512×512) | 3,303,940 | 3,303,935 |
| `afro01-mobile.glb` | 659,460 / `3ce7a4c9c42268f3d7333fe1cb1cca9a8529a244ddd98870009b2c6b44a97ce9` | 396,542 (512×512) | 4,420,648 | 4,420,643 |

Alpha verification found transparent and opaque pixels in both source and resized images, and each output retained alpha extrema `[0, 255]`. The GLB materials still declare `alphaMode: BLEND` and `doubleSided: true`. The test decodes the actual embedded PNG, checks its size/alpha, confirms the exact output SHA, and proves the pre-image geometry/accessor bytes plus mesh/accessor declarations match the original GLB.

The original source textures were already SHA/LFS-pointer verified by the exporter; no new source image or asset was introduced here. The mobile rewrite ran with bundled Pillow 12.3.0 in 0.97 seconds, peaking at 125,501,440 bytes RSS (about 119.7 MiB), within 45 seconds / 128 MiB. No viewer or render was used; image resize quality and alpha fringes still need the remote rendered review.
