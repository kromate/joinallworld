# Mapped driving actor and boarding handoff

Source-only audit at candidate `615638dcb98c7dd5746bc7a5bc44d6a31a8ea4fd`, 9 October 2026. Luna driving inspected the published isolated source; Sol checked the anchors and contact API. No local pose/contact rendering or continuous actor-volume verification occurred. The mapped route remains disabled.

The sedan has source-derived conservative horizontal body/wheel and rotating-door bounds. Those do not prove actor clearance. The current depot diagnostic labels its actor radius0.8m and height2.1m as assumptions, and marks actor integration unverified. Retain those qualifications.

`DrivingScene` places the approach center1.5m outward from the closed door anchor, a threshold0.2m outward, and a provisional exit slide0.6m outward before standing. It opens the door while the actor is at the approach. The door sweep radius is approximately0.95m around its hinge, leaving roughly0.6m of center clearance before accounting for the actor; this is a reason to verify contact, not proof of an actual collision. It uses neither `sampleFootContacts()` nor `solveFeet()`.

The body manifest supplies hashes, nominal heights, bone/triangle counts and clip names. It supplies no animated or clothing-inclusive collision envelope. Skinned appearance changes height/width/depth; the fallback avatar has a separate procedural rig. A shared contract must cover both implementations, relevant driving poses, allowed proportions and wearables. Foot-contact samples support floor correction; they do not establish whole-body clearance or continuous motion by themselves.

The fictional depot apron is authored flat gameplay support, distinguished from surveyed terrain. Its coarse street ground mask indicates support presence, not continuous height. Do not turn a clear diagnostic into live route authority.

## Published diagnostic review — 9 October 2026, 07:43 UTC

GRAPHICS published8fdb1407fdcaa6813a1314d98bc2403c01348514 (`codex/graphics-actor-sampler-v5`), helper `evidence/graphics-loop/actor-volume-boarding-slice-v5/sample-actor-geometry.ts`. Root verified actualCI37899816419 SUCCESS at that exactSHA. Earlier preparation text saying unrun is historical. GRAPHICS reports5/5 actual production GLB/appearance/walk/wardrobe and independent parent-to-world sole checks; Sol/Luna source review confirms useful instantaneous geometry shape, without runtime integration or swept/seat clearance.

Adapter gaps: immutable identity binds only root matrix and may be reused after same-root pose/look changes; mint a same-turn pose/look/phase generation and evaluated bone/matrix snapshot. Shader SHA/cache-key inputs are host assertions; bind a private trusted registry to actual reviewed production callbacks/source. Wire actual FootContact body.parent frame (the helper accepts a supplied frame), require sole state ready separately from geometry ready, and bound vertex/triangle/time work with event-bound sampling. Entry/sit/exit/easing and fallback coverage remain missing. Graphics acknowledged these gaps and keeps source ownership; shared controller interface discussion precedes copying anything into runtime. canBoard and route authority remain false.

## Exclusive work and acceptance

GRAPHICS confirmed no published envelope/boarding/contact contract. As of 2026-10-09T16:34Z, verified PR23 is CLOSED/unmerged at0595b599371f4b93663a00754af2ae1e25d2a116, standing-foot support only; dirty primary contact work is not a reusable published contract. Primary dirty body/assets/scene work is preserved. Integration alone assembles shared runtime; LIVING owns queued physical journey authority and independent review, WORLD uploads.

1. Pin actor/vehicle/clip/appearance sources and derive conservative volume bounds covering both render paths and transitions; distinguish analytic proof from samples and visualization.
2. Check continuous boarding/exit paths against door motion, shell, authored doorway/cabin allowance and static map obstacles. Intended ingress needs an explicit allowance, not global collision disabling.
3. Establish foot/wheel support throughout transitions and depot-to-road movement; retain the authored-versus-surveyed distinction.
4. Integrate the actual controller, collision/yield rules and server-authoritative movement with durable finite fleet custody. Stale identity, invalid input or unsupported route evidence cannot allocate or reward.
5. Verify keyboard/touch, reduced motion, reload/interruption and both actor paths on exact candidate desktop/mobile staging, then retain actual contact/performance evidence before enabling delivery.

## Audited Git blobs

| File | Git blob |
| --- | --- |
| src/app/features/living-world/drivingScene.ts | a543cf063c60e5c2bf9ac8b0bbdb1f4989edaa95 |
| src/game/living-world/depot-motion.ts | 1bc8f088ae9e68ce340953440dad353a3fea4c4e |
| src/scene/avatar-rig.ts | 3addc44d06730090d161114168c07213e14510a3 |
| src/scene/body/foot-contact.ts | a857659c3e47409f645d66f3f1d0149944b8f497 |
| src/scene/body/manifest.ts | 006cd81679ff99ffd791e70706dc755e0e44e1df |
| src/scene/body/skinned.ts | 18cad15794eea659368315e15323949b2255d5ce |
| src/scene/body/stand-in.ts | 32aa468b98d43696abd8ab6cbae3a723d9ac5f40 |
