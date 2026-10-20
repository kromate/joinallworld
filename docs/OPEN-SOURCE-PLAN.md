# Implementation plan: the 36 ideas from the open-source pass

Written 19 October 2026. It turns every idea in [OPEN-SOURCE-LEARNINGS.md](OPEN-SOURCE-LEARNINGS.md) (numbered 1–36 there, the
same numbers here) into fourteen phases in five waves. Each phase is one branch, one work record, one release, built the way
[AGENT.md](../AGENT.md) describes (CI builds, budget lines all `ok`, release workflow). Decisions below were taken as defaults for
the owner; all are reversible. Effort is agent days; waves run in parallel where the ownership map allows.

## Rules that bind every phase

- **The first download does not grow.** Everything new loads with the scene host or in its own lazy chunk. A new chunk `fx`
  (post-processing, particles, rain, feel) gets a provisional brotli budget in `src/budgets.ts`, enforced in
  `src/scene/city-scenes.test.ts` like `SCENE_HOST_*`. Phone tier never imports `fx`'s post and AO parts.
- **Licences.** Only MIT, Apache-2.0, Zlib, CC0 and CC BY code or assets (AGPL-compatible, [NOTICE.md](../NOTICE.md) updated).
  Hunyuan3D output is not used until its licence is read; TRELLIS.2 and TripoSR are fine.
- **Pure planners, drawn separately.** The pattern of `src/scene/street-life/` stays: a pure module that is a function of
  (seed, clock, conditions) with Node tests, and a draw module that owns THREE. Rain, smoke, routines and walks all follow it.
- **The battery rule** (`src/scene/ambient/layer.ts`): nothing asks for frames on its own. Weather and walking people move only
  inside a scene's wake window; reduced motion gets a still frame.
- **Evidence before "done".** Every graphics phase ships a before/after screenshot pair at the three reference views (Yaba
  street at dusk, a Kano venue at noon, a home at night), the scorecard delta, and the frame table from the Mac and the Android
  emulator (phase 0 builds these). A phase whose evidence is missing is not merged.
- **Ownership.** One phase per folder set; `vite.config.ts`, `src/budgets.ts`, `src/scene/quality.ts`'s tier gate and
  `AccountSettings.vue` belong to the integrator; a phase that needs a change there files a one-line request in its record.

## Status, 20 October 2026 (04:00 Lagos)

Every phase the review marked "go" is live (build b9ecaaf74; four releases through the night, each with the continuity check):

| Phase | State | Critic |
| --- | --- | --- |
| 0 Evidence, 0b `fx` chunk | live | anchors proven at 12:00 vs 21:00; bot-walk baseline 8 stalls |
| 1 Rain and smoke | live | earned its place (1.30 → 1.35); tune: wet ground answered by 2b |
| 2 Post stack | live, **on** (owner: "deploy with everything on"); ambient occlusion opt-in `?ao=1` after a kerb smear | not earned as shipped; needs the vehicle lights below to have more to light |
| 3 Feel | live | cheap, unproven in a picture; four events still have no caller |
| 4 Ticker and memory | live | not scored (not graphics) |
| 2b Light from things, wet ground | live | earned its place, only just (night 1.35 → 1.40, wet 1.35 → 1.45, dusk unchanged) |
| 7 Governor and warm-up | live | keep, unproven on a phone; the gate stall (150–200 ms) is the street build in one task, not a governor matter |
| 12 Art direction, provenance, runbook; 13 growth deltas | live (docs, scripts) | 166 models recorded as `unverified` pending Meshy's terms |

Scorecards: `docs/evidence/critic-wave1-20261020.md`, `critic-wave2-20261020.md`. Frame rows: `docs/evidence/frames.md`.

**What the critic says to do next, in order:** (1) headlamps, tail lamps and a contact shadow under every vehicle on the existing pool mesh, and a stronger dusk pool; (2) the road itself wet, with puddles; (3) slice the street build or start it when the player nears the gate, to kill the 150–200 ms stall; (4) a phone row in the frame table (a real device, not the software-GL emulator); (5) shoot the live configuration (`?post=1&ao=0`) at 2× before claiming the post stack looks right. Waiting phases (5, 8, 10, 11) keep their triggers; the owner has two reads to do (Meshy's terms, TRELLIS.2's DINOv3 licence).

## Worth-it review (19 October, the owner's rule: build only what clearly outweighs its drawbacks)

Each phase judged before any code. "Go" means build as narrowed here; "Wait" means not now, revisit when the trigger is met;
"No" means dropped.

