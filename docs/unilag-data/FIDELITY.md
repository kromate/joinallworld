# UNILAG geographic rebuild

Local source work, 7 October 2026. Not published. Browser inspection is pending permission to start the local preview.

## What changed

The campus uses the pinned OpenStreetMap boundary, road polylines and building footprints in local metres. It no longer compresses the campus into the old 600 × 480 rectangular layout. Main entrance node 9889685634 is the coordinate origin. The playable arrival is 9.43 metres inside the approach, clear of the modelled gate columns.

`/unilag` preserves campus intent through guest creation. New guests start in Lagos and the game engine places them at the main gate. Returning lives keep their current city and use the existing travel flow. Campus code loads on entry with a visible loading state and retry button.

The renderer extrudes the mapped polygons, renders near-tile facade details, keeps distant massing, and draws roads and the minimap from the same source. Navigation uses the same polygons, including pools and wetlands. Decorative planting and gate columns have shared collision. Ground remains level; no surveyed elevation model is included.

## Evidence and limits

- [OSM campus boundary 539288366](https://www.openstreetmap.org/way/539288366), version 23, edited 6 August 2026. See README for pinned source, snapshot timestamps, generator and licence.
- [Main entrance node 9889685634](https://www.openstreetmap.org/node/9889685634) is on that boundary beside University Road and links 693550308/693550309. Do not substitute the unrelated gates farther west.
- [Main gate photograph, Ei'eke, 14 May 2025](https://commons.wikimedia.org/wiki/File:University_of_Lagos_Main_Gate.jpg), CC BY 4.0. Visually inspected. The model uses the pointed walls and steel-canopy silhouette as reference; dimensions and structural details remain estimates. No photograph is bundled.
- [Transnational Architecture Group campus visit, 19 January 2024](https://transnationalarchitecture.group/2024/01/19/university-of-lagos-campus/). Senate photograph visually inspected. The model interprets the projecting cream and red facade and separates a taller southern mass from the low rear footprint. Tower height and massing split are estimates, not measured geometry.
- [Esri World Imagery service](https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer). Identify metadata at longitude 3.39, latitude 6.518 reports acquisition **15 May 2025**, Vantor Vivid Advanced, nominal resolution **0.34 m**, accuracy **8.47 m**, block `DYNAMIC_ESRI_Lagos_25Q3`, release `Raster Basemaps 2025.R11`. Gate and Senate image tiles were inspected. This is the available imagery date, not a claim of photography from October 2026. No imagery is bundled or used as runtime textures.

OSM geometry is community mapping, not a survey. Heights and road widths without source tags have explicit estimated provenance. Generic facades, window lighting, gate dimensions, planting and floor elevations are interpretations. The source image supplied by Anthony sets a visual target; it does not establish UNILAG geometry.

`UNMAPPED_LANDMARKS` in `layout.ts` records destinations whose location is still unresolved. No invented building is rendered for them. In particular, the mapped dispensary cannot establish the Faculty of Pharmacy, and the mapped southern Shopping Complex cannot establish New Hall Shopping. Mapped sports-centre placement identifies the broad grounds, not a surveyed entrance.

## Verification

| Unit | Evidence | Remaining work |
| --- | --- | --- |
| Source geometry | Deterministic generator check; nondegenerate footprints; source IDs and versions retained | Further name/footprint corroboration for unresolved places |
| Walking | All mapped anchors reachable; gate, trees, pools and wetland collision probes; boundary coverage probe | Browser walking and mobile performance |
| Shuttle | All directed pairs among mapped stops resolve on the road graph | Browser ride and arrival inspection |
| Scene | Real Three.js scene construction and mapped landmark movement executed in Node; 3 existing disposal/avatar/presence checks pass | Visual comparison, camera, lighting, loading and frame-time inspection |
| Entry | Five-project typecheck clean; 37 existing startup, quick-start, game, student and campus-game checks pass; direct engine probe confirms new guest entry and repeat-call non-teleport behavior | Fresh guest and returning-life browser paths |
| Existing campus tests | Combined gameplay integration runs through shuttle, admission, job and reload, then fails its old eight-stop count against six sourced stops | Some tests encode the retired compressed layout or assume every old named destination has an anchor; no tests were edited without authorization |
| Release | None | Build, deployment and production verification remain separate |

## Reproduce

Run `python3 scripts/geo/build-unilag-map.py --check` and `npm run typecheck` from the repository. The existing `npm run preview:campus` command opens the standalone local campus preview after server-start authorization. Its controls can jump to mapped landmarks, follow a walking route, inspect the occupancy grid and preview a shuttle ride. The preview does not prove the signed-in game flow.

## Delegation record

Luna performed bounded source mapping and entry audits. Sol implemented the deterministic data compiler, geographic navigation and entry flow. The parent integrated the renderer and inspected source and runtime artifacts. Token usage and monetary cost were unavailable. Browser verification has not run.
