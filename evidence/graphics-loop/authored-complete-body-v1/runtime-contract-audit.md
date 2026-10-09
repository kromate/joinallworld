# Runtime contract audit: authored complete body

This is a source audit only. It does not establish creator, wardrobe, or gameplay parity for the authored model.

## Existing `SkinnedBody` contract

`src/scene/body/skinned.ts:55-104` exposes the object, family key, scene scale and stride scale; wardrobe metrics/errors; presentation switching; foot-contact sampling and solving; pose/easing/seated state; still/use/entry animation controls; placement, seat/work anchors, fit, same-family look updates, and disposal.

| Capability | Existing API | What callers rely on |
|---|---|---|
| Identity and clothing | `key`, `wear(look, seed)`, `wardrobe`, `wardrobeError`, `setPresentation()` | `wear()` updates a same-family look and returns `false` when the other body file is needed. Presentation is `everyday`, `bathing`, or `sleeping`. Outfit, fabric, colors, face shape, expression, proportions/appearance, accessories, and wearables flow through look normalization and the wardrobe/appearance controllers. |
| Static and continuous poses | `show(pose, animate?)`, `sampleUse(pose, seconds)`, `stride(phase, jog, climb?)` | `show` selects a still pose or starts a supported transition; `sampleUse` samples a time-bounded use loop; `stride` is driven by the host's walk phase and optional stair/ramp direction. |
| Transition lifecycle | `easing`, `step(dt)`, `settle()`, `enter(animate)` | Host loops advance only while easing. Callers can settle transitions when motion stops or an actor leaves. The body does not run its own frame loop. |
| Spatial/contact | `place`, `sitOn`, `workOn`, `fit`, `sampleFootContacts`, `solveFeet` | Supports standing, seat/bed/tub placement, object-use anchors, scene scaling, and standing foot contact against a host-supplied surface. |
| Ownership | `object`, `dispose()` | The caller mounts the object and disposes the per-actor body. Shared model/clip resources are Kit-owned and released with Kit teardown. |

`BodyPose` in `src/scene/body/poses.ts:6-20` has 15 values: `idle`, `walk`, `jog`, `sit`, `interact`, `dance`, `lie`, `soak`, `wash`, `bucket`, `cook`, `cookLow`, `eat`, `drink`, and `homeDoor`. The clip contract includes idle/walk/jog/dance, sit-enter/sit/sit-exit, sleep/lie-down/get-up, soak/wash/bucket, cook/cook-low/eat/drink and their entry/exit clips, home-door/door, and stairs-up/down. Female-specific work clips are also present in `BODY_MANIFEST` (`src/scene/body/manifest.ts:48-112`).

The normalized `Look` contract in `src/scene/avatar-look.ts` includes body family; hair and hair color; outfit, fabric, outfit and bottoms colors; skin; accessories; face (`oval|round|long`); expression (`smile|neutral|grin`); and optional wearables and appearance. Appearance includes height/build and age appearance. The existing renderer changes geometry for face/expression and proportions, not only material color (`src/scene/body/appearance.ts`).

## Authored prototype gaps

`evidence/graphics-loop/authored-complete-body-v1/rig.ts:9-42` exposes `CompleteCharacter` with only `object`, metrics, `sample(seconds, pose)`, `setExpression()`, and `dispose()`. Its pose type is only `idle|walk|dance`. It has no `show`, timed transition/use API, placement or scale methods, contact samples/solver, same-instance `wear`, or presentation API. Replacing `loadBody()` with this return type would therefore break established callers.

The retarget map at `rig.ts:52-75` maps the legacy 23-bone rig into the authored 52-joint skeleton. It maps the 22 articulated legacy bones, but none of the 30 authored finger joints (three joints for each finger on each hand) have source clip tracks. Hands retain authored/rest finger poses. The prototype currently generates retargeted clips only for idle, walk, and dance (`rig.ts:224-303`); seated, lie/sleep, interact/wave, work, eating/drinking, washing, door, and stair clips remain unsupported. It also reports non-adult age appearance as unsupported (`rig.ts:141-162`).

