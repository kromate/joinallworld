# Realism programme: one plan

Status: plan, 6 October 2026. Nothing below is implemented. This plan combines three documents into one delivery order:

- the 14 realism items in `REALISM.md` (R1–R14);
- the body, home and street design in `EMBODIMENT.md` (E-A to E-G);
- the lessons from Lagos Life, PH Lifestyle and SF Life (L1–L7).

## Ground truth before starting

- `origin/main` is at `824d4bf` (politics). This checkout's `main` is 219 commits behind and has no commits of its own. All 31 state capitals are already open on `origin/main`, so intercity walking (E-G) builds on real cities that already exist.
- Other agents already have their own working copies (git worktrees): `astra/kano`, `cities/nigeria` and `feat/politics`. All three are clean today. This plan must not edit their branches or block their merges.
- This checkout still holds Anthony's uncommitted edits to `CONTRIBUTING.md`, `package.json` and `tools/`. Nothing in this plan touches them.
- Releases go through the reviewed release workflow in `kromate/allworld`, given an exact `kromate/joinallworld` main SHA (`deploy/README.md`). CI runs typecheck, test and build on Node 22 and 24.
- Machine: 24 GB of memory, 12 cores.

## Everything in scope

| ID | Work | From |
| --- | --- | --- |
| R1, R7, R8 | Daily routines, time of day and season, city conditions (NEPA, rain, go-slow, harmattan) | REALISM |
| R2, R3, R14 | Memory facts, gossip and reputation, consequences that come back | REALISM |
| R4 | A cast for each city, starting with Calabar | REALISM |
| R5, R6 | Personal space and gaze; body and age variety | REALISM, merged with E-C morphs |
| R9 | Calabar calendar and landmarks | REALISM |
| R10 | Ambient sound for each place | REALISM |
| R11 | Actions that fit the place, including job shifts written as small dilemmas | REALISM + L2 |
| R12, R13 | Regulars talk to each other; regulars introduce real players | REALISM |
| L1 | Banks of short local moments for each place ("Light don come!") | Competitors, feeds R8, R10 and R12 |
| L3 | A weekly rhythm that actually bites: Saturday rent and wages, generator fuel | Competitors, feeds R8 |
| L6 | NPCs clearly marked; everyone else is a real person | Competitors |
| L7 | Reliability for the viral surge: chat only reaches people nearby, link and phone-number blocking, report reasons, retry-and-start-fresh boot, X and TikTok in-app browsers | Competitors |
| E-A | Skinned body spike (go or no-go) | EMBODIMENT |
| E-B | Smart objects: door, chairs, bed, bath, bucket bath, stairs, cooker | EMBODIMENT |
| E-C | Layered wardrobe: hijab, gele, turban, scarves, chains, agbada, abaya; body morphs | EMBODIMENT |
| E-D | Plot grid, storeys, stairs, cutaway, modular walls | EMBODIMENT |
| E-E | Buy the next plot, merged lots, compounds with shared tap and generator | EMBODIMENT |
| E-F | Streamed street tiles: door to street to venue, on foot | EMBODIMENT |
| E-G | Motor park, expressway ride, arrival on foot in the next state | EMBODIMENT |

## Rules that keep the machine and the codebase healthy

### Concurrency cap

- **At most 10 agents alive at once,** counting Astra. Usually that is 1 Astra coordinator, up to 8 workers and 1 reviewer.
- **Agents are cheap; processes are not.** The model runs remotely, so an idle agent uses little memory. Memory goes to the work agents start: builds, test runs, type checks, dev servers and browsers. These run behind machine-wide slots, so ten agents never mean ten builds at once.

| Slot | Machine-wide limit | Rough memory each (estimate, measured in phase 0) |
| --- | --- | --- |
| `heavy`: `npm run build`, full `npm test`, `npm run typecheck`, edge tests | 3 | 1–1.5 GB |
| `server`: any dev server or local Worker | 2, reused across agents, never one per agent | 0.5 GB |
| `browser`: any Chrome or QA session | 1, Astra only | 1.5–2 GB |

That is at most about 9.5 GB for agent work, which leaves around 14 GB for macOS, the Codex app and Anthony's own apps. If memory pressure turns yellow, the coordinator drops the `heavy` limit to 2.

