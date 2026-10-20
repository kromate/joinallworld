# What other browser worlds can teach Allworld (19 October 2026)

The owner sent one X post ("GitHub is a goldmine for AI game developers", Brendan Jowett, 19 Oct 2026, ten repos) and asked for
similar posts on other platforms and on GitHub, and then for every idea collated. This page is that collation. It is a reading of
about forty sources: X, Hacker News, the three.js forum, GitHub (READMEs and, where it mattered, the code), two blog series, the
Nigerian tech press, and the skill packs other people wrote for coding agents. Reddit blocks our tools; LinkedIn and Threads returned
nothing usable. Figures from press and READMEs are reported, not verified, unless a repo's own code or measurements are cited.

Every idea is checked against what Allworld already has, so this is a gap list, not a wish list. Libraries named are all
AGPL-compatible (MIT, Apache-2.0, Zlib, CC0) unless flagged. Nothing here changes the first-download rule: new effect code loads
with the 3D scene, never in the first paint.

## What we already have (so the gaps are real)

| Area | Allworld today | Where |
| --- | --- | --- |
| Post-processing | Night bloom only, HIGH tier, lazy (EffectComposer + UnrealBloomPass) | `src/scene/quality.ts` |
| Weather | Changes the lighting and thins the crowd; nothing falls, nothing blows, nothing smokes | `src/scene/venue-scenes.ts` (lookAt), `src/scene/ambient/density.ts` |
| Street life | Deterministic crowds and two-way traffic from (seed, clock): lanes, outfits, lights, give-way, okadas per country | `src/scene/street-life/` |
| Venue regulars | Stand at fixed landmarks, glance, shift weight, talk | `src/scene/ambient/layer.ts`, `src/scene/crowd.ts` |
| Adaptive quality | Street counts shrink when frames go over 24 ms; a frame guard drops street life at 42 ms; counts never grow back | `src/scene/street-life/adaptive.ts` |
| Reward feel | Chips and a CSS confetti burst under the top bar | `src/scene/reward.ts`, `.life-burst` |
| Camera | Orbit with collision; no shake, no hit-stop | `src/scene/camera-controls.ts`, `camera-collision.ts` |
| Memory of the player | House agents keep up to five facts per person; the gist ledger reports what happened in a city | `docs/HOUSE-AGENTS.md`, `server/gist/` |
| Share | Share cards, clips with the @handle mark | `src/ui/share.ts`, `docs/AD-READY-PLAN.md` |
| Assets | Low-poly, one 1024 texture, baked AO; CC0 packs with a licence manifest; Meshy models (no manifest) | `docs/ASSET-PIPELINE.md`, `docs/ASSETS.md` |
| Physics | Rapier (compat build) | `package.json` |
| Multiplayer | Our own rooms on a Cloudflare Durable Object | `server/`, `wrangler.jsonc` |

## The ideas, grouped

### A. The look: weather you can see, light that belongs to the street

1. **Rain that falls, stops under awnings and takes the colour of the lights.** Neon Zenith (`billpwchan/neon-zenith`, MIT code,
   Claude Opus 5.5 wrote it in a weekend) draws rain with no state at all: each drop is a pure function of its index and the clock,
   wrapped in a box around the camera, stretched along its velocity as if exposed for 1/30 s, deleted under roofs by a heightmap
   lookup, tinted by a top-down "street-light map", with splashes near the ground (`src/atmos/rain.js`, 90 lines). This is the same
   "function of (seed, clock)" idea our street life already uses, so it fits our architecture and costs one draw call. We already
   know when it rains (`rainingAt`); today nothing is drawn.
2. **A street-light map.** Thousands of signs and lamps cannot each be a light. Neon Zenith bakes their spill once into a 2048²
   top-down texture; roads, walls, rain and fog all sample it, so every emitter's colour costs one texture read. Our night streets
   have the signs and the bloom but no spill on the road.
