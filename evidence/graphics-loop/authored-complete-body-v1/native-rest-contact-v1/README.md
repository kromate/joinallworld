# Native prop-backed resting contact prototype

This folder contains an isolated contact-measurement helper and a prepared-GLB review fixture. It does not wire the experimental factory into the game.

The host must resolve the active furniture before requesting a pose and provide a query against that prop's actual surface geometry. The 3af home scene currently requests `body.show(next, animate)` before it calls `sitOn`/`workOn`; a callback that reads only the runtime's previous stored placement cannot identify the bed, tub, or shower for the first sample. The later scene integration must register the explicit prop before sampling, then resample after moving the actor to its final anchor.

The helper caches bounded samples from the currently visible indexed body/outfit meshes, partitions them by actual skin influence, and keeps only posterior-facing samples for the pelvis, torso, and head. At sample time it evaluates the real deformed vertices against the host's prop-specific world-space height query. It also checks the actual shoe sole points and, for showers, the actual head position against a host-provided water-zone query.

The provisional support conditions are deliberately conservative:

- Lie requires posterior pelvis and torso points near a bed/mat surface, with no sampled body or shoe penetration over 4 mm.
- Soak requires posterior pelvis and both shoe regions near the tub's actual interior support surface, with no sampled penetration over 4 mm.
- Wash requires a shower surface query, the head inside the host's shower zone, both shoe regions sampled on the shower floor, and no sampled penetration over 4 mm.

These measurements only establish sampled contact witnesses. They do not prove whole-mesh nonpenetration, natural transitions, clothing clearance, water interaction, or gameplay acceptance. The actual `sleep`, `soak-wash`, and `shower-wash` clips still require a bounded remote CPU check and matched GPU review before the runtime may advertise these poses.

## Prepared-body review fixture

`home-rest-props.ts` reconstructs the contact-bearing meshes from the pinned 3af17a0 `home-scene.ts` SHAPES definitions: 1×2 bed and sleeping mat, 2×1 tub, and 1×1 shower. Each support query raycasts only its named visible source mesh. The tub query targets the basin base, and the shower head-zone is the vertical spray column derived from the source showerhead bounds. Props share the actor's transformed parent so queries exercise world/parent conversion.

Build the production prepared-factory bundle first, then build `rest-contact-review.ts` with `bundle-rest-contact-review.mjs`. Serve `rest-contact-review.html` from the repository root. The controls cover both prepared families, all 15 `BodyPose` values, bed/mat/tub/shower, source-loop sampling, entry/exit, and four camera yaws. `window.restContactReview` exposes `ready`, `snapshot()`, `pose()`, `prop()`, `yaw()`, `loop()`, `exit()`, and `family()` for deterministic remote review.

`render-rest-contact-review.mjs` verifies the same five 3af source hashes and five prepared asset hashes before driving the fixture through headless Chromium/SwiftShader. Each family is rebuilt from the pinned GLBs, then idle and each bed/mat/tub/shower entry, loop, two views, exit, and missing-support rollback are captured. It treats contact-rule failure, browser exceptions, and failed network requests as failures. Run it only after bundling, under the project’s bounded remote renderer runner; it writes screenshots and a JSON receipt to `remote-results/<run-id>/`. The runner is prepared but has not yet been executed.

`native-rest-15-pose-check.mjs` checks all 15 source pose calls for both actual prepared GLBs, then checks rest entry, still/loop sampling, exit, and missing-prop rollback against the four actual prop meshes. It intentionally fails on unsupported clips/contact rather than treating them as success. Its five source hashes are checked against exact Git blobs at `3af17a01b8bd406bfb830ca0d2ee66d2d0093d28`; all five were independently recomputed. Run after `bundle-prepared-factory.mjs` under the repository's remote resource guard. A passing CPU result still needs matched browser pixels and host integration review.
