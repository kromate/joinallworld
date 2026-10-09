# Nigeria map rendering

## First pass

The city map keeps the existing geometry, instance counts, water openings, and interaction model. The first rendering pass improves the image through the renderer and the colors already assigned to land and buildings:

- ACES filmic tone mapping with a small exposure lift keeps pale roofs and sand from washing into the land while preserving readable highlights.
- Lower, warmer daylight and distinct dusk and night presets give buildings and relief more shape. The night preset keeps enough ambient and moonlight to read roads and landmarks.
- Muted green land, warmer built-up areas, deeper coastal water, and earth-colored roofs give the city a clearer material hierarchy.

The city still uses two scene lights and no real-time shadow maps. The coastline remains land-only: the existing water plane shows through holes in the land. No geometry, texture downloads, meshes, draw calls, or triangle budgets are added. The renderer also continues to use the existing context-loss fallback and simple map mode.

## Budget and behavior checks

`src/map3d/map3d.test.ts` pins the filmic renderer setup, verifies transitions across the time presets, and measures the city with every layer active against the existing triangle and draw-call limits. The existing tests cover idle demand rendering, disposal, pointer interactions, travel, and the map fallback.

For a visual comparison, open the Lagos map at day, dusk, and night and compare the land-water edge and dense city fabric at both core and whole-map zoom. The change is color and light only, so venue positions, route positions, and shoreline geometry stay on the shared geographic frame.

Validation for this first pass: all 24 tests in `src/map3d/map3d.test.ts` pass, including the full-layer budget cases for both vehicle renderers; the five TypeScript projects report no errors; and the production build completes. The browser review has visually checked the night view. Day, dusk, and day again are covered by the renderer regression, with one frame per change and no idle animation loop.

The full-layer fixtures measure 84,643 triangles / 34 draw calls with the map vehicle and 84,749 / 38 with the model-library vehicle, under the existing 90,000 / 40 limits. Download checks pass: first paint is 35,421 bytes Brotli and Lagos startup is 194,779 bytes Brotli. These are build compression measurements, not physical-phone FPS or a measured live transfer.

The original isolated game server used disposable data on port 5193. Lagos was inspected at desktop and 390-pixel width with no horizontal overflow, and the flat-map switch and return to 3D worked without console errors. Before/after images are in `.cache/render-evidence/`.

A separate fresh disposable session was inspected through the normal game UI on port 5195. At the visible game clock `Thu 8 · 4:02 am` and again at `4:03 am`, the Lagos 3D scene was in its night preset. The game clock advanced normally; no user-facing control to set day or dusk was available, so those lighting presets were not visually verified in this session. The Nigeria-level map was also inspected and showed the state list, including FCT/Abuja. Travel to another city was gated by the starter “Settle in” flow; after completing the first Ayo goal the next goal was “Say hello to someone,” so no inland city scene was reached. I did not bypass travel or alter save data. These visual checks therefore confirm the night appearance in Lagos only; day/dusk and inland-city appearance remain unverified. No Nigeria geography, identities, existing saves, routes, catalogue or database was edited.

## Controlled renderer acceptance and lagoon correction

The standalone page `scripts/map-render-preview.html` now mounts the production city renderer with local fixture states and visible Lagos/Abuja/Kano, day/dusk/night and camera controls. It explicitly loads each city's content before mounting, disposes the previous renderer and observer on a city change, ignores stale asynchronous loads, and defaults to reduced motion. It has no gameplay API calls or player-record writes. The entry lives under `src/map3d/preview/` so the client TypeScript project checks its browser globals; its Vite configuration builds only a separate ignored preview output.

Daylight inspection exposed an existing visual error: at longitude 3.43, latitude 6.49, Lagos's detailed land excludes the lagoon, but the coarse administrative context base covers it. A raycast confirmed that this background was above the water plane. Coastal context bases now sit 0.02 map units below the existing water plane; inland bases keep their original height. Shoreline coordinates, holes, triangle topology, colors, feature positions and all source data stay unchanged. The change reveals the existing blue lagoon and bridges without adding a mesh, texture or rendering pass. Regression tests check the real lagoon, the Yaba home on land, and unchanged coastal/inland base topology and horizontal coordinates.

The controlled renderer has been visually inspected in all three lighting presets for Lagos, Abuja and Kano at actual 1280×720. Lagos and Kano were also inspected at actual 390×844; document width was 390 and map canvas width 368, with no horizontal overflow. These checks complete the previously missing renderer-state inspection; they do not validate the gated normal-game travel journey or physical-phone performance. Default desktop scenes measured Lagos 76,131 triangles / 24 calls, Abuja 78,522 / 22 and Kano 84,480 / 23. All **35 focused tests** pass across map, water, context and Lagos geography, including the existing full-layer 90,000-triangle / 40-call budget checks.

Screenshots and raw evidence are in `.cache/render-evidence/`: `lagos-day-context-before.png`, each city's `*-day-preview.png`, `*-dusk-preview.png`, `*-night-preview.png`, narrow `*-mobile-preview.png`, `context-water-regression.tap` and `lagos-context-base-lagoon-diagnostic.json`. The before/after lagoon comparison uses the same production pack and initial camera. The preview diagnostics timer reads counters without scheduling map frames.

Final acceptance also passes the five-project TypeScript check (zero TypeScript/Vue errors), production build and standalone preview build. The download report passes every measurable limit: largest startup over 40 cities is 614,121 raw / 222,553 gzip / 194,754 Brotli bytes; first paint is 35,425 Brotli bytes for its five-file HTML/CSS/JavaScript closure. These are build compression figures. Wardrobe-item and street-tile budgets remain unmeasured in that report. Final browser evidence records no console errors and an idle render count of 8 at both separated reads. Logs are `nigeria-final-build.*`, `nigeria-final-download.*`, `nigeria-preview-build.*`, the honest summarized `nigeria-final-typecheck.json` receipt, and `nigeria-renderer-browser-qa.json`. The first Kano dusk capture was interrupted by the source edit's hot reload and replaced after the source was frozen.

To run the isolated visual tool without a game server:

```sh
node --experimental-strip-types scripts/agent-slot.ts server -- node node_modules/vite/bin/vite.js --config scripts/map-render-preview.config.ts --host 127.0.0.1 --port 5196 --strictPort
```

Open `http://127.0.0.1:5196/scripts/map-render-preview.html`. Production builds do not import this entry. The accepted browser inspection used the existing Nigeria-worktree development server on port 5193, whose working directory was independently verified.

## Upgrade sequence included in the world plan

This first upgrade improves the existing miniature map. The next representation milestone adds streamed, sourced building footprints and roads through the separately tested world-pack adapter, preserving Nigeria's identities, player homes, saves and travel. Mapped footprints and estimated extrusion heights must stay distinguishable from surveyed buildings. More detailed roofs, facades and landmarks then attach to those stable identities with distance-based detail and shared materials. Photorealistic assets follow only where licensed reference data and measured device/download budgets support them. Regional conditions remain a sourced environment layer; they are not inferred from map colors or applied uniformly across a continent.

Keep the rendering branch separate from concurrent graphics/database work until the explicit integration milestone. Review its lighting, water-height and test changes alongside the current water-shimmer edit; the source patches occupy different sections. No integration or deployment has occurred in this milestone.
