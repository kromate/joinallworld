# Native game adoption packet compatibility report

Generated against project HEAD `3af17a01b8bd406bfb830ca0d2ee66d2d0093d28` plus the exact working-tree source bytes listed in `package-manifest.json`. This packet is source-only and staged under `owned-src/`; it does not modify existing project source, package dependencies, queues, or hosts. The prepared runtime is V31 CPUchecks pass; whole real-game review pending and is not release accepted. No build or typecheck was run.

## Compatibility evidence

- Existing legacy entry point: `src/scene/body/skinned.ts` exports `loadBody(kit, look, seed, sceneScale): Promise<SkinnedBody>`; the staged provider delegates to it whenever native preflight or pose coverage fails.
- Shared lifecycle contract: `src/scene/kit.ts` exposes `onDispose`; the native factory receives the same Kit and scene scale. The factory does not own a frame loop, so its host must continue stepping poses and adding/removing `body.object`.
- Existing pose vocabulary: `src/scene/body/poses.ts` defines `BodyPose`; the native factory exports pose coverage. The provider accepts a non-empty requested subset of idle/walk/interact/cook/eat/drink and falls back if any requested pose is outside that allowlist.
- Existing upstream gating: `src/scene/body/gate.ts` retains `bodyAllowed`, WebGL2 detection, and lazy import behavior; this provider does not duplicate or bypass those gates. Integration should call it only inside the already-gated body loader.
- Full native normalized-look preflight is exposed as a pure `supportsNativeLook(input, seed)` wrapper around the private validator. It catches validation errors, performs no loading, and does not mutate `input`.
- The provider requires a complete identity and a non-empty requested pose set contained by the native allowlist. For example, `idle`/`walk`/`interact` can select native without requiring every other allowed pose; any unsupported requested pose stays on `loadBody` for that actor lifecycle. It never switches representation mid-pose.
- Capabilities explicitly keep seat/lie/soak/wash contact, prone surface contact, and stairs support out of release claims. Unsupported poses must remain on the legacy path for that actor lifecycle; do not switch identity/representation mid-pose.
- The provider requests `retargetMode: 'directions'`, matching the reviewed V29 GPU preview; landmarks mode remained visibly crouched. This does not imply causal V30 or release acceptance, which are still pending.
- Source imports are rewritten relative to their intended final `src/scene/body/native/**` locations, not their deeper staging directory. Existing `src/**` contracts are resolved against frozen3af. The prototype avatar-look imports are mapped to3af characters exports. Bare package imports remain unchanged.

## Staged assets (raw copied bytes)

