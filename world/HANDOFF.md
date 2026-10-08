# Copy-and-paste continuation prompt

Continue implementing the world-building system from the research, specifications, code and results already generated in this thread. Begin execution now; do not restart the research, rebuild completed modules, or stop at another plan.

Use GPT-6 Sol (`gpt-6-sol`) as coordinator and GPT-6 Luna (`gpt-6-luna`) for implementation subagents. I explicitly authorize parallel subagents. Use Sol for shared contracts, integration and difficult reviews. Give Luna narrow tasks with exact file ownership, interfaces, acceptance checks and stop conditions. Use `fork_turns: "none"` when selecting a worker model, and supply its necessary context explicitly. Respect the current concurrency limit: four agents including the coordinator, so at most three workers concurrently. The six lanes below run in waves.

Work exclusively in the existing managed worktree:
`/Users/anthonyakpan/.codex/worktrees/world-foundation/joinallworld`
Expected branch: `codex/world-foundation`. Verified foundation commit: `c6e246e5`; latest committed inventory milestone: `d45cd58d`.
Protect the primary checkout at `/Users/anthonyakpan/Desktop/joinallworld`.

First inspect Git status, repository instructions, existing agents and running processes. Preserve uncommitted work and reuse existing agents when available instead of launching duplicate owners. Read `world/PROGRESS.md`, `world/README.md`, `world/IMPLEMENTATION.md`, `world/ROLLOUT.md`, `world/VALIDATION.md`, `world/PRODUCTION.md`, `world/production-types.ts`, `world/tooling/README.md`, `world/campaign-fixtures/README.md` and `world/ENVIRONMENT.md`. Consult `world/RESEARCH.md` for decisions and source evidence. Reconcile documents describing earlier milestones with current code and checks.

Starting state: the verified foundation includes deterministic GeoJSON compilation, immutable hashed packs, a resumable local queue, geometry validation, global coordinates, time/daylight utilities and an independent Accra preview. Its 35 checks passed at the foundation milestone; rerun checks after subsequent changes. It does not yet establish global completion, production bulk acquisition, real terrain/climate ingestion or playable integration.

Current checkpoint (read PROGRESS.md for later changes):
- Inventory/bootstrap are committed; named child links and the lazy inventory preview have passed dateline/polar/Nigeria and narrow browser checks. Final integration/commit status is in PROGRESS.md.
- Real Accra acquisition v1 and v2 completed. V2 filters road subtype; use its receipt and the representative-v2 pack as current evidence. Session `96892` is terminal, not a running job. Do not repeat either download merely to observe it.
- Campaign orchestration has durable stages, reservations, shared-root cache accounting and abortable locks. The remaining representative campaign was authorized under its declared caps; inspect the existing agent/handle/status before any resume. A discovered priority-order bug must be fixed before claiming Africa-first scheduling.
- Six NASA POWER/MERRA2 responses total 139,156 bytes and seven environment checks pass. Sidecars are separate from packs. Terrain remains metadata-only; no further climate downloads are needed for these pilots.
- World preview runs on port 5191. Nigeria renderer preview runs on 5193 with disposable local data. Reconcile current process handles before restarting either.
Inspect live code, messages and running processes before modifying worker files or repeating downloads. Placeholder source records must never pass as verified sources. The latest inventory manifest is `8c40558c7cd6eff38be2c6d94bdaaafc04bfdc3f601fb45c4441d16b4b7d0a4f`, logical published size 354,201 bytes, under `.cache/world-build/output/inventory/manifests/`. Later evidence overrides this snapshot.

Objective: build a reproducible, efficient unattended world-data pipeline with real geography and lightweight 3D first. Establish global geographic coverage, then deepen Africa country by country before other continents. Preserve stable identities and representation layers for later photorealism. Distinguish geographic foundation, explorable geometry and playable destinations, with explicit source-unit denominators and coverage exceptions.

