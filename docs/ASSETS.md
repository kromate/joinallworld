# Third-party assets

Assets the game ships that it did not make itself, where they came from, under what licence, and how they are rebuilt.

The arena games' packs (Fight, Race, Football: KayKit, Kenney and our own Blender-made pieces) have their own pipeline, manifests and credits: [ASSET-PIPELINE.md](ASSET-PIPELINE.md).

What assets must look like, and when a file is allowed at all: [ART-DIRECTION.md](ART-DIRECTION.md).

## Skinned body (`src/scene/body/assets/`)

For every player, with no switch, the player's own figure is one skinned mesh with baked clips instead of the procedural avatar (`src/scene/characters.ts`): in the home room, in every venue, and in the look preview once the world has fetched it. Other players and NPCs keep the procedural figure. The files are built into `dist/assets/` with hashed names (`base-body-male-<hash>.glb`, `base-body-female-<hash>.glb`, `clip-pack-<hash>.glb`), served as `model/gltf-binary` and cached as immutable. Nothing below is fetched before a scene's first frame, or at all on a device the fallback rules below exclude.

### Sources

| What | Author | Where | Licence |
| --- | --- | --- | --- |
| Universal Base Characters (Standard, free) | Quaternius | https://quaternius.itch.io/universal-base-characters | CC0 1.0 |
| Universal Animation Library (Standard, free) | Quaternius | https://quaternius.itch.io/universal-animation-library | CC0 1.0 |

Files used:

- Bodies: `Base Characters/Godot - UE/Superhero_Male_FullBody.gltf` with `T_Superhero_Male_Dark.png`, and `Superhero_Female_FullBody.gltf` with `T_Superhero_Female_Dark_BaseColor.png`.
- Hair: `Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Buzzed.gltf` (male) and `Hair_BuzzedFemale.gltf` (female).
- Clips: `Unreal-Godot/UAL1_Standard.glb`, which has root motion off. The `_RM` file is not used.

The characters and the animation library share one skeleton with the same joint names, so the clips play on the bodies without retargeting. No Mixamo or Ready Player Me content is used.

### Licence text

`Universal Base Characters[Standard]/License_Standard.txt`, licence section, verbatim:

```
License:
CC0 1.0 Universal (CC0 1.0) 
Public Domain Dedication
https://creativecommons.org/publicdomain/zero/1.0/

------------------------------------------------------
Models by @Quaternius
```

The rest of that file says that this free Standard version holds a portion of the models, and that the paid Source version is available from https://quaternius.com.

`Universal Animation Library[Standard]/License.txt`, verbatim:

```
License:
CC0 1.0 Universal (CC0 1.0) 
Public Domain Dedication
https://creativecommons.org/publicdomain/zero/1.0/

------------------------------------------------------
Models by @Quaternius
```

CC0 needs no attribution. We credit Quaternius here anyway.

### Rebuilding

The raw downloads stay out of git. Unzip both into one folder:

```
<raw>/ubc/Universal Base Characters[Standard]/...
<raw>/ual/Universal Animation Library[Standard]/...
```

Then run:

```
npm run body:build -- --raw <raw>      # default <raw> is /tmp/aw-assets; add --verbose for gltfpack's report
```

The pipeline is `scripts/body/build-body.ts`, with `scripts/body/gltf-io.ts` for glTF reading and writing. It needs `npx`, which fetches gltfpack 1.3.0 on first use, and macOS `sips`. It is deterministic: running it twice on the same downloads gives byte-identical files.

For each body, the pipeline:

1. Keeps 23 bones (root, pelvis, three spine bones, neck, head, and the clavicles, arms, hands, legs, feet and balls of the feet).
2. Moves the weights of the 40 finger bones and the ball_leaf tips to the nearest kept ancestor.
3. Keeps the four largest weights per vertex and renormalises them.
4. Merges the body and the buzzed hair cap into one primitive with one material. The eye and eyebrow cards are left out; the face texture paints them.
5. Writes a per-vertex region colour (COLOR_0), worked out from the bone weights. The runtime material dresses each region from the saved look.
6. Ships base colour only, as a 1024 px JPEG at quality 78. Normal and roughness maps are dropped. gltfpack 1.3 via npx has no WebP or KTX2 support.
7. Simplifies the mesh and quantises it with gltfpack, using `EXT_meshopt_compression`.

The pipeline also:

- writes `src/scene/body/assets/clip-pack.glb`, which holds clips only (no mesh). Each clip keeps rotation tracks on the 23 bones plus the pelvis translation; scale tracks are dropped.
- writes `src/scene/body/manifest.ts` with sizes, triangle and bone counts, the clip list, and the texture's measured skin colour, which the runtime tints from.

