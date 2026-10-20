# Evidence: how a graphics change is judged

Written 19 October 2026 (open-source plan, Phase 0: [OPEN-SOURCE-PLAN.md](OPEN-SOURCE-PLAN.md)). Every phase that changes how the
game looks or moves is judged by what a camera and a stopwatch say, not by what the agent that built it says. This page is the
scale, the rules and the commands. The method comes from `majidmanzarpour/threejs-game-skills` (MIT, copied in
[.claude/skills/threejs-visual-scorecard](../.claude/skills/threejs-visual-scorecard/)) and from the critic role in Fable Cities'
`PROMPT.md`; the names and anchors are Allworld's.

## The scorecard

Score each of the ten categories **0 to 3** from screenshots of **active play** (a person standing in the street, the venue or the
home, with the HUD on), never from a title screen or an isolated model. **0** no evidence, **1** basic, **2** premium stylised,
**3** showcase. The names are those of a life sim: the hero is the player's body, obstacles are traffic and crowds, interactables
are doors, stalls and seats.

| Category | 1 | 2 | 3 |
| --- | --- | --- | --- |
| Art direction | The place is mostly colours and a sky | The place's culture drives the shapes, materials, signs and UI: Lagos looks like Lagos, Kano like Kano | A distinct identity in every surface, from a doorknob to the horizon |
| Hero (the player's body) | A stock figure that stands and slides | A readable silhouette with the player's own look, a walk that fits the ground, state cues (tired, hungry, wet) | A body that is clearly this person, with expressive motion and clothes that move |
| Obstacles (traffic, crowds) | Boxes that move; roles hard to tell apart | Danfos, okadas, hawkers and strollers with role-specific shapes, liveries and paths; they give way to the player | Varied families that show intent (a driver braking, a crowd parting) and fill the street's depth |
| Interactables (doors, stalls, seats) | Generic hot spots with a label | Authored forms, a clear "you can use this" state, feedback on use | Purpose and state stay readable while everything moves |
| World | Themed but sparse, repeated blocks | Layered street kit: foreground, midground, background; scale cues; lived-in props | A dense authored place that explains itself at a glance |
| Materials | Flat colour, one roughness | Shared material roles, signs, trim, wear, painted walls with panel lines and dirt | A rich cohesive material language, measured against its cost |
| Lighting | Fog, haze or bloom is the style | Intentional exposure, key, fill and rim, contact shadows, lamps that light what they stand next to; dusk and night look different from day | Cinematic but readable, disciplined post |
| VFX and motion | Generic particles | Events cause effects: rain that stops under the awning, a danfo's exhaust, a goal's confetti; motion eases | High-impact effects that clarify play and stay cheap |
| UI and HUD | A column of stat cards | Game-specific states, icons and meters, text that fits on a phone, nothing over the walking path | A cohesive interface with strong hierarchy and polished transitions |
| Performance evidence | "Seems fine" | Draw calls and triangles from the renderer, frame table, budget lines, target-size shots | Before and after numbers, the bottleneck named, the trade-off written down |

**Premium** means no category under 2 and an average of 2.3 or more, with renderer numbers reported after the change.
**Showcase** means no category under 2, at least six at 3, an average of 2.7 or more, and before and after performance numbers.

### Automatic failures

Any one means "not premium yet", whatever the scores say:

- Fog, darkness, bloom or particles stand in for missing geometry.
- The HUD is mostly rectangular stat cards.
- There is no active-play screenshot (a person in the place, the HUD on, taken by the harness).
- There are no renderer diagnostics after graphics work (draw calls and triangles from `shoot.ts`, and the frame table updated).
- The picture is mostly unrefined placeholders or empty space that the design does not justify.
- The HUD covers the walking path, clips text or breaks the phone's safe areas.

### Anchors

Three pictures, taken on 19 October 2026 from the game as it was, in [evidence/anchors/](evidence/anchors/) (how:
[anchors.md](evidence/anchors/anchors.md)): a Lagos street at dusk, a Kano venue at noon, a home at night. Look at them before
scoring World, Hero, Materials or Lighting, and score against them, not against memory.

**Today's Lagos street at dusk is the "1 to 2" anchor by definition.** A surface that reads closer to it than to a finished
street scores 1 or 2 however much code went into it. The Kano venue and the home are the same era of art and are not scored here:
the first critic scores them. The reference for a 3 is a photograph of the real place, taken at the same hour, until a built
picture earns the place.

## The numbers

The inspector turns "looks flat" into three figures per picture (advisory: a low figure needs an explanation, not a higher score;
never add clutter to raise one):

| Figure | Below or above | Reads as | Evidence against |
| --- | --- | --- | --- |
| Colour entropy | under 3.0 bits | sparse, flat | World and Materials above 2 |
| Dominant colour share | over 0.6 | sparse, flat | World and Materials above 2 |
| Edge density | under 0.04 | primitive-dominant or empty | World and Hero above 2 |
| Luminance contrast (95th minus 5th percentile) | under 60 | fog or darkness compression | Lighting above 2 |

Measure the canvas alone (`<view>-scene.png`); the whole page (`<view>.png`) also holds the HUD. Frame times come from
[evidence/frames.md](evidence/frames.md). A run drawn in software (no GPU) proves pictures and counts and says nothing about speed.

## Running the tools

All of them talk to a running open-mode game; none starts or stops a server. Heavy runs go through the machine-wide slots
(`scripts/agent-slot.ts`). One headless Chromium at a time, with its own profile under `/tmp/aw-evidence-*`, which is deleted at
the end.

```sh
# 1. a settled life with a house, on 127.0.0.1:5211 (run `npm run cities:assets` and `npm run words:assets` first if it answers 503)
node --experimental-strip-types scripts/agent-slot.ts server -- npm run dev:open -- --port 5211

# 2. the three reference views, 2x, with the numbers (PNG and JSON in docs/evidence/out/, which git ignores)
node --experimental-strip-types scripts/agent-slot.ts browser -- node --experimental-strip-types scripts/evidence/shoot.ts --view all --scale 2
#    --view street-dusk|kano-noon|home-night|all   --clock HH:MM   --prove-clock   --gpu metal|swiftshader (metal by default on an Apple-silicon Mac)
#    --uncapped (frame gaps without the screen's 60 Hz limit)   --dwell SECONDS (default 10)   --out DIR   --base URL

#    --prove-clock shoots each view at 12:00 and 21:00 and exits 1 unless the scene's mean brightness differs by 15 or more (0 to 255)

# 3. the pixel figures; exits 1 on a missed threshold, --advisory only prints
node --experimental-strip-types scripts/evidence/inspect.ts docs/evidence/out/*-scene.png

# 4. the bot walk: home, gate, street, market, back. Exits 1 on a console error or more than 8 stalls (a stall is a frame gap over 42 ms), 2 if it cannot finish
node --experimental-strip-types scripts/agent-slot.ts browser -- node --experimental-strip-types scripts/evidence/walk.ts --base http://127.0.0.1:5211
#    --max-stalls N changes the limit (default 8, the baseline below)   --window SECONDS per scene (default 10)

# 5. their tests (part of npm test)
node --experimental-strip-types --test scripts/evidence/*.test.ts
```

What the views are, and the in-game clock each is held at, is in `scripts/evidence/views.ts`. The clock is pinned in two places: the
scene is handed the same moment on every update (its light, sky and window glow), and the page's `Date.now` is shifted by a constant
(the walkers, traffic and ambient crowd read it), so day parts look like day parts. The HUD's own clock still shows the real time.
`--prove-clock` is the check that the pin reaches the light; on 19 October 2026 it gave, for the scene canvas alone (mean brightness,
0 to 255, noon then 21:00): street 156.6 then 67.8, Kano market 196.7 then 50.0, home 194.4 then 52.0. A view whose two pictures differ
by less than 15 has a clock that never reached its light, and the run fails. The harness reads the renderer through the game's own
`?diagnostics` page hook (`window.__jaw`), so nothing in the game was changed for it. Open mode runs the game ten times faster than
real time and keeps a market's real opening hours, so the walk goes to a street kitchen when the market is shut.

**The street view** is the home street's street-life scene (traffic, passers-by, shopfronts, lamps) seen from the pavement at eye
height, looking along the road: the pose the map's dive is meant to end on (`src/scene/street-life/street-scene.ts`,
`src/map3d/arrive-street.ts`). The page cannot reach the host's camera (the world adapter does not hand on `motion()`), so the harness
places the camera with a view whose `render()` sets it before each draw. It is not the walk over the real city's tiles
(`src/street/host.ts`), which has a single fixed daylight and no clock at all; that is a Lighting finding for whoever scores it.

