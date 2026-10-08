# Selected-place publication and independent verification

The separate builder product publishes selected Natural Earth city/town reference points. It supplies source coordinates and labels for map orientation. It is not an exhaustive settlement inventory, real houses, street geometry, official administrative containment or a playable-world declaration. Nigeria remains `legacy-ng`, with lineage references and no replacement point asset.

## Accepted local product — 8 October 2026

Manifest **17932383d2d75ce733a3cfae8e455d053be778fc09dcaa5ca06707416e55b61e** binds the admitted raw source and parent directory. All **7,342** rows are conserved: **7,257** emitted in **221** country assets, **68** protected Nigeria, **17** unmatched (`SJM` one, `SSD` 15, `TKL` one). Geometry and required labels are valid on every row; ambiguous joins and invalid rows are zero. All **258** country identities remain represented: 221 available, 36 missing and one protected. No implicit code crosswalk, coordinate substitution or ADM1NAME relation is used.

Actual aggregate output is **4,202,369 bytes / 223 assets**: a **72,668-byte** manifest, **2,431,609-byte** complete inspection report and 221 country point assets. Largest country asset is **173,316 bytes / 769 points**, below the unchanged **512,000 decimal-byte** route cap. These are uncompressed local bytes. A future player reader must fetch only the manifest and selected country points; the whole inspection report is builder evidence.

First build: **6,114 ms**, macOS maximum RSS **396,427,264 bytes**. Verified repeat: **2,945 ms**, maximum RSS **426,426,368 bytes**, identical manifest/output, `cacheHit=true`. Both use **zero network** and leave exactly **one** publication attempt. Source capture history remains separate and unchanged: two original attempts, **38,783,542 charged bytes = 19,359,003 measured + 19,424,539 unknown reservation**. Do not recapture or reset it.

Root's independent read-only reconstruction passes all source ordinals, keys, complete-feature hashes, exact coordinates/labels, literal parent joins, all 267 parent hierarchy nodes, country rollups and output references. It imports no compiler, publisher or client validator and cross-checks source pins against admitted capture metadata and raw-audit evidence. It took **1,317 ms**, sampled peak RSS **320,176,128 bytes** (macOS process maximum **320,552,960 bytes**). Parent outline geometry, official/spherical boundaries, buildings, navigation and playability are outside this check. The earlier Python admission audit supplies duplicate-JSON-key validation of the admitted raw source; this TypeScript verifier uses JSON.parse and does not independently detect duplicate keys.

Receipts live under `.cache/world-build/evidence/settlement-publication-{first,repeat,independent}.{json,stderr}`. `settlement-publication.json` records the accepted manifest and measurements. Integration/preview tests pass **411/411**, existing independent product fixtures **8/8**; full World TypeScript passes. The new focused suites cover 11 compiler, ten publisher and nine browser-validator cases, including hostile rehashed coordinates, exact attempt boundaries, empty input, charged interruption/resume, corrupt/missing assets and unsafe paths. Tests use synthetic temporary repositories and do not change actual output or ledgers. A typecheck during an in-progress fixture edit failed; its inferred-object type was fixed before final verification.

## Run from the world worktree

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- node --experimental-strip-types world/settlement-cli.ts build
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- node --experimental-strip-types world/tooling/verify_settlement_product.ts 17932383d2d75ce733a3cfae8e455d053be778fc09dcaa5ca06707416e55b61e
```

The builder reads its own saved `settlement-sources.json` and `settlement-parent.json`; it cannot discover sources or fetch network data. Success emits bounded JSON. SIGINT/SIGTERM and deadline/RSS failures close the worker and retain pending/terminal evidence. Build output is under `.cache/world-build/output/selected-places/`; separate publication attempts are under `.cache/world-build/settlement-publish-attempts/`. Request identity binds product/compiler and complete source/parent pins; runtime deadlines are not identity fields.

Limits: source **32 MiB**, raw parent **16 MiB**, **100,000** source rows, **1,024** countries, report **3 MiB**, manifest **256 KiB**, country points **512,000 bytes**, aggregate logical output **16 MiB**. Output tree stays within **32 MiB / 2,048 entries / depth five**. Attempt tree stays within **1 MiB / 128 records / 8 KiB per record**, with **eight lifetime starts per immutable request**. Pending attempts count once and are never discarded. A verified complete cache remains readable after quota exhaustion, but every cache return recompiles the pinned source under the same worker bounds and compares all bytes. Self-consistent rehashed tampering therefore fails closed.

The shared acquisition lock covers the remaining **120-second** deadline. Process RSS is sampled against **512 MiB**; worker heap is bounded to **256/32 MiB**. Disk admission reserves **100 MiB** free plus full bounded output/temp/audit headroom. Scans, reads, collisions and audit records are individually bounded. Report and points publish before the manifest. Correct partial immutable assets can resume before a manifest exists; corrupt collisions and missing assets of a completed manifest fail closed without automatic repair. Filesystem sync cannot be forcibly preempted; a final caller deadline check can reject even after a durable result exists. Read the journal before resuming.

The independent verifier has separate **128 MiB aggregate read**, **120-second** cooperative wall and **512 MiB** sampled process limits. It writes nothing and performs no network requests. Preserve original receipts and save replay output under a new filename.

## Next boundary

Implement a country-lazy reader and separate preview using the accepted browser validators: verify manifest hash/source/parent and country asset hash/length/envelope, fetch no point asset for protected/missing countries, cap cache at **5 MiB** and requests at **two**, cancel stale selection and bound visible markers. Add real browser acceptance for African countries, UK/London, missing units, protected Nigeria and antimeridian/polar cases. No point layer has yet been shown in the preview. Its rendering and startup costs remain unmeasured. Deeper sourced African roads/buildings and terrain/environment attachment remain distinct milestones; climate is regional/seasonal rather than universally humid across Africa.
