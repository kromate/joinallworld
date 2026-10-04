# Allworld procedural model library

## In the combined game (branch `combine/all`)

This document was written on `astra/models`, where the library was wired into an older copy of the game. The combined game keeps its own, newer implementations as the running game; what follows says exactly what of this branch is in use. Everything below this section describes the `astra/models` branch as it was delivered.

| Part of this branch | In the combined game |
| --- | --- |
| The library: `src/models/{vehicles,people,environment,geo}`, its tests, measurements, provenance, research notes | **Adopted whole.** Tested by `npm test` (34 tests). Loaded by nothing in the game unless a flag below is on. |
| The workshop: `models.html`, `src/models/preview.ts`, `src/models/tooling/**` | **Adopted whole**, development only (not a build input). The `game-dev.ts` / `integration-*.json` runner drove the old integrated preview and is kept for reference. |
| Trip vehicles on the 3D city map (`17b7c00`, `src/models/integration/scene-models.ts`) | **Available, OFF by default.** `?models=vehicles` makes the travelling player ride a model-library vehicle (danfo, keke, okada, cab, own car) on real seat anchors, with wheels, steering and day/night lights. Its code is fetched only then (`src/map3d/index.js` → `createMap3D({ travelVehicle })` → `createActor`). Off, the game draws its own batch-drawn vehicle exactly as before. A model vehicle is at most 1,500 triangles and 8 draw calls (asserted); the game's own is one mesh, which is why it stays the default until the map's draw-call budget has been measured on a phone with the flag on. |
| Avatars through the scene contracts (`9886a6f`: `src/scene/characters.js` replaced by a facade over `src/models/people`) | **Not wired.** The game's avatar system was rebuilt after this branch forked (three detail levels, a rig, walk and jog cycles, accessories, the creator) and is what every scene, the creator and the Boutique are verified against. `src/models/people` remains in the library and the workshop. The byte-for-byte "legacy" copies this branch made (`characters-legacy.js`, `world-map-legacy.js`) are not kept: the game's current files are the running implementations. |
| Home / market landmarks, the canoe and the lagoon water material in the city (`17b7c00`, `src/map3d/city-build.js`) | **Not wired.** The city build was rewritten since (local governments, estates, houses, the airport and refinery, the UNILAG campus); `src/models/environment` remains in the library and the workshop. |
| The geographic explorer with Kenya (`cc8db0d`: `src/world-map.js` replaced, `src/models/integration/geography-view.ts`) | **Not wired.** The game has its own world → Africa → Nigeria atlas with inter-city travel wired to the server. `src/models/geo` (world, Africa, Nigeria, Kenya, with the Kenya geoBoundaries attribution in `geo/provenance.json`) remains in the library and the workshop; `geography-view.js` is kept as the adapter a later integration would start from. |

`src/models/integration/flags.ts` is the one place a flag is read. The old `?models=legacy` switch no longer exists: legacy is simply the default.

Implemented on 4 October 2026 in `/Users/anthonyakpan/Desktop/JoinAllworld-astra-models`, branch `astra/models`, based on `c5e803e`. Game consumer integration was added in this branch after Anthony explicitly requested it. The shared owner/main worktrees were not edited. No merge, rebase, push, deployment, downloaded 3D model, image texture, font, or new npm dependency is part of this delivery.

## Current delivery

The local library includes 15 vehicles, 11 buildings/water models, a compatible procedural avatar, and world/Africa/Nigeria/Kenya map models. `models.html` is a dev-only workshop. The production Vite inputs remain unchanged.

| Unit | Immutable implementation commit | State |
| --- | --- | --- |
| Vehicles, buildings, water | `3bae5aba98787e12495baa067ba6a0e2699c5c75` | Implemented; headless and local browser checked |
| People | `bc59adc637ad7d0ac1d44265cd308412be39f152` | Implemented; trait, budget, pose, ownership, and contact-sheet checks |
| Geography | `503a244caffd0b46b632de02dac4d2352af13558` | Implemented; sourced geometry, picking, routes, framing, sizes checked |
| Workshop and verification tooling | `3d31c9a42653fcf861d8240c620d0edea3b87d33` | Local preview and evidence records |
| Local game consumer integration | See the integration commits below | Verified in the actual local game on port 3401 |
| Shared owner branch / production / real Android device | Pending | No merge/deployment; physical-device frame-time and mobile-data proof remain pending |

The Kenya dataset exception is approved by Anthony in this chat. Kenya uses the attributed geoBoundaries release. Other outlines remain Natural Earth public-domain data. Road paths are explicitly **schematic travel corridors**, not surveyed highway alignments or navigation routes. Imported free 3D candidates remain research references.

## Integrated game preview

Open `http://127.0.0.1:3401/` to play the integrated local game. Port 3400 remains the standalone model workshop. The new preview has its own data store and `models_sid` cookie, so its guest sessions cannot replace the owner's `sid` cookie on another port. Its API listens on 3402. No current owner/main checkout or running owner server was changed.

Integration commits:

| Consumer | Immutable commit | Result |
| --- | --- | --- |
| Scene avatars and appearance compatibility | `9886a6f079e82193b313e7bc8447b1d219794133` | The new avatar is the default in creator, home, venue, and crowd consumers; exact saved swatch colours and legacy normalized-look shape are preserved. |
| Trip vehicles, Home/market, canoe, water | `17b7c008241ad142bf12611be72a2e06c5212593` | Supported player trips use new street models and real seat anchors. Home/market landmarks, a lagoon canoe, and water material are mounted in the actual city. |
| Geographic explorer and access gates | `cc8db0d8d18af06eb672e7e7b29899e0f037de3b` | World/continent/country/state exploration, Kenya counties, accessible city controls, canvas picking/dragging, and SVG fallback. |
| Isolated preview and browser checks | `e51b8c6703f9772f7a13df0fcf0c9451e4387804` | Dedicated local game runner, repeatable user-path script, and verification record. |

