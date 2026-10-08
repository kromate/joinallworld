# Copy-and-paste continuation prompt

Continue implementing the world-building system from this thread's existing research, specifications, code and accepted evidence. Take action now; do not restart completed research, rebuild finished modules or stop at another plan. Read `world/PROGRESS.md` first for current status and inspect Git state before editing.

Use GPT-6 Sol (`gpt-6-sol`) as coordinator and GPT-6 Luna (`gpt-6-luna`) for narrow implementation assignments. I explicitly authorize parallel subagents. Respect the current four-agent limit, including the coordinator: at most three workers at once. The six lanes below are ownership lanes run in waves. Use `fork_turns: "none"` when choosing a worker model and supply the necessary context, exact owned files, interfaces, acceptance checks and stop conditions. Reuse suitable idle agents before creating duplicate owners; freeze shared contracts before dependent assignments. Use the collaboration subagent tools for subtasks, not separate user-owned chats.

## Workspaces and protection

Primary world worktree:
`/Users/anthonyakpan/.codex/worktrees/world-foundation/joinallworld`
Branch: `codex/world-foundation`. Accepted expanded campaign commit: `ad9efac2`; preserve all later changes, including the strict LFS pointer parser and this checkpoint. Foundation commit `c6e246e5` is historical, not a reset target.

Protect the concurrent primary checkout:
`/Users/anthonyakpan/Desktop/joinallworld`
Do not edit its game data, database, catalogue, maps, saves, identities, travel or graphics work. Keep builder state/output under the world worktree's `.cache/world-build/`. Never import bulk-builder dependencies into the game. Game/content reader integration is a separate tested adapter milestone.

The user also authorized improving Nigeria's rendering. It is already implemented separately at:
`/Users/anthonyakpan/.codex/worktrees/nigeria-rendering/joinallworld`
Branch `codex/nigeria-rendering`; lighting/material commit `6ad7579b`, lagoon correction and renderer QA commit `01c4c8f1`. Do not regenerate Nigeria. The change reveals existing lagoon water by lowering the coarse coastal backdrop; exact horizontal geography, holes and triangle topology remain unchanged. All 35 focused map/water/context/geography tests, five-project TypeScript, production and standalone builds and measurable download budgets pass. Lagos/Abuja/Kano day, dusk and night were inspected at actual 1280×720; narrow Lagos/Kano at 390×844 fit without horizontal overflow. No browser console errors; idle count remained 8 at separated reads. Read that worktree's `docs/NIGERIA-RENDERING.md`. Normal-game inland travel and physical-device performance remain separate checks. Reconcile this patch with concurrent water-shimmer/graphics changes only at the integration milestone. Preserve its untracked `node_modules` symlink.

Do not merge, deploy, publish externally, buy services or run paid API/cloud jobs without explicit authorization. Routine implementation and reversible local verification are already authorized.

## Read the specifications, then execute

Read `world/README.md`, `IMPLEMENTATION.md`, `ROLLOUT.md`, `VALIDATION.md`, `PRODUCTION.md`, `production-types.ts`, `RESEARCH.md`, `GEOGRAPHIC-COVERAGE.md`, `COUNTRY-OPERATIONS.md`, `FINE-CAMPAIGN.md`, `FINE-OPERATIONS.md`, `ENVIRONMENT.md`, `M2-VALIDATION.md` and `tooling/README.md`. Earlier validation documents describe historical milestones; current checks and next tasks are in PROGRESS.md. Inspect applicable repository instructions, agents and running services before editing or starting processes.

Objective: build a reproducible, efficient, unattended world-data pipeline using real geography and lightweight 3D first, with stable identities and representations that can later support photorealism. Establish global geographic coverage, deepen African countries before other continents, and distinguish geographic foundation, explorable geometry and playable destinations. Missing levels and source exceptions must remain visible.

## Accepted state to preserve

