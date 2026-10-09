# GPU source-corner comparison v5 — appearance replay (prepared, unexecuted)

This immutable remote recipe uses the distinct v3 fixture. It preserves v2/v4 sources and receipts. No local build, browser, server, test, or GPU run was performed.

The prior v4 check compared raw normalized Int8 normals and Uint16 positions to a production body after the recorded `oval`/`smile` appearance. Production legitimately converts position and normal to Float32 and recomputes normals after wardrobe masking. The replay copies the already-masked in-place index, draw range, and groups to a private raw parse before invoking the same production appearance controller. Because Three recomputes normals over the full index array, including its tail, replaying on the original full index would not match.

Before replay, the fixture saves and hashes the untouched full GLB index. It then requires every replayed current attribute byte and layout, rig bind state, skeleton, and mesh-local matrix to equal the displayed production actor. Chart construction clones the displayed geometry, swaps only its private index to a copy of the saved full source index, and rechecks the displayed mask is unchanged. Existing CPU-reviewed counts remain hard requirements: male 3,266 triangles/1,778 vertices, female 3,541/1,893; full source index 9,002 triangles.

The custom source-corner GPU shader still changes position skinning while retaining standard normal skinning; the candidate has no visual acceptance. Workflow branch: `codex/graphics-office-source-corner-gpu-diagnostic-v5`. Browser cap is unchanged at 1,280 MiB/60 seconds; bundle cap remains 220 MiB/25 seconds. The runner adds a maximum 1.25-second empty-group drain after a prior positive RSS sample, retaining source/exit checks.