- **How slots work:** a small `scripts/agent-slot.ts` takes a lock directory inside the repo's shared git directory (`git rev-parse --git-common-dir`). Every worktree shares that directory, including the Kano, Nigeria and politics agents if they use the script. A worker runs, for example, `node --experimental-strip-types scripts/agent-slot.ts heavy -- npm test`. Locks left by a dead process are reclaimed by checking whether the process is still alive.
- **Narrow checks first:** workers run only the tests next to the files they changed, through `node --test <files>`, which needs no slot. The full suite and the build run once per pull request, inside a `heavy` slot.
- **Small context per agent:**
  - Workers start with no conversation history and a compact brief.
  - They return a summary of 500 words or fewer: files, evidence, risks.
  - They retire as soon as their unit is accepted. Raw logs stay in files, not in replies.

### Working alongside other agents

- **One branch and one worktree per lane,** named `codex/<lane>` and branched from `origin/main`. Each worktree runs `npm ci` once (about 2 seconds and 190 MB on disk; it costs no memory while idle).
- **Claims are visible:** every lane opens a draft pull request on GitHub as soon as it starts. Any agent, including the existing Kano and politics agents, can see who owns what.
- **Write ownership by directory:** two lanes never write the same files. Single-writer **contracts** have one named owner at a time:
  - the look and wardrobe schema (`src/scene/characters.ts` look options);
  - the saved-life and estate schema (`src/game/systems/estate.ts`, `world.ts`, server storage);
  - the budget tests (`scenes.test.ts`, `map3d.test.ts`, `avatar-preview.test.ts`, world tests);
  - the world clock (`world-time.ts`, new).
  - Other lanes ask the contract owner to make a change; they never edit these directly.
- **Small and frequent merges:**
  - Lanes rebase on `origin/main` at least daily and just before merging.
  - A pull request should be about 400 changed lines or less, apart from data and generated assets.
  - Lanes merge one at a time. The coordinator merges, never the workers.
- **Everything new merges dark:** behind flags in `src/models/integration/flags.ts`, the one place flags are read. Main always stays releasable, even mid-phase.
- **Conflict rule:** if a lane's rebase conflicts with another agent's work, it stops and reports to the coordinator. It never resolves conflicts by rewriting another agent's code.

### From merge to production

1. **Pull request:**
   - CI is green: typecheck, test and build on Node 22 and 24.
   - Focused checks for the lane are named in the PR.
   - The coordinator reviewed the actual diff.
2. **Staging:** the release workflow runs on the exact main SHA with `publish_staging=true`.
3. **Astra QA on staging:**
   - the guest path through to the world;
   - the lane's feature, with the flag on and with it off;
   - mobile width;
   - console errors;
   - loading, persistence after reload, money and identity.
   - Once phase 0 has a phone, add load time on throttled 3G and frame time on the real low-end Android.
4. **Production:** the same SHA is released to production. Features go out dark, then their flag is turned on for everyone.
5. **Rollback:**
   - A feature problem means turning the flag off, with no redeploy.
   - A code problem means a reviewed forward fix. `deploy/README.md` forbids rolling back the server after new gameplay writes.
   - Save-format changes (E-E) also require a recorded restore reference before release, and the old-to-new check described in `deploy/README.md`.
6. **Cadence:** one release train per day while a phase is active, carrying whatever is merged and green. A failed gate drops that lane from the train; the train still goes.

## Phases

Each phase lists its lanes. Lanes in the same phase run in parallel, with no more than 8 workers. A phase closes when its gate is met in production behind a flag, or when it is turned on.

### Phase 0: Base and rails (1–2 days, 3 workers)

| Lane | Work | Owner |
| --- | --- | --- |
| rails | `scripts/agent-slot.ts`, worktree set-up script with shared `node_modules`, flag entries | Luna-class worker |
| budgets | One budget table in code that all four budget tests read, plus a size report of the build's files in CI | Terra-class worker |
| L7 reliability | Boot retry and slow-network message, in-app browser handling, nearby-only chat check, link and phone-number blocking, report reasons | Terra-class worker |
| baseline | Measure today's game on a real low-end Android on throttled 3G: load time, frame time, memory | Astra (needs a phone, see the decisions below) |

Gate: slots work across two worktrees; baseline numbers are recorded; L7 is in production.

### Phase 1: Body spike and content data (about 1 week, 7 workers)

