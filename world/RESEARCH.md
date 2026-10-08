# Building Allworld’s world independently

Research and architecture proposal — 8 October 2026, Africa/Lagos.

**Recommendation:** build an independent, resumable world-data compiler. Use real geographic datasets for positions and shapes, deterministic software for geometry and packaging, Luna for bounded content enrichment, and a separate preview application for acceptance. Keep Nigeria on its existing implementation. Introduce the new world through a small, reviewed adapter after its data contract is stable.

The agreed direction is real geography and lightweight 3D first, increasingly detailed streets and landmarks next, and photorealistic presentation later. Real building footprints and location-based conditions belong in the underlying data from the beginning. Photorealism is a rendering/data-quality upgrade, not a different world or a reason to move existing places.

This is research, not a launched generation job. No production deployment, database migration, cloud purchase, paid model call, or background automation was started.

## 1. What I verified in your game

I inspected local commit `4832b7e7507914db8a4d721a7f6e5d6ad21d91e1`, installed the locked dependencies, ran the game at `http://127.0.0.1:5187/`, and entered a fresh guest life. Its local data directory is `.cache/world-research/local-data`, separate from normal `.data` saves. I viewed Freedom Park, the Lagos city map, Nigeria, Africa, and the world atlas. The browser reported no captured console errors during that inspection.

The map is a recognisable miniature geography with coastlines, lagoon shapes, administrative boundaries, roads, placed landmarks and procedural urban fabric. Venue scenes are a separate close view. Existing map symbols are deliberately oversized; an atlas icon is not a literal building footprint.

The current generated catalogue contains **40 open cities across 37 first-level units**: 36 states and FCT. Some README and design documents still describe earlier city counts and unfinished features, so I used current code and the running game where they disagree. This confirms broad Nigerian state coverage; it does not establish that every Nigerian town, street, house or LGA is fully built.

`npm run build:slot` succeeded in 35.51 seconds. `npm run size:download -- --top 8` passed every measurable budget:

| Measurement | This build | Existing limit |
|---|---:|---:|
| Automatic startup JavaScript, largest city | 600,434 raw bytes | 609,000 |
| Same JavaScript, gzip | 216,824 bytes | 223,000 |
| Automatic startup, report’s full Brotli closure | 190,066 bytes | 195,600, provisional |
| First-paint JavaScript, gzip | 35,401 bytes | 37,000 |
| Shared scene host, gzip | 69,903 bytes | 71,000 |

The startup JS headroom is only **6,176 gzip bytes**. Startup figures are not total scene/map downloads or a measured time-to-play. Three.js, city geometry, scene assets, imagery, and later downloads have separate costs. For example, the report lists the existing Rivers chunk at 378.1 KB Brotli. Street-tile and wardrobe targets are currently reported as “not measured”; their existence in a budget file is not evidence that streaming is implemented.

I did not run the full game test suite or measure FPS, GPU memory, low-end Android performance, international latency or production traffic. The build emitted an existing circular-chunk warning. This investigation changed no tracked game files.

Evidence: [Nigeria screenshot](/Users/anthonyakpan/Desktop/joinallworld/.cache/world-research/evidence/nigeria.jpg), [world screenshot](/Users/anthonyakpan/Desktop/joinallworld/.cache/world-research/evidence/world.jpg), [Africa screenshot](/Users/anthonyakpan/Desktop/joinallworld/.cache/world-research/evidence/africa.jpg), [download report](/Users/anthonyakpan/Desktop/joinallworld/.cache/world-research/download-budget.txt), [build log](/Users/anthonyakpan/Desktop/joinallworld/.cache/world-research/build.log).

## 2. Reuse the foundation, address the global assumptions