- Global directory: separate 258 map units, retaining every prior 177 country ID and adding 81. Manifest `b3fb51b5660ed22b2ee354235c60291d6857b3dd9245afbabec3fc15918c8501`; 257 non-Nigeria outlines, 263 bounded whole-polygon parts, 12,689,994 logical bytes. Independent reconstruction preserves all 4,271 polygons and 546,699 non-Nigeria positions. Nigeria stays `legacy-ng` and emits no new outline. Do not recapture the pinned 13,287,234-byte Natural Earth source or reinterpret the old inventory product.
- Administrative discovery: frozen 199-row metadata, joined against all 258 units. Directory catalogue `dda57deffe7d09612a9595aedba4f7378821d328d2111039906854dd1d702a4a`: 192 linked, 55 missing metadata, ten source-resolution exceptions, one protected Nigeria. One invalid India metadata identity remains explicit; a valid India row exists separately. Discovery URLs and license strings are not admitted geometry or distribution authorization.
- Durable cache-only fine campaign: actual first/repeat produce one compiled Rwanda, 256 named exceptions, one protected Nigeria, no pending jobs, zero network and one total ledger attempt. Report `2469dd1e014e6ec41cca9c55f4627793310ac331cae8722ad76de82e689cc6ea`. Exhausting this reviewed queue does not mean global administration is complete.
- Rwanda: new fine manifest `a55a237f7ac870631d227d323c937fb32593c5410bc115518663d44ec7269291` binds the expanded directory explicitly. Five original division IDs and all 58,470 positions are unchanged; 2,159,566 logical bytes. Fine schema 2 requires the exact source-bound planar report and all units valid. Old coarse and fine manifests remain immutable/readable. No automatic namespace detection.
- Strict pointer prerequisite: `parseFineLFSPointer(bytes: Uint8Array, maxSourceBytes: number)` in `world/fine-lfs.ts` returns `{sha256, bytes}` for the bounded canonical three-line Git LFS subset. Pointer cap 4 KiB, existing source cap 8 MiB, fatal UTF-8, safe positive decimal size; unsupported extensions fail closed. This is a pure parser; transport, policy joins and durable preparation are still unfinished.
- Latest world checks: all 241 integrated Node tests and full world TypeScript pass. The unchanged accepted world preview build is 648.99 KB minified / 169.68 KB gzip JS, with the existing >500 KB warning, outside the game startup bundle. Browser directory/fine acceptance at 586×804 preserves legacy bindings, rejects incorrect parents, clears stale context and protects Nigeria.
- Real city campaign `representative-real-v2` is terminal with exceptions: Accra, Cape Town, London and Nairobi compiled; Sahara/Antarctica measured empty sources; Fiji failed twice in transport; Nigeria protected. No queued or leased jobs. Accounting remains 113,303,391 bytes = 49,303,391 measured + 64,000,000 reserved for unknown Fiji transfers. **Do not retry Fiji or reset those reservations.**
- Nearby streaming and cache reuse are implemented; actual browser checks passed for Accra/London at 586×804. One bounded Accra DSM and six sourced monthly climate point profiles exist separately. Terrain datum conversion, terrain/climate pack attachment, physical-device tests, soak/journey checks, distribution and the gameplay adapter remain open. Antarctica/polar and antimeridian assumptions require explicit handling.

## Immediate next milestone

Finish bounded source promotion and resumable preparation ahead of the accepted fine compiler, then handle over-limit layers as a distinct representation. Do not keep rerunning the exhausted Rwanda-only queue.