| Phase | Verdict | Why |
| --- | --- | --- |
| 0 Evidence | Go | Cheap (3 days), and without it every later judgement is a guess. The anchor screenshots and the frame table are what let us stop a phase that does not pay. |
| 0b `fx` chunk | Go | A few lines; needed only because 1–3 go. |
| 1 Weather | Go, narrowed | Rain is one draw call and uses the (seed, clock) pattern we already trust: high visible gain, low cost. Smoke only with an own ~150-line emitter and at most two draws per scene; no particle library (bundle and upkeep outweigh it); no per-vehicle exhaust or dust (many emitters for little). |
| 2 Post stack | Go, narrowed | It answers the owner's "flat, no AO" directly on the tier where screenshots are taken. AO is gated: default-off if it costs over 3 ms. The render-target street-light map is dropped (complexity for a modest gain); it returns with the baked street (11). |
| 3 Feel | Go, narrowed | Sound + pop + burst on the big moments is cheap and makes rewards land. Camera shake only on the large tier; hit-stop only in the arena fight; a reduce-shake setting from day one. |
| 4 Ticker and memory | Go, narrowed | The ticker reads the gist ledger we already keep: cheap, shareable. "Remembers you" is kept client-side for one day (no new server table), which removes most of its cost. |
| 5 Homes by the hour | Wait | Nice, but it mostly shows at night in neighbourhoods few people visit yet. Trigger: neighbourhood visits per day rise after wave 1. |
| 6 Walking regulars, Street Sense, blackout | Mostly no | Yuka adds ~60 kB and pathing bugs through walls for a gain today's glancing regulars already half-give. Street Sense is UI clutter. Only the shared blackout event (cheap, screenshot-worthy) is kept, folded into phase 4. |
| 7 Governor and warm-up | Go | Two days, no new bytes, fewer stutters for everyone. |
| 8 BatchedMesh and KTX2 | Wait | Only if phase 0's frame table shows Yaba over the draw-call budget. KTX2 adds a transcoder and a pipeline for textures we keep at one 1024 per model; not worth it yet. |
| 9 Batched crowds | No (for now) | Eight days for crowds above twelve, which the player counts do not produce yet. Trigger: a venue regularly holds more than twelve people. |
| 10 Proximity voice | Wait | Voice stages are barely used; RNNoise is 1.9 MB. Trigger: weekly voice minutes above a few hours. A plain PannerNode (half a day) can go in earlier if voice picks up. |
| 11 Hero street baked | Go, after wave 1 evidence | The owner's stated priority, but ten days: decide once the post stack's before/after shows how far it gets us. |
| 12 Art direction and manifests | Go (docs) | Provenance for the Meshy models is a licence duty; the style guide is a page. The local image-to-3D runbook is optional. |
| 13 Growth deltas | Go (small) | A cost model and two checks folded into the WOW plan. |

So of the 36 ideas: 21 go now (narrowed), 9 wait for a trigger, 6 are dropped (particle library, per-vehicle exhaust and dust,
the render-target light map, Yuka walking, Street Sense, batched crowds).

## The 36 ideas, where each lands

| # | Idea | Phase |
| --- | --- | --- |
| 1 | Rain that falls, stops under awnings, takes the lights' colour | 1 |
| 2 | Street-light map | 2 (first cut), 11 (baked) |
| 3 | One post pass with AO | 2 |
| 4 | Colour grade per climate | 2 |
| 5 | Particles: smoke, dust, exhaust, confetti | 1 |
| 6 | Baked hero street, grammar for the rest | 11 |
| 7 | Zero-asset as a style | 12 (style guide rule) |
| 8 | Juice by tiers | 3 |
| 9 | Hit-stop in fights | 3 |
| 10 | The pop | 3 |
| 11 | People who remember you | 4 |
| 12 | City news ticker | 4 |
| 13 | Homes with people by the hour | 5 |
| 14 | Routines by place, utility not timetable | 5 |
| 15 | Regulars who walk | 6 |
| 16 | Living systems: the shared blackout, Street Sense | 6 |
| 17 | Governor that probes back up | 7 |
| 18 | Shaders compiled before the title fades | 7 |
| 19 | Draw-call budgets, BatchedMesh | 8 |
| 20 | KTX2 textures | 8 |
| 21 | Fifty avatars in one upload | 9 |
| 22 | Budget per view | 0 |
| 23 | Proximity voice | 10 |
| 24 | Local image-to-3D | 12 |
| 25 | PBR maps from one photo | 11 |
| 26 | One skeleton, every outfit | 12 |
| 27 | Art direction document, assets as families, provenance | 12 |
| 28 | Generated sound | 1 (rain, generators), 12 (radio) |
| 29 | A separate critic | 0 |
| 30 | Anchored visual scorecard | 0 |
| 31 | Bot playtests and pixel checks in CI | 0 |
| 32 | Parallel sessions with separate ownership | 0 (process) |
| 33 | Skills installed once | 0 |
| 34 | Lagos Life's costs and ads | 13 |
| 35 | Vibe Jam's growth checklist | 13 |
| 36 | Peers to watch | 13 (standing section) |

---

## Wave 0 — Foundations (week 1; three phases in parallel)

### Phase 0 — Evidence: scorecard, critic, inspector, bot walk, frame table (ideas 22, 29–33)

