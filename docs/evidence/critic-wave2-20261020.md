# Critic scorecard, wave 2 (light from things and wet ground; the frame governor and warm-up)

Critic: Claude (Fable 5.1 session `os-critic-wave2`), 20 October 2026. Source: `origin/main` at `b004c4e78`. I wrote no code and took no new
pictures (the machine's slots were busy and I was told to start no browser or server). Everything is scored from the committed pictures
(`docs/agent-work/os-phase2b-light-{dusk,night,wet,night-post}.png`, the anchors), the records, `frames.md` and the code headers. Where
that is not enough I say "not captured". Scale and failures: [../EVIDENCE.md](../EVIDENCE.md). BEFORE is wave 1's score or the anchor
([critic-wave1-20261020.md](critic-wave1-20261020.md)).

**What these scores rest on, and what they cannot say.** The builder's pictures are two 760 px frames side by side, scene only (no HUD), not
the 2x harness output, and no `inspect.ts` figures were supplied, so I quote no pixel figure. I cropped and enlarged regions of them
(the far lamps, the wet pavement, the night-post kerb) to see what the full frame hides. Each pair is a fresh life (the builder says
so): the traffic differs between left and right (a yellow vehicle sits in a different place), so only the lights, the ground and the
sky are comparable. The wave-1 critic's half-point convention stands: a half point is a doubt, written as such.

---

## Phase 2b: light that comes from things, ground pools, wet ground (`20261020-os-phase2b-light`)

Live as `c4163dabe`; ambient occlusion put back behind `?ao=1` (`123962aa9`); the post stack (bloom, grade, vignette) is on by default
on the high tier. The night street is a new view (`street-night`, 21:00), so its BEFORE is my score of the builder's unchanged-code
left half, not a wave-1 number.

### What I can see

- **Dusk (18:30).** I cannot tell left from right at a glance. In an enlarged crop of the far street the only differences are: the flat
  teal disc that sat under the near lamp before is gone, and a faint pale wash lies on the pavement and kerb under the far lamps after. The
  dusk pool strength is 0.4 and it shows as almost nothing. The lamp heads and the cream windows glowed before and glow after. The sky,
  the walls and the road are unchanged. This is a "barely different" picture and I score it so.
- **Night (21:00).** A real difference, but small and far away. Before: lit windows and glowing lamp heads (already there) and a hard-edged
  sodium disc under one lamp. After: soft pools under the three far lamps that spill over the pavement, the kerb and onto the road, and a
  warm wash along the pavement in front of the shop front by the junction. The lamps now light what they stand next to, which is the
  rubric's wording for a 2. What is still dark: the whole near field (the bottom 60% of the frame is the same flat blue-grey pavement and
  wall as before), the shop sign and awning, the vehicles (no headlamps, no tail lamps, no shadow under them: the loaf-shaped bodies
  look as if they hover over the road), and the utility pole in front of the lens, which has no lamp.
- **Wet (rain, dusk).** The ground is now visibly different from dry: the pavement is darker and has a lilac sky sheen, the sun's warm
  tint is weaker so the sky and the light disagree less than in wave 1. But the sheen is one large smooth radial blob in the middle of
  the pavement with visible colour banding in the gradient; it reads as a spotlight or a stain, not as water. The road, which is
  what a wet street makes shine, shows no lamp reflection and almost no change. No puddle, no ripple, no splash I can point at.
- **Night, post stack (`night-post`).** After code, `?post=0` left and `?post=1` right. The right frame is darker and bluer, has a
  vignette, and the far lamp heads have a small halo. It also has a defect: a pale translucent ghost along the kerb and the left
  pavement, a second duplicate of the kerb line running down the frame, and a grey veil over the left facade and the pole. That is the
  ambient-occlusion smear the record describes, and it is the reason `?ao=1` is now opt-in. The windows do not visibly bloom.

### Scores

