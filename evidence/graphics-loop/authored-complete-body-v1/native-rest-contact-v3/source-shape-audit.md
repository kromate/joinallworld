# Native rest V3 source-shape audit

This is a new fixture revision. V1 and frozen V2 remain unchanged. V3 corrects the fixture's home-unit transforms and the four rest-use anchors against the pinned 3af home source; it does not change factory/runtime contact rules.

## Source contract

`home-scene.ts` uses `ROOM=10` and `tile=ROOM/grid`. The default home grid is 12, so furniture geometry is multiplied by `10/12`. The actor is separately fitted to `tile * AVATAR_SCALE` (`AVATAR_SCALE=.72`), so the test fixture actor scale is `.6` before its deliberately transformed parent. V1 used unscaled prop geometry and actor scale `.72`, exaggerating both by 20% relative to the props and 20% relative to the actor's intended home scale.

The non-wall item's origin is `mountOf(...).y = lift(floor)+.015`; its geometry gets uniform `tile` scale and Y rotation `-item.rot*PI/2`. V3's source shapes remain the exact home-scene dimensions in tile units, while the fixture group now applies that scale and mount-height offset. The chair seat is therefore at `.015 + .38*tile + .03*tile = .015 + .41*tile`.

The authored use anchors come from `seatOf` and `seatFor`, then convert tile units to scene units:

| Prop | Source actor anchor (relative to item center) | Actor facing |
| --- | --- | --- |
| Bed | x=0, y=`.015+.56*tile`, z=`(.64−2*.38)*tile` | 0 |
| Mat | x=0, y=`.015+.08*tile`, z=`(.64−2*.36)*tile` | 0 |
| Tub | x=`W*.2*tile`, y=`.015+.1*tile`, z=0 | `−PI/2` |
| Shower | x=`−.05*tile`, y=`.03+.08*tile`, z=`−.05*tile` | 0 |

The runtime callback resolves only the currently registered `nativeRestAt` item and requires the pose/shape pair to match. It raycasts the furniture batch within a prop-specific vertical range: `mount.y−.02*tile` to `mount.y + {.65 bed, .15 mat, .15 tub, .1 shower}*tile`, and filters hits back to that item id. The fixture instead uses isolated meshes for each support shape, so mesh ownership is explicit by construction; V3 applies the same vertical interval before returning a hit. This remains a mesh mirror, not the full furniture batch or item-grid lookup.

For shower spray, source transforms the tested world point back into the home group, normalizes by tile, rotates into the item's local frame, then checks `abs(x+.2)<=.2`, `abs(z+.2)<=.2`, and `SHOWER_HEAD−.65<=y<=SHOWER_HEAD+.02`. V3 applies the fixture group's inverse world transform, which performs the same item-local rotation/scale conversion, and uses the same bounds. This fixes V1's world AABB around the showerhead; rotated-shower behavior is still a source-contract check, not a rendered water interaction test.

## Exact provenance and limits

The source files are pinned to 3af17a01b8bd406bfb830ca0d2ee66d2d0093d28:

- `src/scene/home-scene.ts`: `31a744babf552bc4bcfdac00e23b59f23ed363ed7f2f94dbd06da5e8b4bcb47d`
- `src/game/content/furniture.ts`: `ca0fd127c340e7d10bc493020b83c87dcf09ee23ecdbfe2a6756109753bd04d5`

V3 files:

- `home-rest-props.ts`: `3c6c9ae72e06e0b55a554fb53283468d47eaa346c715efafb6c6c01aa96e7911` (7,501 bytes)
- `rest-contact-review.ts`: `d166e8402afcca09c26d23a85f0a509e9cd10e19419a056363db486f8b9b88db` (15,274 bytes)
- `native-rest-15-pose-check.mjs`: `26f2f520c7a839d74195ddfd9186a00657e0376822468d752587f6712d67e3cf` (14,236 bytes)

Only `node --check native-rest-15-pose-check.mjs` has run for V3. The remote build, both-family actual-GLB 15-pose check, and remote render remain required. A CPU/renderer pass would not establish full-body collision, natural contact, or production home integration.
