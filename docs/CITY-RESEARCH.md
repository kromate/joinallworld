# City research

Documented Nigerian places become a deterministic city spec. New specs contain facts only. Every place, transport claim, local-government relationship and coordinate needs a cited source. Do not fill a gap with a plausible venue, route, coordinate or business name.

## Research record

Use explicit source groups. Useful groups include government and agency records, OpenStreetMap or Wikidata coordinate records, administrative boundaries, institutional pages, and reputable local reporting. Save every consulted source in a repository-relative cache and record its byte count and SHA-256 hash. Keep each cache to the fields or short excerpt needed to support the declared claim. Omit contributor identities, contact details, unrelated page content and unrelated copyrighted text. The checker reads these pinned files and does not depend on a live page.

Each new city needs 20 to 30 real places. Record each place's real name, kind, cited description, exact OSM element or Wikidata entity, coordinate, coordinate accuracy and local government. OSM coordinate caches use Overpass JSON with the referenced element and `center` output for ways and relations. Wikidata coordinate caches use EntityData JSON with a P625 coordinate claim.

The place set must include the gameplay skeleton required by the schema: a road hub, arrival park, garden used for the evening gameplay option, eatery, hospital, government venue, polling venue, salon, savings venue, real stadium, both a church and a mosque, one to three markets, one to three universities, polytechnics or colleges, and two to three heritage, landmark or museum sites. Every selected local government needs at least one real place. A market is not required in every local government. These are source requirements, not permission to invent missing businesses or a nightclub.

Food, craft and industry facts have stable ids. An eatery points to a sourced food fact. Each market points to the sourced specialties it actually represents. The compiler uses those facts for the plate of the day, market shop types, local products and venue activities. Do not mark a shared shop product as local unless the research supports that commodity.

Climate research records a sourced regional profile, rainy months, dry months and any documented harmattan months. The compiler derives beta gameplay rain chances from the shared profile. Researchers must not invent monthly probabilities.

Transport arrays contain verified facilities only. Leave an airport, rail or port array empty when no verified service has been found. The empty array makes no absence claim. Add an optional absence record only when a source explicitly supports that negative finding; otherwise keep the question in the `not sure` list.

## Research worksheet

Complete this before writing the spec:

- City and state names, atlas OSM or Wikidata reference, and population tier source.
- Exact geoBoundaries ADM1 state name and every selected ADM2 local-government name.
- One pinned source table with id, title, public URL, checked date, supported claims, cache path, bytes and SHA-256.
- A 20 to 30 row place table with id, name, kind, local government, longitude, latitude, OSM or Wikidata reference, accuracy, identity sources and coordinate source.
- Market specialty ids and the source that connects each specialty to that market.
- Food, craft and industry facts, with a shared local product id only where the source supports one.
- Verified airport, rail and port facilities. Add a sourced absence record only for a documented negative finding.
- Climate profile, season months, plain-language note and sources.
- Scene choices for every place: roof, sign, up to two props, and an optional sourced landmark silhouette.
- The committed surface GeoJSON path, byte count and SHA-256 in `geometry.surface`.
- A `not sure` list. Leave unresolved names, coordinates, local-government membership, opening hours, specialties and transport status here. Do not put them in the spec.

Short agent prompt:

```text
Research <city> for an Allworld CitySpec. Use 20–30 real places across the required local governments. Cite identity separately from coordinates. Coordinates must resolve from a pinned OpenStreetMap Overpass JSON element or Wikidata EntityData P625 claim. Record exact source cache bytes and SHA-256. Find one road hub, one arrival park, a garden for the evening gameplay option, an eatery, hospital, government and polling venues, savings and salon venues, a real stadium, both a church and mosque, one to three markets, one to three tertiary institutions, and two to three heritage, landmark or museum sites. Record sourced food/craft/industry facts, market specialties, factual climate seasons, and verified airport/rail/port facilities. Empty transport arrays are allowed. Put unresolved transport and every other unresolved claim in a not-sure list. Invent nothing.
```

## Geometry source

City land, water, roads and rail come from pinned sources. Administrative boundaries use geoBoundaries gbOpen Nigeria ADM1 and ADM2 release `9469f09`. The repository keeps the exact pinned national ADM1 file once at `scripts/geo/sources/nigeria-adm1-9469f09.geojson`. A selected state is cut from a topology built with all 37 first-level units, so every state border is simplified once with both neighbours before subsetting. Surface extraction uses the pinned Geofabrik Nigeria `2026-10-03` PBF. The extractor verifies the PBF byte count and hash before reading it, uses a temporary file-backed node-location index, and removes that index afterwards.