| Category | Dusk before | Dusk after | Night before | Night after | Wet before | Wet after | Evidence where it changed |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| Art direction | 2 | 2 | 2 | 2 | 2 | 2 | Unchanged. |
| Hero | 1 | 1 | 1 | 1 | 1 | 1 | The figure at the wall is the same stock body, dry, unlit, not wet. |
| Obstacles | 1 | 1 | 1 | 1 | 1 | 1 | Vehicles have no lamps and no contact shadow, in both halves of every pair. |
| Interactables | 1 | 1 | 1 | 1 | 1 | 1 | Unchanged. |
| World | 2 | 2 | 2 | 2 | 2 | 2 | Unchanged: the same kit, depth bands, empty pavement. |
| Materials | 1 | 1 | 1 | 1 | 1 | **1.5** | Wet only: the ground darkens and takes a sky sheen. It is a gradient blob with banding on the pavement, the road is untouched; a doubt, hence half. |
| Lighting | 1 | 1 | 1.5 | **2** | 1 | **1.5** | Night: pools under three lamps and a shop front, spilling on pavement, kerb and road (enlarged crop); the foreground is unlit, so it is a borderline 2, not a clear one. Dusk: invisible at strength 0.4, so no change. Wet: the sun loses warmth in rain and the weather and the light disagree less. |
| VFX and motion | 1 | 1 | 1 | 1 | 1.5 | 1.5 | Rain streaks as in wave 1; the lamps do not flicker, the pools do not shimmer in rain, the road does not ripple. |
| UI and HUD | 1 | 1 | 1 | 1 | 1 | 1 | No HUD in these pictures; the wave-1 HUD findings stand. |
| Performance evidence | 2 | 2 | 2 | 2 | 2 | 2 | See "Cost" below: numbers exist (one extra call, 0 measured ms, +99 bytes of start-up), but the post-stack frame cost that is live (no AO) was not measured in this phase, and no pixel figures were run. |
| **Average** | **1.30** | **1.30** | **1.35** | **1.40** | **1.35** | **1.45** | |

Night's BEFORE: 2, 1, 1, 1, 2, 1, 1.5, 1, 1, 2 = 13.5. Night's AFTER: 14.0. Wet BEFORE is wave 1's rainy street (13.5), AFTER 14.5.

**Automatic failures standing.** The two HUD failures from the anchors (cards; the bottom stack over the pavement) are unchanged: no
phase touches the HUD. New or still open for this phase: **no active-play screenshot** (the phase's pictures are the scene canvas
without the HUD, from the harness, so strictly the "HUD on" requirement is not met for them); **no `inspect.ts` figures**; the post-stack
draw calls read 1 and 1 under a composer (the record knows this and takes counts from `post=0` runs). Bloom or particles standing in
for geometry: not standing (the lamp glow is on lamp heads that are modelled), but the wet street's only water cue besides the sheen is
still the streaks.

### Cost

One extra draw call (the light-pool mesh; 43 to 44 on the same life, `frames.md`), triangles unchanged within noise (75,574 to 75,444),
no extra call for the wet ground (a uniform on the existing material), +99 bytes on the first download (STARTUP_RAW 614,012), and
no pool mesh on the phone tier. The frame rows do not show a cost beyond noise (p50 4.0 to 4.0 and 3.5 to 5.2 on the same machine in a
busy minute; the 312 ms in one "after" run is a street build, the same stall as in phase 7). The post stack's measured cost in this phase
(11 to 12 ms p50 against 3 to 4 ms plain) was taken **with AO on**, on a loaded machine; the live default has AO off and that
configuration is not in this phase's table (phase 2's quiet-machine number is 1.5 ms). That is the missing row.

### Verdict: yes, but tune the near field and the dusk

It earned its place on cost alone: one call, nothing measurable in time, a few hundred bytes, phone tier untouched, and it follows the
one clock and goes dark in a power cut (a good Lagos detail I could only read in the code, not see). What it earned in the picture is
a half point of Lighting at night and a half point of Materials and Lighting when wet. That is honest and small. At dusk, the hour the
anchor is defined at and the picture the owner will mostly see, **it changed nothing I can point at**.

