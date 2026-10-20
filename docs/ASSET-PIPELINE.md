# The asset pipeline for the arena games

How the models for Fight, Race and Football are chosen, made, checked and credited. The scripts live in `scripts/assets/`; the
packs they produce live in `public/assets/packs/<pack>/`, so a game fetches them only when it starts (no game loads them yet:
Phases 4 to 6 of `docs/agent-plans/viral/PHASES.md` do that). Older single assets made by hand are in [ASSETS.md](ASSETS.md).
What the assets must look like, and the rules for making a family or using no file at all, is in [ART-DIRECTION.md](ART-DIRECTION.md).

| Path | What it is |
| --- | --- |
| `scripts/assets/wants/<pack>.json` | The want list: where a pack comes from and which files to keep, as what. Edited by hand. |
| `scripts/assets/manifests/<pack>.json` | The manifest: every kept file with its licence, source, author, bytes and triangles. Written by the scripts. |
| `public/assets/packs/<pack>/` | The shipped files: `.glb` models, shared `.webp` textures and the source's `LICENSE.txt`. Nothing else. |
| `scripts/assets/blender/` | Blender scripts that build our own assets, and `preview.py`, which renders any `.glb` for a look. |
| `public/assets/CREDITS.txt`, `src/app/features/help/asset-credits.generated.ts` | The credits, generated from the manifests. |

The manifests are not shipped: the release package (`scripts/guard-joinallworld-package.mjs`) admits no JSON under `assets/`, and
a game does not need them. For the same reason the Help credits are a generated module rather than a JSON file.

## The look

Allworld is low-poly done well, on a cheap phone. Assets for the arena games follow the same rules as the world:

- **Real sizes, in metres.** A fighter is 1.8 m, a car about 4 m long, a ball 22 cm, a five-a-side pitch 40 by 20 m, a goal 3 by
  2 m (7.32 by 2.44 m full size), a ring 6 m inside the ropes with the canvas 1 m up. `prepare.ts` refuses a model whose size is
  implausible for its kind.
- **Few triangles, one texture.** At most 3,000 triangles a character and 1,500 a prop or car (`CAPS` in
  `scripts/assets/pack-types.ts`); one texture of at most 1024 px per model or per family of models, as WebP; one material where
  possible. The whole screen stays under 60,000 to 100,000 triangles and 60 draw calls.
- **Light baked in, not computed.** Our own assets carry their ambient occlusion (corners, under rails, contact with the floor)
  in the colour atlas, so a game needs one light and no shadow map for them. Matcaps and baked shadows over dynamic lights.
- **The Allworld palette.** The app's green `#183b2a` and amber `#e8a643`, cream, a warm red, concrete greys and two grass
  greens (`PALETTE` in `scripts/assets/blender/common.py`). Kenney and KayKit packs keep their own flat-colour atlases, which sit
  well beside it.
- **Nothing from another game.** No model, name, logo or look copied from a commercial game; generic arenas and people only.

What is not matched yet, for the game phases to decide: the KayKit fighters are stylised fantasy figures with large heads and
light skin; a game should tint their skin texels from the player's look, as `src/scene/body/tint.ts` does for the world's body.
The football players are Kenney's very blocky people. The Racing Kit's road tile is 3 m wide at the cars' real size, so a track
should use the larger corner pieces or lay tiles side by side (the kit's own proportions are toy-like; all its pieces share one
scale, so they still fit each other).

## Commands

```sh
node --experimental-strip-types scripts/assets/fetch-pack.ts --pack <pack> [--archive <file.zip>]   # or --all
node --experimental-strip-types scripts/assets/prepare.ts --pack <pack> [--no-meshopt] [--keep-png] [--dry]
npm run assets:budget        # node --experimental-strip-types scripts/assets/budget.ts [--json]
npm run assets:credits       # node --experimental-strip-types scripts/assets/credits.ts [--check]
blender --background --factory-startup --python scripts/assets/blender/preview.py -- --glb <file.glb> --png <out.png> [--clip kick --frame 0.4]
```