Use `?models=legacy` for the retained comparison implementation. The original character and world-map files were copied byte-for-byte before replacement. `?map=2d` and the existing Simple map preference also apply to the new world explorer. A WebGL failure uses the same geography data in an SVG view.

Player transport covers the game's existing danfo, keke, okada, cab, owned-car, and staff-bus paths. Additional catalogue vehicles remain available for future game content. The seated avatar uses the vehicle's passenger anchor and a 0.62 scale. Vehicle swaps and day/night changes preserve the same passenger geometry; the owning actor disposes each old model once. Pose records are reused; repeated identical route samples retain identical steering. Steering between distinct samples follows the preceding route heading, while the standalone model pose API remains parameter-driven.

City integration is deliberately bounded to real consumer locations. The new compound house is the movable Home landmark; the market has the new stall; a model canoe joins the existing boat layer. The water material comes from the lagoon model while the actual city's contours, coastline, collision map, and shimmer texture remain the host's. This does not claim that all eleven catalogue environment models replace every existing venue.

The geographic explorer keeps `cityAccess()` as the entry authority. Previewing Kenya, a state, or another country never creates a playable city. Live route callbacks, if supplied by the later owner host, are checked against its offered/unblocked route and the city gate. Country corridors remain labelled schematic. Kenya attribution and its license link are visible in the game.

Verification on 4 October 2026:

- Full main suite: **536 passed, four skipped, zero failures**, 540 total.
- Focused integration/map/panel suite: **26 passed**. The avatar preview and scene suite also passed after preserving saved normalization and updating obsolete detail/rig expectations.
- The scene draw-call ceiling stays **60**. The structural mesh allowance rises by four for the new elbow/knee parts; that change is explicit in the scene test. The city measures 42,162 triangles / 22 calls at rest and 43,074 / 22 with moving traffic, under its existing 60,000-triangle / 40-call limits.
- Production build passed with the original production inputs and the dependency-aware config wrapper. The workshop remains excluded from production input. The existing large-chunk warning remains.
- Edge suite: **14 passed** against a private snapshot of the unchanged server/deploy sources with the newly built integrated assets. The snapshot keeps generated root `dist` out of other worktrees.
- Actual browser path: Home → city map → world/country explorer → Kenya → world → Africa → Nigeria → Lagos state → playable Lagos map → choose Market → choose Danfo → travel → arrival → reload.
- Kenya showed **47 counties and zero city-entry buttons**. A real pointer drag reached the 3D canvas. The world render counter stayed **2 → 2** over the sampled idle interval.
- The completed danfo trip charged **₦200** in the local test life. The server and reload both showed `location: market`, no active trip, and the same player name/look. This was isolated game currency, not a production account.
- The explicit Simple map path displayed all **47 county SVG paths**, with no city-entry action. Default and fallback browser runs recorded **no uncaught JavaScript exceptions**. Mobile views were inspected at 390×844.

The compact committed record is `src/models/evidence/integration/verification.json`. Screenshots and detailed browser records are local ignored evidence under `src/models/evidence/integration/`: `home.png`, `city-map.png`, `kenya.png`, `world-mobile.png`, `lagos-state.png`, `danfo-trip.png`, `trip-closeup.png`, `arrival.png`, `venue-mobile.png`, and `fallback-mobile.png`. A normal randomized roadside offer can appear after arrival; it does not prevent the saved Market arrival.

Run the integrated preview:

```sh
MODELS_DEPENDENCY_ROOT=/Users/anthonyakpan/Desktop/JoinAllworld node --experimental-strip-types src/models/tooling/game-dev.ts
```

Reproduce the default and fallback browser paths with the preview running:

```sh
MODEL_QA_LOCATION=market node --experimental-strip-types src/models/tooling/integration-browser.ts src/models/tooling/integration-steps.json
MODEL_QA_QUERY='?map=2d' node --experimental-strip-types src/models/tooling/integration-browser.ts src/models/tooling/fallback-steps.json
```

This integration is on `astra/models`, based on `c5e803e`. The later `parity/owner` / `parity/integrate-2` branches add estate/world-service/table work that is not included here. Port the narrow consumer changes onto those newer files rather than overwriting them. Shared-owner merging, deployment, and physical Android/mobile-data testing remain unperformed.

## Open the workshop

The current local preview is `http://127.0.0.1:3400/models.html`. It supports every model, detail selection, lighting, views, paint, avatar appearance, pose/animation scrubbing, vehicle doors/steering/brakes, map selection, region drilldown, camera scrubbing, and flight arcs. Drag rotates; scroll zooms. Rendering stops when input stops.

On this machine, reuse the existing Three.js r180 and Vite installation without creating a root dependency link:

```sh
cd /Users/anthonyakpan/Desktop/JoinAllworld-astra-models
MODELS_DEPENDENCY_ROOT=/Users/anthonyakpan/Desktop/JoinAllworld node --experimental-strip-types src/models/tooling/dev.ts
```

Only ports 3400–3409 are accepted by this runner. It runs the workshop only, without the game API/server. It ignores its own cache/evidence writes to avoid screenshot-triggered reloads. If dependencies are installed normally in a future checkout, omit `MODELS_DEPENDENCY_ROOT`.

## Public API

Import from `src/models/index.ts`, or directly from a domain entry to keep loading narrow. Geography data is lazy-loaded separately. All model code is strict TypeScript ES modules (erasable syntax only); geometry construction needs no DOM or WebGL. The preview and tooling are the explicit DOM/Node exceptions.

