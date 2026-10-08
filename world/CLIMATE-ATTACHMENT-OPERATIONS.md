# African city-associated climate attachment

Three separately derived local packs attach the cached NASA POWER/MERRA-2 **1991–2020 monthly normals** to Accra, Nairobi and Cape Town. Original campaign manifests, all 28 tile bodies, environment sidecars and existing ledgers remain unchanged. This does not establish current weather, climate throughout a country, spatial averages of these small cells, terrain heights or playability. Nigeria and the game/database checkout are outside this publisher.

Read the frozen [specification](CLIMATE-ATTACHMENT-SPEC.md), exact [input associations](climate-attachment-pins.json) and [acceptance receipt](climate-attachment.json). Accra/Nairobi samples are outside their tiny pack bounds; Cape Town's sample is inside. Every product records this explicitly alongside requested/returned coordinates, offsets and the native **0.5° latitude × 0.625° longitude** spacing. The strict centre-offset guard is below 0.01° on each axis, not a distance or accuracy claim.

## Published local products

| Association | Derived manifest SHA-256 | Logical bytes | Original tiles |
|---|---|---:|---:|
| Accra | `c8cb7d2cffc79d9aaa5451df9b04e5baa978b2f5be367a717484eace8402e3a4` | 140,740 | 12 |
| Nairobi | `d3d6515085df93e227c603ad08426d966af98cdea3693604665770439b4d921d` | 115,217 | 9 |
| Cape Town | `fb659e32319919e507513787e7917ab4051d5958aa8d32443b4c08e9488a0dfc` | 101,902 | 7 |

Each logical size includes the unchanged tiles, derived manifest and private provenance. The whole output tree has **357,859 bytes / 34 files**, plus three directories. This is local builder storage, not a player's eager download. Preview routes expose only manifests and tiles; raw inputs, provenance and attempt records are private.

The first run completed the individual jobs in **572 / 371 / 341 ms**, the repeat in **331 / 269 / 236 ms**, with the same hashes and zero source network bytes. Maximum process RSS was **132,497,408 / 140,869,632 bytes**, below 256 MiB. Exactly **three succeeded attempts**, one per immutable request, remain charged; cache replay adds none. Final-code cache replay took **2,435 / 409 / 418 ms** under concurrent verification, with **125,353,984 maximum RSS bytes**, the same products and no extra attempts. All **43** captured original input and ledger files are byte-identical after publication/replay. Keep the existing climate audit and output intact.

## Reproduce and resume

Run from the isolated WORLD checkout. The existing inputs must be present at their pinned paths; this command never downloads missing source files.

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- \
  node --experimental-strip-types world/climate-attachment-cli.ts build-all

# One reviewed association only:
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- \
  node --experimental-strip-types world/climate-attachment-cli.ts build accra
```

The CLI handles SIGINT/SIGTERM and processes at most three jobs sequentially. Each request has a 60-second deadline and four lifetime publication starts. Its worker has a bounded V8 heap; RSS is checked during parent operations and worker execution. Source tile sizes are summed before bodies are read; tile reads are serial. No AI calls or network path occur in derivation.

An interruption before the manifest leaves immutable matching assets available for the next charged attempt. Resume verifies them and writes only missing assets, with provenance before the manifest and the manifest last. A pending audit record stays charged if the process dies without a terminal update. Valid products from different exact-pin requests can coexist under the same stable city/source IDs. Succeeded audit records bind their expected manifest/provenance hashes; removing and rehashing those originals cannot masquerade as another request and trigger repair. Complete cache products are rederived from pinned raw inputs and compared byte-for-byte, even when all four attempts are spent. A published manifest with missing/corrupt referenced assets fails; it is never silently repaired. Do not erase audit history to bypass exhausted attempts.

Hard caps: base manifest 128 KiB, environment manifest 16 KiB, raw response 1 MB; 64 tiles at 1 MiB each but total logical output at most 8 MiB/job; output tree 24 MiB / 1,024 entries / depth four; 100 MiB free disk reserve plus output/audit/scratch headroom; audit 1 MiB / 128 records / 8 KiB per record. Canonical paths, regular files, source hashes and immutable collision checks apply throughout.

## Independent reconstruction

```sh
python3 world/tooling/verify_climate_attachment.py \
  --repository-root /Users/anthonyakpan/.codex/worktrees/world-foundation/joinallworld \
  --id accra \
  --manifest c8cb7d2cffc79d9aaa5451df9b04e5baa978b2f5be367a717484eace8402e3a4
