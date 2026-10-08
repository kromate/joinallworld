# Accra bounded OpenStreetMap pilot

`accra.geojson` is the small derived pilot dataset and is tracked so a clone can compile it without the private raw extract. Its `SourceRecord` pins the exact GeoJSON bytes with SHA-256 `df6d5847c5d3f1528fa0e4f642257141eba785bc89a640a3f609b8fb970aadbc` (70,637 bytes). `accra-config.json` records that input and the original extraction provenance separately: OSM API URL and bbox, downloaded 2026-10-08, raw XML SHA-256 `12a4f458f03d7e696f3a67f53825e9b877c6a6ade43e8f1b4cacc259bf44b8e8` (607,736 bytes).

The GeoJSON is derived from OpenStreetMap and is available under the Open Database License (ODbL); attribution: © OpenStreetMap contributors. See https://www.openstreetmap.org/copyright and https://opendatacommons.org/licenses/odbl/ . Keep this derived data separately attributed and licensed; this notice does not relicense OSM-derived data as code.

The converter retains source way IDs, tags relevant to buildings/roads, and geometry. It strips contributor/user identities. OSM relations are not resolved, and the FeatureCollection metadata preserves that exception. The compiler retains complete intersecting geometries, including roads whose endpoints lie beyond the selected bounds, and records those crossings in the manifest.

To regenerate the GeoJSON when `.cache/world-research/pilot/accra.osm` is available, run `node --experimental-strip-types world/pilots/convert-accra.ts` from the repository root.