3. **One post-processing pass instead of a chain.** `pmndrs/postprocessing` (Zlib, active Oct 2026) merges bloom, anti-aliasing
   (SMAA), vignette, colour grading and tone mapping into one or two passes; the 100-tips guide and the VFX list both say it is the
   usual replacement for EffectComposer. `N8AO` (CC0) gives ambient occlusion that is better than three's SSAO at similar cost. The
   owner's 17 Oct complaint ("flat, no AO, no post-processing") is exactly this gap.
4. **Per-city colour grade.** Fable Cities and Neon Zenith both run "bloom, grade, ACES, vignette, grain". A grade per climate
   (harmattan haze in Kano, monsoon grey in Lagos in July, sodium orange at night) is one small texture per city.
5. **Particles for smoke, dust, exhaust, confetti.** `three.quarks` (MIT, has a visual editor, last push May 2026) or
   `three-nebula` (MIT, pushed Oct 2026). Suya smoke, generator exhaust, Kano dust devils, danfo exhaust, fireworks at Detty
   December, 3D confetti at a goal reached. Today the words "smoke" and "dust" appear only in scene text, never on screen.
6. **Baked hero street, procedural everything else.** Neon Zenith builds its one starting street by hand in Blender with Poly
   Haven materials and bakes its light in Cycles; the other 9,000 buildings follow a grammar (five tower forms, four crowns, three
   estate plans). Allworld's answer: bake Yaba's Herbert Macaulay Way (or wherever the first screenshot is taken) to that standard,
   and let the city generator do the rest. "Glow does not make primitives look AAA. Forms first, then materials, then lighting, then
   effects" (threejs-game-skills graphics guide).
7. **Zero-asset is a style, not just a saving.** night-street (MIT) and Light-Off (Lagos) generate every texture, mesh and sound in
   code. Its author's point: a procedural texture has parameters you must justify; a downloaded one is a fact you cannot argue
   with. Worth keeping for props and interiors even as hero streets go to Blender.

### B. The feel: five small reactions in a tenth of a second

8. **Juice by tiers.** The game-feel skill (awesome-gamedev-agent-skills, Apache-2.0): one satisfying moment is five to eight tiny
   reactions within ~100 ms (sound, burst, brief freeze, flash, knockback, camera shake, number pop). Three tiers (small, medium,
   large) so a footstep is not a boss death; everything eased, never linear; shake the camera, never the body; shake decays from a
   "trauma" value using sampled sine, never random per frame; a "reduce shake and flashing" setting. Allworld's moments that deserve
   this: goal finished, pay received, level up, a fight landing, a goal in football, a danfo stop made, an election won.
9. **Hit-stop for fights.** Freeze the game clock for 50–120 ms on impact, timed with a real-time timer so it resumes. The arena
   fight is the one place this changes how a game feels.
10. **The pop.** Squash to (1.3, 0.7) then spring back with overshoot in 180 ms: for chips, coins, the purse, the share card.

### C. A world that notices you

11. **Pedestrians who remember.** OpenCity (`js/npcmemory.js`, 150 lines): a person near a shot or a reckless car is `afraid` for
    150 in-game seconds and flees you on sight; a person you helped is `friendly`, waves, and may tip off the police. Memory decays
    and is wiped when the person respawns. For Allworld, where there is no shooting: a person you greeted, bought from, gave a lift
    to, or splashed in your danfo, remembers for a day and says so ("ah, the one with the change").
12. **A city news ticker that reports what you did.** OpenCity (`js/citynews.js`) watches state each frame (money jumps, wrecks,
    wanted level, time of day), rate-limits, and counts ("that's the 3rd store hit this hour"), with ambient lines when nothing
    is happening ("the neon comes on as the sun drops"). Our gist ledger is the server-side half of this; the missing half is the
    client-side ticker in the Square and on the radio, with ordinal counting and time-of-day colour.
