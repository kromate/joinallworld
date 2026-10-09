# Native action pose slice

This is a geometry-only action controller for the authored 52-bone model. It adds deterministic host-sampled `sit`, `interact`, `cook`, `eat`, and `drink` poses alongside the frozen native `idle` and `walk` controller. Unsupported pose names and missing seat/floor inputs throw. It creates no animation loop and changes only the actor's bone transforms.

For idle and walk, the controller measures the actual skinned body and clothing torso envelope at actor setup, then moves each wrist target beyond that side envelope. Clearance defaults to 30% of the measured torso width at wrist height. This directly addresses the female body morph widening the torso over the source hanging-arm path. In the pinned casual outfit, the fraction of arm-weighted surface vertices outside the same-height lateral torso envelope changed from 44.2%/45.9% at a fixed 2.5cm clearance to 91.4%/98.3% with the adaptive target for the woman. During walk it measured 90.9%/98.9%. The man measured 100% on both sides in idle and walk. These are geometric silhouette proxies; they do not prove there is no triangle intersection or that rendered arms look natural. The changed pose needs visual review.

The sit pose uses the supplied seat top and floor height, keeps the pelvis 10cm above the seat, solves each leg toward the floor, and flattens the foot along the actor's measured forward axis. Sole offsets come from actual deformed Body vertices weighted to the foot and toe bones. After a measured 0.2mm calibration adjustment, the pinned male and female sole minima were -0.67mm and -0.92mm against a zero floor. The whole skinned mesh bounds had the same minima. Hand-to-knee is not anatomically reachable for this rig at the tested seat height: the hands remain 38–40cm from the knee landmarks. The candidate therefore rests hands at proximal-thigh landmarks instead; nearest torso/thigh support vertices are 5.2–8.7cm away. It does not claim hands-to-knees contact.

`interact` reaches with the right hand, `cook` brings both hands forward at waist height, and `eat`/`drink` bring the right hand toward a head-relative mouth landmark. These are measured pose targets, not task choreography, object attachment, or user-facing semantics. Walk remains in-place and does not include root motion or foot travel.

The focused CPU probe loaded the pinned authored body, real casual suit/hair presentation, and cloned actors for both body families. It checked all skinned body/clothing vertices for finiteness across seven poses, verified foot/toe support within 1mm while seated, checked lap target proximity and the female arm envelope, and confirmed the source skeleton and body geometry remain unchanged. It passed with:

```sh
node --max-old-space-size=48 --experimental-strip-types evidence/graphics-loop/authored-complete-body-v1/native-actions-check.mjs
```

The probe now uses the face-preserving body asset `parametric-base-facial.glb` (2,802,528 bytes, SHA-256 `9a2ff742bff609ad16219cfc7f2bbca03ac834305c595def364add6ee57c01cd`).

The check does not render pixels, test prop or chair collisions, or establish coverage for other outfits, hairstyles, accessories, body options, or procedural fallback actors. Rendered review is still required before using the adaptive arm posture or sit pose.

Source pins for this result:

- `native-actions.ts`: `2c98247435c78f2b8b44b4e8a2698b8b7538df1196a04c4f816b17cd4ad3b6b3`
- `native-actions-check.mjs`: `95804cc3d814e38356f595c8224b7f10c9cd70a7a507e2eb14c375eb7c2e7be9`
- Frozen `native-pose.ts`: `7683d45bf454987a49705bb4c23ee79b00541403cb3dd69b32a532c0d2307fb1`
- `authored-presentation.ts`: `987672ce92babf0b91432a5dc49ba88d7d53f32dfab3a9bc776e9557c3260ea4`
- Test output: `2c2a36de7d086d5bd47a37559eedeadfc742808fdfd28860524e65632b9aa4be`
