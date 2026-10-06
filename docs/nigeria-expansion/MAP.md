# Nigeria expansion: state and file map

Read this first, then the continuation [README.md](README.md). This is the active checkpoint for the Nigeria expansion, not a claim that the expansion is complete. It remains usable as the restart point if the current session ends.

## Delivery state

| Item | State |
| --- | --- |
| Phase 0 formula and lazy registry | Published and verified live |
| Published commit | `ef8de66fa5a5b562d7bf8f899d3bf25f640bc631` |
| Live build verified | `joinallworld-ef8de66fa5a5b562d7bf8f899d3` |
| Release run | [37448046442](https://github.com/kromate/allworld/actions/runs/37448046442), both jobs successful |
| New cities opened | **0**; the original nine remain open |
| Current batch | Uyo, Calabar, Enugu, Makurdi, Asaba, Benin City |
| Current work | Active research and source-data preparation only |
| Checkpoint | Ready to continue from the current batch and local evidence |

The current batch follows the owner's revised priority: Akwa Ibom → Uyo, Cross River → Calabar, Enugu, Benue → Makurdi, Delta → Asaba, Edo → Benin City. Do not substitute Warri for Asaba. The earlier South-West work is parked, not discarded.

## Read and edit map

| Area | Files / purpose |
| --- | --- |
| City and home rules | [`docs/CITIES.md`](../../docs/CITIES.md); one main home, visitors and city modules |
| Shared map frame | [`docs/MAP-GEOMETRY.md`](../../docs/MAP-GEOMETRY.md) |
| Research contract | [`docs/CITY-RESEARCH.md`](../../docs/CITY-RESEARCH.md), [`src/game/cities/spec.ts`](../../src/game/cities/spec.ts) |
| Generator | [`scripts/city/build-city.ts`](../../scripts/city/build-city.ts), [`scripts/city/build-catalogue.ts`](../../scripts/city/build-catalogue.ts) |
| Shared runtime builders | [`src/game/cities/formula/`](../../src/game/cities/formula/), [`src/game/cities/contentBuilder.ts`](../../src/game/cities/contentBuilder.ts) |
| Lazy catalogue and save loading | [`src/game/cities/registry.ts`](../../src/game/cities/registry.ts), `catalogue.ts`, `lifeCities.ts` |
| All-city gates | [`src/game/cities/allCities.test.ts`](../../src/game/cities/allCities.test.ts), `manyHomes.test.ts`, [`src/game/stuck.test.ts`](../../src/game/stuck.test.ts) |
| Startup budget | [`src/app/entry.test.ts`](../../src/app/entry.test.ts), [`vite.config.ts`](../../vite.config.ts), [`scripts/startup-size.ts`](../../scripts/startup-size.ts) |
| Scenes | [`src/scene/parametric-venue.ts`](../../src/scene/parametric-venue.ts), its tests, and `city-scenes.ts` |
| Geographic source builder | [`scripts/geo/extract-city-osm.py`](../../scripts/geo/extract-city-osm.py), `scripts/city/geometry.ts` |
| New named-place research tool | [`scripts/geo/extract-named-places.py`](../../scripts/geo/extract-named-places.py) — uncommitted, tested locally |
| Current public-source candidates | [`scripts/city/research/<city>/`](../../scripts/city/research/) — unreviewed, do not stage indiscriminately |
| Prepared surfaces | [`scripts/geo/sources/formula/makurdi-surface.geojson`](../../scripts/geo/sources/formula/makurdi-surface.geojson), `calabar-surface.geojson` |
| Local handoff evidence | `.cache/nigeria-handoff/` — ignored, never publish wholesale |

## Current research map

The candidate counts below are provisional and include unsuitable or unresolved records. They are **not** valid CitySpecs. The fresh pinned-file results and the new curation notes are the best next input.

| City | Earlier candidate inventory | Fresh named OSM records | Boundary/review status |
| --- | ---: | ---: | --- |
| Uyo | 13 | 329 | Most points in Uyo; AKTC Park is in **Itu**, not Ikono. Uyo/Itam relationship has official support. Wider research also includes Uruan and Ibesikpo Asutan; final footprint is undecided. |
| Calabar | about 33 | 1,290 | Calabar Municipal + Calabar South. Surface ready. Service-role gaps remain. |
| Enugu | 24 | 4,601 | Enugu North + Enugu South + Enugu East. Airport verified; civic/service gaps remain. |
| Makurdi | 14 | 61 | All earlier points inside Makurdi LGA. Surface ready. Sparse named data; do not infer absence. |
| Asaba | 23 | 152 | Oshimili North + Oshimili South. Excludes a river point in Onitsha North. Several required facilities unresolved. |
| Benin City | 26 | 3,803 | All earlier points inside Oredo/Egor/Ikpoba-Okha. Best skeleton coverage, but hospital and some categories need correction. |

Fresh records: `.cache/nigeria-handoff/research/pinned-pois/<city>.json`.
Research configuration: `.cache/nigeria-handoff/priority-batch-poi-config.json`.
Drafts/findings: `.cache/nigeria-handoff/research/<city>/`; also inspect `scripts/city/research/<city>/` because output locations vary.
Spatial audit: `.cache/nigeria-handoff/research/admin-review.json` (predates the latest candidate edits; rerun for final selection).

## Resumed research tracker

These are exact-coordinate checked candidate lists, not valid all-roles CitySpecs. Counts are provisional; read each linked ignored note before promoting a record.

| City | Candidate list | Current gaps / next check |
| --- | ---: | --- |
| Uyo | 24 | Mosque, salon, polling facility, named terminal and non-generic market remain unresolved; AKTC Park is in Itu. [`curation-notes.md`](../../.cache/nigeria-handoff/research/uyo/curation-notes.md) |
| Calabar | 30 | Salon is outside the footprint; polling facility, exact GIG terminal coordinate, named markets and rail/port service remain unresolved. [`curation-notes.md`](../../.cache/nigeria-handoff/research/calabar/curation-notes.md) |
| Enugu | 26 | Polling venue lacks accepted official INEC confirmation; rail and port remain unresolved; Aguagwa heritage status needs proof. [`curation-notes.md`](../../.cache/nigeria-handoff/research/enugu/curation-notes.md) |
| Makurdi | 26 | Polling facility, salon, verified arrival park, road hub, airport status, market specialties and heritage/access claims remain unresolved. [`curation-notes.md`](../../.cache/nigeria-handoff/research/makurdi/curation-notes.md) |
| Asaba | 24 | Polling, salon, rail, port, named heritage/museum, exact motor park and hospital coordinates remain unresolved. [`curation-notes.md`](../../.cache/nigeria-handoff/research/asaba/curation-notes.md) |
| Benin City | — | Spec worker remains active; no spec is verified yet. Surface is ready: 291,711 bytes, SHA-256 `ab163b78f1f11078b6e5b48ebe9d3e1950fafef73faeb20e5b7301dcfdb7b36b`. |

Supporting Wikidata radius caches: Makurdi `makurdi/wikidata-radius18.json` (358 unique), Uyo `uyo/wikidata-radius20.json` (985 rows), and Calabar `calabar/wikidata-radius20.json` (258 rows). The old empty Makurdi-nearby result was based on an incorrect query. Use the working `api.php` `wbgetentities` path, respect the explicit one-request-per-minute WDQS limit, and do not rely on `Special:EntityData` (403).

## Active uncommitted work

- `docs/CITY-RESEARCH.md`: named-place extractor usage added.
- `scripts/geo/extract-named-places.py`: new research utility.
- `scripts/city/research/`: candidate caches and inventories; some exploratory files need pruning.
- `scripts/geo/sources/formula/`: Makurdi and Calabar derived geographic inputs.
- Benin City surface is prepared; Enugu surface generation is the only current heavy GIS job.
- No new city `spec.ts`, `index.ts`, generated runtime module or catalogue entry has been created.

The documentation may have a local documentation-only commit after the published gameplay commit. Inspect `git status` and `git log`; do not mistake that checkpoint for a city release.