1. **fetch-pack** gets the pack and keeps only the wanted files, plus the source's licence text as `LICENSE.txt` (for a licence
   file that also thanks people by name, `licenceLines` keeps only the licence lines). It refuses a source whose own words do not
   state the licence the want list claims. Sources:
   - `kenney`: the zip linked from a kenney.nl asset page, which must say CC0. Tried 16 October 2026 (Racing Kit, live).
   - `github`: files at a pinned commit of a public repository; the repository's licence file must say CC0 or CC BY. KayKit
     publishes its packs this way. Tried 16 October 2026 (Adventurers).
   - `itch`: a free itch.io pack, by the requests the download page makes. Tried 16 October 2026 against Quaternius' Universal
     Animation Library (archive and CC0 licence file found); no pack uses it yet. If itch.io changes, the script says to download
     the zip in a browser and pass `--archive`.
   - `polypizza`: a poly.pizza model page; licence and author are read from the page. Only the page's shape was checked (16
     October 2026); no pack uses it. Poly Pizza mixes CC0 and CC BY: a CC BY model needs its credit line in NOTICE.md.
   - `own`: Blender runs `scripts/assets/blender/<script>.py` for each item (below). `BLENDER` names the binary; otherwise
     `blender` on the path or the usual macOS place.
   A downloaded archive is read in memory by `scripts/assets/zip.ts`; nothing in it is unpacked or run.
2. **prepare** turns each fetched model into a game file, in place: drops what the scene does not reach, meshes the list does not
   keep (`keepMeshes`: weapons, hats) and clips it does not name (`clips`, renamed to the game's names); scales to metres (`scale`
   or `fit`) and turns Z-up models upright; re-encodes textures as WebP at most 1024 px with `cwebp` (three's GLTFLoader reads
   `EXT_texture_webp`); makes a texture that several models of one game share into one file they point at; compresses with
   gltfpack 1.3 (`EXT_meshopt_compression` and quantised vertices, the codec the game's loaders already decode,
   `src/scene/models/gltf-source.ts`, and the tool `scripts/body/build-body.ts` uses, through `npx`), simplifying when the list
   asks (`simplify`); and counts the triangles of the final file, refusing one over its cap. Nothing is written until every model
   of the pack passes. The fix for a refusal is a lighter model or a stronger `simplify`, never a higher cap. Running it again
   leaves prepared models alone. No Draco: the repository uses meshopt only.
3. **budget** checks every pack from the files themselves and fails loudly: a malformed manifest, a missing, resized or unlisted
   file, an unprepared model, triangles over the cap or different from the manifest, a texture over 1024 px, a file the release
   package would refuse, or more than 1.5 MB brotli (quality 11) per game across all packs.
4. **credits** writes `public/assets/CREDITS.txt` and the Help module from the manifests; `--check` fails when they are stale or
   when NOTICE.md lacks a CC BY credit line. The Help sheet shows them behind "Game art credits"
   (`src/app/features/help/HelpBody.vue` loads `AssetCredits.vue` only on that tap).

Tests: `scripts/assets/*.test.ts` (in `npm test`) cover the glTF reader, prepare, fetch (with a fake network and a fake
Blender), budget, credits and the cartridge entries, and hold the committed packs to every cap and the credits to the manifests.

## The manifest

`scripts/assets/manifests/<pack>.json`, format 1: `{ format, pack, name, kind, page, author, licenceId, fetched, assets }`.
Each asset:

| Field | Meaning |
| --- | --- |
| `path` | From the repository root: `public/assets/packs/<pack>/<file>`. The page address is the path without `public`. |
| `licence` | `CC0`, `CC-BY`, `MIT` or `ours`: the cartridge contract's words. |
| `source` | The page it came from, or `Allworld` for ours. |
| `author` | The maker (a library's name, never a private person's). |
| `attribution` | CC BY only: the credit line exactly as it must appear; NOTICE.md must contain it too. |
| `bytes`, `triangles` | Measured from the shipped file. |
| `game`, `kind` | `fight`, `race` or `football`; `character`, `vehicle`, `prop`, `texture` or `licence`. |
| `licenceId` | The exact licence: `CC0-1.0`, `CC-BY-3.0`, `CC-BY-4.0`, or `AGPL-3.0-or-later` for ours. |
| `from`, `sourceSha256` | Where the file sat in the source, and the SHA-256 of the bytes as fetched. |
| `made` | Ours: the script that builds it. |
| `prepared`, `note` | Set by prepare; what was changed. |