### The walk's gate: no worse than the baseline

The bot walk passes when there is no unexpected console error and the whole loop has **no more than 8 stalls** (`STALL_BASELINE` in
`scripts/evidence/walk.ts`), the count measured on 19 October 2026 on a Mac with a real GPU. The gate is "no worse than the
baseline", not "no stalls": scene builds still cost a frame or two. The baseline is lowered only by a release that improves it, in the
same commit, with the new measured count in `docs/evidence/frames.md`; it is never raised to let a regression through. A run that is
slower for a reason outside the game (a loaded machine, software drawing) is not evidence either way: re-run it on the Mac's GPU.

One console error is known and harmless and is not counted (`KNOWN_ERRORS` in `views.ts`): `GET /api/street/me` answers 409 when
no street journey is open, and the page logs it.

## The critic

A graphics phase is not scored by the agent that built it.

1. The builder ships the change, its before and after screenshots at the three views, the harness JSON and the updated frame table.
2. A different agent, the **critic**, writes no code. It takes its own screenshots at the three views at two times of day (the
   harness's `--clock`, and `--prove-clock` for noon against 21:00; a scene whose light does not change with the hour has a Lighting problem), looks at
   the anchors, scores the ten categories 0 to 3 with one line of evidence each, names the weakest surface, and lists any automatic
   failure still standing. It never inflates: a doubt is a lower number, and "not captured" is a valid entry. Its prompt is in
   [AGENT-PROMPTS.md](AGENT-PROMPTS.md#critic).
3. The scorecard (before, after, average, failures) goes in the phase's work record under the critic's name, next to the builder's.
   A phase without a critic's scorecard, or whose pictures or frame rows are missing, is not merged.
4. **Blind pairs at the end of each wave.** A set of A/B pictures is made, ours against a photograph of the real street at the same
   hour, with the order shuffled. A person or an agent that did not build either picks the more convincing one and says why; the
   result (including a loss) goes in the wave's record. Fable Cities lost these 0 to 4 three times after six runs; a loss tells
   the next phase what to fix.
5. Scores are for the surface that is weakest, not the average mood: the next pass is whichever category is lowest.

## Reporting a score

Per category: before, after, one line of evidence. Then the average, the automatic failures still standing and the next pass that
would fix the lowest category. For a surface with no earlier score write "not captured" for before; never invent one.