1. Freeze an explicit promotion contract linking a hash-verified metadata row and country-directory identity to the full immutable source commit, strict LFS SHA-256/length, original-source evidence and attribution. Inspect the already frozen African rows; Natural Earth-derived Djibouti/Namibia are candidate bounded pilots, subject to actual pointer size, geometry limits and licensing checks. No source is admitted just because a candidate URL exists. Ghana's OSM/license mismatch remains unresolved: do not fetch Ghana. Record analogous conflicts rather than accepting their strings blindly.
2. Implement bounded, audited pointer transport and capture using exact full-commit URLs. Pin expected geometry bytes before fetching them; preserve conservative charges for unknown transfers. Reuse `acquireFineSource` for its exact hash/length checks, strict URL/path policy, shared lock and cache verification. Do not bypass its existing source/cache/audit caps or perform one model call per feature.
3. Add durable preparation stages that call existing `runFineTopology` and the cache-only fine campaign. Validate all source-bound reports/assets on resume; retain failures, leases and lifetime attempts. Do not nest the campaign lock around the shared acquisition lock. Source and output quotas are aggregate, not just per file. Keep tests in temporary fixtures, never the actual build ledger.
4. Run representative real first/repeat African captures and builds, independently verify original geometry, identities, hashes, bytes and zero-network cache reuse, then update the full denominator/exceptions. Oversized or invalid sources are named exceptions until the separately bounded partition product exists. Do not simply raise pilot ceilings.
5. Continue deeper administrative/settlement contracts, terrain datum conversion and environment attachment, streaming/device/soak checks, then the separately tested gameplay adapter. Photorealistic assets must attach to stable IDs with licensed reference data and measured budgets; mapped footprints do not prove exact facades, interiors or playable housing.

Continue these six ownership lanes in dependency-aware waves:
1. Geography, terrain, time and sourced regional conditions.
2. Pack contracts, stable identities, provenance and validation.
3. Resumable execution, recovery and resource limits.
4. Pinned source acquisition and deterministic compilation.
5. Lazy streaming, rendering, caching and independent preview.
6. Independent integration checks, coverage reports and operating documentation.

## Operating and verification rules

Use deterministic software for bulk geometry, coordinates, measurement and packaging. Luna implements bounded tasks; AI does not generate every building. Keep source releases, hashes, attribution, disputed-boundary policy, estimates and missing coverage explicit. Derive climate by region and season, never apply humidity uniformly to Africa; climate baselines and live weather are separate products.

Enforce actual network, disk, memory, deadline, retry and render limits. Fine sources stay within 8 MiB, 32 units and 150,000 positions until a separately reviewed representation changes the contract. Current campaign sessions are at most 120 seconds with bounded lifetime attempts and durable state. A two-day workflow needs a bounded resumable supervisor, not bypassed session caps. Stop safely and verify output on resume; do not silently skip corruption, reset accounting, fabricate source coverage or infer whole-world completion from pilots.

Preserve the game startup budgets. Nigeria's latest isolated build passes at 222,553 gzip bytes against 223,000; new readers must remain lazy and small. No builder dependencies or worldwide catalogue in the bootstrap. Preserve saves and original Nigeria routing; new world routing needs sourced sparse connectivity rather than all-pairs links or invented flights.

Use `scripts/agent-slot.ts` for heavy/server/browser resource slots; preserve other owners' services. Inspect current processes before starting a duplicate. Review every worker diff and integrate appropriate isolated checks:

```sh
node node_modules/typescript/bin/tsc -p world/tsconfig.json --noEmit
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- node --experimental-strip-types --test --test-concurrency=1 'world/**/*.test.ts'
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- node node_modules/vite/bin/vite.js build --config world/preview/vite.config.ts
```

Run the private Python source/topology/terrain checks when those modules change. Inspect UI changes through the actual browser and save screenshots; browser emulation is not physical-device validation. Do not broaden/repeat expensive checks without new changes or unresolved evidence. Historical preview services include world port 5191 and Nigeria port 5193; verify ownership/liveness instead of assuming they remain available.

Keep progressing through useful milestones while this session is active. Record genuine dependencies and continue independent work; do not ask again about authorized routine choices. Maintain concise PROGRESS.md evidence, limits, active ownership and exact next tasks. Commit coherent verified milestones in isolated branches. Agents do not continue after the session ends or the computer sleeps; persistent execution requires the documented bounded runner and an awake machine. Do not claim whole-world, playable-world, physical-device or 48-hour completion without measured acceptance, and do not mark the full objective complete while required milestones remain.

Begin with the current-state audit and dispatch the next bounded source-promotion wave.
