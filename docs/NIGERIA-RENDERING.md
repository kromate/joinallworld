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
