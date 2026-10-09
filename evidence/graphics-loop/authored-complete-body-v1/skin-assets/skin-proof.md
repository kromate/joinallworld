# MakeHuman skin texture audit

This folder contains an asset audit and two reversible mobile-size comparisons. It does not change production assets or renderer code, and no full MakeHuman asset pack was downloaded.

## Source and license

The exact source maps are the MakeHuman system-asset pack's `middleage_darkskinned_male_diffuse.png` and `middleage_darkskinned_female_diffuse.png`. Their pinned MHMAT files point to these texture names. The pack identifies its skin assets as CC0 1.0; the pinned repository `LICENSE.txt` is retained beside the maps. Provenance is pinned in [skin-pin.json](skin-pin.json), and [download-skins.py](download-skins.py) re-fetches only these two images, their two MHMAT files, the license, and the small upstream OBJ used for UV verification.

| Map | Dimensions | Bytes | SHA-256 |
|---|---:|---:|---|
| Male | 2048×2048 RGB | 3,046,762 | `ced478cfdd2b86391f0f92a4408b287ad70adb0dd0e9271ba606d0b028b47c6b` |
| Female | 2048×2048 RGB | 4,197,671 | `c3c9ab972ad46fbda64cedfd1d0a626c2a8e739fd345c4c349102eaacc947699` |

Combined source transfer is 7,244,433 bytes. These values cover only the two maps, not a complete character or full-game size change.

## UV compatibility

The authored body's GLB is pinned by SHA-256 `0152129ce2c6022911747f9d7a6df3fdb72a9e6e1bea73db414da1cb8f483077`. Its 14,517 body UVs match the pinned MakeHuman base OBJ's `body` group using the upstream builder's `(v, vt)` deduplication and `TEXCOORD_0 = (u, 1-v)` convention. The comparison found the same 14,517 entries and a maximum absolute float difference of `2.9800415024539006e-08` (the UV proof passes at `1e-7`). This is evidence that these maps use the model's UV layout; it does not establish final visual quality or material calibration.

For the source cheek reference, the audit sampled 44 front-facing lateral cheek vertices per model from the actual GLB body geometry, then sampled their unique PNG pixels. It converts sampled sRGB to linear RGB for a reference estimate:

- Male mean: `[0.14788, 0.04881, 0.02187]`
- Female mean: `[0.14527, 0.04279, 0.02142]`

The region uses `abs(X) = 0.032–0.078 m`, `Y = 1.505–1.535 m`, and `Z > 0.13 m`, avoiding the central nose/mouth and eye/brow heights. The GLB UV is already V-flipped from the OBJ; the script samples PNG rows at `V × (height−1)` with `flipY=false`. The small sample is a starting point for material calibration, not a statistically complete skin-color measurement. Lighting, tone mapping, and the authored body's existing material can shift the rendered result.

## Mobile-size comparisons

Pillow 12.3.0 produced the comparison JPEGs by Lanczos downsampling and JPEG quality 90, 4:4:4, progressive/optimized encoding. The original 2048 maps remain unchanged.

| Map | 1024 JPEG | 512 JPEG |
|---|---:|---:|
| Male | 126,259 bytes | 36,924 bytes |
| Female | 124,599 bytes | 34,950 bytes |

Files and hashes are listed in `skin-pin.json`. These are transfer-size comparisons only; no screenshot or runtime texture-quality review was performed, and these figures do not claim a whole-game size pass.

## Reproduction

Run `download-skins.py` with the bundled Python that includes Pillow. It verifies source hashes and lengths, MHMAT texture references, the retained license hash, GLB/OBJ UV agreement, cheek-pixel reference values, and the generated JPEG hashes and dimensions. The completed audit used the bundled Python 3 runtime with Pillow 12.3.0: exit 0, 9.20 seconds, peak RSS 125,845,504 bytes. No browser, build, server, or production file was touched.

## Primary sources

- [MakeHuman system assets](https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html)
- [Pinned MakeHuman asset repository](https://github.com/s20220526/makehuman-assets/tree/8cf9645b975a98eea056b140df11a1d278da0d10)
- [MakeHuman license](https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md)
- [Pinned MakeHuman base OBJ](https://raw.githubusercontent.com/nirholas/three.ws/ec8d1d270b93b8e2e87e8a6160bb908665fe1fcd/avatar-sources/anny/3dobjs/base.obj)
- [Pinned UV/build script](https://raw.githubusercontent.com/nirholas/three.ws/ec8d1d270b93b8e2e87e8a6160bb908665fe1fcd/scripts/build-parametric-base.mjs)