Protect Nigeria's existing maps, IDs, saves, travel rules, catalogue, database and concurrent efficiency work. Keep build state/output under the worktree's `.cache/world-build/`, separate from game data. Do not import builder dependencies into the game. Eventual gameplay integration is a distinct adapter milestone with regression checks. Do not merge, deploy, publish externally, purchase services or start paid API/cloud jobs without explicit authorization.

The user additionally authorized improving Nigeria's rendering. A separate managed worktree `/Users/anthonyakpan/.codex/worktrees/nigeria-rendering/joinallworld`, branch `codex/nigeria-rendering`, holds commit `6ad7579b`: lighting, filmic tone mapping and material-color changes only. Its 24 map tests, typecheck, build and download checks pass; desktop/mobile night views and fallback were inspected. Keep that visual milestone isolated and preserve all protected data. Controlled day/dusk and inland visual checks remain follow-ups. The rollout plan records this added scope.

Finish the production wave defined in `world/PRODUCTION.md`: pinned bulk acquisition, a lazy world/continent/country inventory, and resumable campaign orchestration. Resolve remaining questions with primary-source research and bounded experiments. Verify exact source releases, hashes, licences and upstream provenance. Measure real acquisition before scaling; do not use public OSM editing APIs or raster tile servers as unattended world downloaders.

Then continue the six ownership lanes in dependency-aware waves:
1. Geography, terrain, time and sourced regional conditions.
2. Pack contracts, stable identities, provenance and validation.
3. Resumable execution, recovery and resource limits.
4. Pinned source acquisition and deterministic compilation.
5. Lazy streaming, rendering, caching and independent preview.
6. Independent integration checks, coverage reports and operating documentation.

Run representative bounded pilots for Accra, Nairobi, Cape Town, London, Antarctica, sparse areas and the antimeridian before continent batches. Freeze shared contracts before dispatching dependent tasks. Every worker assignment needs exact owned files, interfaces, acceptance checks and stop conditions. Review worker diffs, run meaningful isolated tests, typecheck, build and inspect visual changes in the browser. Tests must not mutate the actual preview ledger or output. Commit coherent verified milestones; update documentation to match implemented behavior. Use the existing local tools: `node_modules/.bin/tsc -p world/tsconfig.json --noEmit`, `node --experimental-strip-types --test world/*.test.ts world/preview/*.test.ts`, Python acquisition tests in the private environment, and `node_modules/.bin/vite build --config world/preview/vite.config.ts`.

Use deterministic code for bulk geometry and data processing; never make a model call per building. Label estimated heights and unknown terrain/climate. Derive conditions by region and season: Africa includes deserts, humid tropical areas, savannas, Mediterranean areas and highlands. Climate baselines and live weather are separate products. Real footprints do not establish exact facades or interiors; photorealism requires licensed reference data and measured rendering budgets.

Enforce actual download/network-byte, disk, memory, execution-time, retry and render limits. Stop safely and resume from durable state; verify source/manifest/tile hashes on resume. Quarantine and repair only identified corrupt campaign artifacts with bounded retries and audit evidence. Never conceal missing source coverage, count empty output as completion, or infer whole-world throughput from a tiny fixture. Preserve existing game startup budgets and download only nearby/requested packs.

Keep progressing through successive milestones while this session is active. When a worker finishes, review its output and assign the next ready task. Do not repeatedly ask for routine implementation decisions covered here. Record genuine blockers such as unavailable credentials, source access or spending authorization, and continue independent tasks.

Maintain a checkpoint with completed work, current validation evidence, active ownership, remaining limitations, measured resource use and exact next commands/tasks. A two-day campaign is a bounded runtime target, not a guaranteed completion time. Build and document the persistent resumable runner; model agents do not keep working after the session ends or the computer sleeps. Report actual outcomes and do not declare the overall objective complete while required milestones remain.

Begin with the current-state audit and continue the in-progress production wave now.
