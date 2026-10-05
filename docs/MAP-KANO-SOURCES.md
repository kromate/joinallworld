# Kano map sources

The Kano city map opens the eight metropolis local governments: Kano Municipal, Dala, Fagge, Gwale, Nassarawa, Tarauni, Kumbotso and Ungogo. The state overview retains all 44 local governments. Its other 36 polygons are context and do not grant playable-city access. Names are the pinned 2022 source names, including Kunchi; this geometry layer does not claim a current administrative name register.

The administrative sources are geoBoundaries gbOpen Nigeria, release `9469f09`, originally GRID3 2022, under CC BY 4.0. The exact original union of all 44 selected ADM2 polygons equals the Kano ADM1 outline. The city `playArea` comes independently from the eight original ADM2 polygons. Mapped water is cut from their navigable land; it does not define or expand the footprint.

| Source | URL | SHA-256 | Bytes |
| --- | --- | --- | --- |
| ADM1, NGA-ADM1-27671186 | [Pinned states](https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/NGA/ADM1/geoBoundaries-NGA-ADM1.geojson) | `64fa218ac3d453cc1e66412ff461c5dfa1a4a1ade0da93b239a9891b587d28f9` | 2,289,696 |
| ADM2, NGA-ADM2-59680162 | [Pinned local governments](https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/NGA/ADM2/geoBoundaries-NGA-ADM2.geojson) | `bef7f2cfa45e012f4772eaa61c7b99e5188aeba4d5c6badae7e9f9aae8c02fcd` | 9,422,551 |
| OpenStreetMap Nigeria, 2026-10-03 | [Geofabrik PBF](https://download.geofabrik.de/africa/nigeria-261003.osm.pbf) | `6dfa568106792fb8a9bba0b12a91e1edfb789d38c452087b2c48bc58326880b5` | 709,273,731 |
| Derived Kano land, water and transport | `scripts/geo/sources/kano-surface.geojson` | `10ca8a37bc7a9c4b95fc443ad0a8b7c6e971cf5b04aa804a3948f20fccd51fab` | 648,855 |

Water, roads and railway segments are © OpenStreetMap contributors under ODbL 1.0. Sources were retrieved on 2026-10-05. The derived artifact records selected object identities, extraction hashes and processing parameters. Named primary, secondary, trunk and motorway roads are clipped to the city footprint; source `bridge=yes` identifies displayed flyovers. The illustrative deck height is not a measured bridge elevation. Rail segments are local map context, with no claim of passenger service or a complete national route. Coming road and rail links have no invented route preview.

All render positions use `src/geo/frame.ts`. The city anchor is 8.52 E, 12 N, giving the whole-unit frame origin `{ x: 571, z: -3336 }`, with x east and z south. Administrative and city surface layers use shared arcs, a 0.000001-degree grid and a 0.0001-square-unit Visvalingam threshold. This finer administrative grid preserves Goron Dutse Hill's source point in Gwale, 1.2 metres from the Dala boundary. The coarser 0.0002-degree display grid misassigned that point. State-overview water uses a 0.00002-degree grid and a 0.02-square-unit threshold. Original reservoir islands remain land. Roads and local rail are simplified at 0.00006 degrees while retaining source vertices and clipped endpoints.

The fictional Nassarawa starter estate, public garden and rental use the mapped Gama locality node [2974797951](https://www.openstreetmap.org/node/2974797951), at 8.55362 E, 12.0327 N. The point belongs to Nassarawa in the original administrative source and lies on dry land. It is a locality reference, not a surveyed property.

Gates use named source points, including [Kofar Nassarawa](https://www.openstreetmap.org/node/4395771247), [Kofar Mata](https://www.openstreetmap.org/node/4395782139) and [Kofar Kabuga](https://www.openstreetmap.org/node/4395858272). The pinned PBF contains no identified ancient Kano wall alignment. Unnamed compound walls and modern road embankments are not relabelled as ancient walls, and gate points are not connected into an inferred circuit. The separate heritage layer adapts the red published outline in [Adamu et al. (2024), Figure 3(a)](https://doi.org/10.56578/tsdd010103), under the article's CC BY 4.0 licence. The combined figure caption credits Yusuf et al. (2023a); upstream authorship of the red overlay has not been independently established. The adaptation contains 721 traced outline vertices and bundles neither the underlying basemap nor a photograph. It shows a published historic alignment, approximately georeferenced, without claiming that a standing wall follows that line today.

Three mapped gate ties determine the affine alignment. Independent controls have observed residuals of 49.8 metres at a road junction and 97 metres at the Goron Dutse hill symbol. Other gates are 140–803 metres from the red outline pixels. These observations disclose the illustration's limits; they are not a guaranteed positional error bound. The trace is drawn as a separate dashed heritage line in the common frame and labelled "Historic wall outline (approx.)". It does not become a road, navigation barrier, collision wall or new playable entrance. The rendered points follow the source sequence exactly, including the source's closing point; no extra circuit is constructed.

Wudil campus and Tiga Dam belong on the state overview. They are excluded from the city marker layer when outside the eight-LGA footprint. Catalogue source notes qualify published coordinates and mapped-feature centroids; none is claimed as a surveyed entrance. A source named Tiga Reservoir node at 11.5837037 N conflicts with the mapped reservoir location and is not used to position the dam. The dam's separately cited coordinate near 8.4025 E, 11.43722222 N agrees with the reservoir context. No physical Tiga rock location is inferred from a hotel name.

## Reproduction

Normal generation needs the existing Node.js runtime and the pinned administrative files. It verifies every source hash and writes only the selected Kano target:

```sh
npm run geo:boundaries -- --kano
npm run geo:boundaries -- --kano --check
```

An optional refresh recreates the committed surface artifact from the exact Geofabrik PBF. Use Python with pyosmium 4.3.1 and Shapely 2.1.2. Native tag and entity filters select relevant ways and water areas; national node tags are not materialized in Python.

```sh
python scripts/geo/refresh-kano-surface.py --pbf nigeria-261003.osm.pbf --check
```

The helper also accepts `--extracted-dir` for previously extracted records whose byte hashes match its pinned constants. No Python package or new npm dependency is needed for normal generation. Geometry tests exercise the original administrative partition, water cutouts, near-border ownership, source road projection and the Gama estate anchor. They are bounded samples and selected point checks, not a complete cadastral proof.


The wall adaptation has a separate reproducible refresh. Use Python with pypdf 6.10, Pillow 12.3 and NumPy 2.3.5; the script verifies the pinned PDF and extracted figure hashes before tracing and georeferencing the red outline. Attribution, control points and qualifications are exported with `src/map3d/geo/data/kano-wall.ts`.

```sh
python scripts/geo/refresh-kano-wall.py --pdf TSDD_01.01_03.pdf --check
```
