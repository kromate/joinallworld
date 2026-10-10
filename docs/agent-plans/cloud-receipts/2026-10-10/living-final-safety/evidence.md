# LIVING final safety candidate focused evidence

- Candidate branch: `codex/cloud-living-final-safety-20261010`
- Base: `6769279eb4a573e8bec4a8eb94a72ef7f911389e`
- Final source commit: `1b225b90faf375b8195058ee17257e7d31cf8a98`
- GitHub remote ref verified with read-only `git ls-remote origin refs/heads/codex/cloud-living-final-safety-20261010`: same final SHA (exit 0).
- Tracked worktree and index clean. Only untracked item is the existing dependency symlink.
- Diff SHA256 against base: `675b83d999b8b0d7b31907feb4880b0d01523c71566e969c50911d508b81febf`.
- Whitelist exactly: `server/living-world/driving-service.ts`, `server/living-world/driving-service.test.ts`, `src/app/features/living-world/DrivingApp.vue`, `src/app/features/living-world/practiceIdentity.test.ts`.
- Pure files remain at frozen hashes: `src/game/living-world/driving.ts` SHA256 `eceefd4facee9e5085a45e2e691a32c87be94851b518ff2fce012c9dc43f9ded`; `src/game/living-world/driving.test.ts` SHA256 `a959a8376a5fb3b71153f4af2dc6dd21213e294968daa41e49e06b0204a0e15e`.

## Focused actual Node 24 checks

Commands use the shared heavy slot (`AGENT_SLOT_DIR=/workspace/remote-verification/agent-slots`, `AGENT_SLOT_HEAVY=1`) and were run with escalated execution so nested Node test output was visible. Node: v24.19.0. Host label: `96cc63a2f9d2`. Heap cap: 1536 MiB; heavy concurrency: 1.

- UI/F2 command: `AGENT_SLOT_DIR=/workspace/remote-verification/agent-slots AGENT_SLOT_HEAVY=1 node --experimental-strip-types scripts/agent-slot.ts heavy -- node --experimental-strip-types --test --test-concurrency=1 src/app/features/living-world/practiceIdentity.test.ts`
  - Exit 0; 7 tests, 7 passed, 0 failed, 0 skipped; duration 8.642 s.
  - Regression checks the computed canonical server-reported reverse status while capability is OFF and pause is pending, confirms controls are cleared, and verifies server state remains running/reverse until the authoritative pause reply. The existing harness replaces the component render function with null, so this is computed/state evidence, not rendered-DOM verification; actual artifact UI visibility remains pending.
  - Raw stdout/stderr log: `f2-ui-raw.log`, SHA256 `6c296cdac9d2eba24ebf41374a7b962cfdc8646184b67c19dfc7c4fb5c31d96c`.
- Service/L1 command: `AGENT_SLOT_DIR=/workspace/remote-verification/agent-slots AGENT_SLOT_HEAVY=1 node --experimental-strip-types scripts/agent-slot.ts heavy -- node --experimental-strip-types --test --test-concurrency=1 server/living-world/driving-service.test.ts`
  - Exit 0; 16 tests, 16 passed, 0 failed, 0 skipped; duration 1.843 s.
  - Includes full-row preservation at revision exhaustion for current/pause/input/resume, sequence exhaustion, and last-safe v1 legacy/v2 legacy operations plus exact replay at max revision.
  - Raw stdout/stderr log: `l1-service-raw.log`, SHA256 `5c41e679f9dccfd97076ce7050d053dc4422b80f883272b0adb741a27e132da6`.
- `git diff --check`: exit 0.

## Review pins and remaining checks

The independent D7 Astra report was fetched from checkpoint `e8695a5530f6559701a1cafb6f47dbe5c87a2279`; `docs/agent-plans/integration/driving-d7-astra-review.md` SHA256 matches the supplied pin `d70c51346678979d1126e3dc4a9ef6607c13498bc5706029a8617f0fe21fbd8c`. The report's D2 computed-state requirement is covered by the new capability-loss test. Actual rendered selector/status visibility is still unverified because the existing inert harness does not render the component. Its inherited revision/sequence exhaustion limitation is addressed in the two service files.

The parent reported five-project TypeScript compiler PASS at `6769279eb4a573e8bec4a8eb94a72ef7f911389e` with the explicit 4096 MiB compiler exception; that run predates these final candidate changes and does not validate this SHA. Parent must run final compiler/build/budget/smoke checks against this branch. Final exact-candidate Astra review remains pending.

No route wiring, activation, staging, deployment, migration or release was performed. Durable v2 reopen/rollback compatibility, Node/Worker parity, original-store continuity and desktop/phone gameplay remain unverified. F3 pinned OFF rollback image remains an open gate before any v2 issuance. Configured model was `gpt-6-luna`, high; runtime model/reasoning is not independently attested by shell/thread metadata.