### Clips

| Game name | Source clip | Length | Used for |
| --- | --- | --- | --- |
| idle | Idle_Loop | 2.50 s | standing, relaxing |
| walk | Walk_Loop | 1.35 s | walking, sampled at the stride phase |
| jog | Jog_Fwd_Loop | 0.95 s | jogging, sampled at the stride phase |
| sit-enter | Sitting_Enter | 1.30 s | sitting down on a chair, sofa or beanbag |
| sit | Sitting_Idle_Loop | 1.70 s | seated, including "work" on a seat |
| sit-exit | Sitting_Exit | 1.05 s | standing up |
| interact | Interact | 2.00 s | wave and work while standing |
| dance | Dance_Loop | 1.00 s | dance |

The free library has no clips for doors, bathing, stairs or lying down. `scripts/body/author-clips.ts` authors these from UAL1 poses (CC0, same source as above). It blends and turns the library's joint rotations, bakes them at 20 fps onto the same 23 bones plus the pelvis translation, and writes them into the same `clip-pack.glb`:

| Game name | Built from | Length | Used for |
| --- | --- | --- | --- |
| door | Interact push, then Walk | 1.80 s | arriving in a venue through its door |
| lie-down | Idle → Crouch → sitting on the floor → lying | 2.20 s | getting onto a bed or sleeping mat |
| get-up | lie-down, reversed | 2.20 s | getting off it |
| sleep | lying, breathing | 4.00 s | Sleep, Stay in Bed and Nap: on the back, head on the pillow |
| bathe-sit | Sitting_Idle_Loop plus a washing arm | 2.40 s | Long Soak: sitting low in the bathtub |
| bathe-stand | Idle_Loop plus washing, one hand over the head | 3.20 s | Bath: at a bucket or in the shower |
| stairs-up | Walk with higher knees and a forward lean | 1.33 s | walking up a stair or ramp in a venue |
| stairs-down | Walk with deeper knees, lower hips and a backward lean | 1.33 s | walking down one |

The stairs clips are as long as the walk cycle, so the stride phase carries across. `scripts/body/clip-check.ts --raw <dir>` prints each authored clip's joint positions in game axes at its start, middle, three quarters and end. Use it to check a pose without a renderer, for example that lying puts the pelvis 0.12 m up and the head towards the pillow.

### Look mapping

The mapping lives in `src/scene/body/tint.ts` and is tested in `tint.test.ts`.

| Saved look field | On the skinned body |
| --- | --- |
| `body` | `man` wears `base-body-male.glb`; anything else wears `base-body-female.glb` |
| `skin` | Skin texels are multiplied by `look.skin / skinRef` in linear RGB, where `skinRef` is the texture's measured mean skin colour. The painted shading, lips, eyes and brows stay; only the tone moves. |
| `outfitColor` | Top: torso, clavicles and upper arms |
| `bottomsColor` | Bottoms: hips and legs |
| `hairColor` | The buzzed hair cap |
| (none) | Shoes: fixed dark leather, `#2e2622` |
| hairstyle, outfit cut, fabric, face, expression, accessories | Not mapped. The body has one hair cap and one silhouette. The procedural avatar keeps all of these. |

Old saves load the same way as new ones, through `normalizeLook`. The legacy keys `gender` and `skinTone` are read when `body` and `skin` are absent. Named (`skin1`…`skin7`) and numbered swatches read as their colours. A missing or unreadable field takes the player's seeded value, so no saved look fails to draw.

Clothing regions come from bone weights, so the boundaries fall at joints. For example, a top ends at the elbow and the forearms are skin.

### Budgets and measured sizes

Brotli sizes are at quality 11. `src/scene/body/body-assets.test.ts` holds the files to these budgets.

| File | Raw | Brotli | Budget (brotli) | Contents |
| --- | --- | --- | --- | --- |
| base-body-male.glb | 159,916 B | 138,098 B | ≤ 300 KB | 9,002 triangles (from 13,396), 23 bones, one primitive, one material |
| base-body-female.glb | 157,992 B | 137,296 B | ≤ 300 KB | 9,002 triangles (from 13,642), 23 bones, one primitive, one material |
| clip-pack.glb | 107,536 B | 28,055 B | ≤ 200 KB | 16 clips |
| lazy chunk `skinned-*.js` | 71,462 B | 19,115 B | — | body module, GLTFLoader, meshopt decoder |

A player fetches one body, the clips and the chunk: about 185 KB brotli after first paint, within the 500 KB budget. The first load is unchanged.

### How the runtime falls back

The procedural avatar stays, byte for byte, in each of these cases:

- Data Saver is on, or the connection is 2G;
- the device has 2 or fewer cores, or 2 GB of memory or less;
- the renderer is not WebGL2;
- any fetch, parse or build of the body fails. A console warning is logged and the body is not retried.

These checks live in `src/scene/body/gate.ts`, the "SKINNED BODY" section of `src/scene/home-scene.ts`, the venue stand-in `src/scene/body/stand-in.ts` (owned by `src/venue-world.ts`), and the look preview `src/scene/avatar-preview.ts`. There is no user setting and no address flag.

## Buka stew pot (`src/scene/assets/kenney-food.generated.ts`)

The open stew pot on the buka counter is `pot-stew.glb` from [Kenney Food Kit 2.0](https://kenney.nl/assets/food-kit), created and distributed by Kenney. The pack is CC0 1.0. The archive's exact 711-byte licence is kept at `src/scene/assets/kenney-food-LICENSE.txt`.

The raw archive and its texture stay out of git. The bake reads only these entries:

| Source entry | Bytes | SHA-256 |
| --- | ---: | --- |
| `Models/GLB format/pot-stew.glb` | 29,560 | `311ba282a85bd722b5093f512579a168e3da949617600196b60d782c11afd6b8` |
| `Models/GLB format/Textures/colormap.png` | 10,715 | `75baf74d9483a0fc56ac21ceba346fbe16fc24a2a1bf0524c53e6bbe802e1153` |
| `License.txt` | 711 | `32a081c2035dd4db47d850c83244da048165f0e53d71c076b76c1afc0590bc7f` |

Rebuild from the official archive:

```
node --experimental-strip-types scripts/assets/bake-food.ts \
  --archive /tmp/allworld-kenney-food-kit.zip
```

`scripts/assets/bake-food.ts` accepts only the pinned one-node, one-primitive, identity-transform asset and its 512 px indexed atlas. It preserves all 370 triangles and their original winding, welding only identical position/normal/colour tuples from 532 to 404 vertices. The nearest atlas colour at each source UV is converted from sRGB to linear RGB and emitted beside the geometry. This is a measured gradient approximation because 164 source triangles cross atlas colours; a 10-step barycentric grid over every triangle measured 24,420 samples, maximum linear-channel error 0.048984 and RMS error 0.009508. The importer rejects a maximum error above 0.06.

The generated TypeScript is 10,345 bytes, 4,298 bytes with gzip level 9, and has SHA-256 `38f59214b8a4086762653ff321be87143f737aee13a9fb286ecfa4d6094bc313`. Its 5,496-byte payload stores int16 positions, octahedral int16 normals, palette indices and delta-coded triangle indices. A small decoder runs once at module initialization; scratch buffers are function-local. Maximum decoded errors are 0.000006169 scene units in position, 0.002559 degrees in normal direction and 2.609e-8 in linear colour. Repeating the command with the pinned archive produces the same bytes. At runtime this prop requires no GLB loader or separate asset request, texture, material, geometry object, or draw call: its arrays merge into the buka's existing solid batch and shared vertex-colour material.

## Where every other shipped model is accounted for

This page covers the body and clip files and the buka pot. The other shipped `.glb` files each have a record next to their source:

| Models | Record | Terms |
| --- | --- | --- |
| Arena packs (Fight, Race, Football) | `scripts/assets/manifests/*.json`, credits in Help | CC0, CC BY or ours; checked by `npm run assets:budget` and `assets:credits` |
| Vehicles (`src/models/vehicles/assets`) and the street set (`src/scene/street/assets`), 166 files | `scripts/assets/provenance/meshy.json`, checked by `node --experimental-strip-types scripts/assets/provenance.ts --check` | **Not verified.** Most vehicles are inferred to be Meshy-generated, the street set scripted with generated image tiles; Meshy's terms for paid output have not been read here. The record lists what is known and what is left to do |
| Housing studio furniture (`src/housing-studio/assets`) | `src/housing-studio/assets/NOTICE.md` | Made for Allworld in Blender (a private asset library); AGPL-3.0-or-later |
| Nigeria runtime slices (`public/assets/nigeria-runtime`) | `THIRD-PARTY-NOTICES.txt` in each folder | Made for Allworld; baked maps from Poly Haven, CC0 |
| City scenery kits and heroes (`public/assets/scene-factory`) | [SCENE-FACTORY.md](SCENE-FACTORY.md) | Built by Allworld's scene factory with Blender |
| Native characters (`public/character-lab`) | `public/character-lab/THIRD_PARTY_NOTICES.md` | MakeHuman system assets, CC0; motion from CMU data (see the notice) |
