# Authored skin texture ownership

`applySkinMaterial(root, body, skin, owner?)` now supports a Kit-owned texture cache. With an owner, concurrent actors share one immutable map per body family; each actor still gets a private material and color. Kit disposal releases shared maps, while actor disposal restores its original Body material and releases only its private material. Failed loads are evicted for retry, and a load that resolves after Kit disposal is disposed and rejected. Calls without the fourth argument retain the legacy actor-owned map lifecycle.

The check replaces `TextureLoader.loadAsync` with controlled in-memory textures. It covers family deduplication, per-actor color isolation and recoloring, source-material restoration, exact-once cleanup, failed-load retry, closed-Kit rejection, late resolution, and the legacy three-argument path. It does not measure GPU memory, rendering, or FPS.

Validation passed with exit 0 under the bounded runner: 0.312 s elapsed, peak process-group RSS 82,624,512 bytes (128 MiB cap), Node heap 32 MiB. Receipt: `/tmp/skin-material-check-20261009-receipt.json`.

Source SHA-256: `610c04656887b127226608091d6749b6a78c85dff15354567e6b5ea81174329d` (`skin-material.ts`). Check SHA-256: `9351c2f458960439c77d49d0a01075d646b6071f4aeead835b58c5026144b7d9` (`skin-material-check.mjs`).