| Lane | Work |
| --- | --- |
| E-A body | Skinned body, CC0 clips retargeted offline (idle, walk, sit, door, sleep, bathe), compression pipeline, flag `?body=skinned` at home only |
| E-A fallback | Keep the procedural avatar as the low-detail and 2G path; map old saved looks onto the new body |
| R4 cast | City cast schema and generator; Calabar cast (Efik lines marked `beta` until a native speaker reviews them) |
| L1 moments | Moment banks per place type and per city, as data, in local voice |
| L6 labels | Clear NPC marking in world, chat and People panel |
| R11 + L2 dilemmas | Job shifts with two- and three-way choices, as data plus one resolver |
| world clock | `world-time.ts`, the contract for R1, R7 and R8 |

**Gate, go or no-go:** on the real phone, the skinned body adds no more than 500 KB after first paint, holds frame time against the baseline, and changes nothing in the first load. If it fails, E-B to E-D continue on the procedural body with new poses, and the plan says so openly.

### Phase 2: A living city and objects that work (1–2 weeks, 8 workers)

| Lane | Work |
| --- | --- |
| R1 routines | Regulars follow schedules keyed by the world clock (day, weather, season) |
| R7 + R8 + L3 | Day and night, harmattan and rain, NEPA and generator fuel, go-slow, Saturday rent and wages that really bite |
| E-B objects (2 lanes) | Anchors and the action sequence; door, chairs, bed, bath with the modesty rule, bucket bath, cooker |
| E-C wardrobe (2 lanes) | Slots, hiding body regions and blocking slots; hijab, gele, turban, scarves, chains, agbada, abaya; morphs for height, build and age (with R6) |
| R5 space | Personal space and gaze in crowds and seating |
| R10 sound | Ambient sound for each place, lazily loaded and small |

Gate: every new action plays end to end on staging and on the phone; old looks still load; scene budgets hold.

### Phase 3: Memory and building up (1–2 weeks, 7 workers)

| Lane | Work |
| --- | --- |
| R2 memory | Memory facts per regular, stored on the server |
| R3 gossip | Gossip and reputation; never names another real player |
| R14 consequences | Delayed results of choices, including the job dilemmas |
| E-D plot grid | The home becomes a real-size plot; today's room becomes room one |
| E-D storeys | Floors, stairs object, cutaway camera |
| E-D kit | Modular walls, windows, roofs as batched geometry; Buy mode updated |
| R12 chatter | Regulars talk to each other, using L1 banks |

Gate: walk upstairs and back on the phone; the biggest house stays in budget; `npm run economy` is unchanged unless intended.

### Phase 4: Land, compounds and neighbours (1–2 weeks, 5 workers, highest risk)

| Lane | Work |
| --- | --- |
| E-E save migration | One plot per life becomes plots and units. Forward migration and tolerant loading; restore reference before release |
| E-E land | Buy the touching free plot, merge into one lot, tiered price |
| E-E compound | Units around a shared yard, rent to players or regulars, shared tap, gate and generator |
| R13 introductions | Regulars introduce real players, starting with compound neighbours |
| QA script | A two-player compound script, alongside `two-players` |

Gate: migration rehearsal on a copy of real-shaped data; two players share a compound on staging; the old save loads untouched.

### Phase 5: The street (2–3 weeks, 6 workers)

| Lane | Work |
| --- | --- |
| E-F tile format | The compact tile description and the offline generator from map data and OpenStreetMap |
| E-F streaming | 128 m tiles, 3×3 around the player, local origins, drop behind |
| E-F builder | The phone builds tiles with the existing kit; detail levels for buildings and people |
| E-F doors | Home front door and venue doors are real points on tiles |
| E-F traffic | Pedestrians, okada, keke, danfo on visible tiles; no animation beyond 30 m |
| R9 Calabar | Calabar calendar and landmarks, so the first fully walkable city is also the most alive |

Gate: walk from home to a venue door on the phone with no loading screen; each tile at most 60 KB; the timed trip and miniature map still work.

### Phase 6: State to state (1–2 weeks, 4 workers)

| Lane | Work |
| --- | --- |
| E-G parks | Motor parks as walkable places in each open city |
| E-G ride | Expressway ride on tiles with time compression and real stops |
| E-G arrival | Arrive at the other city's park and walk out |
| content | Road moments (toll gate, hawkers, checkpoint) from L1 |

Gate: Lagos to Ibadan on foot and by bus, end to end, on the phone; the old intercity action still works.

## How many agents, phase by phase

| Phase | Workers at once | With Astra and a reviewer |
| --- | --- | --- |
| 0 | 3 | 5 |
| 1 | 7 | 9 |
| 2 | 8 | 10 |
| 3 | 7 | 9 |
| 4 | 5 | 7 |
| 5 | 6 | 8 |
| 6 | 4 | 6 |