| File | Bytes | SHA-256 |
|---|---:|---|
| `owned-src/src/scene/body/native/authored-body-compression/outcompressed/parametric-base-facial-meshopt.glb` | 1,600,800 | `dfa53941f0fb77d69e59f59fa017f72efa45eddd7e6e8b8414b4a4dba332d552` |
| `owned-src/src/scene/body/native/authored-clothing/casual-female-export/out/casual-female-body-hide-map.json` | 148,659 | `4efb1cbdb673673f93fc4af657f12ffd59e837c04cebd3a51d2270c361e3d753` |
| `owned-src/src/scene/body/native/authored-clothing/casual-female-export/out/casual-female.glb` | 557,900 | `7063492e52bb8817981349df45e141e0bc70dbe3e339d4d2dac8df3bdc3342bd` |
| `owned-src/src/scene/body/native/authored-clothing/office-export/out/office-female-body-hide-map.json` | 128,704 | `47c3999dd2facb11511965925d2adfa160519a72f4cbb4834ccfd636be7cfa66` |
| `owned-src/src/scene/body/native/authored-clothing/office-export/out/office-female.glb` | 547,732 | `fd3f4ac0985dae3d6f46469fc8f22ea22d84628c83829c77802a79b1f8f3c053` |
| `owned-src/src/scene/body/native/authored-clothing/office-export/out/office-male-body-hide-map.json` | 180,703 | `337127fe061c4563faf8a5272135c4311b1893fc5c04c06ac7311e3c922136a3` |
| `owned-src/src/scene/body/native/authored-clothing/office-export/out/office-male.glb` | 1,155,968 | `74354b1293815f8753fe5b0cb618cb00da1fd19e7bb7f99fbff1817d243e73db` |
| `owned-src/src/scene/body/native/authored-clothing/out/body-hide-map.json` | 301,657 | `dbe0c82a3e31da4e6ce37f4f1d9dc8611143c7c9e6dbef72ffea8d281aebe099` |
| `owned-src/src/scene/body/native/authored-clothing/out/male_casualsuit01.glb` | 1,120,612 | `1f8d4fd4b867785226a9c057562289381ae071cf5acbcca248133a3216ae476f` |
| `owned-src/src/scene/body/native/authored-footwear/out/shoes01-body-hide-map.json` | 73,664 | `ba75d7ab36418434c40ad7c8c41d3723740782714e45890c3183d582b507ad71` |
| `owned-src/src/scene/body/native/authored-footwear/out/shoes01-mobile.glb` | 467,864 | `8f4060a275356489205f298bed9874da83920c166aeacffd36746e760a465557` |
| `owned-src/src/scene/body/native/authored-hair/out/afro01-mobile.glb` | 659,456 | `3d37f4a379c19b4d64a9c21bb08418858ede79317a477b34b3fdfb965fd11474` |
| `owned-src/src/scene/body/native/authored-hair/out/short02-mobile.glb` | 504,432 | `a2637b4d14055cbd537b9b0f6e46c695b4a5bdc99e7d779956d58218ffc626a0` |
| `owned-src/src/scene/body/native/native-family-rig-audit/family-anchor-coefficients.json` | 27,541 | `e8903d356e3333d8ab9dc918980160fdc60d35b7520c6f03e28b000eb8f44e35` |
| `owned-src/src/scene/body/native/skin-assets/mobile/1024/middleage_african_female_q90.jpg` | 124,599 | `d2f3d02e63a705173e888578ea91ecfb56ffdc207f59b6407687f1fe66cbd3c1` |
| `owned-src/src/scene/body/native/skin-assets/mobile/1024/middleage_african_male_q90.jpg` | 126,259 | `c8d69c3d8eb5232833599c5d8bfe12b03a85cf430d6b76cbf63a1fa026c3ea65` |

## Staged source hashes

