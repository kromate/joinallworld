# Allworld agent coordination and phased production releases

Canonical repository: kromate/joinallworld. Agents on every computer read the latest GitHub/main copy before claiming files, integrating a phase, or releasing. Local chat messages supplement this record; they do not reach every computer.

## Production release ownership

- Checkpoint: 2026-10-08 17:00 UTC.
- Release owner: **WORLD — Research automated world map system**, chat 01a118b7-2dc5-7ad1-b1cf-874647b3d348.
- State: WORLD is preparing the sole production upload of source **049a3350bf52f29df3524f011e425542c7756b51**. The package, safe archive round trip, current runtime review, public source ancestry and fresh synthetic continuity reference are verified. No upload has started at this checkpoint; ownership remains WORLD through live adoption/continuity.
- Other agents prepare and test reviewable source phases, coordinate integration with WORLD, and do not start concurrent production uploads.
- A stale timestamp means contact the owner; it is not permission to take over a release.
- User authorization: on 8 October 2026 the user requested cross-computer coordination, phased pushes, and pushes to production. Each phase still requires verification. Experiments and a dirty checkout are not release artifacts.

## Memory and local work serialization — 8 October 2026

The human reported desktop slowdown and requested that local agents work one after another. The shared slot CLI now defaults to **one heavy job, one QA server, and one browser lease**. All worktrees must synchronize this tooling phase before starting new work, or explicitly use AGENT_SLOT_HEAVY=1, AGENT_SLOT_SERVER=1 and AGENT_SLOT_BROWSER=1 until synchronized. Do not increase these caps under the current instruction.

Run builds, type checks, simulations, source acquisitions and test suites through `scripts/agent-slot.ts heavy`; run test/dev servers through its `server` lease. Acquire and hold its `browser` lease for a bounded UI review, then close temporary owned tabs and release it. Announce the owner and purpose to the other local agents before a resource-heavy phase. Keep other workers idle or on small source reviews; do not start several builders or test/browser sessions simultaneously. Queue the next check after the prior command is terminal.

Live locks from the earlier larger limits remain visible and block new admission even when they occupy slot2/3 above the new cap. Stale locks are reclaimed only through the existing guarded owner-liveness path. The regression suite passes12/12, including live high-slot blocking, safe stale recovery, signal cleanup and nested leases. A slot is a concurrency limit, not a guarantee about total RAM or unwrapped processes: preserve ownership, stop owned idle servers/previews, monitor memory pressure, and defer work if the computer slows again. Never kill another agent's unknown process or stop the user's browser tabs.

WORLD stopped its broad core test and queued checks; the living-world owner confirmed its heavy chain and 5194 server stopped. GRAPHICS subsequently closed its two temporary tabs and stopped its 5183 server and browser lease. Interrupted checks have no pass claim. WORLD then completed one serialized turn: affected Node checks 100/100 and full Worker checks 142/142, both terminal exit 0; all leases were released and memory returned to 52% free. The agreed next owner is living-world for corrected narrow fixture/compiler checks, followed by GRAPHICS for bounded QA. WORLD waits for both terminal handoffs before packaging or browser review. Production upload ownership remains WORLD while its country phase is being verified.

The shared Vite minifier is also limited to one worker on main at 6ba5d54c. WORLD verified its production build in 28.63 s with a 1536 MiB Node heap cap. These limits reduce concurrency; they do not replace the explicit single-owner turn across heavy, server and browser resources.

## Ownership and phase queue

| Owner | Scope and boundary | Base / exact candidate | State and next gate |
| --- | --- | --- | --- |
| WORLD | Geography, ingestion and additive lazy country outlines. Preserve Nigeria and concurrent graphics/living-world work. | Published source **049a3350bf52f29df3524f011e425542c7756b51**; isolated codex/world-foundation. | Five-project typecheck/build/startup budgets, affected Node100/100 and Worker142/142 pass; public fast CI passes. Sealed package/archive/runtime reviewed; next sole upload and live adoption/continuity. |
| GRAPHICS — Research character graphics and, chat 01a11908-b662-79f1-8bab-888716f77717 | Characters/NPCs, clothing/motion, scene buildings/interiors/props/materials/light and graphics measurements. Preserve WORLD geography and other feature work. | Published main phases: test helpers deb72936; Node campus03e520c3; **manifest-only5dad4476474d317f29f9dcf707ed7fd0475b36c4**. Isolated branch codex/graphics-phase-one clean. | Manifest phase preserves immutable tiles/doors/retained versions; no client renderer or world schema change. Node24/24, Worker52/52, type5projects, build/download pass; complete package saves6,840,045raw/687,087gzip/410,945Brotli bytes vs original. Nodecampus6/6. Public evidence: GRAPHICS-MANIFEST-PHASE.md. WORLD reviews/merges exact phase and reruns integrated checks/sealed package/continuity before its sole upload. Remaining renderer/LOD/clothing/foliage experiments stay local; whole-game/physical-phone acceptance incomplete. |
| Feature parity/app interiors and agents on other computers | Register exact owner, owned files and branch before overlapping work. Preserve existing app/catalogue/reliability work. | Not independently registered here yet. | Add own checkpoint. Screenshots and summaries do not prove completion. |

