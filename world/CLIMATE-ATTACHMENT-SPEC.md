# Next milestone: explicitly associated African monthly climate

The accepted place preview is commit **925d9edb**. The next source-ready implementation attaches the cached NASA POWER/MERRA-2 monthly profiles to the three existing African city pilots as separately derived immutable packs. It must preserve the full world objective, base city products and all Nigeria/game/database work. No source reacquisition, paid service or terrain attachment is needed for this milestone.

## Frozen input associations

`climate-attachment-pins.json` records the exact three allowed base pack hashes/lengths/full region metadata, modern environment manifest hashes/lengths, raw source hashes/lengths/URLs, complete environment requests and exact returned coordinates. Root independently checked all three base manifest hashes, all **28** tile hashes/lengths and all three raw climate hashes/lengths before recording these pins. These are explicit reviewed associations, never a lookup by city label, nearest point, ISO code or matching region strings.

| City | Existing pack region | Environment region | Sample inside tiny pack bounds | Source sample longitude, latitude | Unchanged tile bytes |
|---|---|---|---|---|---:|
| Accra | `gh-accra-overture-pilot` | `pilot:accra` | No | -0.2, 5.55 | 110,758 / 12 tiles |
| Nairobi | `ke-nairobi-kicc-cell` | `pilot:nairobi` | No | 36.822, -1.292 | 83,993 / 9 tiles |
| Cape Town | `za-cape-town-city-centre-cell` | `pilot:cape-town` | Yes | 18.424, -33.925 | 72,521 / 7 tiles |

All sources have native spacing **0.5° latitude × 0.625° longitude**, requested years **1991–2020**, monthly means derived from 360 monthly observations, and LST source metadata. Pack and environment IDs intentionally differ. Accra/Nairobi points are outside their tiny pack cells. Their exact association and coordinate offsets must be disclosed; do not claim containment or a measurement/average of the cell. The reviewed policy additionally requires absolute offset from the bounds centre below **0.01° on each axis**. That is a conservative association guard for these exact pins, not a general geospatial join, distance in metres or accuracy estimate. Raw/requested/returned coordinates are independently pinned; preserve their rounding distinction. All three modern sidecars independently reconstruct exactly through the existing `buildEnvironmentManifest` after source-hash verification, zero network; evidence is `.cache/world-build/evidence/climate-attachment-binding-audit.json`.

## Derivation contract

Root freezes typed interfaces and ownership before writers start. A pure compiler takes one binding, exact base/environment/raw bytes and verified original tile bodies. It checks byte lengths/SHA, validates both existing contracts, verifies full base region and complete request/source/point identity, and reconstructs the environment sidecar with `buildEnvironmentManifest` from the pinned raw response. Compare reconstruction exactly; a sidecar's self-reported profile alone is insufficient. Reject old manifests missing requested coordinates, changed source IDs/period/months, wrong city associations, protected Nigeria, changed geometry and pre-existing climate/source-ID conflicts. Never use the old permissive manifest validator to erase evidence of unexpected fields silently.

The derived world manifest preserves schema/frame/datum/coverage/compilerVersion/region, original source records, tile refs and every non-climate exception. Add the seven-field NASA SourceRecord and the exact 12-month profile. Remove only `climate unavailable: no monthly regional climate source was provided`. Add mandatory disclosures for named city association, exact requested/returned sample coordinates, containment result, source resolution, baseline and monthly precipitation accumulation. Do not turn monthly millimetres into rain intensity or claim current weather.

Create a separate canonical attachment provenance asset with base/environment/raw pins, full source metadata, derivation and explicit association checks. It binds original tiles but omits the final derived manifest hash to avoid a hash cycle. Its SHA is referenced by a mandatory manifest exception; then hash the final manifest. Preserve original profile values and source attribution, including the absence of a separate API product license. The provenance is builder evidence, not an eager player download.

## Publication and recovery

Publish under a dedicated `.cache/world-build/output/climate-packs/` tree. Copy original tile bytes unchanged, write provenance before the new manifest, and publish the manifest last. Preserve all original campaign/environment trees and ledgers. Requests are keyed by compiler/policy and exact input pins; repeat must rederive and compare every asset, not accept a self-consistent modified cache. No network path is permitted. Use the existing canonical-path/immutable storage and supervised-process patterns rather than rebuilding them.

Freeze explicit hard caps before the runner: three association jobs; base manifest 128 KiB, environment manifest 16 KiB, raw source 1 MB, at most 64 tiles/job, each tile 1 MiB, total logical output 8 MiB/job; output tree 24 MiB / 1,024 entries / depth four; free reserve 100 MiB plus measured write headroom; worker deadline 60 seconds and RSS 256 MiB with smaller V8 heap; attempt audit 1 MiB / 128 records / 8 KiB each; queue at most three jobs; at most four lifetime publication starts per immutable request. Cache reads remain available after quota exhaustion. Attempts interrupted before a terminal record stay charged; don't reset history. Tests use temporary repositories exclusively. No actual publication until compiler/runner review and checks pass.

Preview routes expose only `climate-packs/manifests/<hash>.json` and `climate-packs/tiles/<hash>.json`, never source/provenance/audit paths. The existing pack reader can resolve tile paths within this separate product. Add a small climate display showing the selected local calendar month, the four sourced values/units, baseline/source/native-grid association and explicit absence of live weather. Geography-only selections do not inherit a pack's climate. Missing profiles remain unknown; rejected packs clear prior climate.

## Luna wave and acceptance

1. Root: typed contracts/pin validation, integration and operating documentation. Assign a pure derivation compiler/tests to one narrow Luna owner.
2. A second Luna owner: publisher/worker/CLI/tests after shared compiler interfaces are frozen; no preview or shared type edits.
3. A third Luna owner: independent standard-library reconstruction/fixtures or bounded climate-display helper/tests. Root integrates preview routes/main and performs browser checks. Keep max three workers plus coordinator; reuse existing workers.

Accept only after all three real associations derive with zero network, original manifest/tile bytes remain identical, cache repeat is deterministic and independent reconstruction confirms exact monthly values and provenance. Test wrong hashes/lengths/region/source/point/months, coordinate containment disclosure, source-ID collisions, immutable collisions, changed cache, worker interruption/resume, spent-quota cache and unsafe paths. Run full World TypeScript/tests and the separate preview build once final code is frozen. Browser-check three African packs across contrasting months, London without attachment as unknown, wrong hash clearing, lazy tile requests/cache reuse and 390×844/desktop without introducing continuous redraw. Record actual bytes/render workload; do not claim device or world completion.

Terrain still requires separate pinned geoid acquisition and independent vertical conversion evidence; the accepted Accra input is DSM with handbook EGM2008 metadata, not proven ellipsoidal ground. Global building/road campaigns, climate spatialization, unattended scaling, physical-device/soak checks, lawful distribution and gameplay integration remain later requirements. See [ENVIRONMENT.md](ENVIRONMENT.md), [TERRAIN.md](TERRAIN.md), [GEOID.md](GEOID.md) and [ROLLOUT.md](ROLLOUT.md).
