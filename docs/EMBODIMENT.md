# Embodiment: real bodies, real homes, a walkable country

Status: research and design, 6 October 2026. Nothing here is implemented. Companion to `REALISM.md`, which covers behaviour, memory and city life. This document covers the body, the objects it uses, the buildings it lives in and the ground it walks on. Delivery order is in `REALISM-PLAN.md`.

## What Anthony asked for

- Characters that look more like real people.
- Every everyday action is animated: open the door and step out, sit in a chair, lie in bed, climb into the bathtub and bathe, climb stairs.
- More ways to dress: chains, hijab, scarves, gele, and more besides.
- Build up (multi-storey), buy more land, live in a shared compound with other players.
- Walk out of your own door onto the 3D street, walk around the city, and travel from one state to another, on the real map.
- All of it must still load fast and run on a cheap Android phone on mobile data.

## Where the game is today (audited 6 October 2026)

| Area | Today | Evidence |
| --- | --- | --- |
| Body | Built from primitives, no skeleton. Seven rigid parts rotated by sine curves. Low detail is at most 600 triangles, medium about 2,000. About six draw calls per rigged figure. | `src/scene/characters.ts`, `avatar-rig.ts` |
| Poses | Stand, sit, walk, wave, work, dance, relax, jog. No sleep, bathe, door, or climb poses. At home every activity uses `work`. | `characters.ts`, `home-scene.ts` |
| Wardrobe | 2 bodies, 22 hairstyles, 15 outfits, 4 fabrics, 3 faces, 7 skin tones and 11 accessories. Cap, headwrap and fila share one head slot. No hijab, scarf, height or build options. | `characters.ts` look options |
| Props | Static draw functions. A seat is a scene landmark with a pose. Doors are not geometry: you spawn at the entrance. | `props.ts`, `scene/types.ts`, `venue-world.ts` |
| Home | One isometric room. A "duplex" is copy plus a bigger grid. One free plot per life, assigned by the server. No extra land and no compound. | `home-scene.ts`, `world.ts`, `home-layout.ts` |
| City | A separate miniature map at 1 unit = 100 m. Trips are server-timed along a route. No street-level walking. Only Lagos and Ibadan are open. | `map3d/*`, `trip.ts`, `MAP-GEOMETRY.md` |
| Budgets in tests | Scene: 17,000 triangles, 60 draw calls. City: 90,000 triangles, 40 calls. The map renders only on demand (the battery rule). | `scenes.test.ts`, `map3d.test.ts` |

## The one big choice: how "realistic" a human should look

**Decided by Anthony, 6 October 2026: photoreal, as long as speed is not affected.** Speed wins any conflict. Photoreal is reached in tiers, and each device gets the most realistic tier its budget allows.

- **Body:** a realistic base mesh from CC0 sources, retopologised to the budgets below. MakeHuman / MPFB is the first candidate; its licence is checked in phase A before anything ships. Real proportions, hands, a neck, and faces with real features. A range of Nigerian faces and skin tones is authored, not one face recoloured.
- **Skin and cloth:** physically based textures (colour, normal, roughness) compressed with KTX2. Close up, skin uses a cheap soft-light approximation, not true subsurface scattering. Fabrics (ankara, aso-oke, lace, denim) use real fabric normal maps.
- **Hair:** hair cards with alpha for 4C hair, braids, locs, twists, low cuts and fades. These are the hardest part of photoreal on phones, so they get their own budget.
- **Light:** one small pre-filtered environment map per place (indoor, street by day, street by night), so skin and fabric read as real without per-pixel cost.
- **Motion:** realism is mostly motion. Clips come from CC0 motion capture first, retargeted offline to one skeleton. The CMU motion-capture library is the candidate; its licence is checked in phase A.

**Tiers, chosen per device and never mid-session:**

| Tier | Who gets it | Body | Textures |
| --- | --- | --- | --- |
| Photoreal | Wide tier, and phones that pass the phase-A gate | ≤ 10,000 triangles | 1024 px, normal and roughness |
| Real-lite | Most phones | ≤ 5,000 triangles | 512 px, normal map |
| Crowd | Far people, 2G, failure | Today's procedural figure | none |

