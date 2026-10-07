# UNILAG map source

`unilag-osm-source.json` is a privacy-minimized extract of OpenStreetMap data used to build the campus geometry. It contains public geometry, selected public tags, OSM object IDs, versions, and timestamps. Contributor usernames, user IDs, and changeset IDs are intentionally excluded.

The extract combines OSM API map snapshots for `3.380,6.505,3.405,6.530` and `3.380,6.500,3.405,6.506`, retrieved 2026-10-07. The second request supplies the southern portion of boundary way `539288366`, which extends below the first bounding box. The generated map uses buildings, mapped water or wetland polygons, mapped sports grounds, pitches and swimming pools, highways intersecting that boundary, named features, and named nodes inside it. Gate link ways `693550308` and `693550309` are retained because they connect the boundary entrance to University Road. Water, wetland and pool polygons block walking; pitch and sports polygons remain walkable and suppress decorative planting.

Regenerate the minimized source and TypeScript map:

```sh
python3 scripts/geo/build-unilag-map.py --extract /path/to/osm-map-akoka-wide.xml /path/to/osm-map-akoka-south.xml
python3 scripts/geo/build-unilag-map.py --check
```

Coordinates use a WGS84 Earth-centred frame projected onto the local tangent plane at OSM node `9889685634` (`6.5176963, 3.3851659`), the OSM-mapped main entrance and campus-boundary vertex. `x` increases east and `z` increases south. Coordinates are rounded to centimetres.

© OpenStreetMap contributors. The source data is available under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/). OSM geometry is community mapped and is not a survey.