| Domain | Exports / contract |
| --- | --- |
| Vehicles | `VEHICLE_TYPES`, `VEHICLE_DETAILS`, `buildVehicle(type, options)`, `poseVehicle(model, pose)` |
| People | `normalizeLook`, `drawAvatar(batch, look, options)`, `buildAvatar(kit, look, options)`, `poseAvatar(group, pose)`, `buildPerson(look, options)`, `LOOK_OPTIONS`, `DETAILS`, `POSES` |
| Environment | `ENVIRONMENT_TYPES`, `DETAILS`, `buildEnvironment(type, options)`, `poseEnvironment(model, state)` |
| Maps | `GEOGRAPHY_LEVELS`, `loadGeography(level)`, `buildGeography(data, options)`, `buildCountry(data, options)`, `regionData(data, id)`, `buildRoute(map, points, options)`, `transitionCamera(from, to, progress, out)` |

The facade aliases people/environment detail lists as `PEOPLE_DETAILS` and `ENVIRONMENT_DETAILS`. New builders return `{ object3D, userData }`, sharing the metadata object with `object3D.userData`. Metadata includes `triangles`, `drawCalls`, and idempotent `dispose()`, plus applicable parts/anchors. The legacy `buildAvatar` deliberately returns `THREE.Group`, matching the existing contract. Its `userData.parts` retains body, torso, head, arms, and legs; the rig also has elbow/knee controls. `top` includes the builder’s y offset.

Vehicles face +Z, with +Y up. Their driver, door, and passenger-seat anchors are `Object3D` nodes; door anchors move with the door. Wheel rotations use supplied distance. Steering, doors, bounce, brake lights, and indicators reset from stored base transforms. The `time` builder option is `day`/`night`; pose `time` is numeric seconds. Avatar poses accept normalized `stride` and numeric `time`. Water pose modifies existing position and normal buffers. None of these functions starts a timer or owns an animation loop.

```js
import { buildVehicle, poseVehicle } from './src/models/vehicles/index.ts';
const danfo = buildVehicle('danfo', { detail: 'street', route: 'YABA', time: 'day' });
scene.add(danfo.object3D);
poseVehicle(danfo, { distance: 10, steering: 0.15, door: 0.5, time: 2 });
// The host chooses when to render, and disposes any separately attached passengers.
danfo.userData.dispose();
```

`drawAvatar` writes into the existing scene batch. `buildAvatar` borrows the host kit’s materials and disposes only its own geometry. `buildPerson` owns its materials and geometry. The appearance IDs and seeded fallbacks are covered by tests; height/build options scale the geometry without changing its triangle cost. The stylized avatar is about 2.9 local units tall. Hosts must choose scene scale and verify seated fit for the existing game’s unit system before mounting it.

Map coordinates are `[longitude, latitude]`. `model.pick({lon, lat})` returns a feature ID or null. `project(lon, lat, target?)` and `unproject(x, z)` convert to/from local XZ coordinates. Feature metadata exposes full bounds, an area centroid, a safe interior label anchor, and main-landmass focus bounds. `highlight(id, on)` and `hover(id)` update the existing color buffer. `frame(id?)` supports feature IDs, `group:Africa`, and city identifiers such as `city:lagos`. Frames use local model coordinates. Allocate the transition output once and reuse it.

```js
import * as THREE from 'three';
import { loadGeography, buildGeography, buildRoute, transitionCamera } from './src/models/geo/index.ts';
const data = await loadGeography('nigeria');
const map = buildGeography(data);
map.highlight('NG-LA', true);
const from = map.frame(), to = map.frame('NG-LA');
const frame = { position: new THREE.Vector3(), target: new THREE.Vector3(), span: 0 };
transitionCamera(from, to, 0.5, frame);
const route = buildRoute(map, data.roads[0].points, { mode: 'road' });
route.pose(0.5);
// Attach a separately owned vehicle to route.userData.anchors.traveller.
route.userData.dispose(); map.userData.dispose();
```

A route owns its line/anchor but does not own a vehicle the host attaches. Camera transitions and route poses write into existing objects. They handle backwards scrubbing and exact endpoints. Maps currently use flat projections; overseas islands remain in the full feature, while focus framing prefers its main landmass.

## Measured rendering and data budgets

Counts below include model geometry and instanced triangles, excluding preview lights, separate route markers, and other models. The workshop additionally shows actual renderer totals. All counts are reproducible with `MODELS_DEPENDENCY_ROOT=/Users/anthonyakpan/Desktop/JoinAllworld node --experimental-strip-types src/models/tooling/measure.ts`. The JSON record is `src/models/evidence/measurements.json`.

Vehicle cells are triangles / draw calls. The hard ceilings are 250 / 1,500 / 8,000 triangles. Route lettering changes the count within the tested limit.

| Vehicle | Map | Street | Showcase |
| --- | ---: | ---: | ---: |
| danfo | 240 / 7 | 902 / 7 | 1286 / 8 |
| keke | 212 / 7 | 308 / 7 | 452 / 8 |
| okada | 120 / 3 | 216 / 3 | 328 / 4 |
| cab | 248 / 7 | 696 / 7 | 1080 / 8 |
| sedan | 240 / 7 | 664 / 7 | 1048 / 8 |
| hatchback | 236 / 7 | 660 / 7 | 1044 / 8 |
| suv | 236 / 7 | 660 / 7 | 1044 / 8 |
| pickup | 248 / 7 | 636 / 7 | 1020 / 8 |
| molue | 240 / 7 | 602 / 7 | 794 / 8 |
| brt | 240 / 7 | 638 / 7 | 830 / 8 |
| tanker | 244 / 7 | 544 / 7 | 912 / 8 |
| container | 228 / 7 | 516 / 7 | 804 / 8 |
| ferry | 72 / 2 | 240 / 2 | 240 / 2 |
| canoe | 134 / 2 | 158 / 2 | 158 / 2 |
| airplane | 136 / 3 | 504 / 3 | 696 / 4 |

