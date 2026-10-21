# Data-light mode

Data cost is the top complaint of African players (42%); 81% of phones sold in Africa cost under US$200; 32% play with energy saving on
(FEATURES.md #4). This page is the audit of what the game already did about it, then what Light mode adds, and what still has to be
measured on a real low-end phone. Keep it in step with `src/lightMode.ts`.

## 1. Audit: what existed before

| Area | What was there | Where |
| --- | --- | --- |
| Draw only on demand | A scene is drawn only while something moves; the one frame loop ends itself on the first "nothing moves" and when the page is hidden. Tests prove idle = 0 frames, hidden = stopped. | `src/scene/motion-loop.ts`, `src/venue-world.test.ts`; the city map and the atlas keep their own on-demand loops that also stop when the page is hidden (`pageHidden()` in `src/map3d/map3d.ts`, `src/map3d/geo/atlas.ts`); the guide draws at most 30 a second and only while the page is visible (`src/app/features/companion/stage.ts`) |
| Render tiers | `renderTier()`: phone (pixel ratio 1.5, 1024 shadow map), wide (2) and high (2.5, environment map, bloom). Chosen from the device, never from a frame rate. `?quality=` forces one. A renderer's context is given back when a scene closes. | `src/scene/look.ts`, `docs/PERFORMANCE.md` |
| Device class | Dive and aerial city: `diveTier` / `aerialTier` / street-life `deviceTier` cut or halve on reduced motion, **`connection.saveData`**, 2 cores or fewer, under 2 GB. | `src/map3d/dive.ts`, `aerial-plan.ts`, `src/scene/street-life/plan.ts` |
| Background downloads | `preloadNext` fetches the phone, map, Jobs, Groceries, Buy mode and Boutique chunks when idle, one at a time; it already held back on `saveData` and 2G/slow-2G. `ScenePane` fetched the map's code after the scene. A trip warms the destination's scenes. `warmLanding` warms the landing on a new device. | `src/app/state/idlePreload.ts`, `src/app/scene/ScenePane.vue`, `src/app/state/app.ts` |
| Music and sound | Synthesised on the phone (`src/audio/music/`, `instruments.ts`, `sequencer.ts`): **no audio file is downloaded**. The engine chunk is fetched on the first tap. Music has its own switch (`musicOn`). | `src/audio/` |
| Models and textures | Trip vehicles are fetched after the page is ready; the player's body (`.glb`) loads lazily and only on WebGL2 (`bodyAllowed`). City scenes load per city. | `src/scene/body/gate.ts`, `src/scene/city-scenes.ts` |
| Service worker | `public/sw.js` exists for push notifications only. It has no `fetch` handler and caches nothing. Caching is the HTTP cache: hashed files under `/assets` are `public, max-age=31536000, immutable`; `index.html` is `no-cache`. | `public/sw.js`, `server/server.ts` |
| What pauses on `visibilitychange` | The motion loop, the city map, the atlas, the guide, the driving scene, the showcase room, arena games; the app stops its polling socket (`game.stop()`) and reads the life again on return (`wake`). | `src/app/App.vue`, `docs/DEVICES.md` section 2 |
| Settings | Sound (with a Music on switch), hints, wallpaper, call settings, account, privacy. Lazy: the tab is a Phone app chunk. | `src/app/features/sim/SettingsTab.vue` |
| Browsers without WebGL | The landing preview and avatar stages show a flat figure; the city map falls back to a 2D map; `ScenePane` shows "The 3D scene could not be drawn on this device. Everything else still works." after the scene's code was already downloaded. No way forward was offered. | `src/app/features/start/lookPreview.ts`, `src/city-map.ts`, `src/app/scene/ScenePane.vue` |
| Not there | A data meter; one switch that gathers the above; a frame cap; pausing while a full-screen panel covers the scene; a refusal that comes **before** the 3D download. |  |

## 2. What Light mode is

One switch, `src/lightMode.ts` (no imports, carried by the first download, about 1 KB):

- **Default:** on when `navigator.connection.saveData` is true, otherwise off. The player's choice in Settings (stored in
  `localStorage['joinallworld-light-v1']`, `'1'` or `'0'`) wins over the default either way.
- **Lowest picture:** `renderTier()` returns `LIGHT_TIER` (the phone tier at pixel ratio 1 with a 512 shadow map). `?quality=` still wins.
  The tier is read when a scene is built, so a change applies from the next place the player enters.
- **Frame cap:** 30 a second in the one scene loop (`motion-loop.ts`: venue, home, street, campus), the city map and the atlas. The
  decision is the pure function `frameAction()` in `src/scene/frame-gate.ts` ("draw", "wait" or "stop"). A skipped frame moves and draws
  nothing and asks for the next browser frame; time (`dt`) accumulates, so walking speed is unchanged.