Each agent updates its own row with branch, exact SHA, touched files, phase scope, dependencies, checks/evidence, blockers, and next action. Record shared-file overlaps before edits. A local path is not evidence available on another computer: publish a safe report or link CI/PR evidence. Never commit tokens, cookies, secrets or private continuity fixtures.

## Concurrent updates and integration

1. Fetch origin/main and inspect ownership and incoming changes. Preserve dirty work. Isolate each phase on a branch/worktree; do not include another agent's unfinished changes.
2. Preserve other agents' latest entries. GitHub Contents API updates include the current file blob SHA. On concurrent-write rejection, refetch and merge; never overwrite using stale contents. Git pushes must fast-forward or use reviewed merges. Never force-push shared main.
3. Compare a phase against fresh main, resolve conflicts, run relevant checks and record the integrated SHA. Coordinate shared schemas, renderer interfaces, budgets, manifests and release tooling. Do not reset immutable baselines or relax budgets to make a phase pass.
4. The release owner records exact source SHA and phase scope before upload, and rereads this file immediately before uploading. If another owner/release is recorded, coordinate instead of starting that upload.

This file is an advisory record, not a lock enforced by the deployment platform. The single-owner agreement and fresh SHA-checked updates are needed to avoid competing releases.

## Production phase verification

Follow [deploy/README.md](../deploy/README.md), especially **Checked local release package**. Validate the reviewed source SHA reachable from origin/main, build and seal its package, then revalidate its digest/config. Do not deploy an ordinary dirty checkout.

Preserve Worker joinallworld-next, JOINALLWORLD, the existing SQLite namespace/migration and provider bindings/secrets. Keep package and runtime/download limits unchanged, and retain no_bundle:true and find_additional_modules:false in the sealed configuration.

Before upload record relevant checks/CI, visual/gameplay evidence, unchanged data/binding contracts, rollback/forward-fix reference and fresh synthetic continuity reference. A timestamp alone is not a backup. After upload record provider version, exact source SHA, public /api/health adoption, live smoke and the same synthetic identities/balances/action receipts. Report success only after those observations pass. Physical-phone performance remains unverified until tested on actual devices.

## Release receipts

[PARITY-DELIVERY.md](PARITY-DELIVERY.md) reports historical app-interiors source cfbc133b36b5d4e8d071bb8223fbfc59e6a33289, Cloudflare version 77d0ab82-7f21-4431-9ad9-9d6e8d60740b, adoption at 2026-10-08 13:45:31 UTC. This linked receipt is not a fresh health check. GRAPHICS' HTTP health probe at this checkpoint returned 403, so current public adoption is not independently reverified here.

Append each receipt with owner, integrated source SHA, scope, checks/CI/evidence, sealed-package digest, upload UTC times, provider version, observed public build, continuity/smoke results, limitations and explicit release-owner handoff. Preserve earlier receipts.

### Prepared country release — 2026-10-08 17:00 UTC

WORLD source049a3350bf52f29df3524f011e425542c7756b51 adds 257 requested geographic outlines and retains protected Nigeria. Digest3e7339088e4fc0f89022a1be5da29f71439b8547da72a6ec57c16ff15b4394a7; 6,103 files / 6,111 archive members / 100,770,682 logical bytes, largest4,508,691. Existing 5MiB/file, 6,500-member and 100MiB logical caps pass; safe Python3.12 extraction reproduces the exact package digest. Startup bytes/budgets are conserved. Complete dist is94,866,859bytes, which exceeds GRAPHICS' original84,369,438raw baseline by10,497,421; no full-distribution no-growth pass, baseline reset or new whole-compression claim. Current sealed-assets Node/browser review passes Senegal/Fiji/Nigeria/Lagos with balance5000 and zero console errors/warnings; current viewport override failed to apply (actual1280), so reuse prior390px evidence only because client bytes are identical. Current and immutable Lagos/Ibadan manifest HTTP/cache/resolver/tile checks pass. Broad core interrupted run is not a full-suite pass. Public [fast CI](https://github.com/kromate/joinallworld/actions/runs/37810320967) passes; full CI skipped. Fresh owned synthetic reference2026-10-08T16:58:53.265Z reads prior buildjoinallworld-cfbc133b36b5d4e8d071bb8223f and cash5000; credentials remain private. Upload/provider version/live continuity are pending. WORLD retains upload ownership.
