# Rivers geometry sources and reproduction

This document records the source chain for the Port Harcourt and Rivers State map layers. It describes the committed reproducible input and the derived artefact used by the generator. The water layer is map data for a game surface; it is not a hydrographic survey, navigational chart, ferry timetable, or claim about an operated service.

## Normal reproduction

The normal deterministic command is:

```sh
npm run geo:boundaries -- --rivers
npm run geo:boundaries -- --rivers --check
```

The generator accepts one explicit target at a time: `--lagos-only`, `--oyo`, `--ogun`, `--rivers`, or `--nigeria`; `--check` compares generated text and decoded topology without writing. The Rivers target reads the committed `scripts/geo/sources/rivers-water.geojson`, verifies its SHA-256 and embedded PBF provenance, combines it with the pinned geoBoundaries ADM1/ADM2 cache inputs, and writes `src/map3d/geo/data/rivers.ts`. It does not require the extraction scripts, a scratch directory, or a locally available PBF for this normal path.

The committed Rivers water source is 5,140,595 bytes and has SHA-256 `176197c043a0975eb5f7d1bfe72cc9e1eca3d2a297f06476eeed0f9681ac7b36`. Its metadata records 540 selected water area objects, 750 `wetland=mangrove` area objects and the derived route. The selection bbox is recorded below and in the provenance catalogue. The generated module carries the same source hash and the PBF hash for provenance.

## Local-government display names

