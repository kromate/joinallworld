# Separate global administrative foundation

This product uses the pinned Natural Earth 10m Admin 1 layer alongside the existing 258-unit Admin 0 directory. It is a **new source namespace and representation**, not a replacement for geoBoundaries fine products, existing country identities or Nigeria. The source's default de facto depiction and version remain explicit. Source-labeled geographic units do not declare cities playable or establish current political/legal correctness.

## Frozen contract

`admin1-types.ts` defines the independent caps and interfaces. `admin1-capture.json` binds the previously captured metadata bytes, exact full commit, advertised 40,726,851-byte size and Git blob SHA-1. Capture verifies actual EOF size, the Git object digest and raw SHA-256. `admin1-parent.json` binds the accepted 10m directory and its exact retained raw Admin 0 source; no additional Admin 0 acquisition is needed. The old 110m inventory is not the parent for this product.

Source features require unique positive canonical safe keys from the exact lowercase `ne_id` property; the parent Admin 0 file uses uppercase `NE_ID`. No casing fallback is inferred. Internal IDs use `admin1:natural-earth:` plus the encoded source key; names and source releases are not part of those IDs. A later changed key, split, merge or retirement requires explicit migration review; the initial product does not infer mappings. Full original properties, geometry, source ordinal and canonical feature hash stay bound to each feature.

Join `adm0_a3` only to the same release's exact Admin 0 `ADM0_A3`, then resolve that Admin 0 feature through its existing country-directory identity. Unmatched and ambiguous joins remain visible; never use names, geographic containment or another code as fallback. Nigeria is protected by the direct `NGA` code and legacy identity/provider. Its source rows are counted, but no replacement Nigeria geometry is emitted.

The pure planner partitions complete original features in deterministic key order. Holes, polygon parts and higher ordinates remain intact. Valid unlinked/ambiguous features can be retained in null-parent partitions. Unsupported geometry, oversized individual features/properties and protected Nigeria become named source-reference exceptions, with original ordinal/key/hash retained in the immutable source. Nothing is silently clipped, simplified, dissolved or dropped. Feature count is not capped at the old fine product's 32-unit country ceiling.

Structural checks validate finite WGS84 coordinates and closed nondegenerate rings. They do **not** establish planar topology, spherical validity, official boundary correctness or coverage currentness. Supervised inspection writes a hash-addressed report, not geographic pack output. A partition plan is not a published manifest. Publication, lazy preview and topology acceptance are distinct following tasks.

## Resource bounds

Capture has a separate 64 MiB source ceiling, 96 MiB cumulative lifetime network allowance across request identities, 128 MiB cache including retained partials/audits, two attempts per immutable request and 120-second total operation deadline. Pre-contact reservations are durable; unknown transfers retain their full allowance and observed overshoot remains charged. Verified cache hits remain usable after quota exhaustion. Corrupt sources, receipts or audits are retained and rejected; deleting them is not recovery.

Inspection uses the existing shared acquisition lock, a supervised worker with 256 MiB old/32 MiB young heap limits, a 512 MiB process RSS gate, a 120-second operation limit and 100 MiB free-disk reserve. Source and parent buffers are bounded before parsing. Report and audit trees have independent aggregate size/entry/depth limits; attempt evidence precedes worker execution. Worker cancellation terminates and awaits exit before releasing ownership.

The download index carries compact identity/hash/asset bindings; detailed geometry and join diagnostics remain once in the source-bound inspection report. This avoids duplicating diagnostics across every feature in the index. Pure planning has independent ceilings: 10,000 source features, three million positions, 100,000 positions per feature, 16 KiB properties per feature, 1 MiB per partition, 64 whole features per partition, 512 partition assets, 2 MiB index/report and 96 MiB logical planned output. The global denominators are measured from the actual source, not taken from mutable download-page estimates. Existing fine-source and game startup/render caps are unchanged.

## Commands

Run from the isolated world worktree, using the shared heavy slot:

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- node --experimental-strip-types world/admin1-cli.ts capture world/admin1-capture.json
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- node --experimental-strip-types world/admin1-cli.ts cached world/admin1-capture.json
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- node --experimental-strip-types world/admin1-cli.ts inspect world/admin1-sources.json world/admin1-parent.json
```

The source pin `admin1-sources.json` is frozen only after independent raw-byte verification. Inspecting/resuming uses that pin and never discovers or downloads sources. SIGINT/SIGTERM aborts the operation; preserve durable attempt records, sources, receipts and reports. No daemon, paid service, game integration or external publication is installed by these commands. See [PROGRESS.md](PROGRESS.md) for actual acceptance, current limits and remaining tasks.

## Measured source and planning acceptance — 8 October 2026

A single actual HTTP 200 capture measured **40,726,851 response-body bytes**, verified Git blob `4a8438f98ac7dfec7dc1739b1eaf91398ad33f22` and raw SHA-256 `22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5`. Request hash is `eaf1498c96855122384818bd99c3083991056ed0b06c22e9661af9885b385939`. Cache-only repeat returned the same source with zero network and no additional transport attempts; no unknown transfer remains. This 40.7 MB is a builder input, not a player download.

Two actual supervised inspections return the identical report `4f232220522add22cccfd747ad3ff16d6fce6cf05bf053a3aeb92c4b53b99759`: **4,596 source features, 1,295,319 positions and 8,535 polygons**. Exact joins link 4,559 non-Nigeria source features to 250 existing country/map-unit IDs; 37 Nigeria rows are protected, with no unmatched or ambiguous joins. Seven non-Nigeria map units have no features in this source. All rows pass the structural checks; planar topology remains unverified. Thirty source country groups exceed 32 units, with the largest containing 232.

An independent semantic audit found mixed source `gadm_level` values: 545 level 0, 3,488 level 1, 555 level 2 and eight level -1 rows. Of 251 `adm0_a3` groups, 89 have no level-1 row; 360 rows lack `type` and 372 lack `type_en`. Antarctica has two level-0 source units, not formal first-order divisions. Preserve all original classifications and shapes; never infer an official state/province hierarchy from the layer name or silently filter other levels. Full independent byte/feature reconstruction also verified all 111 interior rings.

The first full-source planning probe exceeded the 2 MiB index gate because it repeated diagnostics. Its retained failure is `admin1-plan-probe.json`. After compacting the index without raising its cap, the supervised full-source probe passes: **272 planned partition assets**, 4,559 emitted feature records, 37 protected source-reference exceptions, **40,549,410 geometry asset bytes**, largest asset **1,046,372 bytes**, compact index **1,728,401 bytes**, and **43,998,851 logical planned bytes** including the canonical inspection report. It took 5,948 ms with sampled peak process RSS **404,062,208 bytes**, below the 512 MiB gate. These are local planning measurements, not physical-device rendering or network transfer figures. **No geometry assets or Admin 1 manifest are published yet.**

Evidence is under `.cache/world-build/evidence/`: `admin1-capture-{first,repeat,independent-verification}.json`, `admin1-source-initial-schema-audit.json`, `admin1-inspection-{first,repeat}.json`, `admin1-plan-{probe,compact-probe}.json`, integrated test/typecheck logs and `admin1-full-independent-verification.json` and `admin1-source-semantic-audit.json`. Current counts and exact next steps are maintained in [PROGRESS.md](PROGRESS.md).
