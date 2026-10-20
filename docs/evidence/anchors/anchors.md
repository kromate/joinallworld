# Anchor screenshots

Taken on 19 October 2026 from the local game (main `7ec83aab5` merged into this branch), by `scripts/evidence/shoot.ts`, headless
Chromium on a Mac with an Apple M4 Pro (real GPU, ANGLE Metal), window 1280 x 800 at device pixel ratio 1, quality tier `high`, a
fresh open-mode life (`npm run dev:open -- --port 5211`, a settled life with a free starter house, N50,000,000). They are what a player
sees, HUD on. They are the pictures to score against ([../../EVIDENCE.md](../../EVIDENCE.md)).

Each view has `<view>.png` (the whole page), `<view>-scene.png` (the 3D canvas alone, what the pixel figures are measured on) and
`<view>.json` (the harness's numbers for the run, with 3 seconds of dwell).

| View | Files | How it is reached | In-game clock |
| --- | --- | --- | --- |
| (a) A Lagos street at dusk | `street-dusk.png`, `street-dusk-scene.png` | New Lagos life; travel home on foot; `home.door` outside; then the camera is put where the map's dive ends on the home street: eye height on the pavement, looking along the road with its traffic, passers-by and shopfronts (the street-life scene) | 18:30 Lagos time (dusk is 17:30 to 19:30) |
| (b) A Kano venue at noon | `kano-noon.png`, `kano-noon-scene.png` | New Kano life (city `kano`); travel on foot from the Gama garden to Kurmi Market | 12:00 (day) |
| (c) A home at night | `home-night.png`, `home-night-scene.png` | New Lagos life; travel home on foot: the starter house, indoors | 22:00 (night) |

URL for all three: `http://127.0.0.1:5211/?diagnostics=1` with the session cookie of the life described (the page picks the city from its
saved character; the harness sets it for Kano). To repeat:
`node --experimental-strip-types scripts/evidence/shoot.ts --view all --scale 1 --out docs/evidence/anchors --dwell 3`.

## The clock pin, proved

The clock reaches the light. `shoot.ts --view all --prove-clock` shoots each view at 12:00 and at 21:00 and compares the mean
brightness of the scene canvas (0 to 255); it fails below a difference of 15. Run on 19 October 2026 (pictures in the git-ignored
`docs/evidence/out/`, named `<view>-1200-scene.png` and `<view>-2100-scene.png`):

| View | Noon (12:00) | 21:00 | Difference |
| --- | ---: | ---: | ---: |
| street | 156.6 | 67.8 | 88.8 |
| Kano market | 196.7 | 50.0 | 146.7 |
| home | 194.4 | 52.0 | 142.4 |

The anchors themselves read: street at 18:30 99.2, Kano market at 12:00 189.0, home at 22:00 52.0. The home at night is a dark blue
sky around a room lit by its own lamps, so the room reads warm and bright inside a dark picture: its mean is 52, against 194 at noon.
The pin is two things (see EVIDENCE.md): the scene is handed one fixed moment for its light, and the page's `Date.now` is shifted so
walkers, traffic and the ambient crowd follow the same hour.

## Notes a critic should know

- **The street is the free starter house's street in Agege, not Yaba.** Open mode settles a new life in the first local government of
  the city (`server/open-dev/life.ts`) and a change of local government waits seven days, so Yaba cannot be reached from open mode.
  The view is therefore called `street-dusk`. The street scene is the same code for every Lagos home. Integrator request: an optional
  open-mode setting for the home local government (for example `lagos-mainland`), read in `server/open-dev/life.ts`, would let the
  harness stand in Yaba itself.
- The camera on the street is placed by the harness (a view that sets the camera before each draw): the host's own camera handle is
  not reachable from the page. The avatar is the figure standing at the garden wall.
- The HUD's clock shows the real time of the day the pictures were taken (12:56 am in the street picture), and so does the greeting bubble
  ("Good morning"): they read `new Date()`, which the harness leaves alone. Only `Date.now` and the scene's moment are pinned.
- The HUD says "Outside your home" on the street view because that is the game's state; the picture is the street scene.
- Kano's market at noon reads as a day scene; the game's text on the Kano HUD talks about a real-time power cut, which does not
  change the scene's own light.
- The neighbours on the street are houses of other lives on the same server (here, earlier runs of this harness), so a street with
  more or fewer neighbours is normal.

## Pixel figures (the scene canvas alone)

Measured with `scripts/evidence/inspect.ts`; thresholds in [../../EVIDENCE.md](../../EVIDENCE.md#the-numbers).

| View | Colour entropy (bits) | Dominant colour share | Edge density | Luminance contrast | Mean brightness | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| street-dusk | 5.55 | 0.157 | 0.265 | 113.6 | 99.2 | passes |
| kano-noon | 3.45 | 0.469 | 0.152 | 139.3 | 189.0 | passes (entropy nearest to the line) |
| home-night | 4.08 | 0.245 | 0.088 | 158.7 | 52.0 | passes |

The figures are advisory and all three pass, including the street that is the "1 to 2" anchor by definition: the thresholds catch a
flat or empty picture, not a basic one. Whole-page figures, which include the HUD, are higher (entropy 4.6 to 5.4, edge density 0.30
to 0.40).