The phase-A gate decides which phones get which tier. If photoreal costs frame time or load time on the reference phone, phones get real-lite and the gap is reported.

## Design

### 1. One skinned body, many clothes

Replace the seven rigid parts with **one skinned mesh on one shared skeleton**. Every outfit, hair and accessory is skinned to that same skeleton. This is the industry pattern behind Roblox layered clothing (reference only, since its cage tooling is heavier than we need) and VRChat mobile avatars.

- **Skeleton:** about 30 bones, at most 4 influences per vertex. Hand detail is reduced to a mitten plus a thumb, which is enough to hold a cup, grab a rail or push a door.
- **Draw calls go down, not up:** one skinned mesh with one atlas material is **1 draw call**. Today's rig costs about 6. Headroom under the 60-call ceiling increases.
- **Variety comes from morph targets, not new meshes:**
  - height, build (slim to heavy), age (young to elder) and belly;
  - jaw, nose width and lip fullness.
  - One base can then look like a slim Yaba student, a heavy Lagos aunty or an elderly Calabar chief.
- **Skin and fabrics come from palettes:** skin tone from a small palette texture; ankara, aso-oke and lace from a shared fabric atlas tinted per outfit. Today's saved colour choices map across.
- **Detail levels:**
  - Hero (you, in the creator and at home) is at most 8,000 triangles.
  - Nearby people are at most 2,000 triangles and about 20 bones.
  - Far crowd keeps today's 600-triangle procedural figure.
  - The current procedural avatar stays as the 2G and failure fallback.
- **Sources:** CC0 base and clips from Quaternius (Universal Base Characters, Universal Animation Library) and Mesh2Motion. These are retargeted offline in Blender and shipped as **baked clips on our one skeleton**, because retargeting at runtime is buggy in three.js. Mixamo is avoided: its licence forbids redistributing the raw files, and a web game ships its GLBs to everyone. Ready Player Me was shut down in January 2026, so no hosted avatar service is used.
- **Rule change:** this ends "procedural only" for people. Authored assets go through one pipeline: Blender, then `gltfpack` with meshopt geometry and animation compression, then KTX2 textures. Every file has a byte budget checked in CI.

### 2. Wardrobe slots that layer like real clothing

Today one head slot holds a cap, headwrap or fila. That cannot express a hijab worn with earrings and a chain. Each item instead declares:

- the **slot** it occupies: head, hair, neck, ears, wrist, face, top, bottom, full, shoes, carry;
- the **body regions it hides**, so a hijab hides hair and neck skin and long sleeves hide forearm skin;
- the **slots it blocks**, so a gele blocks caps.

First new items, all skinned to the shared skeleton:

- hijab (several drapes), turban, gele (several ties);
- neck scarf and shoulder wrap;
- chains (thin, Cuban, pendant), beads and coral;
- wristwatch and bangles;
- agbada, kaftan, abaya, buba-and-iro, school uniform and work uniforms;
- slippers, sandals and sneakers.

Items are separate small files. The wardrobe loads only the item you are trying on, and the Boutique sells them.

### 3. Objects that tell the body how to use them

This follows The Sims' smart-object model. Each usable prop ships with:

- **anchors:** an approach point, a use point and an exit point;
- **an action list:** a chair offers sit; a bed offers sleep and lie down; a bath offers bathe.

Using an object runs one sequence:

1. Walk to the approach point.
2. Turn to align.
3. Play the *enter* clip (sit down, step into the bath).
4. Loop the *use* clip (breathing while seated, sleeping, scrubbing).
5. Play the *exit* clip and walk off.

Feet on stairs and a hand on a door handle use a small IK correction. Everything else is anchors and baked clips.

First objects:

| Object | Clips |
| --- | --- |
| Door | Push open, step through, door swings shut. The door leaf has a real hinge. |
| Chair, sofa, plastic chair, bench | Sit down, seated idle, stand up |
| Bed, mat | Lie down, sleep, get up |
| Bathtub | Step in, sit, wash, step out. Water and foam rise to chest height. |
| Bucket bath, shower | Wash at standing height. The bucket bath is the realistic Nigerian default; the tub is an upgrade. |
| Stairs | Climb and descend, with feet placed by IK on each tread |
| Table, cooker | Eat, cook |

**Modesty rule:** bathing never shows nudity. Clothing swaps to a towel wrap, foam and water cover the body, and the camera frames the shoulders up. This is a hard rule because the game is social and public.

**Battery rule kept:** a scene renders frames only while an action or movement is playing, then goes idle. A sleeping character is a short loop that stops after a few seconds with the eyes closed.

### 4. Homes you can build up and out

- **Plot grid:** the home becomes the plot, a real-size grid in metres. Today's single room becomes the first room on it.
- **Storeys:** each floor is its own group. The camera uses Sims-style cutaway:
  - floors above the one you are on are hidden;
  - walls between the camera and you fade.
  - Stairs are an object (see 3) that links one floor's walkable grid to the next.
- **Building:** place walls, doors, windows, stairs and a roof from a kit of modular pieces drawn in batches. Many pieces still cost few draw calls (`BatchedMesh` and `InstancedMesh` in r180).
- **More land:** buy the free plot next to yours in the same estate street. Plots that touch merge into one buildable lot. The price rises with the estate tier.
- **Compounds:** a compound is a building type with several units around a shared yard.
  - The owner (a player) rents units to other real players, or to regulars until players arrive.
  - Shared things are actually shared: the gate, the yard tap, the generator, the clothesline. A NEPA cut hits the whole compound together.
  - This is the most Nigerian thing in this document. It also creates neighbours, which feeds `REALISM.md` items 3 (gossip) and 13 (introductions).
- **Save format:** this changes one plot per life into a list of plots and units. It is a server migration with a rollback plan, not a client tweak.

### 5. Walk out of your door onto the real street

Today there are two scales: scenes at about 1 m per unit and the city map at 100 m per unit. Walking needs a third layer: **the street, at 1 m per unit, streamed in tiles around you.**

- **Tiles:** 128 m square. Only the 3×3 tiles around the player are loaded; the next ring is fetched as you walk; tiles behind you are dropped. This is how Roblox streaming works. Each tile has its own local origin, so there is no floating-point jitter far from the origin.
- **Same map:** tiles are generated offline from the same geography the city map uses. Roads, plots and estates already exist in `world.ts`, with OpenStreetMap footprints and building heights where the data is good enough.
  - A tile is a **compact description**: road polylines, building footprints and heights, and props.
  - The existing kit builds it on the phone. This is the reason the street can be small.
  - Target: 20–60 KB per tile compressed, against hundreds of KB for a modelled tile.
- **Door to street:** your home's front door is a real point on a real street tile. Step out and you are on the street; the next venue door on that street is a real door you can walk into. The timed-trip system remains for long distances and for people who prefer it.
- **Street life:** pedestrians, okada, keke and danfo on the visible tiles use the same detail levels as section 1. Street characters beyond 30 m are not animated.
- **City to city and state to state:**
  - Walking Lagos to Ibadan at real scale is about 128 km, roughly 25 hours of real time. Realistic, but not playable.
  - So it works the way Nigerians actually travel: walk to the motor park (Ojota, Jibowu, Iwo Road), board a bus, and ride the real expressway.
  - The ride runs on the same tiles with time compressed, stopping at real points: Berger, Ogere, the toll gate.
  - You arrive at the other city's motor park and walk out onto its streets.
  - Within your city you can walk anywhere, at real scale.

## Size and speed budgets

All sizes are brotli-compressed downloads. The first load does not grow: everything below loads after first paint and is cached by the service worker.