| Current evidence | What it means for the world build |
|---|---|
| `src/game/cities/registry.ts`: separate lazy rules, content and map loaders | Preserve this separation. A London player should not download Lagos content or every other city. |
| `scripts/city/build-city.ts`, city specs and pinned research | Reuse deterministic compilation, provenance, source hashes and validation concepts. Do not replace these with free-form AI code generation. |
| `src/map3d/geo/frame.ts`, `CityMapPack` | Projection is explicitly `nigeria-equirectangular-v1`, at 100 m per map unit and standard parallel 9° N. It is not a global street coordinate system. |
| `src/map3d/regions.ts` | Country identity is narrowed to Nigeria; atlas detail levels are world/Africa/Nigeria. Global detail navigation needs a data-driven region tree. |
| `src/app/features/start/placesModel.ts` | The country picker currently places the catalogue under Nigeria. |
| `src/game/cities/catalogue.ts` | Every city adds an eager catalogue row and loader reference. This cannot stay proportional to every city on Earth. |
| `src/game/cities/registry.ts:164` | Generated travel is given `countryId: 'ng'` for every open city. Appending London today would create incorrect assumptions. |
| `src/game/cities/generatedLinks.ts` | Nested loops inspect every city pair; road eligibility uses distance/country, not road-network connectivity, and two airports can generate an air link without an actual service claim. |
| `src/game/cities/spec.ts` | The current spec fixes timezone to `Africa/Lagos`, and its climate and product vocabularies are Nigeria-oriented. |
| `src/game/world-time.ts` | Day bands and several seasonal calculations use Lagos time. London needs DST handling; polar regions need different daylight behaviour. |
| `scripts/geo/extract-city-osm.py` | Extraction pins a Nigerian PBF and boundary sources. Documented scans cost about 6–7 minutes per city. Repeating national scans for thousands of cities wastes most of the build. |
| `deploy/cloudflare-worker.ts:160` | The inspected Worker sends gameplay through one named Durable Object. CDN map delivery does not remove that gameplay bottleneck. |

At 10,000 cities the pair loop examines **49,995,000 pairs** before filtering. The current 40-city registry produces 807 total links. Global expansion needs sparse, regional adjacency and transport hubs, with routes computed or fetched on demand. A road must follow connected road/ferry data; geographic proximity does not establish a road. An airport is not evidence of a direct flight to every other airport. Preserve existing Nigerian routes; use a new route provider for new-world packs.

The unchanged Nigeria projection would overstate east–west distances around London by roughly **59%** relative to local ground scale (`cos(9°)/cos(51.5°) ≈ 1.587`). Keep it intact for legacy maps, but use geographic coordinates plus local metre-based frames for new street geometry.

## 3. Define what “the entire world is built” means

Use independent coverage levels, with explicit denominators from a pinned source release:

| Level | What exists | Completion rule |
|---|---|---|
| Geographic foundation | All covered land, water, country/territory outlines, available administrative divisions, settlements and coarse climate | Every requested source unit is processed or has a named coverage exception. Nothing is silently omitted. |
| Explorable region | Lightweight terrain, roads, mapped building footprints, place labels and a working preview | Geometry, seams, download budgets and fallback behaviour pass. This does not automatically allow spawning or travel. |
| Playable city | Arrival, housing, jobs, food, recovery, travel, civic/gameplay support and compatible saves | Gameplay contracts and complete journeys pass; sourced factual content is reviewed. |
| Detailed destination | Local architecture, specific landmarks, richer streets, interiors and activities | Local fidelity, visual QA and device performance pass. |

Country and continent completion should be a roll-up of a chosen level. “Africa’s foundation is complete” is useful and achievable without implying every African settlement has finished gameplay. Each country can also have an explicit initial playable-city set. Small, sparse or uninhabited regions should not be forced through a city template requiring a stadium, market, church and mosque.

Your preferred order becomes: preserve Nigeria → establish world foundation → deepen African countries → complete the agreed Africa target → deepen other continents country by country. London can be a preview-only technical pilot before the Africa rollout because it exposes projection, timezone and climate problems early.

## 4. The world as layers

1. **Geographic truth:** stable feature identities, longitude/latitude, shapes, elevation, administrative memberships, road connectivity and provenance.
2. **Visual representation:** lightweight extrusion/procedural form first, better roof/material/landmark assets later. All representations refer to the same feature identity and anchor.
3. **Game content:** a curated subset of places has supported activities, entrance anchors and authored gameplay roles. A mapped building does not automatically become a business or usable home.
4. **Player changes:** owned homes, money, relationships and constructed objects remain in the existing authoritative game systems. They are not stored in regenerated map files.
5. **Conditions:** compact climate profiles plus an optional current-weather overlay, separate from immutable geometry.

Keep a separate player-world overlay over the real geographic base. Importing a real house’s outline must not overwrite a player’s existing home or imply that a player owns the real property. Public map geometry is sufficient; resident identities are unnecessary.