### Wave 1's four "still basic" items

1. **"Light that comes from things, and the wet": answered about a third.** Night: windows and lamp heads were already lit, and the
   pools now exist, in the distance. Dusk: not answered. Wet: the ground now admits the rain, badly (one blob, no reflections of the
   lamps, a road that does not change). The post stack finally has something to find, but only the lamp heads are over its threshold
   and the halo is small.
2. **"The life on the road": not touched.** Same two loaf vehicles, the same empty pavement. They still look as if they hover.
3. **"Surface and silhouette": not touched.** Same flat planes, cube trees, prism poles.
4. **"Signs and clutter": not touched.** The shop sign at night is still a flat, unlit panel.

### Is the live default (post on, AO off) right?

**Yes, AO off is the right call, with one condition.** The `night-post` pair is the evidence against AO: the ghost kerb and the facade
veil are clearly visible at the pair's size and they are worse than what AO adds (contact darkening I still cannot find under the vehicles
or the fence). The scenes already have baked vertex AO. But that pair was shot **with AO on**, so no committed picture shows the live
configuration (bloom, grade, vignette only). Before anyone says the live default "looks right", the integrator should shoot the same
frame with `?post=1&ao=0` explicit, beside `?post=0`, at 2x. From the committed pair I can say only that bloom, grade and vignette give a
darker blue and a small lamp halo: a mood change, worth about 1.5 ms of the quiet-machine cost, not a Lighting step by itself.

- **Bloom threshold (0.85) and emitter brightness:** do not lower the threshold. In the pair the windows (the biggest lit areas)
  do not bloom while the lamp heads do, and a lower threshold would bloom walls and the pale pavement, which is the haze I already see.
  Raise the emitters that should glow: shop signs and the nearest lamp's pool, not the cream windows. Boost 1.6 is already above the
  threshold for a lamp; a sign at 0.9 x 1.6 is marginal.
- **AO radius and intensity (1.65 units, 2.2):** if AO is retried, halve both (radius about 0.8, intensity about 1.1) and shoot
  the kerb frame before enabling it. The smear sits along thin, long, low-contrast kerb edges and a pavement seen at a grazing angle,
  which is where a depth-aware half-resolution AO over-darkens. Not worth another phase; park it.

### Weakest surface and the single next change

**Weakest surface:** the night street's near field and its traffic (Lighting 2 at best, Obstacles 1, Materials 1): the foreground is
lit by nothing, and the vehicles are dark blocks with no lamps and no ground shadow.