Building/water budgets use the same conservative ceilings. LODs retain the same bounds and anchor positions.

| Environment | Map | Street | Showcase |
| --- | ---: | ---: | ---: |
| compound-house | 204 / 1 | 240 / 1 | 504 / 1 |
| bungalow | 104 / 1 | 104 / 1 | 368 / 1 |
| apartment | 192 / 1 | 288 / 1 | 1740 / 1 |
| office | 180 / 1 | 252 / 1 | 1308 / 1 |
| kiosk | 72 / 1 | 72 / 1 | 264 / 1 |
| market-stall | 72 / 1 | 108 / 1 | 186 / 1 |
| bus-stop | 84 / 1 | 108 / 1 | 168 / 1 |
| bridge | 168 / 1 | 240 / 1 | 384 / 1 |
| lagoon | 60 / 2 | 192 / 2 | 552 / 2 |
| river | 72 / 2 | 204 / 2 | 564 / 2 |
| beach | 242 / 3 | 374 / 3 | 734 / 3 |

People hard limits are 600 / 2,500 / 25,000. The fixed measurement sweep covers 656 body/hair/outfit/fabric combinations per tier with a crown and a specified five-accessory set. It is not an exhaustive maximum over every look combination. The separate low-detail test exercises all game-allowed accessory subsets up to five items. A representative unmarked rigged braids/casual person is 476 / 1,848 / 7,788 triangles at 11 calls. Unrigged batching is one opaque call, plus one for a marker. Rigged marked avatars use 12 calls.

| Map | Features | Minified module bytes | Triangles | Draw calls |
| --- | ---: | ---: | ---: | ---: |
| world | 242 | 113,508 | 16,280 | 3 |
| africa | 56 | 69,941 | 14,442 | 3 |
| nigeria | 37 | 58,496 | 12,666 | 9 |
| kenya | 47 | 29,064 | 4,430 | 8 |

World includes countries and territories. Africa includes 56 features, including disputed representations and the island countries omitted by the source’s Africa continent filter. Nigeria includes 36 states plus FCT and 37 distinct capital anchors. Kenya includes 47 counties. Country maps include city/airport anchors, schematic corridors, lane markings, and sampled source coastlines; Nigeria includes Niger/Benue centerlines. Coming-soon hatching adds a draw call when enabled.

`src/models/geo/provenance.json` records URLs, immutable revisions, source hashes, attribution, and limitations. `generate-data.py` fetches missing authoring inputs, verifies hashes, nodes collinear shared border segments, simplifies common chains, and writes compact local chunks. The world/Africa/Nigeria/Kenya module budgets are respectively 120,000 / 80,000 / 60,000 / 40,000 bytes. Capitals missing from Natural Earth use the committed Wikidata CC0 supplement; airport coordinates use OurAirports public-domain data. No runtime tiles or network APIs are used.

## Verification and local evidence

- Main `npm test`: 534 tests total, 530 passed, four skipped, zero failures. The final focused model run passed 29/29 after visual corrections.
- Production `npm run build`: passed with a dependency-aware config wrapper and output redirected into `src/models/.cache/build`. It kept the original production inputs, so the workshop is not bundled into the game.
- Edge suite: 14/14 passed. The test fixture hardcodes a root `dist` path; to respect the write lane, it ran on a private `git archive c5e803e` snapshot under `.cache/edge-workspace`, with the newly built assets linked as that snapshot’s `dist`. Existing game/deploy files are byte-identical to that base. The installed `deploy/tooling` dependencies were reused through `JOINALLWORLD_TOOLS`.
- Browser verification used the user-provided headless Chromium/CDP approach. Captures reported no JS exceptions and stable idle render counters. Actual model renderer counts matched metadata when no separately owned route traveller was present.
- Twelve repeated kiosk detail changes ended with the same live renderer geometry count, 1 → 1. An avatar pose change retained its geometry allocation. Nigeria → Lagos drilldown worked; the 390px viewport had no horizontal overflow. These are bounded local checks, not a universal GPU-leak or physical-Android proof.

Focused tests:

```sh
MODELS_DEPENDENCY_ROOT=/Users/anthonyakpan/Desktop/JoinAllworld node --experimental-strip-types --import ./src/models/tooling/register-dependencies.ts --test src/models/vehicles/*.test.ts src/models/people/*.test.ts src/models/environment/*.test.ts src/models/geo/*.test.ts
```

Screenshots are local ignored files under `/Users/anthonyakpan/Desktop/JoinAllworld-astra-models/src/models/evidence/`. JSON measurements and browser check results are committed. Representative paths:

- `vehicles-map-grid.png`, `vehicles-street-grid.png`, `vehicles-showcase-grid.png`.
- `environment-map-grid.png`, `environment-street-grid.png`, `environment-showcase-grid.png`.
- `people-{low,medium,high}-{hair,outfit}-{woman,man}.png`: front/side/back, lightest/darkest skin for every option in each body registry.
- `people-high-single-woman-night.png` and `people-high-single-woman-night-skin-1.png`.
- `geo-street-single-{world,africa,nigeria,kenya}.png`.
- `transition-nigeria-lagos-{0,0.5,1}.png`, `mobile-preview.png`.

The parent inspected the main fleet/building/map views and representative contact sheets, then corrected vehicle face winding and windscreens, canoe interior faces, avatar cheek/eye projection, exposed tunic waist geometry, building LOD massing, roof ribs, and palm shape. Machine-generated contact sheets cover the full registry; not every thumbnail received an individual close-up art review.