This separation lets Nigeria’s engine, storage and efficiency improvements continue while new geographic packs are built elsewhere. It also lets a building gain better graphics without changing its gameplay identity.

## 5. Data sources and their limits

| Layer | Recommended starting source | Decision and limit |
|---|---|---|
| Small world atlas/coastlines | Natural Earth | Already used by the game; appropriate for overview scales, not house placement. Its published data is public domain. [Terms](https://www.naturalearthdata.com/about/terms-of-use/) |
| Administrative units | geoBoundaries gbOpen | Reuse the current family of sources. Pin metadata, geometry, release and attribution. Available levels and dates vary; do not assume every country supplies every ADM level. [API](https://www.geoboundaries.org/api.html) |
| Roads, water, rail and detailed tags | OpenStreetMap regional extracts from Geofabrik | Best first ingestion route because a pipeline already exists. Snapshot, scan once per region, then spatially index and cut many outputs. Africa’s source PBF was listed at about 7.4 GB during research; that is an input size, not the game download. [Geofabrik](https://download.geofabrik.de/africa.html) |
| Building footprints | Overture Buildings, with selected OSM tags retained | Good global starting coverage. Includes mapped and machine-detected footprints; precision varies. Footprints are not complete architectural models. [Buildings guide](https://docs.overturemaps.org/guides/buildings/) |
| Place candidates | OSM/Wikidata; optionally Overture Places | Use candidates to locate institutions and businesses, then verify high-value gameplay facts. Confidence, closure, duplication and source age matter. [Places guide](https://docs.overturemaps.org/guides/places/) |
| Alternative transport graph | Overture Transportation | Its segments and connectors can support a common graph. Trial against existing OSM extraction; do not ingest two competing networks without deduplication. [Transportation](https://docs.overturemaps.org/guides/transportation/) |
| Terrain | Copernicus DEM GLO-90 initially; selected GLO-30 later | Downsample offline. This is a surface model, which can include vegetation/building effects, not perfect bare earth. Verify tile availability and vertical references, especially at poles and seams. [Dataset](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM) |
| Vegetation/land cover | ESA WorldCover 2021 | Useful offline input for woodland, built areas, grass and water classes. It is a dated classification, not current street imagery. CC BY 4.0 attribution applies. [Data](https://esa-worldcover.org/en/data-access) |
| Climate baseline | Regional summaries derived from ERA5 | Use monthly distributions and seasonal profiles. ERA5 is historical reanalysis, not a live weather feed. Its published hourly product is global and commonly regridded to 0.25°. [ECMWF](https://www.ecmwf.int/en/forecasts/datasets/era5-hourly-data-single-levels-1940-present) |
| Optional current weather | An appropriately licensed weather provider; Open-Meteo is a candidate | Cache by game-region cell, not player. Its public hosted free API is non-commercial; commercial service and historical access have plan requirements. [Service terms/pricing](https://open-meteo.com/en/pricing) |

Overture’s themes do **not** all have the same licence. Buildings, divisions and transportation carry ODbL; Places has different permissive upstream terms. Preserve the per-theme/per-source licence manifest. For OSM-derived data, satisfy attribution and applicable derivative-database share-alike requirements; separating data from game code helps implementation but is not a blanket exemption. [Overture attribution](https://docs.overturemaps.org/attribution/), [OSM copyright](https://www.openstreetmap.org/copyright).

Do not bulk-download the public OSM raster tile service for offline city packs; its usage policy forbids that. Process downloadable geographic data and host our own output. [Tile policy](https://operations.osmfoundation.org/policies/tiles/).

For build-time selective extraction, DuckDB/GeoParquet can retrieve bounded subsets of Overture data instead of downloading everything. Do this in the builder, not inside the mobile game. [Overture example](https://docs.overturemaps.org/examples/pandas/).

## 6. Real houses now, photorealism later

For each source building, retain a stable internal ID, source IDs, footprint, anchor, source release, confidence and separately attributed height/roof/use fields. Track changes through alias/tombstone records rather than assuming source IDs never split or merge.

The first renderer can extrude the footprint and choose a simple roof/material from a small approved visual kit. Use measured heights where present. Missing heights get clearly recorded procedural estimates; an estimated roof or facade should never be described as a verified reconstruction.

Real footprints do not reveal exact windows, wall colours, interiors, floor plans or occupants. Accurate photorealistic copies need suitable licensed imagery, scans or authored models. AI can propose a plausible facade, but that does not make it the real facade.

The upgrade sequence is:

| Stage | Representation | Persistent data |
|---|---|---|
| First pass | Real footprint + cheap extrusion + limited palette | Feature ID, anchor and provenance |
| Better regional character | Roof forms, facade kits, vegetation, signs, region-specific assets | Same IDs and positions |
| Recognisable landmarks | Authored landmark models and better silhouette/height | Same place/entrance references |
| Photorealistic option | PBR materials, compressed textures and licensed detailed meshes | Same gameplay/ownership overlay |

Keep the cheap version available for every supported device. Use geometric detail levels, instancing of repeated props and merged static meshes; the existing Three.js renderer already uses these ideas. [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html). glTF and KTX2 are appropriate later asset-delivery options, subject to measured decoder, GPU-memory and download cost. [glTF](https://www.khronos.org/gltf/), [KTX](https://www.khronos.org/ktx/).

For large photogrammetry or landmark districts, evaluate 3D Tiles later. It supplies hierarchical spatial delivery, but adopting it does not itself create source models, collision or gameplay. Do not add a globe engine to the first download merely to reserve this possibility. [OGC 3D Tiles](https://www.ogc.org/standards/3dtiles/).

## 7. Location-based conditions

Use latitude/longitude, elevation, month, daylight and sourced climate values. Continents are organisational groups, not climate presets. Lagos and equatorial rainforest can be humid; the Sahara is arid; savannas have seasonal rain; highland areas can be much cooler. Antarctic interiors and coasts also differ. Southern and northern seasons reverse, and polar day/night must be handled explicitly.

A small region profile should contain monthly temperature ranges, moisture/rain statistics, wind, snow/ice propensity, elevation band and land-cover tags, with units and source period. Quantise and compress this offline. Exact variables and thresholds should be calibrated in the pilot; the model should not invent measured values.

Start with **climate-informed simulated conditions**. A deterministic seed plus a region profile produces coherent weather over time; neighbouring cells should blend rather than changing weather abruptly at a border. Daylight derives from date/latitude, and local clock display uses an IANA timezone with DST. Do not make a fresh random weather draw every frame.

Render cold/wet/dry conditions cheaply through light, sky/fog, ground/material variation and bounded particles. Simulate only active scenes. A billion unseen raindrops or NPC routines should not exist in memory.

Later, one server-side collector can fetch weather for active cells periodically, publish a timestamped compressed snapshot, and share it with everyone in that region. Keep source time, received time, expiry and fallback mode. When data is stale, return to the climate simulation and label it appropriately; never present a simulated fallback as current observed weather. A provider forecast/reanalysis is itself an estimate, not a sensor at each house. [Historical-variable reference](https://open-meteo.com/en/docs/historical-weather-api).

Start with visual conditions in the separate preview. Cold penalties, wet roads, queue changes, class schedules or transport disruption affect gameplay and must later pass through authoritative game rules. They must not silently change Nigeria’s economy or action durations.

## 8. Small downloads and responsive play

Retain the current lightweight world outline. On selecting a continent, load its country directory; on selecting a country, load its administrative/city directory; on entering London, fetch London’s bootstrap and nearby geometry. Do not embed every global city, place, road or import URL in the startup catalogue.

“Download London” should mean a city bootstrap plus streamed visible districts. An optional full-area download can show its measured size. London does not need all its buildings resident in RAM at once.

Preserve the current location-privacy rule: an optional device-location request resolves to a region inside the browser; exact device coordinates are not sent to the game or a weather provider. Allow manual city selection. Use the selected game region for content/weather requests, and distinguish the avatar’s location from the person’s physical location. Unsupported starting places should offer an available destination without claiming that their home town is already playable or changing an existing life automatically.

Use spatial cells for delivery, separate from administrative boundaries. Start by benchmarking city-wide lightweight map packs for the current miniature view, then add tile subdivision where density requires it. At street level, test roughly 256–512 m cells as a design candidate, with smaller cells for dense areas and coarser levels at distance. Cell size is a tuning choice, not a universal promise.

Each frame has a **total visible** budget across all cells, crowds, props and overlays. Existing limits are 90,000 triangles/40 draw calls for city maps and 17,000/60 for venue scenes. The provisional street tile target is 60 KB Brotli and 25,000 triangles, but nine tiles at their individual ceilings would already exceed the city triangle limit. Tile and whole-view limits must both be enforced.

Suggested prototype targets, not measured achievements:

| Item | Initial target |
|---|---|
| Existing Nigeria startup | Stay within current raw/gzip/Brotli gates; do not fund expansion by raising them |
| New city minimum bootstrap | Aim for ≤250 KB compressed incremental data, excluding already cached shared engine/assets; validate on representative cities |
| Individual street data tile | Start with existing ≤60 KB Brotli target, split or reduce detail on failure |
| Active fetches | Start with 2 on slow/mobile connections, tune from measurements |
| Persistent map cache | Begin around 50 MB automatic cache, adapt to reported quota and allow clearing; downloads beyond it need a size-visible user action |
| Frame target | At least stable 30 FPS on a defined low-end Android; seek 60 FPS where measured feasible |

At 1 Mb/s, even 60 KB needs approximately 0.48 seconds of payload transfer before latency and decoding; 250 KB needs about 2 seconds. Therefore prefetch ahead of movement, cancel obsolete requests, decode/build geometry in workers, and keep a coarse fallback ready. A tile cannot be assumed to arrive “within a frame.”

Use a bounded RAM/GPU cache with explicit disposal on eviction. Disk caching can use IndexedDB/Cache API as appropriate, but browser quota and eviction vary; graceful re-download is mandatory. Offline cached geography does not permit offline authoritative money/gameplay writes. [Browser storage](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

PMTiles is a good candidate for immutable vector basemap archives: range requests fetch a relevant portion of an archive. It is not itself a 3D engine or offline-download manager. Partition archives by manageable region/release because an archive cannot be updated in place. Keep actual game scene assets as separate content-addressed packs when that is simpler. [PMTiles concepts](https://docs.protomaps.com/pmtiles/).

Before shipping, verify Range responses, CORS, ETags, CDN cache behaviour and no accidental whole-archive download. Do not apply transparent whole-file compression that changes the archive byte offsets. Overture’s provided tiles are inspection-oriented, not a ready-made production basemap. [Cloud storage](https://docs.protomaps.com/pmtiles/cloud-storage), [Overture tiles](https://docs.overturemaps.org/examples/overture-tiles/).

## 9. Keep global coordinates out of the small scene

Canonical stored geometry stays geographic. Derive regional/tile local metre coordinates for rendering, with an explicit anchor, coordinate convention, scale, projection ID and elevation datum. Use a local tangent-frame implementation capable of polar locations; a later globe view can use earth-centred coordinates. Retain the exact legacy Nigeria frame as an adapter.

Atlas cartography, city miniatures and human-scale venue/street scenes are different views over shared identities. Do not inherit oversized atlas buildings or 100 m units for street collision and walking.

Use double precision for geospatial calculations and nearby origins for GPU positions. Include seam tests, antimeridian wrapping, polar coverage, islands, holes, bridges/tunnels and crossing streets at different elevations. Web Mercator alone cannot represent the poles. Shared administrative arcs should still be simplified once; tile cuts need buffers and consistent quantisation so adjoining pieces agree.

Administrative hierarchy must allow countries, territories, provinces, regions, counties, boroughs, districts and settlements; not all places have Nigeria’s state/city/LGA hierarchy. Rendering cells must not grant administrative ownership. Cities can cross administrative boundaries. Preserve existing Nigerian IDs; namespace new identities to prevent duplicate names such as different Londons from colliding.

## 10. A builder that can safely run unattended

Prefer a durable command-line service on an always-on machine to a single two-day chat. A laptop can run the pilot but sleep, memory contention and connectivity make it a poor unattended production worker. An approved dedicated worker can later run the batch without interfering with Nigeria development.

The proposed flow is:

```text
Pinned sources → regional extraction/index → geometry and climate compiler
                                             ↓
Sourced facts → optional Luna enrichment → validators → immutable candidate packs
                                             ↓
                           independent preview + acceptance reports
                                             ↓
                             reviewed application adapter/release
```

A small SQLite job ledger is sufficient for the first builder. It is a **new build database**, not the game database. Each job has a source/release/compiler/schema hash, region ID, stage, lease, attempt count, output checksum, timings and cost. Stages are fetch → verify → extract → compile → enrich → validate → package → preview-ready. Separate stages allow geometry to finish even if prose enrichment is unavailable.

Workers claim jobs transactionally, renew leases and write into temporary output directories. Only validated results are atomically promoted. Stale leases are retried; completed matching hashes are reused. Bounded retries with backoff handle transient failure. Repeated failure goes to a visible exception queue while unrelated regions continue. No empty file or invented place stands in for failed source ingestion.

Use one heavy GIS process on the current development machine until memory/disk measurements justify more; multiple cheap model calls do not imply multiple safe GIS processes. Scan each source region once and fan out city/cell outputs through a spatial index. The repository’s measured 6–7 minute city extraction would exceed 100 serial hours for 1,000 cities if repeated unchanged.

Treat source changes as a new release: hash inputs, pin tool versions and seeds, record licences, keep a rebuild manifest. Do not silently fetch “latest” halfway through a two-day run.

The unattended run needs hard cost/disk/time caps; an explicit city/region target set; startup disk checks; checksums; restart/resume tests; a stop control; and a concise final report showing successes, exceptions and remaining work. Notifications should be limited to completion, meaningful failure or required input.

## 11. What Luna should do

Use Luna for compact tasks: classify a sourced place into approved game categories, summarise evidence, produce local descriptions, flag inconsistencies, and select from supported visual archetypes. Supply a bounded fact packet, require schema-valid output with evidence IDs, and allow `unknown`.

Do not ask it to generate coordinates, boundaries, road graphs, measured temperatures, entire national geometry, arbitrary executable code or database migrations. A validator verifies identity references and consistency; it cannot prove that a plausible cultural claim is true. Escalate disputed/low-confidence facts and review representative regions plus exceptions before publication.

Use Astra for the initial contracts, difficult failures and acceptance decisions. Ordinary software performs the bulk of the world build. Do not keep an expensive model continuously rereading the whole repository.

There are two execution choices. **Codex Luna workers** can help implement and troubleshoot the builder using non-interactive execution and structured final results; their availability and allowance depend on the account. **Direct Luna API jobs** are a cleaner default for repeated data enrichment because the external job ledger controls inputs, costs, retries and outputs. Keep the provider interchangeable. Neither a resumed Codex conversation nor an API request substitutes for a durable job queue. [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [Codex/Work pricing and limits](https://learn.chatgpt.com/docs/pricing).

Official documentation lists `gpt-6-luna` at **$0.10/M input tokens and $0.50/M output tokens** for standard short-context processing. Batch is 50% of Standard, with a 24-hour completion window. Availability and queued-token limits still depend on the account; unsuccessful/expired items require recovery. [Luna model](https://developers.openai.com/api/docs/models/gpt-6-luna), [Batch API](https://developers.openai.com/api/docs/guides/batch).

Illustrative token-only arithmetic: one city packet with 8,000 input and 2,000 output tokens costs $0.0018 Standard or $0.0009 Batch. Ten thousand such packets cost **$18 or $9**. This is not the cost of a researched city: multiple passes, billable reasoning, tools/search, retries, review, data work and hosting are excluded. A 10× workload is 10× the cost. API pricing is not a prediction of Codex subscription allowance consumption.

Batch suits independent enrichment. Serial dependent batches can use most of a 48-hour window before repair, so keep source acquisition and essential geometry independent, submit enrichment early, and reserve time for synchronous fixes. Split by both request count and file size: the documented per-batch bounds are 50,000 requests/200 MB, alongside model-specific queued prompt-token limits. Persist custom job IDs for joining unordered results back to the ledger.

## 12. Keep Nigeria and current database work isolated

The strongest first boundary is a separate builder repository/output root with a frozen pack schema, source caches and preview. A dedicated worktree can be used for a later application adapter. A branch alone does not prevent shared files, databases or generated registries from being touched.

The builder gets no production database, deployment, merge or Nigeria-write credentials. Its source checkout is read-only; outputs go only into its own candidate-pack namespace. Exclude Nigerian content regeneration and preserve Nigeria’s current pack/provider. Existing country outlines can supply context without replacing its playable data.

Do not call today’s `cities:build` directly against the active checkout in a bulk worker: it regenerates common catalogues/loaders. Give the new compiler an explicit output directory and make it emit manifests/data rather than modifying runtime registries. A single integrator owns shared adapter changes.

Define a versioned contract with at least:

```text
pack ID, region ID, schema version, compiler version, source release
bounds, coordinate frame, origin, unit scale, elevation reference
geography/content/gameplay coverage states and known omissions
content hashes, measured bytes, dependencies, licences and evidence
minimum supported reader version, stable feature/entrance IDs
```

Initially packs contain data only. Scene builders come from a versioned allowlist in the app. A model cannot smuggle a script into a downloaded city pack. Resolve the pack version once per session/journey so geometry, routes and entrances are coherent. Reader compatibility is checked before opening a city.

Before integration, compare against the **current** main branch, not an old Nigeria snapshot, so legitimate concurrent Nigeria improvements survive. Run old-save restoration, homes/money/identity/travel regression checks; verify no protected generated files changed; compare startup closure/downloads; and test failed downloads without losing the life.

Any new country’s currency, calendar, careers, civic vocabulary, service requirements and climate need an explicit profile. Do not implement a new multi-currency ledger or convert Nigerian balances as part of world generation. A geographic preview can ship internally before those gameplay decisions are settled.

Later integration cannot be honestly guaranteed to require zero shared-code work. The isolation design makes the bulk build independent and the eventual shared changes small, owned and reviewable. Respect the project’s existing forward-fix release policy; retaining immutable assets for old readers is different from rolling back gameplay storage.

## 13. Global delivery is separate from multiplayer scaling

Static packs should live on object storage/CDN, outside gameplay SQLite and outside the main JavaScript bundle. That gives nearby delivery and avoids database work for every map view.

The actual authoritative player simulation still needs its own capacity programme. The inspected Worker uses one named object; current storage work may already change parts of this design, so coordinate through the existing owner rather than editing it here. Future regional rooms/shards need ownership, idempotent travel handoff, consistent receipts and a rule for where a player’s authoritative life lives. No two regions should credit the same money or simultaneously own the same move.

Dormant places consume static storage, not active NPC simulation. At runtime, tick only populated/active rooms and reconstruct deterministic ambient conditions when entering. A complete geographic world does not require millions of always-running game servers.

CDN caching can make geography fast globally, but it does not prove low-latency gameplay for everybody. Validate action latency, room update frequency and reconnect/reload across actual player regions separately.

## 14. Cost and storage model

Total cost = source acquisition + GIS compute + temporary disk + AI enrichment/review + output storage + requests/CDN + optional weather + gameplay hosting. Cheap tokens do not eliminate these other terms.

As a hosting candidate, R2 Standard currently lists $0.015/GB-month storage, $4.50/M Class A operations, $0.36/M Class B operations and no egress charge. Its free tier includes 10 GB-month, 1M A and 10M B operations. At those rates, 100 GB held for a month is about **$1.35 storage-only** after the free allowance, before operation rounding, other services and tax. It is not a whole-game hosting quote. [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

Illustrative output sensitivity: 10,000 lightweight city packs averaging 1 MB would be 10 GB; averaging 10 MB would be 100 GB. Neither average is measured. High-detail building tiles and photoreal textures may dominate storage. Raw inputs and build indexes can be much larger than final packs, so budget scratch disk separately.

Build-time throughput must be benchmarked. Planetiler documents planet-scale vector generation with substantial hardware and temporary storage; its historical example is evidence that automated global cartography is possible, not a timing estimate for this laptop or a playable Allworld world. [Planetiler planet guide](https://github.com/onthegomap/planetiler/blob/main/PLANET.md).

## 15. A credible two-day target

**Forty-eight hours can be an unattended batch window once the pipeline is built and measured. It is not a defensible guarantee of researching, coding, validating and publishing every city from the present code in two days.**

The first automatic-run target should be a globally navigable geographic foundation, preserved Nigeria, a bounded set of African preview cities, and a completeness/exception report. All settlements from the chosen gazetteer can have catalogue records without claiming all have finished gameplay. Dense global building detail can remain a later per-region production pass.

Proposed 48-hour batch allocation, conditional on a working pilot and available inputs:

| Window | Intended output |
|---|---|
| Hours 0–6 | Verify cached sources, resumable downloads, global/admin directories, source-coverage report; submit independent enrichment batches |
| Hours 6–24 | Compile lightweight Africa region packs, terrain/condition summaries and selected city previews; produce coarse global coverage |
| Hours 24–36 | Validate, retry failed regions, compile next queued regions as capacity permits, import returned enrichment |
| Hours 36–44 | Representative visual/geometry/journey checks; budget and compatibility reports; quarantine bad packs |
| Hours 44–48 | Finish safe repairs, write immutable candidate manifests and final report; retain pending work for resume |

This is an allocation, not a measured schedule. If acquisition alone exceeds the first window, the run reports it and resumes; it must not invent completion to meet a timer.

A simple capacity estimate after the pilot is `acquisition + critical-path work + serial GIS time + parallel enrichment + validation + retry margin`. In the simplified homogeneous case, city processing is approximately `city count × measured time / effective workers`, but disk contention and serial stages limit that speed-up. Include at least a measured failure/retry allowance rather than assuming perfect throughput.

## 16. Implementation sequence

1. **Freeze the boundary.** Document pack schema, protected Nigeria IDs/files, preview-reader interface and coverage meanings. Record the measured current build. No gameplay database change.
2. **Build a separate preview/compiler pilot.** Use Accra for nearby expansion, Nairobi for elevation/climate, Cape Town for southern seasons, London for latitude/DST/density, and one Antarctic cell for poles/cold/daylight. London and Antarctica remain engineering probes, not a change to the Africa-first rollout. Use sparse/rural and border cells too.
3. **Prove real geometry and restart behaviour.** Produce real footprint-based blocks; deliberately interrupt a job and resume; inject bad hashes, missing sources, oversized tiles and invalid geometry. Confirm zero Nigeria writes.
4. **Measure and choose packaging.** Compare current compact geometry modules/data packs versus vector PMTiles for the pilot. Record compressed bytes, decoder time, worker cost, visible draw calls, RAM/GPU memory, low-end-phone FPS and cache eviction. Select the simplest passing format.
5. **Add bounded Luna enrichment.** Compare output with evidence, measure acceptance/retry rate and actual tokens, then set the full-run cap. Keep source processing independent of model failures.
6. **Run the foundation batch.** Globally browseable directories and base geography; expand Africa in the agreed order; keep exact coverage counts and exceptions. Start on the measured local budget or an explicitly budgeted dedicated worker.
7. **Integrate once the reader is stable.** A separate app change adds region-aware lazy directories and a pack provider alongside legacy Nigeria. Coordinate route/time/country fixes with current engine owners. Research success alone does not mark new cities playable.
8. **Deepen and upgrade.** Fill local gameplay, walking, classes/queues and landmarks; add better regional kits; add optional photoreal assets only where they meet the same device goals.

The first concrete engineering deliverable should therefore be **the independent world-pack schema, compiler and five-location preview**, rather than thousands of generated changes to the game repository. It establishes whether the chosen data, fidelity and budgets work before multiplying them worldwide.

An additional useful idea is to make detail demand-aware: all regions have a coarse geographic representation, while a requested district moves up the refinement queue. Popular places can receive better landmarks and street detail sooner, within the Africa-first rollout policy. Players still enter only validated, published content; an in-game visit must not trigger uncontrolled model spending or expose unfinished output.

## 17. Acceptance checklist for that first deliverable

- Nigeria still uses its existing IDs, maps and saved lives; protected files are unchanged by the builder.
- Every imported geometry or factual statement has a source/release; estimated visual attributes are separate.
- Invalid polygons, water intersections, duplicate buildings and broken seams are detected or explicitly quarantined.
- Global hierarchy supports non-Nigerian administrative structures, duplicate place names, antimeridian and polar cases.
- City previews use local coordinates; street-scale geometry is not stretched atlas symbolism.
- Climate differs by region, season and altitude; northern/southern seasons, local time and polar daylight behave coherently.
- One London preview does not download other cities’ full geometry. Broken/missing/cached tiles have tested fallbacks.
- Total visible budgets pass on an actual target phone, including decode time and GPU memory; desktop browser observation alone is insufficient.
- Job restarts are idempotent, spend/disk limits work, and exceptions remain visible.
- New packs contain no player-save mutation, generated executable code, production credential or implicit deployment action.
- A completion report distinguishes geographic coverage, explorable previews, playable cities and detailed destinations.

The unanswered quantities are measured city/tile sizes, worldwide source completeness, cold-build throughput, available model queue limits, a real low-end-phone baseline and the current storage owner’s integration contract. None prevents the isolated pilot; all prevent an honest guarantee that every city will be production-ready in two days.
