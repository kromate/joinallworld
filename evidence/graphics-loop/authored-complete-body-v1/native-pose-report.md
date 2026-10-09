# Native-rig pose probe

This prototype replaces old-rig quaternion transfer with rotations derived from the authored character's own joint positions. The inspected v6 rendered comparison (`downloaded-37949817985/.../woman-idle-front.png` and `woman-walk-profile.png`) shows the authored model's arms spread forward/outward; the old clip-pack retarget is not a usable posture source. This probe does not use that retarget.

`native-pose.ts` captures bone transforms only, measures lateral direction from the authored shoulders and forward direction from its toe bases, then aims upper-arm/forearm and thigh/calf segments at constrained directions. The clavicle/shoulder segment remains in its authored rest pose. `apply(seconds, 'idle'|'walk')` is deterministic and host-driven; it creates no mixer, clock, or render loop and returns joint metrics without scanning the mesh. `measure()` is a separate full-body vertex scan for diagnostics. Root position, rotation, and scale remain caller-owned. The hand and finger joint rests are unchanged. `restore()`/`dispose()` restore captured bone transforms only.

The bounded GLTFLoader check invokes `Skeleton.pose()` on actor clones first, applies each family's existing body morph, and measures actual `Body.getVertexPosition()` skinning bounds along with hand/shoulder/head/hip/foot joint positions. It verifies the source GLB stays immutable. Run it with:

```sh
node --max-old-space-size=32 --experimental-strip-types evidence/graphics-loop/authored-complete-body-v1/native-pose-check.mjs
```

It passed on the pinned 2,692,984-byte authored GLB (`0152129ce2c6022911747f9d7a6df3fdb72a9e6e1bea73db414da1cb8f483077`). Native rest body minimum Y measured `-0.00037` (male) and `0.000015` (female); sampled constrained-walk body minimum Y ranged `-0.00532..0.00018` and `-0.00087..0.00472`, respectively. In rest, the left/right hands were about `0.430/-0.432` model units from the hips on X; the candidate idle rotation brings them to `0.200/-0.200`, with hands about `0.489` below their shoulders. The checker also changes root position/rotation/scale before posing and confirms the controller preserves those caller transforms. These are CPU geometry/joint measurements, not pixel or contact acceptance.

Limitations: the walk is a simple in-place leg/arm direction cycle, not a recovered animation clip. It has no root travel, foot IK, seated/reach/use/door poses, finger articulation, or visual naturalness evidence. Feet remain close to the model-space floor in sampled phases, but a host still needs its actual surface solver. This is a bounded native-rest/idle/stride hypothesis for parent rendering review, not production-ready animation.