Regenerate contact sheets in bounded pages by body type:

```sh
node --experimental-strip-types src/models/tooling/capture.ts vehicles:street:grid environment:showcase:grid people:high:hair:woman people:high:hair:man geo:street:single:nigeria --interactions
```

The capture tool uses the existing local Chromium binary, owns port 3409 while running, and removes its temporary profile. It has per-command timeouts. The ordinary preview stays on 3400.

## Extend and integrate

Add geometry to the appropriate domain builder/registry and keep the same public wrapper. Share materials and instance repeated geometry. Dispose temporary construction geometry after merging, and release instanced-mesh resources as well as their geometry/materials. Extend the existing parameter-driven pose function rather than creating a render loop. New geo datasets need closed nondegenerate rings, stable unique IDs, and explicit provenance; `buildCountry` accepts data without changes to its geometry logic.

Remaining handoff items for the parity owner:

1. Port the already-wired actor and city changes onto the newer estate/world-service branch, then retest that branch’s scene scale, collision bounds, and vehicle seating.
2. Preserve the implemented avatar facade and comparison flag when porting. Keep batched low-detail crowds and the legacy `buildAvatar` return shape.
3. Carry the implemented geographic explorer into the newer host while preserving its live cross-city route callbacks and city-entry rules. Keep scene-wide budgets in addition to per-model limits.
4. Preserve the Kenya geoBoundaries attribution and license link from `geo/provenance.json` in any distributed game. Anthony’s exception applies to this dataset, not to unrestricted new asset imports.
5. Retain the visible schematic-route label. Accurate highway geometry, surveyed lane counts, and map-specific bridge placements still need a separately approved/licensed source. The reusable bridge model is implemented.
6. Run the actual host paths and representative Android hardware/mobile-data checks before a production claim. The local game integration is verified above; it has not been merged into the separate owner’s running build.

Three Sol workers implemented the disjoint vehicle, people, and environment units; a Luna researcher checked Kenya provenance. The parent implemented geography, preview/tooling, integration, and visual QA. Revision passes are reflected in the tests and commits above. Per-agent elapsed time, tokens, and money were not exposed.

## Research archive

The following source comparison was completed before implementation. Candidate assets were researched and previewed, not imported. Kenya’s earlier public-domain-only blocker is superseded by Anthony’s explicit attributed-dataset approval; the Natural Earth audit correctly remains eight old Kenyan provinces and was not used for county geometry.
## Free vehicle candidates

Hard triangle ceilings from the brief: map 250, street 1,500, showcase 8,000. An advertised count below a ceiling is only a candidate; materials, moving parts, seat anchors, loading, and memory still need inspection. Unknown counts are not a pass. Unless stated otherwise, free download is advertised but the archive was not downloaded.