The first five fields are the cartridge contract's asset entry (`src/arena/cartridge.ts`), with the same
meanings. `cartridgeAssets(manifest, { game, files })` in `scripts/assets/cartridge-assets.ts` returns those entries for a game's
files (never the licence text), and `gameAssets(manifests, game)` gathers one game's files from every pack, so a cartridge's
`manifest.assets` can list pack files as they are. Checked 16 October 2026: with every game's files listed this way in
`src/arena/cartridges.ts` (a local edit, not committed: Phases 4 to 6 wire them in), `npm run cartridge:check -- --no-dist` accepts
them, and the test `scripts/assets/cartridge-assets.test.ts` runs the same checker over them. Only CC0, CC BY and ours may enter; anything else fails the manifest check.

## The packs

Measured 16 October 2026 (brotli at quality 11, as the budget counts it):

| Pack | Source | Licence | Game | Files | Triangles | Raw bytes | Brotli bytes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| `kaykit-adventurers` | KayKit, Adventurers Character Pack 1.0 (GitHub, commit `672074b`) | CC0 | fight | 2 | 2,956 + 2,990 | 453,204 | 159,823 |
| `allworld-arenas` | ours (`ring.py`) | ours | fight | 1 | 620 | 38,916 | 31,540 |
| `kenney-racing-kit` | Kenney, Racing Kit | CC0 | race | 27 | 8,386 (largest 1,430) | 155,212 | 59,202 |
| `kenney-blocky-characters` | Kenney, Blocky Characters 2.0 | CC0 | football | 4 | 72 each | 110,956 | 49,967 |
| `allworld-arenas` | ours (`pitch.py`, `goal.py`, `ball.py`) | ours | football | 5 | 830 | 27,460 | 15,411 |

Per game: **fight 191,363**, **race 59,202**, **football 65,378** bytes brotli, each against 1,500,000. Each pack folder also
holds its source's `LICENSE.txt` (not counted).

- **Fight, the real characters:** `native-fight-clips.glb` (ours, animations only, 24 clips: 12 for each body, 310 KB) with the world's own character files, which are not part of the pack.
- **Fight, the stylised fallback:** `fighter-1.glb` and `fighter-2.glb` (KayKit's Barbarian and Rogue without weapons, hat or cape, simplified by gltfpack
  to the cap; one rig of 41 joints each) with 15 clips: `idle`, `walk`, `walk-back`, `run`, `punch`, `punch-2`, `kick`, `block`,
  `blocking`, `block-hit`, `hit`, `hit-2`, `dodge-back`, `down`, `cheer`. `ring.glb`: the ring on a 14 m concrete floor.
- **Race:** four cars (`raceCarRed`, `Green`, `Orange`, `White`; separate `body` and four wheel nodes, `wheelFrontLeft` and so
  on, for steering and spin), nine road pieces (start, start grid, two straights, three corners, a curve, a pit lane), barriers, a wall, a
  fence, pylons, a chequered flag, light posts, trees, grass, a tent, two grandstands and a pit garage. The Race screen (`src/arena/race-3d.ts`) loads twelve of them: the four cars, the barrier wall, the fence, a grandstand, the pit garage, two trees, a light post and the chequered flag (about 0.1 MB in all); the road itself is built from the track in code.
