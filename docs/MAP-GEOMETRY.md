# Map geometry contract

Every map in the game (the Nigeria atlas, a state map, a city map) is drawn in one shared frame, so the pieces tile into the real shape of the country. The code is `src/map3d/geo/frame.ts`.

## Projection

Equirectangular (plate carree) on a sphere of radius 6371.0088 km, with a fixed standard parallel of 9 degrees N, the middle of Nigeria. North is up.

```
x (east)  = (lon - 8) * cos(9 deg) * 6371.0088 * pi/180 * 10
z (south) = (9 - lat) * 6371.0088 * pi/180 * 10
```

- One map unit is 100 m (`UNITS_PER_KM = 10`).
- x runs east, z runs **south**, y is up (the same handedness as the city maps).
- The frame origin is 8 E, 9 N. Over Nigeria's 4 N to 14 N the east-west scale is within 3% of true; inside one state it is well under 1%.
- Use `project`/`unproject` for lon/lat, never your own formula.

## Local coordinates and origins

A map is drawn in coordinates relative to its own origin: `local = frame - origin`, `frame = local + origin` (`toLocal`, `fromLocal`). Origins are whole numbers of units, so placing every map at its origin reproduces Nigeria exactly. The origins live in the `ORIGINS` registry in `frame.ts`; Lagos is anchored at Lagos Island (3.40 E, 6.45 N).

## Adding a state

1. Choose an anchor: a recognisable point near the middle of the playable area. Add one line to `ORIGINS` with `originAt(lon, lat)`.
2. Add the state's local-government (or district) shapes as a data chunk `src/map3d/geo/data/<state>.ts` and a reader beside `lagos-shapes.ts`. Extend `scripts/geo/build-boundaries.ts` (the ADM2 selection and id list) so the chunk is generated, never edited by hand.
3. Use the game's own ids for the features, so the map and the game agree.
4. Add boundary tests next to `src/map3d/geo/boundaries.test.ts`: coverage of the state by its parts, no overlap, round trips.

## Data sources and licences

| Data | Source | Licence |
| --- | --- | --- |
| Nigeria states (ADM1), Lagos local governments (ADM2) | geoBoundaries gbOpen, release 9469f09, original source GRID3, year 2022 | CC BY 4.0 |
| Neighbouring countries, rivers, lakes, world and Africa | Natural Earth | Public domain |

Exact URLs, hashes and byte counts are in `src/models/geo/provenance.json`; the attribution text is in `NOTICE.md`. `npm run geo:boundaries` downloads the pinned geoBoundaries files into `.cache/geo` (git-ignored), verifies their sha256, and rewrites `data/lagos.ts` and `data/nigeria.ts`. Each data file's header records source, processing and tolerance.

## Chunks and lazy loading

| Chunk | Contents | Size now | Budget |
| --- | --- | --- | --- |
| `data/nigeria.ts` | 37 states, neighbours, rivers, lakes (including the Lagos Lagoon) | about 47 kB | 60 kB |
| `data/lagos.ts` | 20 local governments, State outline, lagoon | about 14 kB | 60 kB |

Data chunks are never part of the first download. `nigeria.ts` is loaded by the atlas level that needs it; `lagos.ts` is imported (through `lagos-shapes.ts`) only by the lazily loaded Lagos city map. A new chunk follows the same rule and states its budget in a test.

## The shared-arc rule

A border two regions share is stored as one arc, simplified **once**, and quantised **once**; both neighbours then use the same vertices, so tiled maps have no gaps and no overlaps. Never simplify a polygon on its own. The topology format is described in `src/map3d/geo/topo.ts`. Simplification is Visvalingam-Whyatt with the threshold in square map units (1 unit squared = 10 000 m squared); Lagos State's own arcs use a finer one so its coast and lagoon stay recognisable at the Nigeria level.

## The water rule

Boundary shapes are **land only**. Water is anything not covered by land: the Lagos Lagoon and the Lekki Lagoon are the gaps between the Lagos local governments. Do not draw water as polygons on top of land, or add land under it; draw the sea and lagoons as the background that shows through. The State outline (ADM1) includes the lagoon; the `lagoon` shape in `lagos.ts` is derived (State outline minus the 20 local governments, traced from a 0.0002 degree raster) and is there for convenience, for example the Nigeria atlas lake.

## Lagos local-government ids

`agege`, `ajeromi-ifelodun`, `alimosho`, `amuwo-odofin`, `apapa`, `badagry`, `epe`, `eti-osa`, `ibeju-lekki`, `ifako-ijaiye`, `ikeja`, `ikorodu`, `kosofe`, `lagos-island`, `lagos-mainland`, `mushin`, `ojo`, `oshodi-isolo`, `somolu`, `surulere` (the same as `LAGOS_LGAS` in `src/game/content/world.ts`), plus `lagos-state` for the outline. `lagosShapes()` in `src/map3d/geo/lagos-shapes.ts` returns them as lon/lat polygons, `[outer ring, ...holes]`.

## Symbols are not to scale

Shapes (coastline, local government borders, lagoon, island outlines, road routes) and positions are true to the frame. Symbols are not: at 100 m a unit, a venue landmark is drawn about 500 m across, a road about 180 m wide, and the fabric houses of built-up areas are sketches about 150 m wide, so that places can be read and told apart. Where two landmarks would overlap (the cluster on Lagos Island is under 400 m across) their order and direction are kept and only the icons are nudged apart by the minimum needed; the zoom levels, not any stretching of the map, make the dense core readable. A map never exaggerates the core non-linearly.

## Known limits of the water

Water is whatever the land polygons leave uncovered, so the Lagos Lagoon and the eastern Lekki Lagoon appear exactly as the source draws them. Water that lies inside a land polygon in the source is drawn as land: the Apapa harbour and the Badagry creeks. No open dataset with a compatible licence for them has been added; when one is, draw them as additional holes in the land polygons, not as overlays.