13. **Homes with people in them, by the hour.** Factory Yard (MIT): every house can be looked into; whoever is home is on the sofa,
    at the table or in bed depending on the hour; delivered parcels wait inside the door; fewer people out at night. Our residents
    have days (docs/AI-RESIDENTS.md); their homes do not show it.
14. **Routines, not schedules.** The old GameDev.net thread and the Dustgrave developer agree: give intent to a place or a faction
    (the market opens, the church fills, the viewing centre on match night) rather than to each fragile person; Ultima 7's
    home-work-tavern loop is still the model. A utility score ("how much does each person want each option now") beats a timetable
    when the day is disturbed by rain or a festival. The game-ai skill's rule: decide, steer and path are three separate layers.
15. **Regulars who walk.** `Yuka` (MIT, pushed Oct 2026) gives steering (seek, wander, avoid), a navmesh, perception and state
    machines in plain JS. Our regulars stand at landmarks; walking between them (the bar to the table to the door) is the step
    between "furniture" and "people". Light-Off's "Street Sense" (hold a key to see what is happening nearby) is a cheap way to
    show it.
16. **Living systems with local truth.** Light-Off (Lagos, three.js, built with Claude): NEPA blackouts, bad roads and floods,
    checkpoints collecting "roger", a pocket radio that unlocks missions, newspapers and an end-of-night report, Mama's suspicion.
    MAZHA (Kerala): monsoon as the setting, not an effect. Allworld has the festivals and the gist; the blackout that darkens the
    whole street and starts every generator at once is the kind of shared moment that gets screenshotted.

### D. Smooth on the devices people have

17. **A frame-time governor that goes both ways.** Ours only shrinks. Neon Zenith's `core/governor.js` (40 lines) and Halcyon's:
    step the render scale down on missed frames (p90 over 21 ms), and after a run of clean frames probe back up; a probe that costs
    frames doubles the wait before the next. Both hold a locked 60 fps at render scale 0.9–1 on a laptop; Halcyon publishes p50/p95
    per view in its README. We should publish the same table for Yaba, Kano and a home.
18. **Compile every shader before the title fades.** Halcyon, Neon Zenith and the 100-tips guide all do `compileAsync()` during the
    loading screen, then stream HD textures over several frames. night-street's warning: 30–40 s of shader compiling with a page
    that does not respond is what happens when you do not. We have `shader-warmup.ts`; check it covers the post stack and weather.
19. **Draw-call budgets with numbers.** Mobile: about 100 draw calls; desktop 500+. `InstancedMesh` for the same geometry,
    `BatchedMesh` (r156+) for different geometries with one material, merged geometry for static things. Neon Zenith: 300–400 m
    chunks, instanced, culled per chunk, ~2,000 draws at street level on a desktop.
20. **Textures in KTX2.** 4–8× less GPU memory than PNG/WebP, which decode to full size on the GPU (a 2048² PNG is ~21 MiB with
    mipmaps). UASTC for normal maps, ETC1S for colour; `gltf-transform` does both. We ship WebP; this is the next step if VRAM is
    the limit on phones.
21. **Fifty avatars in one upload.** The Cinevva series (part 23): remote players get a headless "VirtualSkeleton" that animates
    but never enters the scene; all bone matrices (100 per avatar) are packed into one storage buffer (~384 KB for 60) and a
    custom material skins in the vertex shader, so a crowd of real players costs one upload and one draw per body part. The
    "one draw call, 100,000 people" forum post does the same for NPCs with shader LOD: far people get fewer moving parts, people
    facing away drop detail earlier, blinking and buttons are shader, not geometry. Our venue cap is 12; the Square on election
    night will want more.
22. **Budget per view, not per scene.** Cinevva's HUD captures an idle baseline and adds 0.06 ms per synthetic avatar; Neon
    Zenith's table is per view (street, mid-air, CBD, high). Our `?streetperf=1` readout is the seed of this.

### E. Voice and presence