- **Football:** `pitch.glb`, `goal.glb` (five-a-side), `goal-full.glb` (full size, for a penalty duel), `ball.glb`, the goals'
  shared net texture, and `player-1.glb` to `player-4.glb` (clips `idle`, `walk`, `run`, `kick`, `celebrate`, `dejected`, `down`,
  `pick-up`). No goalkeeper dive clip exists in these packs: Football rolls the whole body to the side instead (`diveRoll` in `football-3d.ts`). The players carry no normals, so the view computes them. `goal-full.glb` is not used (the five-a-side goal, scaled to the rules' own 5.2 m mouth, reads better on a phone); the pitch's marked spot at 6 m is the shoot-out's spot.

Each model was rendered with `preview.py` before it was kept (the fighters in each clip). Nothing has yet been measured in the
game on a throttled phone; the game phases do that when they load the packs.

## Making our own assets with Blender

Our own assets are built by scripts, never by hand, so they can be rebuilt: `scripts/assets/blender/<name>.py`, run headless by
fetch-pack for a want list of kind `own` (`scripts/assets/wants/allworld-arenas.json`), or by hand:

```sh
blender --background --factory-startup --python scripts/assets/blender/ring.py -- --out ring.glb [--size 6]
blender --background --factory-startup --python scripts/assets/blender/goal.py -- --out goal.glb --width 7.32 --height 2.44 --depth 2
```

- **`common.py`** holds the helpers: an empty metric scene, boxes, cylinders and rods between two points, joining parts into one
  mesh, painted images, vertex colours, and `bake_atlas`.
- **Baking:** `bake_atlas` gives the joined mesh one UV map (Smart UV Project), bakes the materials' colour (Cycles, DIFFUSE, colour
  only) and ambient occlusion (AO) into two 1024 px images, multiplies them (`colour x (0.35 + 0.65 x AO)`) into one sRGB atlas,
  and replaces every material with one that shows it. The ring uses it. The pitch is flat, so its markings are painted straight
  into a 1024 x 512 texture; the ball and the pitch boards use vertex colours (no texture).
- **LODs:** none of these needs one (the largest is 620 triangles). For a bigger asset, add a Decimate modifier copy at about half
  the triangles and export it as `<name>-lod1.glb`, listed as its own item.
- **Export:** glTF binary, +Y up, transforms applied, no cameras, lights or extras, textures as PNG (prepare.ts makes them WebP and
  compresses the file; the exporter's own Draco is not used, because the game decodes meshopt).
- **Animation, ours:** `native-fight-clips.py` keys the Fight clips for the native 53-joint characters (the world's CC0 MakeHuman
  bodies), with no mesh in the file: `<clip>.male` and `<clip>.female` (the two bodies share bone names but not rest poses, so each is
  solved for its own). Each frame is solved from a few plain numbers (pelvis, hips, chest, head, where each wrist and foot is) with
  two-bone solvers for arms and legs (elbows and knees bend one way, planted feet stay planted) and written as bone rotations for the
  body's rest pose; nothing is captured or copied from anywhere. Clips: `idle`, `walk-forward`, `walk-back`, `jab`, `cross`, `kick`,
  `block`, `block-hit`, `hit`, `hit-2`, `down`, `cheer`; strikes are 0.35 s and 0.55 s, the rules' move lengths (`fight.ts` MOVES).
  `blender ... native-fight-clips.py -- --out clips.glb --preview body.glb [--preview-body female] [--only jab] [--check]` also writes a
  body with the clips for `preview.py --clip jab.male --frames 0,0.3,0.6,0.9` (one picture per frame, camera fixed on the whole motion).
  gltfpack resamples the clips to 30 frames a second. `native-football-clips.py` does the same for Football (idle, walk, jog, sprint, dribble, kick, pass, tackle, stumble, celebrate, dejected, keeper-ready, keeper-dive-left, keeper-dive-right, keeper-catch; `native-football-clips.glb` in `allworld-arenas`); both scripts share `native_rig.py` (the solver and the writer). Fight (`src/arena/fight-native.ts`) plays them with an AnimationMixer on the
  native actor's skeleton; the native system's own motion is never run for these actors. An animated asset made by hand should be
  rigged with Rigify (bundled with Blender) and keep one action per clip named as the game calls it (`idle`,
  `walk`, `run`, `punch`, `kick`, `block`, `hit`, `celebrate`), exported with `export_animation_mode='ACTIONS'`; the other animated assets come from KayKit with named clips. An animated asset of
  our own should be rigged with Rigify (bundled with Blender) and keep one action per clip named as the game calls it (`idle`,
  `walk`, `run`, `punch`, `kick`, `block`, `hit`, `celebrate`), exported with `export_animation_mode='ACTIONS'`.
- **Sources:** no `.blend` is committed: the scripts are the source, and they build the same bytes every time (checked on 16
  October 2026 by building the pack twice). A hand-edited asset would keep its `.blend` under `assets-src/` (under 10 MB, zipped;
  the repository has no Git LFS).
- **Check before keeping:** budget.ts, and `preview.py` for a look; then render it in the game on a throttled phone profile.

### Tools and their licences

| Tool | Licence | Used for |
| --- | --- | --- |
| Blender 5.2 LTS | GNU GPL (a tool: what it makes is ours, not GPL) | building, baking, previews |
| Blender's glTF importer and exporter (bundled) | Apache-2.0 | GLB in and out |
| Cycles (bundled) | Apache-2.0 | the colour and ambient occlusion bakes |
| gltfpack 1.3 (meshoptimizer, through `npx`) | MIT | compression and simplification |
| cwebp (libwebp) | BSD-3-Clause | WebP textures |

No Blender add-on beyond the bundled ones, and no new npm dependency.

## Local image-to-3D (optional runbook)

For a market's worth of wares or one landmark from photos of real Lagos things, not for people (the world's two bodies are enough)
and not for anything a generator in `src/scene/` can draw ([ART-DIRECTION.md](ART-DIRECTION.md), the zero-asset rule). It runs on
the owner's Mac; nothing here is installed by the repository, and this page was written without installing any of it.