The first measured extraction of the pinned national PBF took 6 minutes 33 seconds, reached 2.37 GB maximum resident memory and a 324 MB process physical footprint, and recorded no swaps. The 324 MB figure does not measure temporary index storage. Run one extraction at a time. A missing or mismatched PBF fails. It does not produce an empty surface.

After the pinned PBF and boundary files are present, generate a surface source with:

```sh
python3 scripts/geo/extract-city-osm.py \
  --city-id <id> \
  --state-id <state-id> \
  --state-source-name '<ADM1 name>' \
  --local-unit '<id>=<ADM2 name>'
```

Repeat `--local-unit` for every selected local government. The extractor clips mapped water, major roads and rail to the selected footprint. It writes `scripts/geo/sources/formula/<id>-surface.geojson` with the selected raw state and local-government boundaries plus pinned source metadata. Commit this derived source with the city research. It supplies selected ADM2 and surface data in clean CI. State topology always comes from the separately pinned national ADM1 source; generated TypeScript geometry is never used as its own source.

For several cities with incomplete Overpass coverage, put their `id`, exact `stateSourceName` and `{id, sourceName}` local units in a JSON array, then run `python3 scripts/geo/extract-named-places.py --config <cities.json> --output-dir <directory>`. The command verifies the same pinned PBF and boundaries, scans the PBF once, and writes one deterministic `<city-id>.json` cache per city. It retains named nodes and ways only, allowlists research-relevant tags, records coordinate ownership separately from way intersection, uses source node coordinates or a canonical `center` object for the full source-way bounding-box centre, and does not process relations. Run `python3 scripts/geo/extract-named-places.py --self-check` for the small synthetic ownership check. Run the national extraction alone: its temporary file-backed node index can use substantial disk space and is removed on normal exit.

## Build and check

Build a city from the repository root with:

```sh
node --experimental-strip-types scripts/city/build-city.ts <id>
```

The command validates the spec, pinned research caches, exact OSM or Wikidata coordinates, raw ADM2 membership, derived dry-land membership, non-overlapping local governments and non-overlap with open cities. It then generates rules, content, scenes, small geography metadata, lazy map, index and compact geometry modules, followed by the local city catalogue and loader files. Rules and content read only the small origin, bounds and dry-home-anchor module; topology remains behind the lazy map loader. Edit the source spec and research record, then regenerate. Do not hand-edit generated files.

Run the deterministic offline check with:

```sh
node --experimental-strip-types scripts/city/build-city.ts <id> --check
```

`--check` never downloads a source. It checks the city first and checks the generated catalogue only after the city passes. It fails when a cache or derived surface is missing, a hash or byte count differs, a coordinate does not match its referenced OSM or Wikidata record, a place lies outside its declared dry local government, required place coverage is absent, geometry overlaps another open city, or generated output is stale.

The catalogue can still be generated or checked on its own:

```sh
node --experimental-strip-types scripts/city/build-catalogue.ts [--check]
```

The checker cannot decide whether prose fairly represents a source, whether a source itself is trustworthy, or whether a cited identity page really supports every specialty and cultural claim. A human research review must inspect those claims before publication. A passing check proves internal consistency with the pinned records, not that no fact was invented.

## Sagamu preservation adapter

Sagamu is a separate legacy-preservation case. Its existing runtime includes explicitly fictional gameplay venues, so it cannot truthfully pass the new-city CitySpec contract. Its declarative recipe regenerates rules, shared-builder content, map and index modules, then compares the exact serialized rules, content and geometry with the pinned original baseline. This protects the current game from accidental changes. It does not prove that Sagamu was converted to the new archetype or that its fictional venues became researched real places.

Check the preservation adapter with the same command:

```sh
node --experimental-strip-types scripts/city/build-city.ts sagamu --check
```

## Release boundary

Review the city research record before running generation. Successful generation updates the generated city catalogue for the local source tree, but that local catalogue is not a deployment or public release. Do not start a downstream release until the CitySpec, generated modules and catalogue pass `--check` and the research record has been reviewed. Existing production cities remain unchanged until a separately authorized release.
