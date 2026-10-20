# Critic scorecard, wave 1 (rain and smoke, the post stack, feel)

Critic: Claude (Fable 5.1 session `os-critic-wave1`), 20 October 2026. Source: `origin/main` at `37c4c5e3c`. I wrote no code. I took no
new pictures (the machine's slots were busy, and I was told not to start a browser or server): everything below is scored from the
committed anchors in [anchors/](anchors/anchors.md), the builders' pictures in `docs/agent-work/`, the code and the numbers in the three
records and in [frames.md](frames.md). Where that is not enough I say "not captured". Scale and failures: [../EVIDENCE.md](../EVIDENCE.md).

**Half points.** The scale is 0 to 3. I use a half point only where a picture sits between two rows of the table and I could not
decide without inflating; a half point is a doubt, written as such.

**What I could not do** (so the reader knows what these scores rest on): run `shoot.ts` or `inspect.ts` on the builders' branches,
shoot a second time of day, or look at the pictures at 2x. The builders' pictures are 780 to 880 px wide, resized, and (phase 1)
taken with a copy of `shoot.ts` that is not in the repo; the pixel figures in the anchors file are not comparable with them, so I
quote none for the phases.

## The anchors, scored (BEFORE for every phase)

The street at dusk is the "1 to 2" anchor by definition; I scored the other two because the anchors file leaves them to the first
critic. Obstacles at home: not applicable (nothing in the room is traffic or crowd), left out of that average.

| Category | Street, dusk | Kano market, noon | Home, night | Evidence (the anchor pictures) |
| --- | :-: | :-: | :-: | --- |
| Art direction | 2 | 2 | 2 | Street: wires, awnings, "HAIR SALON" and "JEWELLERY" signs, a spire. Kano: the "KURMI MARKET" sign, mat stalls, earth tones. Home: red curtains, window grille, water barrel, jerry cans. Culture drives the shapes, but nothing is distinct down to the doorknob. |
| Hero | 1 | 1 | 1 | The player is a stock figure that stands at a wall, at the door, in the market. No state cue (wet, tired) on the body. |
| Obstacles | 1 | 1 | n/a | Street: two block vehicles (a green and a yellow loaf shape) and one walker on a long road. Kano: three figures and a hand cart. |
| Interactables | 1 | 1 | 2 | Street and Kano: a floating "City streets" tag, chips in the HUD. Home: authored furniture, "Step outside" tag on the door, the chips name the rooms. |
| World | 2 | 1 | 2 | Street has depth bands, diminishing poles, wires, planters. Kano is four repeated stall blocks on a pale plate in a void. Home is a dense, lived-in room. |
| Materials | 1 | 1 | 1 | Flat colour per surface, no panel lines, dirt or wear; the home's tiled floor is the only pattern. |
| Lighting | 1 | 1 | 2 | Street: one low sun colour, long shadows, but every lamp, window and sign is dark and lights nothing; no contact darkening. Kano: flat noon. Home: warm lamp pools on a dark blue night, the one place the lights light what they stand next to. |
| VFX and motion | 1 | 1 | 1 | Nothing falls, drifts or bursts. The street HUD says "Raining - trekkers get soaked" over a picture with no rain in it. |
| UI and HUD | 1 | 1 | 1 | A column of rounded cards on the left, four stacked banners at the bottom centre. |
| Performance evidence | 2 | 2 | 2 | Renderer calls and triangles and frame rows exist ([frames.md](frames.md)); the Android row is "not measured". |
| **Average** | **1.3** | **1.2** | **1.6** | |

Automatic failures standing at the anchors (and therefore in every picture below, since no phase touched the HUD):

1. **The HUD is mostly rectangular stat cards.** The left rail is seven cards and pills, the bottom centre four banners.
2. **The HUD covers the walking path.** On the street view the bottom-centre stack (location card, two sign-up banners, "Near you")
   sits over the lower third of the pavement. The camera there is placed by the harness, so this is a finding about the picture,
   not proof for every phone; it is still a standing failure by the rule.

---

## Phase 1: weather you can see (`os-phase1-weather-20261019`)

Pictures: `docs/agent-work/os-phase1-weather-{street,kano,home}.png` (high tier, `?wet=1`, inside the wake window).

| Category | Street before | after | Kano before | after | Home before | after | Evidence where it changed |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| Art direction | 2 | 2 | 2 | 2 | 2 | 2 | |
| Hero | 1 | 1 | 1 | 1 | 1 | 1 | The figures get no wet cue (no dark clothes, no hunch). |
| Obstacles | 1 | 1 | 1 | 1 | n/a | n/a | Nothing reacts to the rain. |
| Interactables | 1 | 1 | 1 | 1 | 2 | 2 | |
| World | 2 | 2 | 1 | 1 | 2 | 2 | |
| Materials | 1 | 1 | 1 | 1 | 1 | 1 | The ground is not darker or glossier: it is the dry anchor with lines drawn in front. |
| Lighting | 1 | 1 | 1 | 1 | 2 | 2 | A warm low sun, hard shadows and a clear violet sky under falling rain. The weather and the light disagree. |
| VFX and motion | 1 | **1.5** | 1 | **2** | 1 | 1 | Street: thin white streaks, about two dozen in the frame at 780 px, visible and not generic. The awning cover and the splashes cannot be proved from the picture (I see no splash). Kano: dense, long, plainly rain, and the whole diorama reads as weather; it falls over the empty fog around the plate too (snow-globe look), and one streak about 100 px long hangs bottom-left, a drop beside the lens. Home: the streaks fall through the void above and around a roofless cutaway room; nothing about the house responds, so it reads as noise, not weather. |
| UI and HUD | 1 | 1 | 1 | 1 | 1 | 1 | |
| Performance evidence | 2 | 2 | 2 | 2 | 2 | 2 | Record: wet against dry within 0.2 ms on the M4 Pro; +1 to +3 draw calls, +12k triangles at high. Good numbers; `frames.md` has no wet rows and the Android row is still empty. |
| **Average** | **1.30** | **1.35** | **1.20** | **1.30** | **1.56** | **1.56** | |

**Automatic failures standing.** The two HUD failures above. "Particles stand in for missing geometry" is not standing, but it is
close: the streaks are the only wet cue on a dry-looking street. Frame table not updated (partial: the numbers are in the record).
Smoke (the grill and the generator) shows in none of the three pictures, so it is **not captured** and not scored.

**Verdict: yes, but tune the street's surfaces.** Rain pays its way: it is one or two draw calls, it is inside the noise on the
fast GPU, it loads lazily (FX_GZIP 5.8 kB of a 120 kB budget), and it closes the most embarrassing gap in the anchors, a HUD that
says it is raining over a picture that is dry. It is the only phase of the three with a visible change. It earned a half point on
the street and one on Kano, not more, because it is rain on a dry world. Tune: (a) make "wet" a property of the ground, not only of
the sky; (b) drop the near-lens streak and test the streak width at phone size (a half-pixel line is invisible on a phone); (c) do
not rain through the home's cutaway: sound only, or a drip on the window; (d) put one picture with a grill or generator in the
record or cut the smoke from the claim.

**Weakest surface:** the street's ground in the rain (Materials 1, Lighting 1). **Single next change:** when wet, multiply the
road and pavement colour by about 0.7, lower their roughness, and take the sun down a step (one uniform on the ground and wall
materials, no new pass). It moves Materials and Lighting together, costs nothing, and makes the rain already built look like it is
landing on something.

---

## Phase 2: one post stack (bloom, grade, vignette, N8AO, MSAA) on the high tier (`20261019-os-phase2-post`)

Pictures: `os-phase2-post-before.png` and `-after.png`, the dev street harness (`?post=1`) at dusk, 800 px. This is a different
camera and different neighbours from the anchor, so it is a real before/after pair of its own, not the anchor frame. Only the street
was shot: **Kano and home are "not captured"** (the plan asked for all three).

What I see between the two pictures: the top of the sky is a deeper, more saturated violet; a soft darkening in the corners; the
shadows are a touch cooler. I cannot find the contact darkening the record describes under the fence, the planters or the vehicles.
The lamp heads, the shop windows and the signs do not glow in either picture.

| Category | Before | After | Evidence where it changed |
| --- | :-: | :-: | --- |
| Art direction | 2 | 2 | |
| Hero | 1 | 1 | |
| Obstacles | 1 | 1 | |
| Interactables | 1 | 1 | |
| World | 2 | 2 | |
| Materials | 1 | 1 | AO would be the Materials lever; I cannot see it. |
| Lighting | 1 | 1 | The grade is a mood change (sky), not a lighting change: no emitter lights anything, so bloom has nothing to bloom and the lamps are as dark as before. The plan's target (Lighting at least 2 at dusk) is **not met**. |
| VFX and motion | 1 | 1 | |
| UI and HUD | 1 | 1 | |
| Performance evidence | 2 | **1.5** | The record has before/after milliseconds with the bottleneck named (AO), which is good. But the after picture's own overlay reads "1 calls, 1 tris": under a composer `renderer.info` counts the last pass only, so draw calls and triangles are blind with the stack on, and `frames.md` has no after rows. |
| **Average** | **1.30** | **1.25** | |

**Automatic failures standing.** The two HUD failures. **No renderer diagnostics after graphics work** (calls and triangles read
1 and 1; the frame table is not updated). Required three-view pair: only one view captured.

**The cost, from the record.** On an M4 Pro at 2x: plain 2.5 to 2.7 ms, stack without AO 4.1 (+1.5), with AO 6.3 to 6.4 (+3.7, AO
alone about 2.2). The lazy fx chunk is 247 kB raw and 106 kB gzip (it holds n8ao). The buffers are capped at 1.5x, so a retina
screen is drawn softer than before and stretched. A street this light (2 ms plain) understates what AO costs on a busy scene or a
weaker GPU; the builder says integrated GPUs "can be several times slower".

**Verdict: no, not as shipped.** Under the worth-it rule the change has to clearly outweigh its drawbacks, and from the pictures
the benefit is a deeper sky and a vignette, which I would call barely visible, against 3 to 4 ms and 106 kB on every high-tier
player. The owner's complaint was "flat, no AO"; the AO is the largest cost and the part I cannot see. The honest reading is that the
stack has nothing to work on yet: bloom and the grade need light sources, and the picture has none. Do not delete it. Ship it with
AO off by default (grade, vignette and MSAA are about 1.5 ms), or hold it behind `?post=1` until a picture pair at 2x shows contact
shadows I can point at. The plan's own wording for phase 11 ("decide once the post stack's before/after shows how far it gets us")
now has its answer: not far, by itself.

**Weakest surface:** Lighting on the street (1; nothing emits). **Single next change:** make the emitters real. Give the lamp
heads, shop windows and signs a colour brighter than the bloom threshold (0.85) and put a warm additive disc on the ground under
each lamp and shop front (a cheap decal, not the dropped render-target light map). That is the first time the stack has anything to
bloom and the first time a lamp lights what it stands next to; it is the change most likely to take Lighting from 1 to 2.

---

## Phase 3: feel (tiers, shake, hit-stop, pop, reduce-shake) (`os-phase3-feel-20261019`)

No picture was supplied and none is possible from a still: the effects are a chime, a CSS confetti burst, a chip pop, a camera nudge
and a 70 to 90 ms freeze in the arena fight. **Every category is "not captured" for this phase, which means the scores stand as the
anchors.** Judged from the record and `src/scene/feel/` (543 lines with tests, 13 files):

- Wired on main: `goal-done` and `pay-received` (`src/scene/reward.ts`), the fight hit (`src/arena/fight-3d.ts`), the shake listener
  in `src/venue-world.ts` (the integrator applied the patch), and the "Reduce shake and flashes" switch in `ViewSettings.vue`.
- **Not wired:** `level-up`, `football-goal`, `danfo-stop` and `election-won` are in the table and have no caller; no goal in the
  football scene freezes or shakes. Four of seven events are dead code.
- The confetti is a 2D HTML overlay (`.life-burst`), not an effect in the scene. The pop is CSS on a chip. The mesh pop and the 3D
  burst were left out. The shake is a sampled sine, never random, decays in under half a second and respects the reduce choice, which
  is the right design.

| Category | Before | After | Evidence |
| --- | :-: | :-: | --- |
| Art direction, Hero, Obstacles, Interactables, World, Materials, Lighting | as the anchor | same | Not touched. |
| VFX and motion | 1 | 1 (not captured) | The rubric lists "a goal's confetti; motion eases" as a 2. By code the reward moment would earn it, but no picture or recording shows it, and "a doubt is a lower number". The plan's measure (VFX at least 2) is unmet on evidence. |
| UI and HUD | 1 | 1 | A chip that pops is a transition on a card; the cards are unchanged. |
| Performance evidence | 2 | 2 | No frame cost to measure; startup bytes equal main (613,913 raw) after two regressions the builder caught and removed. |
| **Average** | **1.30** | **1.30** | |

**Automatic failures standing.** The two HUD failures. **No active-play screenshot** for this phase.

**Verdict: yes, but tune: show it, and wire the other moments or delete them.** It is cheap, lazy, off the first download, it has the
reduce-shake switch the owner's rule demanded, and the design (routine actions get nothing) is right. It earns its place on cost
alone, not on anything I can see. A "feel" phase that cannot put one frame, one clip or one number on the scorecard has not been
shown to be worth the review time it took. The weakest surface is its evidence. **Single next change:** add `--query feel=goal` to
the harness (fire `feel('goal-done')` after the scene settles) and save a three-frame strip of the street at the shake's peak with
the confetti and the popped chip in it. Then wire `level-up`, the most frequent of the dead events, since an event that nothing
fires is a cost without a benefit.

---

## Wave 1 in one line

Street at dusk: **1.30 before; about 1.35 after the three phases together** (VFX +0.5 from rain; the post stack's Performance
evidence half point goes the other way; the feel phase is invisible to the scorecard). Kano 1.20 to 1.30; home unchanged at 1.56.
Nothing is near "premium" (no category under 2, average 2.3), and the weakest categories (Hero, Obstacles, Materials, Lighting, UI) did
not move.

## What the pictures still say

The street at dusk next to a photograph of a real Lagos street at the same hour, ranked by how fast a viewer notices:

1. **Light that comes from things, and the wet.** In a real dusk the street is lit from within: windows, shop signs, generators'
   bulbs, headlights and taillights, lamps with a sodium pool on the pavement and a smear of it on the tarmac, haze catching all of
   it. Here every lamp, window and sign is dark; the only light is a low sun colour on flat surfaces. The post stack has no input,
   and in the rain pictures the ground is as dry as in the anchor. One fix family: emitters, ground pools, a wet ground.
2. **The life on the road.** A Lagos street at dusk is full: danfos with their dents, stripes and lettering, okadas threading
   between them, keke, hawkers and kiosks at the kerb, people in rows, parked cars half on the pavement. Here two loaf-shaped
   vehicles (a green and a yellow block) and one or two walkers share a long, empty road and a clean, empty pavement.
3. **Surface and silhouette.** Everything is a clean, straight, flat-coloured plane: salmon walls without cracks, stains, peeling
   paint or mildew; no corrugated zinc, open drains, rubble, sandbags, potholes or patched tarmac; trees are green cubes, poles are
   prisms. The edge-density figure (0.265) comes from facets and wires, not from detail.
4. **Signs and clutter.** Shopfronts carry one or two words on a flat panel. A real street layers hand-painted boards, banners,
   posters, billboards, tangled wire with things hanging from it, plastic chairs, generators, heaps; and no figure in the frame shows
   what it is doing or that it is wet, tired or hurrying.

## Blind-pair note

I cannot see a real photograph here, so this is a prediction, not a result. A blind judge shown our street (or the rainy one)
against a photograph of a real Lagos street at the same hour would almost certainly pick the photograph within a second, and the
reasons would be, in order: (1) the lights, since real dusk has glowing windows and lamps and ours has none; (2) the clutter and the
people, since the road and pavement are empty; (3) the surfaces, since nothing is dirty or textured; (4) the blocky vehicles and
cube trees at the silhouette level. The rain pictures would not change the pick: the streaks help the Kano and home views read as
weather, but on the street they sit in front of a dry scene, and a real wet street would show the lamps in the road. The post stack's
deeper violet would not register in a pair at all. Expect to lose this pair 0 to 4 or close to it, as Fable Cities did; the loss tells
the next phase to build the lights and the life before any further effect.

## Pointers for the integrator

- The standing HUD failures (cards; stack over the pavement) are the cheapest points on the board: UI and HUD is a 1 in every view and
  no phase owns it.
- `frames.md` needs rows for the wet street and, above all, for the post stack, with draw calls and triangles counted from the scene's
  own pass (the composer's last pass reads 1 and 1).
- Phase 11 (the baked hero street) should start from the light and the life, per the list above, not from more passes.