The pinned ADM2 release spells two names `Emuoha` and `Omumma`. Display aliases use **Emohua** and **Omuma**, matching the [INEC Rivers office list](https://cvr.inecnigeria.org/locator/browse/33/). The same official list uses **Ogu/Bolo**; **Akuku-Toru** follows the hyphenated form in INEC's [state-election constituency list](https://inecnigeria.org/wp-content/uploads/2022/10/2023-GENERAL-ELECTION-FINAL-LIST-OF-CANDIDATES-FOR-STATE-ELECTIONS-GOVERNORSHIP-HOUSES-OF-ASSEMBLY.pdf). Official publications also use spaces for these compound names. These are display-only aliases: source selectors, stable IDs and every polygon remain unchanged.

## Pinned upstream inputs

Administrative boundaries use geoBoundaries gbOpen Nigeria release `9469f09`, originally GRID3, under CC BY 4.0:

- ADM1: `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/NGA/ADM1/geoBoundaries-NGA-ADM1.geojson`; SHA-256 `64fa218ac3d453cc1e66412ff461c5dfa1a4a1ade0da93b239a9891b587d28f9`; 2,289,696 bytes; boundary `NGA-ADM1-27671186`; retrieved 2026-10-05.
- ADM2: `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/NGA/ADM2/geoBoundaries-NGA-ADM2.geojson`; SHA-256 `bef7f2cfa45e012f4772eaa61c7b99e5188aeba4d5c6badae7e9f9aae8c02fcd`; 9,422,551 bytes; boundary `NGA-ADM2-59680162`; retrieved 2026-10-05.

Water and wetland source:

- Immutable Geofabrik URL: `https://download.geofabrik.de/africa/nigeria-261003.osm.pbf`
- SHA-256: `6dfa568106792fb8a9bba0b12a91e1edfb789d38c452087b2c48bc58326880b5`
- Source date: 2026-10-03
- Bytes: 709,273,731
- Licence: Open Database Licence 1.0; attribution: © OpenStreetMap contributors.
- Selection bbox: longitude 6.65..7.60, latitude 4.35..5.35.
- Selected area tags: `natural=water`, `natural=wetland`, `waterway=riverbank`, and `waterway=dock`. Mangrove selection uses `wetland=mangrove` within the same source pass.

The derived GeoJSON embeds the selected OSM way/relation ids, so the committed input remains auditable without shipping the full PBF. Coordinates are rounded to seven decimal degrees in the extracted source.

## Offline extraction recipe

Upstream source preparation is separate from normal regeneration. The following sequence produces the clipped input; normal regeneration consumes the committed, hash-verified result.

1. Read the pinned PBF once with `pyosmium` using `locations=True`. Select the area tags above and retain only geometries intersecting the bbox. A separate named-node scan is not part of water preparation. Convert OSM areas to GeoJSON geometries and round coordinates to seven decimal places.
2. Load the pinned Rivers ADM1 and ADM2 GeoJSON. Set all boundary geometry to `1e-7` degree precision. Select the seven opened local governments: Port Harcourt, Obio/Akpor, Eleme, Okrika, Ikwerre, Oyigbo and Etche. Union those seven polygons into the open play area.
3. Union selected water polygons, intersect the result with the pinned Rivers ADM1 polygon, then apply topology-preserving simplification at `0.00005` degrees and set precision back to `1e-7` degrees. Union selected mangrove polygons, intersect with the seven-LGA open area, simplify at `0.00005` degrees, and set precision to `1e-7` degrees.
4. For each opened LGA, derive paired surfaces from the same water mask: `land = LGA - water` and `water = LGA ∩ water`. The generated land and water layers share the same arc-building path. State-overview water and mangrove layers are separately built at their display tolerances; they do not define the city navigation mask.
5. Build the shared-arc topology. Each arc is simplified once using Visvalingam–Whyatt effective-area thresholds in the Nigeria frame, then quantised to its layer grid. Rivers tolerances are: LGA/state grid `0.0002` degrees with effective areas `0.01` square map units; city water grid `0.000001` degrees with effective area `0.0001`; state-overview water grid `0.00005` with effective area `0.05`; mangrove grid `0.00002` with effective area `0.02`. One map unit is 100 metres.

The source preparation uses Python with `osmium==4.3.1` (pyosmium), `shapely==2.1.2` and `numpy==2.5.3`. These are offline GIS tools, not application dependencies. Versions can be verified with `importlib.metadata.version`; the `osmium` module does not provide `__version__`.

## Optional upstream refresh

`refresh-rivers-water.py` recreates the committed intermediate from the original PBF. It is an offline GIS utility, separate from the TypeScript application and normal generator. It validates the PBF and administrative input hashes before processing and can compare the complete output without writing:

```sh
npm run geo:boundaries -- --rivers --check
python3 -m venv .cache/geo-tools
.cache/geo-tools/bin/pip install osmium==4.3.1 shapely==2.1.2 numpy==2.5.3
curl --fail --location --output .cache/geo/nigeria-261003.osm.pbf https://download.geofabrik.de/africa/nigeria-261003.osm.pbf
.cache/geo-tools/bin/python scripts/geo/refresh-rivers-water.py --pbf .cache/geo/nigeria-261003.osm.pbf --check
```

Omit `--check` only when deliberately replacing the intermediate. The pinned snapshot reproduces all 5,140,595 bytes and the source SHA-256 above. No Python package is needed to build, run or test the application from the committed source.

## Derived boat route

The route solver uses the source-water component containing the two endpoints:

- departure: `(7.0247212, 4.7576372)`;
- arrival: `(7.0823282, 4.7471189)`.

It clips the selected OSM water to the seven-LGA open area, simplifies the water mask at `0.00005` degrees for the research search, and searches a four-neighbour grid with A* at `0.0003` degree resolution within `7.015..7.105 E, 4.70..4.77 N`. The grid nodes must lie inside the same connected water component. Each move costs one grid step and the heuristic is Euclidean distance in grid cells. Neighbours are visited in east, west, north, south order; heap entries sort by `(estimated total cost, travelled cost, (x index, y index))`. Each endpoint chooses the nearest visible valid node in the first nonempty radius of one through eleven grid cells. The solver then applies greedy line-of-sight reduction, trying the farthest later path point first and accepting a segment only when the complete segment remains covered by that water component. Every retained segment is checked again against the source water mask.

The committed route has 21 points. The boarding tolerance is `0.0000001` degrees. This tolerance is used to cover endpoint boarding and is about one centimetre at Rivers latitude; it does not turn a land crossing into a navigable channel. The route metadata explicitly says it is a water-connected derived path, with no ferry schedule or surveyed-channel claim.



## Licence and limitations

Administrative boundaries are attributed to geoBoundaries/William & Mary geoLab under CC BY 4.0. OSM-derived water and wetlands are attributed to OpenStreetMap contributors under ODbL 1.0. The generated data is modified, simplified, quantised and converted to ES modules. The water mask and route are suitable for the game's map and bounded boat interaction; they do not establish a surveyed shoreline, depth, channel clearance, public landing, commercial operator, or schedule.