- **No background downloads:** `preloadNext` does not run (it already honoured `saveData`; it now honours Light mode, and a player who
  turned Light mode off is no longer held back by the browser's own ask, only by a 2G connection). `ScenePane` does not fetch the map's code
  ahead. The dive and aerial city are cut (the existing `saveData` path), which is the largest optional download.
- **Place models (one model per public place, `docs/agent-plans/unique-places/PLAN.md`):** a venue's own model is fetched only when its scene is built. Light mode, Save-Data, a slow connection and any device that is not known to be strong get the LOD1 file (about 15 to 25 KB, up to 4,000 triangles) and the 1024 atlas; LOD0 (60 to 100 KB, up to 20,000 triangles, 2048 atlas) is for a desktop-class or wide, 4 GB, 4-core device only. The idle warm-up of the current city's first six LOD1 files is held back by the same `holdsBack` switch as the other idle downloads. Files are content-addressed, kept by `public/sw.js` in Cache Storage and asked to be persistent, so a place is downloaded once. See `src/scene/places/device.ts`.
- **Music off:** a device that has not chosen starts with `musicOn: false`; turning Light mode on sets the existing Music switch off
  (`applyLight`). Turning it off leaves sound as the player has it.
- **Smaller images:** there is no image-size option on anything downloaded (pictures the player uploads are already shrunk on the phone,
  `messages/pictureModel.ts`, `showcase/showcaseModel.ts`); nothing was added. The pixel ratio of 1 is the main saving in drawn pixels.

## 3. No drawing while hidden or covered

- **Hidden:** already true for every loop (section 1). `frameAction` now also refuses a frame that arrives after the page was hidden.
- **Covered:** `sceneCanStart()` in `src/app/scene/sceneSupport.ts` (a lazy file `ScenePane` calls as the scene starts) tells `src/scene/frame-gate.ts` `setCovered()` when a sheet is open and it either belongs to a full-screen
  panel (`panel.fullscreen`: the landing and the character creator) or the screen is phone-sized (width 720 px or less), where the sheet
  (88% of the height, nearly the full width, over a dimmed backdrop) is the screen. On a wide screen the scene stays live beside a sheet.
  The motion loop's default frame request is `gatedRequest` in `frame-gate.ts` (startup code): while covered it parks the callback, and
  when the cover goes it gives it a frame, so the walk or the ease carries on where it was; it also skips frames above the cap. Nav panels (Buy, Map) are not "covered": they need the scene. The city map and
  the atlas are not paused by a cover (their loops run only during a trip, a dive or an ease).

## 4. The data meter

`src/app/state/dataMeter.ts`, a lazy chunk started when the scene starts (`sceneSupport.ts`) and when Settings opens. It observes
`PerformanceObserver` `resource` and `navigation` entries with `buffered: true` (so the first download is counted) and adds
`transferSize`. A cache hit has `transferSize` 0, which is right for the player's bill. The running total for the local calendar day is in
`localStorage['joinallworld-data-v1']` as `{ day, bytes }`; it is saved every 5 seconds of change and when the page is hidden or left, by
adding only what this tab counted since its last save (so two tabs add up), and starts again at midnight.

What it cannot see: WebSocket traffic (live places, chat, voice, calls), requests to other sites that send no `Timing-Allow-Origin`, and
anything fetched before the page's own timeline. It is a floor, not an invoice, and the Settings note says so. Settings shows
"Data used: 3.2 MB this session · 11 MB today" under **Data and battery**, with the Light mode switch.

## 5. A browser that cannot show the 3D scene

`src/app/scene/sceneSupport.ts` (the probe only) is asked by `ScenePane` **before** the scene's code is fetched. It refuses Opera Mini (extreme mode renders
on a server) and any browser that gives no WebGL or WebGL 2 context (the probe context is given back at once). A scene that started and then
threw shows the same words. The words and the button are a lazy chunk (`SceneUnsupported.vue`, `sceneWords.ts`). The pane says: "This phone's browser can't show the 3D world. Open Allworld in Chrome or your phone's own browser
to see it. Everything else works here: your phone, messages, jobs, money, the map list and the table games.", shows the address and a
**Copy link** button. The HUD, the phone, the 2D city map and the games are not behind the scene, so they work.

## 6. To measure on a throttled low-end phone (not done: no browser on the build machine)

Use a real phone under US$150 (or Chrome DevTools: CPU 6x slowdown, Network "Slow 4G" and "Fast 3G", device 360 x 760, DPR 2.75),
cold cache, a new player in Lagos, the same 60-second walk in a venue, a phone-app tour and one trip. Light mode off, then on, three runs each:

1. Bytes: the meter's "this session" after the first scene, after the 60-second walk and after the trip; DevTools Network "transferred" for
   the same; the number of requests; which chunks load idle (expect none with Light on).
2. Frame cost: `?diagnostics` frame count over the walk; Performance panel main-thread ms per frame (median, 95th), long tasks over 50 ms,
   frames per second while walking and while the camera eases; GPU time per frame (a trace with `--trace` in `scripts/perf/`).
3. Energy: battery percent over 10 minutes of walking, and device temperature if available; with the phone's own battery saver on.
4. Memory: JS heap and GPU memory after the venue loads.
5. Covered/hidden: frames drawn (`diagnostics().renderCount`) while the phone app is open for 30 seconds and while the tab is in the background; expect zero.
6. A WebGL-less browser (Chrome with `--disable-gpu --disable-software-rasterizer`, or Opera Mini): the message, the copy button, no 3D
   chunk requested, the HUD usable.

Record the numbers in the table below.

| Measure | Light off | Light on |
| --- | --- | --- |
| First scene, bytes transferred | | |
| 60-second walk, bytes | | |
| Frames a second while walking | | |
| Main-thread ms per frame, median / p95 | | |
| Battery % in 10 minutes | | |

## 7. Tests

`src/lightMode.test.ts` (default from `saveData`, saved choice, tier, music default), `src/scene/frame-gate.test.ts` (the pure decision, the
cap over 60 frames, cover and hide in the real loop), `src/app/state/dataMeter.test.ts` (cached = 0, day rollover, two tabs, formatting),
`src/app/scene/sceneSupport.test.ts`, `src/app/features/sim/lightSettingsModel.test.ts`, and the Settings render in `src/app/features/panelsA.test.ts`.