The phase-1 gate is the main risk. Phases 2–3 are the busiest. Phase 4 is narrow on purpose, because a save migration should have few hands on it.

**Model routing:**

- Content and data lanes (L1, L6, R4, the content lane) are Luna-class.
- Ordinary feature lanes are Terra-class.
- E-A, E-B, E-D storeys, E-E migration and E-F streaming are Sol-class.
- Astra reviews, merges, does all browser and phone QA, and starts each release.

## Decisions (Anthony, 6 October 2026)

1. **Branches and merging:** Astra creates `codex/` branches and worktrees from `origin/main` and merges reviewed, green pull requests itself.
2. **Releases:** automatic. When CI, staging QA and every gate for the lane pass, the same SHA goes to production with no further approval.
3. **Tests:** budget tests are updated as phases need, and new state and save changes get tests, as `CONTRIBUTING.md` requires.
4. **Assets and look:** CC0 models and animations are allowed as long as speed is not affected. The target is photoreal, in the tiers set out in `EMBODIMENT.md`.
5. **Measurement device:** no physical phone. Instead:
   - a local Android emulator (the SDK and an arm64 image are installed on this Mac);
   - Chrome DevTools with the low-tier mobile CPU throttle and slow-3G network throttle on the same build;
   - an online real-device service if a free tier allows it.
   - The emulator uses the Mac's GPU, so its frame times flatter a real Tecno. The throttled Chrome run is the gate for CPU and load time. GPU cost is held down by the triangle, draw-call and texture budgets, which are checked in tests.
6. **Efik review:** still open. Calabar lines stay `beta` until a native speaker reviews them.

## Run log

Each phase records here: model, workers, retries, what merged, what released, and what the gate measured.

### Phase 0 (6 October 2026)

Workers: three Sonnet-class workers (rails, budgets, reliability), each in its own worktree from `origin/main` at `5e9515b`. Retries: one (reliability first pushed the eager first-load bundle 1.6 kB over its budget; the additions were moved behind dynamic imports and both first-load budgets pass unchanged). Incident: all three workers' first `apply_patch` used relative paths and touched the main checkout; each reverted its own file at once and the checkout was confirmed back to Anthony's own edits. Briefs now require absolute paths.

CI found on the way: every `main` CI run on 6 October was cancelled by the 10-minute job limit, not by a failure; the suite now takes longer. The limit is raised to 25 minutes in this pull request.

**Baseline, before any realism work** (build `5e9515b`; scripts in `bench/` (run from a folder with `playwright-core` installed; not part of the build or typecheck): Playwright driving Chrome over the DevTools protocol, phone viewport 390×844 at 2×, CPU throttled 6×, cache off).

| Where | Network | First paint | Loading screen | Character creator ready | Bytes at ready | Bytes after 8 s |
| --- | --- | --- | --- | --- | --- | --- |
| joinallworld.com | slow 3G (2 s RTT, 400 kb/s) | 6.5 s | 6.7 s | 23.3 s | 540 kB | 703 kB |
| joinallworld.com | fast 3G (560 ms, 1.6 Mb/s) | 2.6 s | 2.6 s | 7.2 s | 539 kB | 827 kB |
| joinallworld.com | 4G (150 ms, 9 Mb/s) | 1.8 s | 1.8 s | 3.1 s | 539 kB | 827 kB |

Slow 3G reaches the creator at 23 s, inside the new 40 s "Start fresh" point but past the 15 s "slow" message. The local Node server sends files uncompressed (1.8 MB at ready), so download numbers come from production only.

Frame time in the world (Freedom Park, guest after "Play now"), Android emulator: Android 15 arm64, 2 GB, Chrome 124, SwiftShader software GPU, 412 px wide at DPR 2.6. Character creator: median 16.7 ms, p95 16.8. World: median 16.7 ms, p95 33.4 ms, worst 49.9; JS heap 17 MB; no console errors. Software rendering is slower than a mid-range phone's GPU and faster than nothing, so this is the reference to compare against, not an absolute. On the Mac's GPU with 6× CPU throttle the world holds 8.3 ms median and 9.2 ms p95.

Phase 1 gate reads these: the skinned body must not move the creator-ready time on fast 3G by more than 0.5 s, must not add to bytes at ready, and must keep the emulator world p95 at or under 33.4 ms.
