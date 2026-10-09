# Complete-character asset cache ownership check

The controlled-loader check exercises the current `completeCharacterKit` implementation without network or GLB parsing. Two concurrent callers for one Kit receive the same wrapper and share one template fetch and one motion fetch. A second Kit receives an isolated wrapper and independent loads. It also forces each asset request to fail once and verifies retry succeeds, closes Kits during pending body and motion loads, and verifies late scenes release geometry, materials, and skeleton textures. Already-disposed Kits reject without fetching.

The check passed with exit 0: 0.305 s elapsed, peak process-group RSS 87,162,880 bytes, Node heap capped at 24 MiB, under the available bounded runner’s 128 MiB RSS/45 s limits. It observed 8 geometry disposals, 8 material disposals, and 9 bone-texture disposals. This is an ownership/lifecycle check using fake GLTF responses; it makes no network, asset-parse, GPU, or visual claim. The available repository runner does not expose a 64 MiB process-group limit, so the recorded cap is 128 MiB.

Source SHA-256: `a99ea6bd43bb0fb95c52ca2e0a632dc942034e324aed3092f01f905b06423193` (`assets.ts`). Check SHA-256: `b126a94610a2c091361bb987f17b5766c1d2bdead059df01d445fdda4e0113fd` (`assets-cache-check.mjs`).