**Single next change that would move the street most:** light and weight for every vehicle, built on the pool mesh that exists.
A danfo, keke or car gets two headlamp emitters and two tail-lamp emitters (above the bloom threshold, warm white and red), a soft
forward pool on the road, and a dark soft contact blob under the body. It uses the same instanced additive mesh and the same hourly
numbers, it moves Lighting (the road finally has lights on it), Obstacles (a vehicle reads as a vehicle, not a hovering box; the
rubric's 2 for "role-specific shapes, liveries") and, when wet, gives the sheen on the road something to reflect. It is one draw call
at most. If only a lighting step is allowed, the second choice is the same thing for the near field: a lamp or lit shop front in the
bottom third of the frame, so the pool is seen at the size of a person and not as a smear in the distance.

---

## Phase 7: the frame governor and the shader warm-up (`20261020-os-phase7-governor`)

No picture, and none could show it: nothing it does changes what is drawn. All ten category scores stand as before; only Performance
evidence is scored.

### Claims against what was measured

| Claim | What the record measured | My reading |
| --- | --- | --- |
| The governor steps the render scale down when the p90 passes 21 ms and probes back up | 12 unit tests; a fill-bound stand-in (3000 x 1800 at 3x, 7500 x 4500 canvas): scale 1.0 to 0.8 and back, p90 26 ms at one look, 17 ms otherwise, one 20 s walk; `?scale=0.7` locks | It works in the one place it was made to be tested, and the stand-in is a desktop GPU made to be fill-bound, not a phone. One run, no before row (n/a), so the 26 to 17 ms is not a before and after, it is the governor's own readout. |
| It leaves a script-bound device alone and says `pressed` | 6x CPU throttle: p90 39 ms, scale stayed 1.0, verdict `pressed`; the street's readout then vanished and the walk went on at 18 ms p90 | The undo logic worked as designed. But "street life was dropped by its own frame guard" is the street's older guard, not clearly the governor's verdict; the record does not separate them. A CPU throttle is not a phone either (no GPU or memory pressure, no heat). |
| It costs nothing | `?scale=1` (governor idle) against governor on, in the same minute, four runs: 4.3 to 5.3 p50, no difference | Believable and the right test. |
| The warm-up compiles what is drawn later, against the post stack's buffer | `?post=1`, worst frame in the first 9 s, three loads each: 150, 117, 117 ms before; 100, 83, 83 after | A real, modest gain (about 30%) with n = 3 on a loaded machine. It matters because the post stack is now on by default. |
| The loading card waits for the first real draw | Card gone 110 to 150 ms **before** the first draw (render count 0) before; at the first draw (render count 2) after, three loads | A real fix of a real flaw (the card faded to an empty frame), but the size is 110 to 150 ms on a fast Mac, three loads. The time to first frame is unchanged (816 to 917 ms before, 842 to 848 after). The 2.5 s cap means the worst case is a longer card on a device whose first draw is slow; that case is not measured. |
| No stall over 100 ms in the first 10 s | **Not met.** The gate stage (stepping out of the house) is 150 to 200 ms in every run, before and after; the busy-machine "after" walks read 5 to 6 stalls against 2 to 3 before, and the alternating quiet rounds read equal (2, 2, 4 against 2, 2, 2) | See below. |

### The stall, and whether phase 7 could ever fix it

The stall is the street scene being built in one JavaScript task when the player steps out: `world-adapter.ts` `import.then`, 196 ms in
a Long Animation Frame trace, only 12 ms of it shader work. Phase 7 could not fix it, and by design: the governor reacts after the fact
to the p90 of drawn frames and **explicitly ignores a lone gap over 150 ms** as "a shader link, a texture upload, a scene being built",
and a render scale does not shorten a script task; the warm-up only moves shader links. The record says so honestly. The fix belongs to
whoever owns the scene build: slice it over several frames or idle callbacks, build the street while the home is still on screen (the
player is walking to the door), or cover the 200 ms with the door transition. On a phone this task will be several times longer, so
it is the stall a player will actually feel, and nothing measured here says how long.

### Is the loading-card hold a real improvement?

Yes, small and real, and it is correct to do. It is a fix for a visible glitch (a card that disappears before there is a picture), not a
speed gain, and it is evidenced by a render count, not by a feel. Keep it. Still missing: a slow-device row showing the 2.5 s cap
helps or hurts.

### Performance-evidence score: **2** (of 3)

Reason: before and after rows with the bottleneck named (the gate stall is JS), the trade-offs written down, and the budgets read
after the re-pin (CI `39355979372`, all budgets ok); that is the 2 row. It is not a 3 because the governor's whole purpose is the slow
device and there is **no slow device in the evidence**: every number is from an M4 Pro against the Vite dev server with other agents
running (the record's own caveat: load average 4 to 14), most rows are single runs or n = 3, and the one statistic that would decide
the governor (a phone's p90 before and after) does not exist. On the governor alone I would give 1.5.

### Verdict: yes (keep), unproven

It is about 1 kB gzip in the lazy scene host, costs nothing measurable on a fast device, has an undo for a step that does not help,
and the two small fixes (card hold, warm-up against the post buffer) are measured and correct. Do not count it as a performance gain
yet. The 100 ms target was not met and cannot be met by this phase, so the plan's wording should now say "phase 7 stops blur from being
left on and removes the first-draw flash; the gate stall is a separate item".

### Evidence still missing

1. **A phone.** The Android emulator rows are still "not measured" (the next step in `frames.md`). Better a real mid-range phone, with the
   governor's verdict and scale read from `?diagnostics` over a 60 s walk, with `?scale=1` as the control.
2. **A release build, not the dev server.** The dev server's unbundled modules make the first-load and build numbers worse than a player's.
3. **A quiet machine and n of 5 or more** for the stall rows, so "busy" is not an explanation for a 5 to 6 against 2 to 3.
4. **The gate stall** as a number a fix is tested against (the 196 ms task), and the first-load time to a drawn frame on a throttled
   network.
5. **The live post configuration** (AO off) in the frame table, with draw calls counted from the scene's own pass.

---

## The ranked "still basic" list now (a Lagos street, from the committed pictures)

### At dusk (18:30)

1. **The life on the road.** Unchanged since wave 1: two loaf-shaped vehicles that look as if they hover, no lamps, no shadow under them;
   one or two walkers on an empty pavement.
2. **Surfaces and silhouette.** Flat salmon planes with no stain or crack, cube trees, prism poles, a clean kerb.
3. **The dusk light itself.** It is the low sun colour on flat surfaces; the lamp pools (strength 0.4) are invisible, the windows and
   signs were already pale, and nothing says "evening" beyond the sky colour. This is where phase 2b did least, and dusk is the
   anchor's hour.
4. **Signs, clutter and the HUD.** Flat one-word panels, no billboards, no hanging wire clutter, no generators; the HUD is still a
   column of cards with a stack over the pavement.

### At night (21:00)

1. **The life on the road, and its light.** Dark blocks with no headlamps, tail lamps or shadow; the road has nothing moving on it that
   is lit.
2. **The near field is unlit.** The pools are far away; the bottom 60% of the frame is the same flat blue-grey. A real night has a lit
   shopfront, a generator bulb or a phone torch within three metres of the camera.
3. **Surfaces and silhouette.** As at dusk; at night the flat planes read as clean plastic.
4. **Signs, clutter and the HUD.** The shop sign is an unlit panel; the awning is dark.

### Wet (either hour)

1. **The road does not change.** A wet street shows the lamps in the tarmac; here the road is as dry as before and the sheen is a
   banded blob on the pavement. 2. No puddles, ripples or splashes on the ground. 3. Nothing wet on the body of the player or the walkers.

## Blind-pair note

I cannot see a photograph, so this is a prediction. A blind judge shown the night street (2b after) against a photograph of a real
Lagos street at 21:00 would still pick the photograph at once. The reasons, in order: (1) the traffic and the people (a real night road
is full of headlamps, tail lamps, generators and figures lit from the side; ours is dark blocks and an empty pavement); (2) the
surface (clean, flat, plastic); (3) the lights, where ours have improved but are small, far and few against a real street where every
doorway is lit. Phase 2b moves reason 3 from "no lights" to "a few lamp pools", which a judge would notice only if asked to look
for it. At dusk the pair would not change at all. The wet pair would lose on the road (no reflections) and the lilac blob would
read as a mistake. Expect 0 to 4, or one lucky draw: the next phase must build the life on the road and its lights, not another effect.

## Pointers for the integrator

- Shoot the live configuration: the `night-post` frame with `?post=1&ao=0`, at 2x, scene and page, and run `inspect.ts` on it. Add the
  AO-off stack's frame rows to `frames.md` on a quiet machine.
- Put the dusk pool strength up (0.4 is invisible) or accept that 2b is a night feature, and say so in the record.
- Record the gate stall (196 ms, one JS task) as its own item with an owner; it is the only thing in phase 7's target that stays red.
- The standing HUD failures remain the cheapest points on the board.