| Asset | Budget | Basis |
| --- | --- | --- |
| Shell (first paint) | No increase over today | Our rule |
| Base body, all morphs, hero detail level | ≤ 300 KB | VRChat mobile "Good" is 10,000 triangles; we use 8,000 |
| Core clip pack (idle, walk, jog, sit, door, sleep, bathe, stairs) | ≤ 200 KB | Meshopt animation compression |
| One wardrobe item | ≤ 60 KB, ≤ 4,000 triangles, ≤ 1024 px texture | Roblox accessory limits |
| One street tile | ≤ 60 KB description, ≤ 25,000 triangles built | Our target |
| Visible scene on the phone tier | ≤ 60 draw calls, ≤ 120,000 triangles | Existing ceiling; three.js mobile guidance |
| Renderer | WebGL2 stays primary | About 23% of Nigerian Android devices are on Android 10–11, below WebGPU's Android 12 floor |

The data plan matters: more than a third of Nigerian subscribers are still on 2G (BusinessDay, 2026). Every new layer therefore has a fallback. The procedural avatar, the timed trip and the miniature map all remain.

## Phases, each provable on its own

| Phase | Delivers | Proof before moving on |
| --- | --- | --- |
| A. Body spike | One skinned body plus idle, walk, sit, door, sleep and bathe, at home only, behind a flag | On a real low-end Android (Tecno, Infinix or itel class): load time on throttled 3G, frame time, memory. **Go or no-go for the whole plan.** |
| B. Smart objects | Door, chairs, bed, bath, bucket bath, cooker, table | Each action plays end to end in the browser; the scene stays under budget; the battery rule holds |
| C. Wardrobe | Slots and layering, hijab, gele, scarves, chains, body morphs, Boutique items | Creator and Boutique checks; old saved looks still load |
| D. Building | Plot grid, storeys, stairs, cutaway, modular walls | Climb to the second floor and back on a phone; budget holds at the largest house |
| E. Land and compounds | Buy the next plot, merge lots, compound units, shared tap and generator | Server migration with rollback; a two-player compound check |
| F. Street | Streamed street tiles around home, door to street to venue | Walk from home to a venue door on a phone without a loading screen; tile sizes within budget |
| G. Intercity | Motor park, expressway ride on tiles, arrival on foot | Lagos to Ibadan end to end; the old timed trip still works |

## Decisions needed from Anthony

Decided on 6 October 2026:

1. CC0 models and animations are allowed, as long as speed is not affected.
2. The art target is photoreal, in the tiers above.
3. Budget tests may be updated.
4. Work starts from a fresh copy of `origin/main`.

Still open: the save migration for plots and units (phase E) gets its own rehearsal and restore reference before release.

## Sources

- VRChat avatar performance ranks: https://creators.vrchat.com/avatars/avatar-performance-ranking-system/
- Roblox cage meshes and layered clothing: https://create.roblox.com/docs/art/modeling/cage-meshes
- Roblox streaming: https://create.roblox.com/docs/workspace/streaming
- Ready Player Me shutdown: https://avatarsdk.com/blog/2026/01/15/switch-from-ready-player-me-to-avatar-sdk-fast-familiar-production-ready/
- Quaternius CC0 characters and animation: https://quaternius.com/packs/universalanimationlibrary.html
- Mesh2Motion (MIT code, CC0 art): https://mesh2motion.org/
- Mixamo licensing FAQ: https://community.adobe.com/questions-696/mixamo-faq-licensing-royalties-ownership-eula-and-tos-589400
- Meshopt versus Draco: https://compress-glb.com/blog/draco-vs-meshopt/
- three.js SkeletonUtils retarget issue: https://github.com/mrdoob/three.js/issues/25288
- The Sims object design: https://donhopkins.com/home/TheSimsDesignDocuments/ObjectFileFormat.pdf
- Sims 4 build and cutaway: https://simsvip.com/2014/08/06/the-sims-4-build-mode-lessons/
- Local origins for precision: https://reearth.engineering/posts/high-precision-rendering-en/
- OSM2World: https://osm2world.org/
- WebGPU support: https://web.dev/blog/webgpu-supported-major-browsers
- Nigerian Android versions: https://gs.statcounter.com/android-version-market-share/mobile-tablet/nigeria
- Nigerian devices and 2G share: https://businessday.ng/technology/article/the-price-divide-behind-androids-88-dominance-in-nigeria/