| File | Source SHA-256 | Staged SHA-256 |
|---|---|
| `owned-src/src/scene/body/native/assets.ts` | `c3b3662a3a5b6d4661119fd6af4ed090b4244309369c9aa29e5af55554685d76` | `c5722bb8067d10980a785b3cb889522ddf7eb09ecfb5d7a80c52dbf3ab9a8421` |
| `owned-src/src/scene/body/native/authored-footwear/presentation.ts` | `d6fbb7193f475700d16070eae8715cf8861961c1ae0c081c3c4f510bb4e429fe` | `d6fbb7193f475700d16070eae8715cf8861961c1ae0c081c3c4f510bb4e429fe` |
| `owned-src/src/scene/body/native/authored-look-bridge.ts` | `41a35d893a11ff4af9441cf8f19b523e57168df4d006e80f45cb3dadcf7e458f` | `70a5c182ad1897e03e16a883f46bcde9b36eeadad5e89c96b9dab0d1aa8172d6` |
| `owned-src/src/scene/body/native/authored-presentation.ts` | `675385b2f1f0ae5d80d2668723d2a2574bf7e96e2bf2eb4a293b40d351c18224` | `6c8c7933f5247d30252115b9aae2bf5ae0272dee0a65c87292cfea6b5f3248cd` |
| `owned-src/src/scene/body/native/body-mask-union.ts` | `e0fd166198ca49f7451b6ae5e81a61a24632a3a704dba2f3a5cd33194d0e8c78` | `e0fd166198ca49f7451b6ae5e81a61a24632a3a704dba2f3a5cd33194d0e8c78` |
| `owned-src/src/scene/body/native/clothing-palette.ts` | `7440e64477ab051eb3f343dc78451c5b621a9423fcf8df3e071e042b756979ef` | `7440e64477ab051eb3f343dc78451c5b621a9423fcf8df3e071e042b756979ef` |
| `owned-src/src/scene/body/native/eye-material.ts` | `b734c9d671f8d76f1f8a0400b2eea5a91a316755160eb9178b8da6bc785a2cf1` | `b734c9d671f8d76f1f8a0400b2eea5a91a316755160eb9178b8da6bc785a2cf1` |
| `owned-src/src/scene/body/native/hair-palette.ts` | `740abeb62c007761541edd58cbc8baa26747c68f42316c83774b9bbb5fe5a7cd` | `740abeb62c007761541edd58cbc8baa26747c68f42316c83774b9bbb5fe5a7cd` |
| `owned-src/src/scene/body/native/native-body-surface.ts` | `1d7091862e15440a363c7af632e10f16b144f323ab14e772a8cbd4e55679939b` | `1d7091862e15440a363c7af632e10f16b144f323ab14e772a8cbd4e55679939b` |
| `owned-src/src/scene/body/native/native-clip-solver.ts` | `ce0bebd25b471affc0300edb82151469deb6c8c28511d30dd9ade141c16d28a3` | `ce0bebd25b471affc0300edb82151469deb6c8c28511d30dd9ade141c16d28a3` |
| `owned-src/src/scene/body/native/native-direction-retarget.ts` | `e8637e141ca4e814f547ec1ab7ef608365cad2a9b14eb86cd401901a0626ab0d` | `e8637e141ca4e814f547ec1ab7ef608365cad2a9b14eb86cd401901a0626ab0d` |
| `owned-src/src/scene/body/native/native-family-rig-correction.ts` | `b1af46f9fe97d6e02a5bb5ac4792e792ffa450a0cdfe3749fef0b965379d05c0` | `b1af46f9fe97d6e02a5bb5ac4792e792ffa450a0cdfe3749fef0b965379d05c0` |
| `owned-src/src/scene/body/native/native-full-runtime-v1/native-full-runtime.ts` | `e9447cc27a1522cc3889ee9f7b2c9a367baf9797e5886215ca6be79913862cf5` | `ef8e9cea3cee759c182d1ef2728cfed2cd052df99245fff675590b421ab666ab` |
| `owned-src/src/scene/body/native/native-full-runtime-v1/native-prepared-factory.ts` | `ecf30896371cdf65317894e5f2add34eb7679f0f8b9c5f72210457159f38f5e2` | `7cbaf16a9d015c973451558c671811f13be841027e4057e73b775b4066ab28bb` |
| `owned-src/src/scene/body/native/native-hand-pose.ts` | `09dce24a6f3891320a526ee0d1cbb704e677e0f153c247aa87b9460abcc6a8d7` | `09dce24a6f3891320a526ee0d1cbb704e677e0f153c247aa87b9460abcc6a8d7` |
| `owned-src/src/scene/body/native/native-source-pose.ts` | `e3bd40bd34cc8fe92872ec07ebb8052f864d9bb9eb8d85bb84d7525a67abb9a1` | `e3bd40bd34cc8fe92872ec07ebb8052f864d9bb9eb8d85bb84d7525a67abb9a1` |
| `owned-src/src/scene/body/native/native-source-sampler.ts` | `9df4ca4cc656c5b1cf08bcb217f3ddd29d8f1417f738f3da702027d803eb691c` | `9df4ca4cc656c5b1cf08bcb217f3ddd29d8f1417f738f3da702027d803eb691c` |
| `owned-src/src/scene/body/native/native-wrist-orientation/native-wrist-controller.ts` | `dfa3fff282cfeeded2f770dc3593f38fadf2edcae43c14d1cf99c59639707555` | `dfa3fff282cfeeded2f770dc3593f38fadf2edcae43c14d1cf99c59639707555` |
| `owned-src/src/scene/body/native/native-wrist-orientation/native-wrist-orientation.ts` | `903f625c536c41b3a719f5eb0c1963f1cbfb1773a5d13682a29fd98142ba10ef` | `903f625c536c41b3a719f5eb0c1963f1cbfb1773a5d13682a29fd98142ba10ef` |
| `owned-src/src/scene/body/native/rig.ts` | `ee6962088ae2fd3d9e7a6b08f187c18dce483637fc46dc940890dcde1b5f25e4` | `358f2be8691babe3bc48b85b14863238c32a3b134af42b56c17e6785e0f82421` |
| `owned-src/src/scene/body/native/skin-material.ts` | `610c04656887b127226608091d6749b6a78c85dff15354567e6b5ea81174329d` | `610c04656887b127226608091d6749b6a78c85dff15354567e6b5ea81174329d` |
| `owned-src/src/scene/body/provider.ts` | `generated` | `af04cdf3a2276b76f6e96c0aee9bdd1dc88fa83faf32cb50ad6a70890046bff8` |

Total staged payload: 8,024,657 bytes; assets/data: 7,726,550 bytes. Full machine-readable list is in `package-manifest.json`.
