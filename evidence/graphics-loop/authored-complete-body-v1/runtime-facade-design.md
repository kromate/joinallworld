# Authored actor runtime facade

This is a private integration prototype, not a replacement for `SkinnedBody` and not a gameplay rollout. It narrows the new native actor to operations that already have a concrete implementation and makes every missing capability explicit.

## Boundary

`assessAuthoredLook()` is the shared pre-load selector for creator, player, and NPC callers. It normalizes the request once and returns either the exact canonical look or a reasoned rejection. The caller keeps the current runtime on rejection; the function never removes unsupported fields or substitutes another identity. `createAuthoredRuntimeFacade()` then receives an already prepared `CompleteCharacter`, its per-actor `NativeActionController`, the same exact look-capability check, and optional same-actor look-update hooks. It does not load GLBs, create caches, or add a second animation or render loop. Ownership transfers only when construction returns `{ ok: true }`; a capability rejection leaves the existing runtime and supplied components untouched. On success, the facade registers idempotent cleanup with `Kit.onDispose()` and owns the prepared actor/action/presentation resources. A Kit that was already disposed immediately releases the candidate and construction rejects.

The returned `object` is a placement wrapper around the native actor. During facade creation, it samples a standing pose once and captures the complete skinned actor's root-local height. `fitToHeight()` reuses that cached measurement, so later fits are independent of a seated pose, parent transforms, or the wrapper's current rotation/scale. It does not depend on the legacy body manifest. `place()` writes only the wrapper transform, so action sampling does not overwrite world placement. The facade exposes the actual posed head/hand `Bone` objects in `bones` and adds zero-transform `Head`, `hand_l`, and `hand_r` locator children in `aliases`. The locators preserve name-based world-position lookup; they are not replacement bones and consumers that rotate or retarget gaze must use `bones.head`.

## Supported behavior

| Capability | Facade behavior |
|---|---|
| `idle`, `walk`, `sit`, `interact`, `cook`, `eat`, `drink` | Host calls `sample(seconds, pose, support)`; the native action controller samples synchronously. `sit` requires finite seat top and floor values; other supported poses require floor support. |
| Expression | `setExpression()` delegates to the complete rig's retained morph controls. Same-look identity updates also set the normalized expression after the look bridge commits. |
| Skin, face/body shape, hair, outfit, accessories, wearables | A complete look-support callback validates every requested field against the prepared actor. Mutations require a transactional `lookBridge`; without one, look changes reject without changing the current look. Expression can still be sampled through the rig's explicit expression API. |
| Body-family change | Returns `body-family-change-requires-reload`; caller can keep the current actor visible while preparing the replacement. |
| Placement and scale | Wrapper-local placement and measured-bound fitting; no legacy dimensions or animation-owned root transforms. |
| Disposal | Repeated `dispose()` is safe. It unregisters the Kit callback, disposes actor-private actions/presentation, then the actor, leaving shared Kit templates to Kit ownership. |

`dance` is intentionally not included: the current complete rig's dance path is a transferred clip, while the facade is scoped to the verified native-action controller. `jog`, `lie`, `soak`, `wash`, `bucket`, `cookLow`, `homeDoor`, stairs, and all entry/exit transitions return `unsupported-pose`. The caller must keep the current canonical actor/runtime when a requested capability is missing; silently substituting idle would misrepresent the action.

## Look transaction

The prepared actor is family-specific and has its initial face/body morphs fixed at load time. The exact prepared look is checked against both `CompleteCharacter.metrics.unsupportedAppearance` and the injected `unsupportedLookFields()` capability function. A rejected initial look is not mounted. A same-family change runs the capability check before `applyLook`; no fields are dropped to make a request fit. The bridge must apply atomically and throw only before mutation. The rig then applies the normalized expression. A family change requests a replacement actor rather than mutating family identity in place.

The current presentation implementation only proves the pinned casual suit and two pinned hair assets. It does not yet provide a general transactional `lookBridge`; therefore same-actor outfit/hair/accessory changes are not enabled by this facade alone. The producer must also supply exact look capabilities from the actual presentation result, rather than a hard-coded “supported” label.

## Bounded CPU check

`runtime-facade-check.mjs` loads the SHA-pinned authored body and clip-pack GLBs, constructs actual male and female complete actors, and exercises the facade with the native action controller. It checks same-actor alias/bone references, repeated fit under parent/wrapper transforms, invalid support veto before pose mutation, explicit unsupported pose/look behavior, independent skeleton/expression state, and disposal by a live or already-closed Kit. Run with:

```sh
node --max-old-space-size=48 --experimental-strip-types evidence/graphics-loop/authored-complete-body-v1/runtime-facade-check.mjs
```

The run measured the standing actor-local heights at 1.694 m (male) and 1.558 m (female); repeating each 1.8 m fit under transformed wrapper and parent returned the same factor exactly. This is an image-free CPU geometry/lifecycle check. It does not prove rendered pose quality, mobile cost, outfit/hair switching, or gameplay integration. Output is recorded in `runtime-facade-check-result.json`.

## Remaining integration gates

- The facade deliberately does not implement the full `SkinnedBody` surface. Existing scenes additionally require transition/easing, timed use clips, stairs, seated/work anchors, foot-contact sampling and solver behavior, wardrobe presentation modes, and same-family `wear()` semantics.
- The current action controller has measured sit/use poses but does not establish semantic parity for all venue/home actions. Each action needs rendered body-and-clothing review and anchor/contact evidence.
- The old aliases cover only `Head` and the two hand names currently queried by scene callers. They do not recreate the legacy skeleton for wardrobe or foot-contact code. Those systems need explicit authored-rig adapters.
- Creator, player, NPC, peer, and fallback integration still needs to call the shared selector and retain the current visible runtime on rejection or load failure. This file does not change the gate, imports, assets, or production routing.
- Full look coverage, all-age appearance, garment switching, female outfit coverage, phone/device budgets, and route-level identity parity remain unverified.