| Candidate and source | Published license / access | Count and formats | Allworld assessment |
| --- | --- | --- | --- |
| [Kenney Car Kit](https://kenney.nl/assets/car-kit) | CC0; free download with an optional donation | 45 files; per-vehicle triangles and formats not exposed in the inspected page | First generic traffic candidate. Visual review shows consistent compact cars, a taxi, vans, pickups, and service vehicles. Rounded, toy-like proportions fit the direction. It does not solve the signature danfo. |
| [Low Poly Autorickshaw aka TukTuk, Nirmal.Justin](https://sketchfab.com/3d-models/low-poly-autorickshaw-aka-tuktuk-c7c87455ad014b3f9fc8c9fb2d164a61) | CC BY 4.0; free download button observed | About 4,800 triangles, 2,600 vertices; archive contents uninspected | Best specific keke candidate found. Visual review shows an open passenger side, rear bench, canopy, mirrors, and one front wheel. It has Indian branding/plates and textured rendering. Fits the showcase triangle ceiling on paper, not street or map. |
| [Lagos Danfo Bus, Iam_thearchitect](https://sketchfab.com/3d-models/lagos-danfo-bus-41b71827dcc94339b627fb79d9a7adb7) | CC BY 4.0; free download button observed | About 40,900 triangles, 20,400 vertices; creator says parts can be separated in Blender and that glass is absent | Strong Lagos reference, unsuitable unchanged at every tier. Preview shows worn yellow paint and weathered bodywork. That appearance relies on textures. Separate doors, usable rigging, and seat anchors are not established. |
| [Passenger Tricycle / Keke Napep, Flashtech Studio](https://sketchfab.com/3d-models/3d-model-passenger-tricycle-keke-napep-5d3b827310e747a8b5b4079f26ebb221) | Indexed listing says CC Attribution; not acquired | About 262,700 triangles; advertised Blender source/export options | Reference-only candidate. Far above even the showcase ceiling. Rig/export claims are not tested. |
| [Autorikshaw, bhagathartworks](https://sketchfab.com/3d-models/autorikshaw-indian-tuk-tuk-5775d012693741008acff9dad410e92d) | Indexed listing says CC Attribution | About 8,100 triangles, 3,900 vertices | Slightly above showcase and far above the other tiers. Secondary reference, behind Nirmal.Justin's model. |
| [Quaternius Public Transport Pack](https://quaternius.com/packs/publictransport.html) | Pack says CC0; current QAL discrepancy below | 12 vehicles; FBX, OBJ, Blend; counts unknown | Generic bus/transport reference. Do not label a school bus a molue or BRT without changing its actual body and door layout. |
| [Quaternius Cars Pack](https://quaternius.com/packs/cars.html) | Pack says CC0; current QAL discrepancy below | Eight models; FBX, OBJ, Blend; counts unknown | Generic taxi/private-car comparison. [Poly Pizza bundle](https://poly.pizza/bundle/Cars-Bundle-FE5IWe6OMk) separately lists CC0 and FBX/GLB. Preserve the exact source and license of any acquired version. |
| [Cartoony Purple Motorcycle, AliceCassie](https://poly.pizza/m/j20srJUjpB) | CC0; download control observed | Rounded listing count 1.5k triangles; OBJ/glTF | Closest advertised count to street budget, but 1.5k rounding does not prove <=1,500. Visual review shows a bulky cruiser/chopper shape. A typical commuter okada needs a slimmer frame, different handlebars, passenger seating, and pegs. |
| [Motorcycle, Poly by Google](https://poly.pizza/m/dse64pqMKAR) | Listing says CC Attribution | OBJ/glTF; exact triangles unverified | Additional motorbike candidate. License version, seating, and pivots need inspection. |
| [Bus, Poly by Google](https://poly.pizza/m/4CPpvEmrMoF) | Listing says CC Attribution | OBJ/glTF; exact triangles unverified | Generic bus reference, not verified as a Lagos BRT or molue. |
| [Pickup, Quaternius on Poly Pizza](https://poly.pizza/m/qn4grQgHm8) | Listing says CC0 | Exact triangles and archive contents unverified | Generic pickup candidate, not verified as a Hilux likeness. |
| [Kenney Watercraft Kit](https://kenney.nl/assets/watercraft-kit) | Official pack lists CC0 | Per-vessel triangles unverified | Prefer a coherent kit for generic boats. Exact ferry/canoe coverage and passenger capacity still need inspection. |
| [Quaternius Ships Pack](https://quaternius.com/packs/ships.html) | Pack says CC0; current QAL discrepancy below | Six ships; FBX, OBJ, Blend; counts unknown | Secondary watercraft reference. A ship silhouette does not substitute for a Lagos passenger ferry or a dugout canoe. |
| [Small Airplane, Vojtěch Balák](https://poly.pizza/m/7cvx6ex-xfL) | Listing says CC Attribution | OBJ/glTF; exact triangles unverified | Potential inter-city travel marker. Airliner appearance and the 250-triangle map budget remain unverified. |

No verified free candidate in this research closes the tanker/container-truck, authentic canoe, or complete BRT/molue requirements with proven budgets and animation anchors. Those are explicit gaps, not implied coverage from a pack title.

## People, hair, and environment candidates

Hard avatar triangle ceilings: low 600, medium 2,500, high 25,000. The target is a friendly character about 4.5 heads tall. Counts must include hair, garments, face, hands, accessories, and any extra shadow geometry.

| Candidate and source | License / access | Fit and limitation |
| --- | --- | --- |
| [Quaternius Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html) | Pack page says CC0. It advertises a free subset of 60–70%, with paid Source extras. QAL discrepancy applies. | Six bodies and 20 hairstyles advertised, average 13k triangles, humanoid rig, FBX/glTF. Preview shows sculpted faces and textured-hair silhouettes, but adult/superhero proportions are much taller and more muscular than the Allworld target. Candidate for high-detail authoring/reference, already over medium before treating the average as a guarantee. Exact free hairstyle/body inventory needs inspection. |
| [MakeHuman MPFB2](https://github.com/makehumancommunity/mpfb2) | [License](https://github.com/makehumancommunity/mpfb2/blob/master/LICENSE.md) separates GPLv3 program code from bundled CC0 graphical assets. Maintainers place no restriction on output made from those assets. | Strongest offline human-authoring alternative. Morphs and rigs provide flexibility, but it is not a finished 4.5-head Lagos character pack. Topology, clothing, and export choices determine cost. Community add-ons need their own license checks. No installation or export was performed. |
| [Kenney Blocky Characters](https://kenney.nl/assets/blocky-characters) | CC0; 20 files and animation advertised | Candidate for deliberately blocky NPCs. It does not establish the sculpted face, flexible joints, Nigerian garments, or low-tier count required here. |
| [Adobe Mixamo](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html) | Adobe's FAQ allows royalty-free game use and requires an Adobe ID | Animation/rigging service, not proof of suitable Lagos character art. Commercial game use does not make it a CC0 source asset library. Current workflow, rig output, retargeting, and source redistribution were not tested. |
| [Open Source Afro Hair Library](https://afrohairlibrary.org/), including [Rain](https://afrohairlibrary.org/models/rain/) | Custom [BOSS license](https://afrohairlibrary.org/license/), not CC0 | Valuable Black hair reference and potential integrated-work asset source under its terms. Direct public redistribution and mirroring are restricted; other use restrictions also apply. Rain's displayed `0k` count is not credible budget proof. Keep reference-only for this handoff. |
| [Code My Crown, Dove guide](https://www.unilever.com/files/code-my-crown-dove-unilever-guide.pdf) | Educational resource described by [Unilever/Dove](https://www.unilever.com/brands/beauty-wellbeing/dove/); no separate asset redistribution grant verified | Relevant to hairlines, parts, curl masses, locs, cornrows, twists, and fades. Use as modelling education, not as a blanket license for guide images/sculpts. Full PDF inspection was blocked by the research tool's size limit. |
| [Short Dreadlocks, Tiko](https://sketchfab.com/3d-models/short-dreadlocks-toonlow-poly-style-3a7499eae78f4b58b1c7798f1cbc125a) | Indexed description/metadata disagree on CC0 versus CC Attribution; unresolved | About 46.1k triangles in indexed metadata, over the full high-detail avatar budget before adding a body. Reference-only; not an adoption recommendation. |
| [African Female Base Mesh High Poly Sculpt](https://sketchfab.com/3d-models/african-female-base-mesh-high-poly-sculpt-free-790e9124414a4f54ab02531faf2f74b4) | Indexed creator description says CC0; not acquired | About 2.1 million triangles in indexed metadata. Anatomy reference only, unsuitable as runtime geometry. |
| [Quaternius Downtown City MegaKit](https://quaternius.com/packs/downtowncitymegakit.html) and [Stylized Nature MegaKit](https://quaternius.com/packs/stylizednaturemegakit.html) | Free subsets, paid extras; pack CC0 labels/QAL discrepancy | Useful optional background references. City architecture is generic; nature-pack name does not establish Nigerian species. Both involve textures. Counts and selected free contents remain unverified. |
| [Kenney city kits](https://kenney.nl/assets/city-kit-commercial), [roads](https://kenney.nl/assets/city-kit-roads), and [industrial](https://kenney.nl/assets/city-kit-industrial) | CC0 packs | Coherent modular background candidates if imports become allowed. Local kiosks, compound walls, roofs, signage, and streets still require Lagos-specific work. |
| [Poly Haven](https://polyhaven.com/) | [CC0 asset license](https://polyhaven.com/license) | Useful prop/lighting/material reference. Photorealistic scans, image textures, and HDRIs conflict with the present brief and do not become mobile-friendly merely because they are free. |

Ready Player Me is not shortlisted for adoption. Some official branded pages remain readable, but the research did not verify current root-service operation or current commercial terms. Historical licensing and a live marketing page are insufficient grounds for a new dependency.

No researched free pack proves complete coverage of every existing hair/outfit/accessory ID, all three triangle tiers, the 4.5-head proportions, and the required animation contract. In particular, gele, agbada, buba/wrapper, and recognizable fabric systems remain authored work.

## Licensing findings that affect the decision

The [Kenney support page](https://kenney.nl/support) confirms that its asset-page downloads use CC0 and attribution is optional. CC0 is the clearest fit for freely reusable library assets. [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) also permits commercial adaptation and redistribution, with credit, the license link, and an indication of changes. An asset's exact license still needs to be recorded; platform-wide assumptions are insufficient.

Quaternius's current [QAL v1.0](https://quaternius.com/license.html), dated 28 August 2026, allows use in finished commercial products but prohibits distributing the assets as standalone assets, including modified versions. Several older pack pages still explicitly say CC0. The site says license changes do not apply retroactively. This handoff records the discrepancy without deciding which terms govern an unacquired archive. Preserve its bundled license and acquisition evidence before selecting it. A reusable public model library and an integrated game are different distribution contexts under QAL.

OSAHL's BOSS terms permit use within larger original works while restricting direct asset distribution and specified uses. Its name does not imply CC0 or unrestricted source redistribution. MPFB's bundled graphical assets have a different license from its program code. These distinctions matter more than a marketplace's “free” label.

NC/editorial-only assets are excluded from the commercial-game shortlist. An example is the indexed [Tricycle by kurtcamarines](https://sketchfab.com/3d-models/tricycle-a1bfcae534604c2588dcb49c9598f979), listed CC BY-NC. Assets with omitted or conflicting licenses remain reference-only pending verification.

## Geography research and measured gap

[Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/) explicitly place its vector/raster map data in the public domain. It is a suitable baseline for world/continent outlines, coastlines, and simplified country/state plates. [Admin-1 documentation](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/) warns that administrative divisions and codes can be difficult to keep current.

The actual GeoJSON was fetched and inspected at immutable upstream revision `ca96624a56bd078437bca8184e78163e5039ad19`. The raw file was 40,726,851 bytes with SHA-256 `22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5`. It was processed in memory and not committed.

| Layer | Observed count | Minified country subset, all original properties | Brief requirement | Result |
| --- | --- | --- | --- | --- |
| Nigeria admin-1 | 37 | 234,510 bytes | 36 states + FCT; final chunk <=60,000 bytes | Count matches. Simplification and property removal still required. |
| Kenya admin-1 | 8 | 117,288 bytes | 47 counties; final chunk <=40,000 bytes | Fails coverage: contains former provinces. Do not ship this as counties. |

The Nigeria source spells Nasarawa `Nassarawa` and classifies FCT as `State`. Stable IDs and a reviewed display-name/type mapping are required. Count matching does not validate topology or political accuracy. Nigeria's required structure is also stated by its [National Bureau of Statistics](https://www.nigerianstat.gov.ng/page/about-us/). Kenya's government [county directory](https://kdsp.devolution.go.ke/counties) identifies 47 counties.

Measurements are in `src/models/research/natural-earth-observed.json`. The standard-library probe `src/models/research/audit-natural-earth.py` reproduces the source hash, counts, names, and compact subset sizes. It needs network access, fetches about 41 MB, and has a 90-second overall timeout on this macOS host. Its probe logic was executed during research; no production chunks or geometry were generated.

Other verified data candidates and limitations:

- [geoBoundaries NGA ADM1 metadata](https://www.geoboundaries.org/api/current/gbOpen/NGA/ADM1/) reports 37 units from GRID3, year 2022, under CC BY 4.0. This is not public domain and does not meet the current data-license rule.
- [geoBoundaries KEN ADM1 metadata](https://www.geoboundaries.org/api/current/gbOpen/KEN/ADM1/) reports 47 counties, year 2020, with original-source license `Public Domain` and RCMRD/Africa GeoPortal provenance. This is a promising lead, but its broad source link and the collection's licensing need to be reconciled before declaring the downloadable derivative public domain. [geoBoundaries repository](https://github.com/wmgeolab/geoBoundaries) describes collection-level open licenses. No county boundary binary was inspected or adopted.
- [OurAirports data](https://ourairports.com/data/) is public domain and available as CSV. Filter offline for Nigeria/Kenya, keep identifiers and coordinates, and label it game data rather than current navigation information.
- [Natural Earth rivers](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-rivers-lake-centerlines/) provide named generalized centerlines. Niger/Benue selection, joins, and river-mouth continuity still need a data check.
- [Natural Earth roads](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/roads/) documents basic coverage in North America. It is not evidence of a Nigerian highway network. Its full road binary was not audited.
- [OpenStreetMap](https://www.openstreetmap.org/copyright) uses ODbL, not public domain. It is a possible separately approved route-data source, not a silent substitute under this brief.

For public-domain-only highways, a verified source remains unresolved. An original, explicitly schematic city-to-city route can depict travel, but it must not be presented as a measured highway alignment. Lane counts and bridge placement require finer evidence than a generalized world map.

Natural Earth uses [de facto boundaries](https://www.naturalearthdata.com/about/disputed-boundaries-policy/) by default. The model should preserve provenance and separately represent disputed boundaries. It should not present the source's choice as universal political agreement. Country IDs also need a policy for features without usable ISO codes.

The world <=120 kB, Africa <=80 kB, Nigeria <=60 kB, and Kenya <=40 kB figures remain target budgets, not achieved chunk sizes. A later build must simplify shared borders together to avoid gaps, retain small islands deliberately, verify all IDs, and test picking against reviewed interior points. A geometric centroid alone is not always a safe label/pick point in concave or multipart geography.

## Real-world references for original work

These are factual/visual references, not files to ship or designs to trace.

- [MIT Atlas of Popular Transport: Lagos](https://atlasofpopulartransport.mit.edu/lagos) distinguishes danfo, korope, keke, and formal BRT. It describes danfo capacity up to 18 and keke's local-trip role. The underlying mapped GTFS is described as not publicly accessible; the article is not an open route dataset.
- [Bajaj Nigeria three-wheelers](https://www.bajajauto.com/en-ng/three-wheelers) and [RE specifications](https://www.bajajauto.com/three-wheelers/re/specifications) are manufacturer references for silhouette and dimensions. Match the Nigerian model variant before using numbers from another market. The Nigeria CNG brochure was found but not fully read due to its size.
- [The Met's agbada object](https://www.metmuseum.org/art/collection/search/650308) documents a wide-sleeved outer robe worn over other clothes. Model its volume and sleeve opening; painting a normal shirt does not produce that silhouette.
- [V&A cloth reference](https://www.vam.ac.uk/articles/cloth-of-a-continent-africa-fashion) distinguishes adire resist-dye patterns, ankara printed cloth, and aso-oke strip weaving. The procedural material treatment should preserve those differences rather than use one generic multicolour pattern. Reference images remain outside the shipped library.

The local `RESEARCH-DESIGN.md` section 2 calls for warm skin highlights, readable dark tones, and a fill/rim lighting setup. The model brief expressly forbids real-time shadow maps, so that prohibition takes precedence over the design document's shadow suggestion. Face evaluation needs both darkest/lightest skin, day/night, and the actual host lighting.

## Technical acceptance before any adoption

These checks informed the implementation. The current verification record above distinguishes completed checks from physical-device and host-integration work that remains pending.

1. Record the exact asset URL, creator, file hash, acquired version/date, bundled license, attribution, edits, and redistribution conditions. Confirm which models are actually in a free subset.
2. Inspect the full asset, including child meshes, hidden geometry, material groups, textures, animations, and skeleton. Count triangles after triangulation. Count instanced triangles multiplied by instance count.
3. Produce each required LOD independently. A 4,800-triangle keke can be a showcase candidate while failing map and street. Compression changes transfer/storage cost, not the triangle count of the decoded model.
4. Inspect topology, normals, scale, pivots, seats, doors, wheels, steering, and clothing deformation. Imported skeletons need a deliberate adapter to the existing avatar contract, not a new animation loop.
5. Measure actual render calls/triangles in the host, plus decoded memory, cold download bytes, and frame cost on representative Android hardware. Use [Three.js renderer counters](https://threejs.org/docs/pages/WebGLRenderer.html), with the pinned r180 implementation as the compatibility authority. Marketplace counts are not renderer measurements.
6. Follow [Three.js geometry batching guidance](https://threejs.org/manual/pages/optimize-lots-of-objects.html) and [InstancedMesh documentation](https://threejs.org/docs/pages/InstancedMesh.html). Sharing one material does not merge separate meshes into one draw call. Material groups, transparent passes, and animated parts affect cost. Arbitrary skinned crowds are not made cheap merely by replacing them with `InstancedMesh`.
7. Preserve [render-on-demand](https://threejs.org/manual/pages/rendering-on-demand.html). The host supplies time/progress. Reset every affected transform from its base pose so calling the same time twice, or scrubbing backwards, is deterministic. Avoid allocations in the pose path.
8. Verify [resource disposal](https://threejs.org/manual/pages/how-to-dispose-of-objects.html) for geometry, materials, textures, skeleton resources, and shared ownership. A headless disposal-event test proves ownership bookkeeping; it does not by itself prove that GPU memory is stable in a browser.

[Khronos glTF guidance](https://www.khronos.org/gltf/) is relevant if model files become permitted. glTF is a delivery format, not a budget guarantee. Image texture compression and imported animation are outside the current procedural-only scope.

There is also an API distinction in the brief: the common new builder wrapper returns `{ object3D, userData }`, but the existing `buildAvatar(kit, look, options)` returns a `THREE.Group` whose `userData` owns `parts`, `top`, and `dispose`. Preserve the legacy return shape for the drop-in function; expose a separately named wrapper if needed. Do not silently wrap the legacy return value.