**What changes.** Nothing a player sees. Every later phase is judged by this.

**New.**
- `docs/EVIDENCE.md`: the ten-category scorecard (art direction, hero, obstacles, interactables, world, materials, lighting, VFX,
  UI, performance evidence; 0–3 each; premium = none under 2 and average ≥ 2.3) with its automatic failures ("bloom, fog or
  particles standing in for geometry", "HUD mostly stat cards"), renamed for a life sim (hero = the player's body; obstacles =
  traffic and crowds; interactables = doors, stalls, seats). Three anchor screenshots in `docs/evidence/anchors/` taken today:
  Yaba street at dusk, a Kano venue at noon, a home at night. Today's Yaba is the "1–2" anchor by definition.
- `scripts/evidence/shoot.ts`: a repo-safe screenshot harness on the `dev:open` server (port 5211, settled life with a house),
  headless Chromium over CDP, with named views (`?view=street-dusk` etc.) and a fixed clock; writes PNG plus a JSON line with
  console errors, draw calls, triangles and frame time p50/p95 over a 10-second dwell (`renderer.info`, the `?streetperf=1`
  readout). The owner's private `shots/shot.mjs` stays private; this one has no account and no live site.
- `scripts/evidence/inspect.ts`: pixel metrics on each PNG (colour entropy bits, dominant-colour share, edge density, luminance
  contrast) with the thresholds from the scorecard, so "looks flat" becomes a number in CI.
- `scripts/evidence/walk.ts`: a bot that plays the loop home → gate → street → market → back, reporting a metrics JSON (stalls,
  errors, time to first frame, frames over 42 ms); run on every release, fails on a console error or a stall.
- The critic: a prompt in `docs/AGENT-PROMPTS.md` ("you write no code; take your own screenshots at the three views at two
  times of day; score against the anchors; name the weakest surface; never inflate") and a rule that a graphics phase's record
  carries a critic's scorecard written by a different agent than the builder. A blind pair (A/B shuffled, ours against a
  reference photo of the real street) at each wave's end, recorded in the phase record.
- `docs/evidence/frames.md`: the per-view frame table (Mac Chrome at 2×, Android emulator), kept up to date by phases 1–9.
- `.claude/skills/`: copies of `game-feel`, `game-ai`, `create-game-assets` (Apache-2.0, with LICENSE) and the scorecard and
  inspector references from `threejs-game-skills` (MIT), each with a one-line note "written for three r186; we are on r180".
  `docs/AGENT-PROMPTS.md` gains the two process rules: one session per folder set, and review from screenshots and frame timings,
  not from the agent's report.

**Owns.** `scripts/evidence/`, `docs/EVIDENCE.md`, `docs/evidence/`, `.claude/skills/`, `docs/AGENT-PROMPTS.md`.
**Depends on.** Nothing. **Effort.** 3 days. **Measure.** Every later phase cites it.

### Phase 0b — The `fx` chunk and the tier gate

**What changes.** Nothing visible; the place the next phases load into.

**New.** `src/scene/fx/index.ts` (empty host that exports `loadFx(tier)`), a `manualChunks` rule in `vite.config.ts` that puts
`src/scene/fx/**`, `postprocessing`, `n8ao` and the particle library in `fx`; `FX_BROTLI` provisional budget (first guess
120,000 bytes; measured after phase 2); the tier gate: `fx`'s post and AO parts only on the HIGH tier (`quality.ts`'s existing
gate), rain and feel on every tier. `three` stays at r180 for now; a separate one-day phase upgrades to r186 after wave 1 if
phase 8 needs `BatchedMesh` per-instance opacity (r183+).

**Owns.** `src/scene/fx/index.ts`, the integrator's files. **Effort.** 1 day.

### Phase 0c — Dependencies and licences

`npm i postprocessing n8ao three-nebula yuka` (Zlib, CC0, MIT, MIT), each checked with `gh api repos/<r> --jq .license`,
lines added to `NOTICE.md`, `src/licence.test.ts` extended to assert the dependency list stays AGPL-compatible. If
`three-nebula` is over 40 kB brotli after tree-shaking, phase 1 writes its own 150-line billboard emitter instead (decision
recorded in its record). **Effort.** Half a day.

---

## Wave 1 — The look and the feel (weeks 2–3; three branches in parallel)

### Phase 1 — Weather you can see (ideas 1, 5, 28)

**What a person sees.** When the city's weather says rain, rain falls in the street and at the venue door, streaks lit by the
signs, none under the awning or the roof you stand beneath, splashes on the road. Suya grills and generators smoke; a danfo
pulling away leaves exhaust; a Kano afternoon in harmattan has dust lifting off the road; a goal reached bursts confetti in
3D (phase 3 fires it). Rain, generator and wind sounds come from the synth, not files.