```

Repeat with the other two IDs/hashes above. The standard-library Python verifier imports no production compiler. It reconstructs monthly temperature, direct relative humidity, scalar wind and precipitation from 360 monthly records per parameter, checks the complete 390 monthly/annual key set, and uses actual Gregorian month lengths for precipitation. Monthly numerical tolerance is absolute **1e-10**. It verifies pinned source/sidecar identities, exact climate disclosures, original tile copies and climate-only manifest changes. Duplicate JSON keys, nonfinite values, unsafe paths, rehashed wrong values and contradictory disclosures fail.

It checks hashed bytes and parsed semantic reconstruction; it does not independently establish ECMAScript canonical number serialization equivalence or climate accuracy. The publisher checks canonical output serialization. A third raw coordinate ordinate is not terrain. Actual independent checks passed for all three products in **43.083 / 33.866 / 34.273 ms**, zero network.

## Preview and acceptance

Reuse the existing preview at port 5191. Enter `/world-output/climate-packs/manifests/<hash>.json` and the corresponding hash in the pack panel. The selected UTC instant is converted to the pack's IANA timezone before selecting a climate month. Displayed precipitation is historical monthly accumulation in millimetres, never instantaneous rain intensity.

Actual browser checks cover January/July for all three cities, Nairobi's local February boundary at `2026-01-31T21:30` UTC, London without climate, geographic outline selections, wrong-hash clearing, invalid time, cache reuse and idle demand rendering. At 1280×720 / 390×844, source text wraps without horizontal overflow and console errors are zero. Recorded city workload is Accra **5,530 / 18**, Nairobi **6,722 / 17**, Cape Town **7,462 / 16** triangles/calls; London remains **11,854 / 17**. The eight-tile resident limit defers four Accra and one Nairobi tile explicitly; all seven Cape Town tiles fit. Changing month adds no tile traffic; repeated Cape Town loading fetches only its manifest and reuses tile cache.

Rounded preview download counters show **86.7 / 95.4 / 90.8 KB** for the initial three pack loads and **19.9 KB** for Cape Town cache reload. These are decoded-body counters, not exact wire transfer measurements. This is browser verification, not physical-device or prolonged-soak acceptance.

The separate preview build has **33 modules**, JS **717.31 kB minified / 188.15 kB gzip**, CSS **12.17 / 3.52 kB**. Its existing chunk-size warning remains; no game startup module was added. Focused checks pass five compiler, eleven publisher, six display and eight independent Python cases. Full World checks are recorded in the acceptance receipt, including the retained initial failed run, repaired reader-phase fixture, and later 457/458 Admin1 process-exit/RSS race. Process-state/PID checks distinguish exit from invalid live measurements without weakening the 512 MiB cap. Nine focused topology cases and the final **459/459** World tests pass.

Evidence lives in `.cache/world-build/evidence/climate-attachment-*`: first/repeat publication, independent reconstruction, before/after preservation, browser cases/screenshots, TypeScript, preview build and test receipts. Do not overwrite the earlier selected-place evidence.

## Next expansion

Use the existing bounded Overture campaign runner for a new African sample-cell batch, rather than replaying the terminal four-city pilot campaign. Dakar, Addis Ababa and Dar es Salaam have source-bound candidate place points and country links but no cached building/road extracts. Check the anchor semantics, freeze unique source requests and run each bounded job through the existing audit. Keep Nigeria protected, retain all source/coverage exceptions, and label samples as foundation coverage until a separate promotion proves explorable coverage. Terrain datum conversion, global spatial climate, lawful distribution, device/soak validation and the gameplay adapter remain open.