23. **Proximity voice done properly.** Cinevva part 23: WebRTC peer-to-peer, one connection per remote peer, lower id offers;
    each voice through an HRTF `PannerNode` with inverse-distance rolloff, listener updated every frame from position and facing;
    Opus at 128 kbps with in-band FEC; a hidden muted `<audio>` element so Chrome keeps pulling packets; RNNoise denoising (92%
    wet), browser echo cancellation and gain, a soft compressor, and push-to-talk that ramps a gain node (no clipped syllables).
    Their relay is a 74-line Durable Object forwarding 36-byte binary frames with hibernating WebSockets (~half a cent per
    peer-hour). Allworld's calls and voice stages exist (docs/CALLS.md, docs/WORLDS.md); the HRTF-in-the-scene part is what makes
    a bar sound like a bar.

### F. Assets: where models come from now

24. **Local, free image-to-3D.** TRELLIS.2 (Microsoft, MIT, Dec 2025, 4B params, PBR output) and Hunyuan3D (Tencent; licence is
    not plain open source, check before shipping) run on a Mac or an NVIDIA box; AssetFurnace (`Bingeljell/image-to-3dlab`,
    Apache-2.0) wraps them with auto-rig and 21 animations ("a T-pose with empty hands rigs best"). TripoSR (MIT) is the fast rough
    one. The capybara game that won Vibe Jam 2026 used Tripo's hosted API; threejs-game-skills does too. Meshy stays for quality;
    these cover volume (a market's worth of wares from photos of real ones).
25. **Textures from one photo.** Ubisoft CHORD (`ubisoft/ubisoft-laforge-chord`): one texture image in, base colour, normal,
    height, roughness and metalness out. Pairs with Poly Haven for the hero street.
26. **One skeleton, every outfit; one controller, any body.** Cinevva parts 25 and 29. We have two shipped bodies and a wardrobe;
    the lesson is to keep it that way as Meshy characters arrive: retarget to our skeleton, never ship a third.
27. **Art direction as a document, assets as families.** The create-game-assets skill: lock the technical frame (camera, scale,
    texture budget), write the visual system (shape language, palette roles, edge treatment), approve one hero asset at game scale
    before producing a family, normalise deterministically (crop, size, anchor, name), validate in the game not from a render, and
    record provenance for every file. Our manifest does this for CC0 packs; the Meshy models need the same record.
28. **Generated sound.** Neon Zenith, Halcyon, Fable Cities, night-street and Light-Off synthesise every sound at runtime with
    Web Audio (rain, wind, generators, turbines, a score that thickens with speed) and ship no audio files. ACE-Step 1.5 makes a
    song in under 10 s on a 3090 for the radio; ElevenLabs for voices (the capybara game's choice).

### G. How the strong AI-built projects are run

29. **A separate critic that writes no code.** Fable Cities' `PROMPT.md` (their words: "if you only take two things: make a
    separate critic, and make the agent look at its own output before it may say done"): builders own one folder each; an
    integrator alone touches core; a critic takes its own screenshots at several times of day and zoom levels and scores 0–10
    against reference screenshots with written anchors (10 = indistinguishable, 8.5 = AAA with nits, 7 = good indie, 5 = programmer
    art); a blind final gate shows judges A/B pairs with the order shuffled; scores persist in `docs/STATUS.json` so each run
    resumes from the weakest module. Their honest result: six runs, ~20M output tokens, playable, and never cleared 8.5; blind
    judging lost 0–4 three times. Our screenshot harness and `docs/agent-work/` records are halfway to this; the anchored scale
    and the critic role are missing.
30. **An anchored visual scorecard.** threejs-game-skills' ten categories (art direction, hero, obstacles, interactables, world,
    materials, lighting, VFX, UI, performance evidence), each 0–3 with calibration images; "premium" = nothing under 2 and average
    ≥ 2.3; automatic failures include "fog, darkness, bloom or particles standing in for missing geometry" and "HUD is mostly
    rectangular stat cards". Its canvas inspector measures colour entropy, dominant-colour share, edge density and contrast from the
    pixels, so "looks flat" becomes a number. Usable as-is for grading our Yaba street and the owner's next screenshot.
31. **Bot playtests and pixel checks in CI.** The same pack ships Playwright templates for smoke tests, visual-regression
    baselines and a bot that plays the loop and reports metrics JSON; the rule is "screenshots alone do not cover gameplay
    changes". We have scene harness pages; a bot that walks home → street → market every release would catch the regressions the
    graphics checkpoint lists as "open".
32. **Parallel sessions with separate ownership.** The capybara winner ran 2–3 Claude Code sessions at once, each on its own part
    of the code, a fresh session per feature and one long-running one for bugs; Neon Zenith's author "set the direction and reviewed
    every pass from screenshots and real-GPU frame timings". That is our relay model; the added rule is review from screenshots and
    timings, not from the agent's report.
33. **Skills, installed once.** `npx skills add gamedev-skills/awesome-gamedev-agent-skills` (74 skills, Apache-2.0, three.js
    pinned to r186; we are on r180) and `npx skills add majidmanzarpour/threejs-game-skills` (nine skills, MIT, with the
    scorecard and inspector). Claude-Code-Game-Studios (26.9k stars, MIT) is the heavier studio-of-49-agents version; its useful
    parts are the hooks (design-doc read before edit, asset-change validation) rather than the hierarchy.

### H. Spreading: what the Nigerian browser-game month says

34. **Lagos Life's numbers (press, unverified):** first version in about eight hours; 1M players in three days, 2M then 3M in the
    following week; $500k raised at a $10M valuation; running costs about $2k/month AWS and $4k/month Cloudflare; now an ad
    business (TechCabal, 12 Oct). Reported stack: Next.js 16, React 19, PostgreSQL, Socket.IO, three.js through React Three Fiber;
    Cloudflare D1 → DigitalOcean → AWS after the app and database sat in different places. Lagos Run (danfo driving) drew ~140k
    players in a week and inspired it. Our WOW plan already answers both; the two facts to add are **Socket.IO-scale costs of a
    viral week** (budget for it) and **ads as the first revenue** (the owner's 14 Oct direction, now proven locally).
35. **Vibe Jam 2026's rules are a growth checklist:** free, no login or signup, loads instantly with no loading screen, works in
    the browser, multiplayer preferred, an exit portal to the next game. 945 entries; the winner was a cosy co-op delivery game in
    one global city on a Cloudflare WebSocket, built in 14 days with Claude Code, three.js, Suno, ElevenLabs, GPT image and Tripo.
    The three winners were all "do one small thing with friends in a charming place". Capybara Simulator's maker: 46k peak MAU and
    $18k paid out in player rewards in three months.
36. **Peers in the same lane (watch, borrow, do not copy):** Light-Off (Lagos, three.js, zero assets, Claude-built, 0 stars,
    pushed 14 Oct); Olè the Lagos Hustle (three.js runner); MAZHA (Kerala monsoon county); OpenCity (10×10 blocks, 1 star,
    pushed 16 Oct, the two living-city modules above); Factory Yard (140 stars, live isometric town); World of ClaudeCraft (2.3k
    stars, MIT, a complete browser MMO with 22 locales, a wiki generated from live content, a headless RL env, and "weather is
    render-only so it never touches the deterministic sim"); Fable Cities (81 stars, agent-built city builder); the Cinevva
    open-world series (30 parts, Feb–Jun 2026).

## Libraries, checked 19 October 2026

| Library | Licence | Last push | Fits | Use for |
| --- | --- | --- | --- | --- |
| pmndrs/postprocessing | Zlib | Oct 2026 | yes | one-pass bloom + SMAA + vignette + grade; replaces our composer |
| N8python/n8ao | CC0 | Aug 2026 | yes | ambient occlusion in the street and at home |
| three.quarks | MIT | May 2026 | yes (quiet) | particles with a visual editor |
| creativelifeform/three-nebula | MIT | Oct 2026 | yes | particles, more active |
| Mugen87/yuka | MIT | Oct 2026 | yes | steering, navmesh, perception for regulars |
| gkjohnson/three-mesh-bvh | MIT | Oct 2026 | yes | fast raycasts for a BVH character controller, taps, sight lines |
| three-stdlib | MIT | Jun 2026 | yes | standalone copies of three's examples |
| 0beqz/realism-effects | MIT | Feb 2024 | stale | SSGI; not for us |
| VAST-AI-Research/TripoSR | MIT | Jun 2026 | tool | quick rough models from a photo |
| microsoft/TRELLIS.2 | MIT | Dec 2025 | tool | quality image-to-3D, local |
| Bingeljell/image-to-3dlab (AssetFurnace) | Apache-2.0 | Oct 2026 | tool | photo → rigged, animated character |
| ubisoft/ubisoft-laforge-chord | check | — | tool | PBR maps from one texture photo |
| colyseus, drei, react-three-rapier, MCP Unity, godot-mcp | — | — | no | need React, Unity or Godot, or duplicate our rooms |

three.js itself: r186 is current (Sept 2026; native Gaussian-splat renderer on WebGPU). We are on r180. WebGPU is not faster by
default; the three.js contributor's note (Nov 2025) is that many-draw-call scenes can be slower on WebGPURenderer, so instance and
batch first and profile on the phones we care about before switching.

## A suggested order

Ranked by what the owner will see per day of work, mapped onto code we have. Each is its own small release.

1. **Weather you can see** (A1, A5): stateless rain in venue and street scenes, grill and generator smoke, Kano dust. Loads with
   the scene host. ~3 days.
2. **One post stack with AO and a grade** (A3, A4): postprocessing + N8AO on the HIGH tier, a grade per climate; keep the phone
   tier on the plain renderer. ~3 days, plus the frame table (D17, D22) to prove it.
3. **Juice tiers on the big moments** (B8–B10): a `feel(tier, at)` helper (sound, burst, pop, decaying shake), a reduce-shake
   setting, wired to goal done, pay, level up, fight hits (hit-stop), football goals. ~3 days.
4. **The ticker and the memory** (C11, C12): the gist ledger read on a client-side ticker in the Square and the radio with ordinal
   counting; a one-day "remembers you" flag on people you dealt with. ~4 days, mostly content.
5. **Governor that probes back up, shaders compiled before the title** (D17, D18). ~2 days.
6. **Scorecard and critic** (G29–G31): adopt the ten-category scorecard with our own anchor screenshots (Yaba today = the "1–2"
   anchor), add the canvas inspector to the screenshot harness, and give every graphics release a critic pass that writes no code.
   ~2 days to set up, then standing.
7. **Hero street baked in Blender** (A6, A2, F25): one street to the Neon Zenith standard, with a street-light map, before the
   generator is taught the grammar. ~1–2 weeks; the one the owner's 17 Oct direction is really asking for.
8. **Regulars who walk** (C15) with Yuka, and homes with people by the hour (C13). ~1 week.
9. **Proximity voice in the scene** (E23) once voice stages are used. ~1 week.
10. **Local asset pipeline** (F24, F27): AssetFurnace or TRELLIS.2 on the owner's Mac for props from photos of real Lagos things,
    with the manifest record the CC0 packs already get. Standing.

## Sources

Posts and threads: the Jowett post (x.com/jowettbrendan/status/2112115634335363577); Mnilax's "15 repos" post
(x.com/Mnilax/status/2110039818524660135); levelsio's Vibe Jam 2026 rules and results; Summer Plays on Capybara Simulator;
three.js forum: "One draw call, massive crowd" (89928), "Built a GTA style open world" / MAZHA (94461), "Particle engine" (8044);
Hacker News: "The entire city of San Francisco as a video game" (49422784), "Show HN: 3D multiplayer game with Claude Code"
(46639408). Blogs: Cinevva "Open world in the browser" parts 1–30 (app.cinevva.com, Feb–Jun 2026); utsubo "100 three.js tips"
(2026); Snyk "Top 8 Claude skills for 3D"; TechCabal 12 Oct 2026 on Lagos Life's ad business; WeeTracker 6 Oct, Vanguard,
BusinessDay on Lagos Life and Lagos Run; Wccftech on the capybara winner; playlagoslifegame.wiki "How it was built".
Repos read: gamedev-skills/awesome-gamedev-agent-skills (game-feel, game-ai, create-game-assets); majidmanzarpour/threejs-game-skills
(director, graphics builder, visual scorecard, QA release); Donchitos/Claude-Code-Game-Studios; lappemic/awesome-ai-built-games;
naranyala/awesome-threejs-vfx; billpwchan/neon-zenith (rain.js, governor.js, README) and halcyon; rawprogress/fable-cities
(PROMPT.md); StarKnightt/night-street; Khalidabdi1/factory; Faizankhan17623/OpenCity (npcmemory.js, citynews.js);
okoliken/light-off; levy-street/world-of-claudecraft; Bingeljell/image-to-3dlab; and the library repos in the table.

## Peers to watch (standing)

**Re-read monthly.** The next reading is due 19 November 2026; whoever does it changes the dates below, notes what moved, and
adds a line to the next phase's work record if something is worth borrowing. Each reading is five minutes: open the repository or
page, look at what changed since the last date, and check that the licence is the same. Borrow ideas and techniques; never copy
assets or names (the rules in [OPEN-SOURCE-PLAN.md](OPEN-SOURCE-PLAN.md)). Last checked: **19 October 2026**, the pass that wrote
this page. The GitHub columns (licence as GitHub reports it, last push) were re-read on 20 October 2026 with `gh api repos/<r>`.

| Peer | Lane | Where | Licence | Last push | What we watch it for |
| --- | --- | --- | --- | --- | --- |
| Light-Off | A Lagos three.js game with no assets, Claude-built | `okoliken/light-off` | none stated | 14 Oct 2026 | Zero-asset scenes in our own city |
| OpenCity | A living-city sim; its NPC memory and city-news modules | `Faizankhan17623/OpenCity` | none stated | 16 Oct 2026 | Ideas 11 and 12 (the ticker and the memory) |
| Factory Yard | A live isometric town | `Khalidabdi1/factory` | MIT | 11 Oct 2026 | Isometric life, how it stays readable |
| World of ClaudeCraft | A complete browser MMO (22 languages, a wiki generated from live content) | `levy-street/world-of-claudecraft` | MIT | 20 Oct 2026 | Render-only weather, generated docs, an environment for agents |
| Fable Cities | An agent-built city builder with a critic prompt | `rawprogress/fable-cities` | custom text (read it) | 2 Sep 2026 | The critic and blind-pair method (EVIDENCE.md) |
| Neon Zenith | A street-level open world; its rain, governor and per-view frame table | `billpwchan/neon-zenith` | custom text (read it) | 6 Oct 2026 | Ideas 1 and 17; its README's frame table |
| Cinevva open-world series | Thirty posts on a browser open world (voice, crowds, skeletons) | `app.cinevva.com` (blog) | not checked | Feb to Jun 2026 | Ideas 21, 23 and 26 |

Read a licence cell as GitHub's word, not a legal reading. "None stated" means GitHub found no licence file, so nothing may be
copied from that repository at all. "Custom text" means a licence file GitHub cannot name: read it before borrowing anything but
an idea. Hosted games reported in the press (idea 34 above) are read from the press and are not listed here. If a peer is archived or silent for three months, drop it from the table and say so in this paragraph.