**New.**
- `src/scene/fx/rain-plan.ts` (pure): a drop's world position as a function of (index, seconds, wind, box around the camera),
  wrapped into the box; the cover test (a 1 m grid heightmap of the scene's roofs and awnings, built once from the scene's
  landmark boxes and street buildings); counts per tier (phone 600, mid 2,000, high 6,000). Tests: wrap continuity, cover under
  a roof, zero drops when `wet` is false.
- `src/scene/fx/rain.ts`: one `InstancedBufferGeometry` of quads with a `ShaderMaterial` (WebGL GLSL port of the TSL idea):
  the vertex shader stretches each quad along velocity relative to the camera, fades near and far, discards under cover, tints
  from the street-light map when phase 2 provides it (a uniform; white-grey until then); additive, no depth write, one draw.
  A second small instanced set for splashes near the camera. Rendered only inside the wake window (battery rule), with a fixed
  still frame under reduced motion.
- `src/scene/fx/smoke.ts`: emitters bound to landmarks by the regexes that already name them (`/suya|grill|smoke/`,
  `/generator|exhaust/`), plus vehicle exhaust from `street-life/traffic.ts` poses; dust from `harmattan`; a `burst(kind, at)`
  for confetti and sparks. Three-nebula or the own emitter per phase 0c.
- Hooks: `src/scene/venue-scenes.ts` passes `view.weather` and the wake window to `fx`; `src/scene/street-life/street-scene.ts`
  the same for the street; `src/scene/home-scene.ts` rain on the windows and the yard.
- Sound: `src/audio/data.ts` recipes for rain (intensity from the drop count), a generator's drone with the smoke, and wind;
  played by the director on the existing `outage`/weather moments.

**Owns.** `src/scene/fx/rain*.ts`, `src/scene/fx/smoke.ts`, the hook lines in the three hosts, `src/audio/data.ts` (rain,
generator, wind recipes only). **Depends on.** 0b, 0c. **Effort.** 4 days.
**Measure.** Frame table: rain costs under 1.5 ms on the emulator at the phone count; one draw call for rain, one per
emitter kind. Scorecard: VFX from 1 to 2 at the Yaba-dusk view. **Risk.** Overdraw on phones: the count table is the lever;
additive quads thinner than a pixel conserve brightness (Neon Zenith's `max(width, dist·0.0011)` rule).

### Phase 2 — One post stack with AO and a grade; the first street-light map (ideas 2, 3, 4)

**What a person sees.** On the HIGH tier the street has contact shadows under eaves and cars, smooth edges, a gentle vignette,
night lights that spill onto the road, and a colour mood per climate: harmattan amber in Kano, monsoon grey-blue in Lagos in
July, sodium orange at night, clean blue in Nairobi's dry season. Phone tier is unchanged.

**New.**
- `src/scene/fx/post.ts`: `EffectComposer` from `postprocessing` with `RenderPass`, `N8AOPostPass` (half resolution, the
  "performance" preset), `EffectPass(BloomEffect, LUT3DEffect, VignetteEffect, SMAAEffect, ToneMappingEffect ACES)`, built once
  per renderer, sized by the governor's render scale (phase 7) and `BLOOM_RATIO`. Replaces the composer in `quality.ts`
  (`createBloom` keeps its signature and delegates).
- `src/scene/fx/grade.ts` (pure): a 16³ LUT generated in code from climate parameters (lift, gamma, gain, warmth, saturation)
  for `CityClimate` × season × hour; tests assert monotone luminance and a fixed hash per climate so a grade never changes by
  accident. No LUT files shipped.
- `src/scene/fx/lightmap.ts`: a first-cut street-light map: once per night scene, render the scene's emissive meshes (signs,
  windows, lamps) top-down with an orthographic camera into a 1024² render target, blur it, hand it as a uniform to the ground
  and façade materials via `onBeforeCompile` (`gl_FragColor.rgb += spill * texture(lightmap, uv)`) and to rain (phase 1).
  Phase 11 replaces the render with a baked texture for the hero street.
- `docs/evidence/frames.md`: before/after rows for the three views.

**Owns.** `src/scene/fx/post.ts`, `grade.ts`, `lightmap.ts`, `src/scene/quality.ts` (delegation only), the ground and façade
material hooks in `src/scene/street/street-kit.ts` and `venues-common.ts`. **Depends on.** 0b, 0c. **Effort.** 4 days.
**Measure.** Scorecard Lighting and Materials ≥ 2 at Yaba dusk; post stack under 4 ms on the Mac at 2×, AO under 2.5 ms;
`fx` within budget. **Risk.** AO noise on flat vertex-coloured walls: tune radius and intensity per anchor view; a grade that
fights the existing `lightingFor` presets: the grade is applied last and kept subtle (gain ±8%).

### Phase 3 — Juice: feel tiers, hit-stop, the pop, reduce-shake (ideas 8, 9, 10)

**What a person sees.** Finishing a goal: a chime, a confetti burst beside you, the chip pops in with overshoot, the camera
nudges once and settles, the number counts up. Pay received: a smaller version. A fight hit lands with a 70 ms freeze and a
flash; a football goal gets the large tier. Settings gains "Reduce shake and flashes"; `prefers-reduced-motion` turns it on.