**Licences, read from GitHub on 20 October 2026** (`gh api repos/<r> --jq .license.spdx_id`, and each project's own README):

| Tool | Licence | What to know before a file ships |
| --- | --- | --- |
| `microsoft/TRELLIS.2` | MIT | Code and weights are MIT, but its DINOv3 image encoder has its own licence. AssetFurnace therefore marks TRELLIS output `commercial-conditional`. Read the DINOv3 licence and write the clause in the file's provenance row before shipping. |
| `Bingeljell/image-to-3dlab` (AssetFurnace) | Apache-2.0 | The studio, not a model: it runs the backends on a Mac, writes a `.provenance.json` next to every file (hashes, settings, licence classes) and refuses an input without a real transparent foreground. Keep its NOTICE if code is ever copied. |
| `VAST-AI-Research/TripoSR` | MIT | The fast, rough one. The repository licence was checked; the weights' own licence was not. |
| `Tencent-Hunyuan/Hunyuan3D-2` | GitHub reports `NOASSERTION` (a custom licence) | AssetFurnace's README says the weights are under the Tencent Hunyuan Community License, **not licensed for use in the EU, UK or South Korea**. Allworld is worldwide: **Hunyuan3D output is not shipped** until that licence has been read and allows it. |

**Steps**

1. **Photo.** One object, your own photo (no stock images, no other game's screenshots, no person without their consent), plain
   background, cut out to a transparent foreground.
2. **Generate** with AssetFurnace (a TRELLIS.2 or TripoSR backend). Read `install.sh` before running it, as its README asks; it
   downloads no weights until you choose a backend and it states each licence first. Keep the `.provenance.json` sidecar.
3. **A character** is made in a **T-pose with empty hands** and plain clothes, which rigs best. Its own skeleton is not shipped:
   **retarget it to one of the two shipped skeletons** (the 23-bone male or female body, [ASSETS.md](ASSETS.md)), never a third
   body. The retargeting script does not exist yet (`scripts/body/retarget.ts` is named in the plan and not written); until it
   does, a generated model may only be a static prop.
4. **A prop** goes through `node --experimental-strip-types scripts/assets/prepare.ts --file in.glb --out out.glb --kind prop --fit y:<metres>`,
   which scales it to metres, makes the texture a WebP of at most 1024 px, compresses it and refuses it over the 1,500-triangle cap.
   Simplify or re-generate; never raise the cap.
5. **Record it.** `fetch-pack.ts` has no source kind for a file made on the owner's Mac yet; add one (`local`) when the first photo
   model is actually wanted, so that it gets a manifest row (`licence`: `ours`, `made`: the tool and its version, the photo's hash)
   and the Help credits. Until then a file waits for a row in `scripts/assets/provenance/` and does not ship.
6. **Judge it in the game**, not in the tool's viewer ([ART-DIRECTION.md](ART-DIRECTION.md), section 5).
