# Third-party assets

Assets the game ships that it did not make itself, where they came from, under what licence, and how they are rebuilt.

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

The free library has no clips for the following. They keep today's behaviour:

- opening or closing a door;
- bathing;
- stairs;
- sleeping or lying down. The bed stays as it is today; the body is not used to lie on it.

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
| clip-pack.glb | 53,896 B | 13,984 B | ≤ 200 KB | 8 clips |
| lazy chunk `skinned-*.js` | 71,016 B | 18,891 B | — | body module, GLTFLoader, meshopt decoder |

A player fetches one body, the clips and the chunk: about 171 KB brotli after first paint, within the 500 KB budget. The first load is unchanged.

### How the runtime falls back

The procedural avatar stays, byte for byte, in each of these cases:

- Data Saver is on, or the connection is 2G;
- the device has 2 or fewer cores, or 2 GB of memory or less;
- the renderer is not WebGL2;
- any fetch, parse or build of the body fails. A console warning is logged and the body is not retried.

These checks live in `src/scene/body/gate.ts`, the "SKINNED BODY" section of `src/scene/home-scene.ts`, the venue stand-in `src/scene/body/stand-in.ts` (owned by `src/venue-world.ts`), and the look preview `src/scene/avatar-preview.ts`. There is no user setting and no address flag.