**New.**
- `src/scene/feel/tiers.ts` (pure): `FEEL = { small, medium, large }` with sound id, burst size, pop amplitude, trauma added,
  hit-stop ms, flash ms; `feelFor(event)` maps game events (goal done, pay, level up, fight hit, goal scored, danfo stop made,
  election won) to a tier. Tests: every event has a tier; large never fires more than once per 2 s.
- `src/scene/feel/shake.ts` (pure): decaying trauma → camera offset by sampled sine (`offset = max·t²·sin(k·clock)`), never
  random per frame; `camera-controls.ts` adds the offset after `constrain()` and never to the avatar.
- `src/scene/feel/hitstop.ts`: a scene clock that can be frozen for N ms by real time (`performance.now`), used by
  `src/arena/fight-3d.ts` on an impact and by `football-3d.ts` on a goal; input is never blocked.
- `src/scene/feel/pop.ts`: squash (1.3, 0.7) → back with overshoot in 180 ms, for chips, the purse, coins and the share card;
  CSS keyframes in `src/ui/shell.css` for DOM, a tween for meshes.
- `src/scene/feel/index.ts`: `feel(event, at)` fires sound (audio engine), burst (phase 1 `burst`, CSS `.life-burst`
  fallback on phone or reduced motion), pop, shake, hit-stop and the number pop together; `src/scene/reward.ts` calls it.
- Settings: `AccountSettings.vue` toggle "Reduce shake and flashes" (integrator), stored beside the reduced-motion preference in
  `src/scene/first-person/preferences.ts`.

**Owns.** `src/scene/feel/`, `src/scene/reward.ts`, the impact hooks in `fight-3d.ts` and `football-3d.ts`, `camera-controls.ts`
offset lines. **Depends on.** 1 for 3D bursts (works with the CSS burst before that). **Effort.** 4 days.
**Measure.** Scorecard VFX/motion ≥ 2; a session recording of ten rewards with no nausea complaint from two testers; shake
returns to zero within 600 ms. **Risk.** Over-juicing: routine actions (walk, tap) get no feel at all.

---

## Wave 2 — A world that notices you (weeks 3–5)

### Phase 4 — The ticker and the memory (ideas 11, 12)

**What a person sees.** A news line runs along the Square's board and on the danfo radio: "third stall opened on Tejuosho
this hour", "Ada wins Lagos with 61%", "the generators start as NEPA takes light in Yaba", and at quiet hours a line of colour
("the suya smoke rises as the sun drops"). A person you greeted, bought from, gave a lift to or splashed says so next time
("ah, the one with the change") for a day.

**New.**
- `src/game/news/observer.ts` (pure): watches life state and gist entries, rate-limits (7 s + weight), keeps rolling counts per
  in-game hour for ordinals, picks lines from a per-city bank (`docs/TALK-BANKS.md` format) with placeholders; tests for the
  cooldown, the ordinal, and no line repeated within an hour.
- `src/app/features/gist/Ticker.vue`: the line in the Square and the HUD's notice slot; `src/danfo/conductor.ts` reads it as
  radio lines between stops.
- `server/social/acquaintance.ts`: `(playerId, npcId, kind, until)` with a 24-hour TTL, kinds `greeted | bought | lift |
  splashed | helped`; written by the stall purchase, the greeting gesture, the danfo stop and the rain splash (phase 1 reports a
  splash within 2 m of a walker); read by `src/scene/crowd.ts` so a regular gets a `memory` field, and by `ambient/layer.ts`
  which gives that person a wave or a turned back and one bark line.
- Content: thirty lines per kind in three registers (Lagos pidgin-light, Kano, elsewhere English), in the talk banks.

**Owns.** `src/game/news/`, `src/app/features/gist/Ticker.vue`, `server/social/acquaintance.ts`, the `memory` field in
`crowd.ts` and its use in `layer.ts`, the talk-bank files. **Depends on.** nothing hard; phase 1 for the splash kind.
**Effort.** 4 days. **Measure.** Lines shown per session; share-card taps from the ticker; "remembered" moments per day.
**Risk.** Spam: the rate limit and the one-line-per-hour-per-kind rule.

### Phase 5 — Homes by the hour and routines by place (ideas 13, 14)

**What a person sees.** Look into a neighbour's window at 21:00 and someone is on the sofa; at 02:00 the light is off and
they are in bed; at 07:00 the kitchen. The market fills from 09:00 and empties by 19:00; the viewing centre fills on match
night; a church or mosque fills at its hour; rain thins everything (already) and a festival swells it (already). People are
moved by what places want, not by a timetable per person.

