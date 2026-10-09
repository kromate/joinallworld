# Native hand pose check

This is an ignored, source-derived CPU prototype. It does not change production files and has not been visually reviewed.

`native-hand-pose.ts` discovers the authored 30 finger bones (five digits, three joints per hand) and captures their rest quaternions for one actor. It builds each flexion axis from that actor's current wrist, knuckle and palm layout, then applies relaxed, walk or grip angles after the host has sampled the body/action pose. The palm anchor is an affine blend of the four-knuckle average and wrist, measured in actor-local coordinates; it does not depend on world origin. It changes finger joints only; it does not create a clock, animation mixer, render loop or mutate shared template geometry. The values are deterministic and shared by both body families. Walk adds a small phase pulse; grip curls the fingertips toward the measured palm anchor.

The check used the pinned authored facial GLB (`9a2ff742…57c01cd`) and clip pack (`89a2c636…fd3d47`), loaded both male and female actors with the real loader, and evaluated the actual skinned vertices. It checked all 30 joints, finite body bounds, 3,330 vertices with finger weights, changes to those vertices under relaxed/grip poses, decreasing fingertip-to-palm distance in grip, walk phase changes, nonidentity actor transform preservation, independent actors, and cleanup. Run with:

```sh
node --max-old-space-size=48 --experimental-strip-types evidence/graphics-loop/authored-complete-body-v1/native-hand-pose-check.mjs
```

| Family | Maximum relaxed joint delta | Maximum grip joint delta | Mean palm gap, relaxed (L/R) | Mean palm gap, grip (L/R) | Max weighted-skin vertex delta, idle→relaxed / relaxed→grip |
| --- | ---: | ---: | --- | --- | ---: |
| Man | 0.18 rad | 0.94 rad | 0.0875 / 0.0875 | 0.0677 / 0.0677 | 0.058 / 0.218 m |
| Woman | 0.18 rad | 0.94 rad | 0.0875 / 0.0875 | 0.0677 / 0.0677 | 0.053 / 0.192 m |

The check also applies the same pose with a translated and rotated parent, then without that transform. Local finger quaternions and actor-local palm gaps match within `1e-8` for both families. The hand pose angles are provisional. These numbers establish that the authored finger chains and weighted skin move coherently at the CPU level; they do not establish naturalness, an object grip, hand contact, animation quality, mobile performance or production suitability. Rendered checks still need front/side views for relaxed idle, walk and a held prop, both families and several hand sizes.

The current seated hand target is derived from the hips, with a fixed forward/up/lateral offset. That can leave hands on the abdomen. A useful comparison candidate should instead project each hand target to the closest point on the same-side thigh surface in the evaluated seated pose. Build that surface from triangles whose source vertices have meaningful weight on the corresponding upper-leg/leg bones, compute the closest point on triangles (not only sampled vertices), and then check arm reach, hand-to-thigh clearance and body/clothing intersections. Compare both candidate targets at the same seat height and pose, for both body families. This report does not alter `native-actions.ts`, and no lap-contact result has been measured.

## Frozen files

- Controller SHA-256: `707be8939d756c9d1a214b8f63c73d201eac69d94b84c90a4f6c41eb0bfe0b64`
- Check SHA-256: `0ae04f5a34103f6439721ac50113e72a8bea9390561609910419dac0dbbedef7`
- Result SHA-256: `0d404ab2e965a9de38e96b13854b753ffe9e42cb302d439377174b601372f96d`
