# Frame table

One row per view, kept up to date by the graphics phases (1 to 9): re-run `shoot.ts` and replace the rows, keeping the old row
and its date underneath when a phase changes a number. How to run it: [../EVIDENCE.md](../EVIDENCE.md#running-the-tools).

**What is measured.** Over a 10-second dwell the page is asked to draw the scene on every animation frame (the worst case; the game
itself draws nothing while a street is still), and the gap between frames is recorded. Draw calls and triangles are
`renderer.info.render` after the dwell, read through the `?diagnostics` hook. Source: `scripts/evidence/shoot.ts` of this branch,
game source of main `7ec83aab5`, 19 October 2026, open-mode life, quality tier `high`. The in-game clock is pinned (the scene's moment and
the page's `Date.now`), so the crowd and traffic are those of the hour named.

## Mac Chrome at 2x

Headless Chromium on a Mac with an Apple M4 Pro (ANGLE Metal renderer, real GPU), window 1280 x 800 at device pixel ratio 2
(2560 x 1600 pixels), fresh open-mode life.

| View | In-game clock | Draw calls | Triangles | Frame gap p50 / p95 / max, held to 60 Hz (ms) | Frame gap p50 / p95 / max, uncapped (ms) | Console errors |
| --- | --- | ---: | ---: | --- | --- | --- |
| Lagos street at dusk (`street-dusk`, eye height on the home street) | 18:30 | 50 | 78,959 | 16.7 / 16.7 / 33.4 | 3.9 / 5.1 / 9.8 | 0 |
| Kano venue at noon (`kano-noon`, Kurmi Market) | 12:00 | 44 | 77,041 | 16.7 / 16.7 / 16.8 | 3.1 / 4.9 / 17.0 | 0 |
| Home at night (`home-night`, starter house) | 22:00 | 22 | 34,549 | 16.7 / 16.8 / 16.8 | 2.1 / 3.0 / 14.1 | 0 |

Reading it: "held to 60 Hz" is what a player on a 60 Hz screen gets (16.7 ms means every frame was on time; the one 33.4 ms frame on
the street is a single missed frame). "Uncapped" removes that ceiling and is the headroom: the cost of a frame on this GPU, and the scene
was drawn about twice per frame (the harness asks for a draw on each frame and the game's own loop also draws). A phone is several
times slower than this computer; do not read these as phone numbers. Draw calls and triangles move from run to run (traffic and
walkers: the uncapped run read 29 calls and 41,752 triangles on the street, 51 and 77,173 at Kano).

Triangles and calls are what the renderer reports for its last draw (probably shadow passes included), so they are higher than the
scene's own budget counts in `src/venue-world.ts` (`setHostBudget`); compare a phase's numbers with these rows, not with those budgets.

Earlier run, kept for the history of the table (same day, before the page's clock was pinned and with the street seen from above in
the estate scene, so the crowds were those of the real late evening): street 37 calls / 46,185 triangles, Kano 23 / 45,847, home
22 / 32,304. They are not comparable with the rows above.

## Phase 2b: light from things, ground pools, wet ground (20 October 2026)

Same machine (Apple M4 Pro, ANGLE Metal), window 1280 x 800 at 2x, tier `high`, `shoot.ts` of branch `claude/os-p2b-light` (`--uncapped`, 10 s dwell;
`--query post=0|post=1|post=0&wet=1`). "Before" is the code of main `53a738808`, "after" is the branch; each run is a fresh open-mode life, so the
street (houses, shops, traffic caps) differs from run to run: the draw calls of identical code ranged from 25 to 46 on `street-dusk`. The machine
was shared with other agents' browser runs, so read frame gaps as noisy (about +-1 ms plain, more with the stack).

Draw calls on **one life shot before and after** (`--sid`, same street, same camera, `post=0`):

| View | Before calls / triangles | After calls / triangles |
| --- | ---: | ---: |
| `street-dusk` | 43 / 75,574 | 44 / 75,444 |
| `street-night` | 43 / 75,555 | 44 / 75,462 |
| `street-dusk` with `?wet=1` | 38 / 85,580 | 39 / 85,426 |

The one extra call is the light-pool mesh (not drawn on the phone tier: `quality=phone` builds no such mesh, tested in `scenery.test.ts`). The wet
ground is a material swap on the same layer: no call. With `?post=1` the renderer reads 1 call and 1 triangle (the composer's last pass), so counts
come from the `post=0` runs.

Frame gap, uncapped, p50 / p95 / max (ms), two runs of `post=0` and one of `post=1` per view, before then after (each run its own life):

| View | before `post=0` | after `post=0` | before `post=1` | after `post=1` |
| --- | --- | --- | --- | --- |
| `street-dusk` | 4.0 / 4.8 / 15.5; 3.5 / 4.8 / 17.6 | 4.0 / 6.5 / 10.8; 5.2 / 8.3 / 312 | 11.3 / 14.0 / 30.1 | 11.9 / 19.2 / 31.0 |
| `street-night` | 3.1 / 4.7 / 17.0; 3.8 / 6.3 / 17.1 | 3.9 / 6.8 / 17.7; 3.9 / 5.3 / 10.7 | 11.1 / 39.1 / 95.6 | 10.8 / 14.7 / 32.3 |
| `street-dusk` `?wet=1` | 10.9 / 17.3 / 34.2 | 4.3 / 5.7 / 14.9 | | |

Reading it: the emitters, pools and wet ground cost nothing measurable (within the run-to-run noise; the 312 ms is one stall while the street
built). The post stack costs about +7 ms p50 on this street now (11 ms against 4 ms), against +1.5 to +3.7 ms in the phase 2 record: that
record was taken on a quiet machine, this one was not. The wet row before (10.9) is a loaded moment, not the change. Held to 60 Hz every run reads
16.7 ms (no information at 2x on this GPU).

## Software drawing (no GPU), for reference

The same street drawn by the CPU (`--gpu swiftshader`): about 850 ms a frame at 2x, 13 frames in 10 seconds. It is a way to take
pictures and count draw calls on a computer without a GPU; its frame times are not evidence of anything.

## Android emulator

Not measured. Next step: serve the same build to the Android emulator (`adb reverse`), drive it over `adb forward tcp:9333
localabstract:chrome_devtools_remote`, and record the three views at the phone tier. The harness's `--base`, `--size` and `--scale`
(for example `--size 412x915 --scale 2.625`) are the starting point; `shoot.ts` needs a small change to attach to a remote
browser instead of launching one.

| View | Draw calls | Triangles | Frame gap p50 / p95 (ms) |
| --- | --- | --- | --- |
| `street-dusk` | not measured | not measured | not measured |
| `kano-noon` | not measured | not measured | not measured |
| `home-night` | not measured | not measured | not measured |

## The walk

`walk.ts`, same machine, 10 s per scene, 19 October 2026 (night in Lagos, so it went to the street kitchen: the market was shut):

| Scene | Time to first frame (ms) | Frames | Stalls over 42 ms | Frames over 100 ms | Worst gap (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| home | 2688 | 583 | 3 | 1 | 117 |
| gate (stepping out to the street) | 444 | 582 | 2 | 1 | 233 |
| street (walking along it) | 18 | 600 | 0 | 0 | 17 |
| market (street kitchen, market shut) | 2649 | 595 | 1 | 0 | 50 |
| back home | 2575 | 599 | 0 | 0 | 33 |

First load to first frame: 1,273 ms. Console errors: none unexpected. **Stalls: 6 this run, 8 in the earlier run on the same machine;
the gate is "no more than 8"** (the baseline; [../EVIDENCE.md](../EVIDENCE.md#the-walks-gate-no-worse-than-the-baseline)). Exit code 0.
The longest, 233 ms, is the street scene being built as the player steps out of the house. Times to first frame for a trip include
the trip itself (about 2.5 s in open mode).

## Phase 7: the frame governor and the warm-up (20 October 2026)

Same Mac (Apple M4 Pro, ANGLE Metal), same harness, but against the **Vite dev server** (unbundled modules, so first-load and scene-build
times are higher than a release build) and with other agents' browsers running on the machine (load average 4 to 14 over these runs), so
the noise is larger than in the tables above. Every "after" number was taken with the governor on; where it matters the same run was
repeated with `?scale=1`, which fixes the scale and leaves the governor idle, to show what the governor itself costs. Source: branch
`claude/os-p7-governor` on main `53a738808`.

**What the governor can and cannot move.** It reads the gaps between frames the host's own loop draws, so it works while the avatar walks or
the camera eases, never in a still scene. The harness's dwell pumps `update()` itself (no loop), so the street-dusk dwell is the same code path
before and after, and its rows are a noise check, not a gain.

| Run (street at dusk, `--uncapped`, 10 s dwell) | p50 / p95 / max (ms) | Frames over 100 ms |
| --- | --- | ---: |
| Before, run 1 (cold server) | 3.7 / 7.5 / 503.6 | 1 |
| Before, run 2 | 3.4 / 5.1 / 13.9 | 0 |
| Before, run 3 | 3.9 / 5.0 / 10.2 | 0 |
| After, run 1 | 3.9 / 6.6 / 10.2 | 0 |
| After, run 2 (machine busier) | 4.4 / 8.3 / 16.3 | 0 |
| After, run 3 (machine busier) | 5.0 / 8.4 / 16.0 | 0 |
| Same minute, `?scale=1` (governor idle) | 5.3 / 8.9 / 363.1 and 4.9 / 8.6 / 17.7 | 1 and 0 |
| Same minute, governor on | 4.3 / 8.6 / 17.8 and 5.1 / 8.3 / 295.6 | 0 and 1 |

The 300 ms outliers appear with the governor on and off and once before the change: the first frames of a dwell on a loaded machine. They are
not the governor's. The pixel ratio read 2 in every run: nothing in a still dwell moves it.

**The bot walk** (`walk.ts`, 10 s per scene, stalls are gaps over 42 ms):

| Run | First frame (ms) | Stalls | Frames over 100 ms | Gate stage worst gap (ms) |
| --- | ---: | ---: | ---: | ---: |
| Before, run 1 | 917 | 3 | 1 | 149.9 |
| Before, run 2 | 816 | 2 | 1 | 150.1 |
| After, run 1 (machine busy) | 848 | 6 | 2 | 183.3 |
| After, run 2 (machine busy) | 842 | 5 | 2 | 166.6 |
| `?scale=1` then governor on, three rounds each, quieter machine | n/a | 2, 2, 4 then 2, 2, 2 | 1 each | 166.6, 183.3, 150.1 then 183.3, 200, 150 |

The busy-machine "after" runs are higher in the home and market stages only; the alternating `?scale=1` / governor rounds that followed are
equal. **The gate stall did not go.** The 150 to 200 ms frame when stepping out of the house is the street scene being built in one task
(`world-adapter.ts` `import.then`, 196 ms in a Long Animation Frame trace, 12 ms of it in the warm-up); it is JavaScript, not a shader link, and
neither the governor nor the warm-up can shorten it. The walk's stall count stays at the gate of 8.

**What does move (measured):**

| Measure | Before | After |
| --- | --- | --- |
| Loading card gone vs the first draw (3 loads) | card gone 110 to 150 ms **before** the first draw (render count 0 at that moment) | card gone at the first draw (render count 2) |
| `?post=1`, worst frame in the first 9 s (3 loads each, same hour) | 150, 117, 117 ms | 100, 83, 83 ms |
| `?scale=0.7` (fixed) | n/a | pixel ratio 1.4 of 2, governor locked |
| 3000 x 1800 window at 3x (fill bound, 7500 x 4500 canvas), 20 s walk | n/a | scale 1.0 to 0.8 and back as the load changed, p90 26 ms at one look, 17 ms otherwise; the 15 people and 8 vehicles never changed (the pixels were the problem) |
| 6x CPU throttle on the same street | n/a | within 2 s the verdict read p90 39 ms, scale 1.0, `pressed` (the scale does not help a script-limited street); the street's readout then vanished, i.e. street life was dropped by its own frame guard, and the walk went on at 18 ms p90 |

Not measured: the Android emulator (still the next step above).