**New.**
- `src/scene/ambient/intent.ts` (pure): a utility score per (place kind, hour, weather, festival, match night, outage) →
  wanted occupancy and pose mix; replaces the fixed `densityFor` tables where they exist with the same outputs by default
  (tests pin today's numbers), then adds match night, prayer hours and market hours.
- `src/scene/home-scene.ts`: an `occupant` for a visited home, placed by hour (sofa, table, bed, kitchen) from the resident's
  day (`docs/AI-RESIDENTS.md`), window light tied to occupancy; `src/scene/neighbourhood-scene.ts` lights windows across the
  estate by the same rule, so the street at night shows who is up.
- Parcels: a delivery waits inside the door until the owner is home (ties to Earn gig pay).

**Owns.** `src/scene/ambient/intent.ts`, `density.ts` (delegation), the occupant code in `home-scene.ts` and
`neighbourhood-scene.ts`. **Depends on.** nothing. **Effort.** 5 days. **Measure.** Scorecard World ≥ 2 at the home-night
view; time spent in neighbourhoods. **Risk.** Draw calls from lit windows: emissive on an instanced window material, not lights.

### Phase 6 — Regulars who walk, Street Sense, the shared blackout (ideas 15, 16)

**What a person sees.** The bar's regulars walk from the counter to a table to the door and back; at the market a trader
restocks and a buyer wanders between stalls. Hold a button and a quiet overlay names what is happening nearby ("Mama Nkechi is
haggling", "a danfo is loading for Oshodi", "generator running"). Once in a while NEPA takes light across the whole street at
once: every lamp and window goes dark, then one generator after another starts with its smoke and its drone, and the gist says so.

**New.**
- `src/scene/ambient/walk.ts`: Yuka `NavMesh` built once per venue from the floor polygon minus furniture and landmark boxes
  (`parametric-venue.ts` already knows them), `Vehicle` + `FollowPathBehavior` + `ObstacleAvoidance` for regulars, decisions
  from `intent.ts` (go to the counter when hungry, to a seat when tired, to the door when the venue closes); stepped only inside
  the wake window; deterministic from (seed, clock) by seeding Yuka's RNG and stepping with a fixed dt.
- `src/scene/first-person/sense.ts`: the hold-to-see overlay listing nearby tags (`SceneTag`s) with one line each.
- `src/game/conditions/conditions.ts`: `powerCutAt` gains a district-wide event (start, cascade of generators over 20 s,
  end); `fx/smoke.ts` and the audio director react; the observer (phase 4) writes the gist line.

**Owns.** `src/scene/ambient/walk.ts`, `first-person/sense.ts`, the blackout event in `conditions.ts`. **Depends on.** 5 (intent),
1 (smoke), 4 (ticker). **Effort.** 6 days. **Measure.** Regulars' moves per visit; bot walk shows no one walking through a
wall; frame cost under 0.5 ms for 12 walkers. **Risk.** Yuka's bundle (~60 kB brotli): lazy in `fx`, loaded only when a venue
has walkers.

---

## Wave 3 — Smooth on the devices people have (weeks 4–6)

### Phase 7 — A governor that probes back up; every shader before the title (ideas 17, 18)

**New.** `src/scene/governor.ts`: a 90-frame ring buffer; render scale (via `setPixelRatio`) steps down 0.1 when p90 > 21 ms,
and after 45 clean frames probes up; a probe that misses doubles the next wait; a lone long frame (shader link, texture
upload) is ignored; `street-life/adaptive.ts` keeps its count shrink but reads the governor's scale instead of its own mean.
`shader-warmup.ts` gains the `fx` materials and the rain shader, and the loading screen waits for `hold()` before fading.
**Owns.** `governor.ts`, `adaptive.ts`, `shader-warmup.ts`. **Effort.** 2 days. **Measure.** Frame table p95 ≤ 20 ms at
scale ≥ 0.8 on the Mac; zero frames over 100 ms in the first 10 s after a scene opens on the emulator.

### Phase 8 — Draw-call budgets and KTX2 (ideas 19, 20)

**New.** `BatchedMesh` for the street stand-ins and shopfronts (`street-standins.ts`, `shopfronts.ts`), merged static venue
geometry where it is not already, a draw-call line in the frame table with the budget (phone 100, high 500);
`scripts/assets/prepare.ts` gains `--ktx2` (gltf-transform: ETC1S for colour, UASTC for normals), `KTX2Loader.detectSupport`
in `src/scene/models/gltf-source.ts`, WebP kept as the fallback for browsers without Basis. May need three r186 (its own
one-day phase first). **Owns.** the two stand-in files, `prepare.ts`, `gltf-source.ts`. **Effort.** 5 days. **Measure.**
Draw calls at Yaba dusk from today's count to under 150 on HIGH; GPU memory on the emulator (Chrome's `gpu` trace) down by a
third on a textured venue.

### Phase 9 — Fifty avatars in one upload (idea 21)

**New.** `src/scene/body/batched-skin.ts`: remote players and far NPCs animate on a headless skeleton (`AnimationMixer` on an
unparented skeleton), bone matrices packed into one `DataTexture` (100 bones × N), a custom skinning vertex shader per body
part with shader LOD (fewer moving joints past 15 m, cheaper lighting facing away); `CROWD_LIMIT` raised from 12 to 48 on HIGH
for the Square and election night only. **Depends on.** 7, 8. **Effort.** 8 days. **Measure.** 48 bodies under 4 ms on the
Mac; Cinevva's 0.06 ms per synthetic avatar is the target. **Risk.** The largest phase; schedule after wave 2 ships.

---

## Wave 4 — Presence and assets (weeks 5–8)

### Phase 10 — Proximity voice in the scene (idea 23)

**New.** In `src/calls.ts`/`src/community.ts`: one `PannerNode` (HRTF, inverse distance, ref 1.5 m, max 25 m) per remote
peer, the listener updated each frame from the avatar's position and facing; Opus 128 kbps with FEC in the SDP; a hidden muted
`<audio>` per stream; push-to-talk that ramps a `GainNode` over 40 ms; RNNoise as a lazy worklet (~1.9 MB, fetched on the first
tap of "voice", never in any budgeted chunk); browser echo cancellation and AGC left on, no gate. **Owns.** those two files and
`src/spaces/world/` voice bits. **Effort.** 5 days. **Measure.** Two testers in one bar hear direction; no clipped first
syllable in ten PTT presses.

### Phase 11 — One hero street, baked (ideas 2, 6, 25)

**What a person sees.** Herbert Macaulay Way in Yaba (the owner's screenshot street) to the standard of Neon Zenith's Temple
Street: modelled shopfronts, cables, aircon units, posters, bin bags, Poly Haven brick and concrete, light baked from its own
signs and lamps, a baked street-light map for rain and fog.

**New.** `scripts/assets/blender/street-yaba.py` (lot-by-lot build from `src/scene/street/street-plan.ts`'s layout, Poly Haven
CC0 materials fetched by the pack script, CHORD maps for photographed textures where Poly Haven has none, Cycles bake to a
2048² lightmap and a 2048² top-down light map, gltfpack export under the pack caps); `public/assets/packs/street-yaba/`;
`street-kit.ts` loads the pack for that street and the generator for the rest; the grammar (five tower forms, four crowns,
three estate plans, in local idiom: the Yaba face-me-I-face-you, the Lekki duplex, the Kano mud-brick wall) written into
`street-standins.ts` as the second half of the phase. **Owns.** the Blender script, the pack, `street-kit.ts`. **Depends on.**
2 (lightmap uniform), 8 (KTX2 helps). **Effort.** 10 days. **Measure.** Blind A/B of the street against a real photo: the
critic names what gives it away; scorecard World and Materials at 3.

### Phase 12 — The asset pipeline, the style guide, the manifest (ideas 7, 24, 26, 27, 28)

**New.** `docs/ART-DIRECTION.md`: the technical frame (camera, metres, 1024 texture, triangle caps), the visual system (shape
language, palette roles, edge treatment), the family rule (one approved hero asset before a family), the zero-asset rule for
props and interiors, and the acceptance gates (in-game at native scale, never from a render). `docs/ASSET-PIPELINE.md` gains
a local runbook: AssetFurnace (Apache-2.0) or TRELLIS.2 (MIT) on the owner's Mac, photo → GLB → `prepare.ts`, retarget to the
two shipped skeletons (never a third body; `scripts/body/retarget.ts`), T-pose with empty hands. The Meshy models get the same
manifest and provenance record as the CC0 packs (`scripts/assets/manifests/meshy.json`), and Help credits list them. Radio:
ACE-Step 1.5 songs are optional and recorded with their licence; the synth gets a "radio" recipe family. **Owns.** the two
docs, the manifest, `retarget.ts`. **Effort.** 4 days plus standing use.

---

## Wave 5 — Spread (standing; folds into the WOW plan)

### Phase 13 — Growth checklist, costs and peers (ideas 34–36)

Deltas to [WOW-PLAN.md](WOW-PLAN.md), not a new programme:
- **Instant load, no loading screen:** measure the landing's time to first interactive on the emulator; the `LOADING_*` budget
  already binds; add a "no spinner over 1 s" check to the bot walk (phase 0).
- **No login to try:** confirm the guest path reaches a street in two taps; the Vibe Jam rule is the bar.
- **A viral-week cost model** in `docs/CAPACITY.md`: Durable Object and WebSocket costs at 100k daily players (Lagos Life's
  reported ~$6k/month across AWS and Cloudflare is the comparison); the switches that shed load first.
- **Ads as first revenue:** the owner's 14 Oct direction; Lagos Life's formats (press) noted in `docs/PROMOTE.md` as reference.
- **Peers to watch:** a standing section in OPEN-SOURCE-LEARNINGS.md, re-read monthly (Light-Off, Lagos Run, Lagos Life,
  OpenCity, Factory Yard, Neon Zenith, ClaudeCraft, Fable Cities, the Cinevva series).
**Effort.** 2 days.

---

## Ownership map (who may touch what while waves overlap)

| Phase | Owned paths | Needs from the integrator |
| --- | --- | --- |
| 0 | `scripts/evidence/`, `docs/EVIDENCE.md`, `docs/evidence/`, `.claude/skills/`, `docs/AGENT-PROMPTS.md` | — |
| 0b, 0c | `src/scene/fx/index.ts`, `vite.config.ts`, `src/budgets.ts`, `NOTICE.md`, `package.json` | is the integrator |
| 1 | `src/scene/fx/rain*.ts`, `fx/smoke.ts`, hook lines in three hosts, rain/generator/wind recipes | nothing |
| 2 | `src/scene/fx/post.ts`, `grade.ts`, `lightmap.ts`, `quality.ts`, material hooks in `street-kit.ts`, `venues-common.ts` | nothing |
| 3 | `src/scene/feel/`, `reward.ts`, hooks in `fight-3d.ts`, `football-3d.ts`, `camera-controls.ts` | the Settings toggle |
| 4 | `src/game/news/`, `gist/Ticker.vue`, `server/social/acquaintance.ts`, `memory` in `crowd.ts`/`layer.ts`, talk banks | nothing |
| 5 | `src/scene/ambient/intent.ts`, `density.ts`, occupant code in `home-scene.ts`, `neighbourhood-scene.ts` | nothing |
| 6 | `src/scene/ambient/walk.ts`, `first-person/sense.ts`, blackout in `conditions.ts` | nothing |
| 7 | `src/scene/governor.ts`, `street-life/adaptive.ts`, `shader-warmup.ts` | nothing |
| 8 | `street-standins.ts`, `shopfronts.ts`, `scripts/assets/prepare.ts`, `models/gltf-source.ts` | the three r186 upgrade |
| 9 | `src/scene/body/batched-skin.ts`, `crowd.ts` cap | nothing |
| 10 | `src/calls.ts`, `src/community.ts`, voice in `src/spaces/world/` | nothing |
| 11 | `scripts/assets/blender/street-yaba.py`, `public/assets/packs/street-yaba/`, `street-kit.ts` | pack budget line |
| 12 | `docs/ART-DIRECTION.md`, `docs/ASSET-PIPELINE.md`, `scripts/assets/manifests/meshy.json`, `scripts/body/retarget.ts` | nothing |
| 13 | `docs/CAPACITY.md`, `docs/PROMOTE.md`, `docs/OPEN-SOURCE-LEARNINGS.md` | nothing |

Two phases never share a path. Where a phase lists "hook lines" in a shared host, it adds lines and never rewrites the file;
conflicts are resolved by the integrator at merge.

## Schedule

| Week | Running | Releases |
| --- | --- | --- |
| 1 | 0, 0b, 0c | the evidence tools and the empty `fx` chunk |
| 2–3 | 1, 2, 3 | rain and smoke; the post stack; juice (one release each) |
| 3–5 | 4, 5, then 6 | ticker and memory; homes by the hour; walking regulars and the blackout |
| 4–6 | 7, 8, then 9 | governor and warm-up; batching and KTX2; batched crowds |
| 5–8 | 10, 11, 12 | voice; the hero street; the pipeline docs |
| standing | 13 | folded into WOW releases |

About 70 agent days, run three or four phases at a time, so roughly eight weeks wall-clock with the hero street the long pole.
Wave 1 alone (eleven days, three agents in parallel, two weeks) is what answers the owner's 17 October direction first.

## Gates for every release

1. `NODE_OPTIONS=--max-old-space-size=3584 npm run typecheck` and the phase's Node tests, plus the pure-planner tests.
2. CI build with every budget line `ok` (`STARTUP`, `LOADING`, `SCENE_HOST`, and the new `FX`).
3. The bot walk (phase 0) passes: no console errors, no stall over 42 ms in the first 10 s of each scene.
4. The three-view screenshot pair and the critic's scorecard delta in the phase record, with the frame table rows.
5. Release by the usual workflow after merging `origin/main`; the live commit checked at `/api/health`.

## Decisions taken as defaults

- Particles: `three-nebula` (active) over `three.quarks` (quiet since May); own emitter if the bundle is too big.
- Post: `pmndrs/postprocessing` + `N8AO`; HIGH tier only; phone tier untouched.
- Rain on every tier at tiered counts; it is one draw call.
- Routines by place with a utility score, not per-person timetables.
- Yuka for walking regulars, loaded only where a venue has walkers.
- WebGPU: not now; instance and batch first, profile later.
- three r180 → r186 as its own one-day phase before phase 8, not before wave 1.
- The hero street is Herbert Macaulay Way, Yaba, because it is the street in the owner's screenshots.
- Hunyuan3D output is not shipped until its licence is read; TRELLIS.2, TripoSR and AssetFurnace are fine.
