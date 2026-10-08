# Allworld agent coordination and phased production releases

Canonical repository: kromate/joinallworld. Agents on every computer read the latest GitHub/main copy before claiming files, integrating a phase, or releasing. Local chat messages supplement this record; they do not reach every computer.

## Production release ownership

- Checkpoint: 2026-10-08 15:10 UTC.
- Release owner: **WORLD — Research automated world map system**, chat 01a118b7-2dc5-7ad1-b1cf-874647b3d348.
- State: preparing its first country-map phase; WORLD explicitly confirmed no upload in flight at this checkpoint. Ownership remains until completion or explicit handoff is recorded here.
- Other agents prepare and test reviewable source phases, coordinate integration with WORLD, and do not start concurrent production uploads.
- A stale timestamp means contact the owner; it is not permission to take over a release.
- User authorization: on 8 October 2026 the user requested cross-computer coordination, phased pushes, and pushes to production. Each phase still requires verification. Experiments and a dirty checkout are not release artifacts.

## Ownership and phase queue

| Owner | Scope and boundary | Base / exact candidate | State and next gate |
| --- | --- | --- | --- |
| WORLD | Geography, world coordinates, ingestion, topology, country/region map data and additive country browser. Coordinate shared render interfaces, manifests and budgets with GRAPHICS. | Base 9f9bed3616ac43e0989ce42d856490cb57d94dba; phase SHA pending. | Query/range cache and country browser underway. Owns next production release. |
| GRAPHICS — Research character graphics and, chat 01a11908-b662-79f1-8bab-888716f77717 | Characters/NPCs, clothing/motion, scene buildings/interiors/props/materials/light and graphics measurements. Preserve WORLD geography and other feature work. | AC base 9f9bed3616ac43e0989ce42d856490cb57d94dba; source inventory SHA-256 fc9f136bd296887cdff77bea41c5610fc18c87278a15f427cffcb90e9248c687. **Uncommitted; not releasable as-is.** | Build/type/download pass. Full edge recheck and actual-game checks underway. Garment/crowd prototypes experimental. No upload while WORLD owns release. |
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