The current authored presentation path is narrower than the look contract: `authored-presentation.ts:10-20` supports a casual suit bake and two hair assets (short02 and afro01). It is not a general replacement for legacy wardrobe resolution. Existing wardrobe, appearance, facial-detail, and foot-contact code expects the legacy body attributes, materials, and bone names. For example, `src/scene/wardrobe/geometry.ts:40-55` and `src/scene/body/foot-contact.ts` look up bones such as `pelvis`, `neck_01`, `Head`, `thigh_l`, `calf_l`, and `foot_l`; the authored rig uses Mixamo names and needs an explicit compatibility map. The existing face appearance/detail path also depends on legacy region/color and atlas attributes, so authored face morphs cannot be assumed to satisfy it.

## Callers and required parity

| Caller | Current use | Required authored adapter behavior |
|---|---|---|
| `src/scene/avatar-preview.ts:210-229` | Lazy body load after eligibility; look changes can require a family reload; pending/failure state remains visible. | Preserve async cancellation/generation checks, pending appearance identity, family swap behavior, and the same return contract. Do not import authored assets before the existing gate. |
| `src/scene/body/stand-in.ts:88-189` | Venue player attach/detach, `fit`, `show`, `place`/`sitOn`, `stride`, `step`, `settle`, and standing contact solve. | Preserve host-driven frames, actor disposal on detach, no internal render loop, head/tag anchor access, and safe fallback. Authored head naming and contact-bone mapping need explicit support. |
| `src/scene/home-scene.ts:587-652, 1207-1218` | Home self load/look updates, room fit, movement, door entry/use, seats/bed/tub, cooking/work anchors, stairs, transitions and foot contacts. Door interaction reads `hand_r` (`:620-626`). | Full compatibility requires all applicable home/use/transition/stair poses, interaction hand anchor, seated placement, and contact behavior. Current three-clip prototype is insufficient. |
| `src/scene/home-scene.ts:408-424` | Canonical home guests load by their own look/seed and start idle. | Keep exact per-guest identity, isolated skeleton/morph/material state, and Kit lifetime. |
| `src/scene/venue-scenes.ts:425-470, 779-819` | Shared canonical loader for authored NPCs, peers, and local people; maps stand/relax/sit/walk/jog/wave/work/dance; gaze uses `Head`. | Preserve each descriptor's look/seed, seated anchors, independent phase/pose, gaze/tag anchors, and stable ID/spots. `interact` currently stands in for wave/work; that semantic remains until new clips are mapped. |

The existing lazy/fallback boundary is `src/scene/body/gate.ts:1-43`: `bodyAllowed()` rejects Data Saver, 2G, and low-tier device signals; `drawsWebGL2()` is required; only `importBody()` dynamically imports the body module. Load/parse failure leaves the procedural avatar available. Keep this as the sole entry point so authored geometry, loader, and decoder do not increase fresh startup bytes. Shared templates and clips stay owned by `Kit`; every actor still needs independent skeleton, morph influences, material uniforms, wardrobe geometry, animation state, and disposal.

## Smallest safe integration route

1. Keep `loadBody(kit, look, seed, sceneScale): Promise<SkinnedBody>` as the scene-facing boundary. Put the authored loader/adapter behind the existing `importBody()` gate and add a Kit-owned, deduplicated template/clip cache; do not make scenes import the GLB directly.
2. Implement a compatibility facade before migrating callers. It must cover the `SkinnedBody` operations listed above, or migrate a capability interface and all callers together. Provide explicit old-bone aliases for tags, gaze, door hand anchors, wardrobe and contacts; do not rely on renamed bones happening to work.
3. Make look changes transactional. Same-family look changes must update shape, face/expression, materials, hair and outfit on the same actor without sharing mutable state. Family changes must preserve the current body until the replacement is ready, then dispose it exactly once. Kit teardown must cancel late loads and release shared resources.
4. Define and verify pose coverage before venue/home rollout. A first narrow experiment may compare creator plus standing idle/walk on self and one NPC, but it is not full integration. Home seats, door/work anchors, use loops, stairs, venue sit/wave/dance, and finger gestures remain separate gates until actual mapped clips and anchors are tested.

The current strongest integration risk is not just missing clips: wardrobe and contact code consume the old mesh's named bones and source attributes. Preserve the procedural fallback through the gate for unsupported devices or failed loads, but do not present it as appearance parity with the authored model.
