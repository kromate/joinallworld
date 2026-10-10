# Driving 676 source review

Decision: **MODIFY**, limited to source. Candidate `6769279eb4a573e8bec4a8eb94a72ef7f911389e` on `codex/cloud-living-replay-repair-20261010` was read from the fetched object in `the clean integration repository`. Prior candidate: `d7ccfa5dfea65dacd541ca1dddc885f7f410df9e`. The earlier unavailable-object/notourref events preceded actual GitHub publication. The publisher clone initially pushed to a local source clone; its origin was corrected and the actual GitHub branch was then verified. This was a publication workflow defect, not a driving source defect. No source execution, tests, compiler, browser, runtime, or repository changes were performed. Supplied 15 service / 7 component passes are reports, not independently observed execution evidence.

The repair changes exactly four files (123 insertions, 24 deletions). Final SHA-256 pins:

| File | SHA-256 |
|---|---|
| server/living-world/driving-service.ts | 7e7abcb72ddfe2dcbde041e6faaf48c51b336ec1e01e5bff07eded5329282b61 |
| server/living-world/driving-service.test.ts | 0ef67a228afa40a64fd3a93d78d488263bc0fe5d0e852af1c86deae7d801fce9 |
| src/app/features/living-world/DrivingApp.vue | b17534eb138d16ebbc1b611e48021974e562a9545361eb4380f0c51fa6aaa875 |
| src/app/features/living-world/practiceIdentity.test.ts | 5ddf6152b0322c94aad447f2afa05ee2a782ccde3f372ba12fe600753886f6ae |
| src/game/living-world/driving.ts | eceefd4facee9e5085a45e2e691a32c87be94851b518ff2fce012c9dc43f9ded |
| src/game/living-world/driving.test.ts | a959a8376a5fb3b71153f4af2dc6dd21213e294968daa41e49e06b0204a0e15e |
| src/types/living-world.ts | 27757f7089a482d5b046692fdc1d53ed06272788c3633949a2ed6efa64dbc677 |

## Findings resolved

**D1 closed in source.** Service lines 295–319 perform authentication/context, strict row validation, city/location safety handling, and journey matching before the sole retained packet check. Exact successful retry and same-sequence fingerprint conflict now precede clock reads, timeout/clock pause, issuance gate and simulation for every input shape and constructor mode. Old unretained or future sequences return sequence_conflict. The city/location mismatch safety pause remains a separate refusal and does not qualify as successful nonmutating replay. Nonmutating refers to the driving row; existing session renewal/life settlement is not removed.

New service scenarios cover ON explicit/legacy exact retry after timeout and reversed clock with complete row snapshots, plus OFF old-unretained explicit sequence refusal. Their conflict/future-sequence assertions occur before the timeout/clock manipulation, so they do not themselves execute the delayed-conflict variant. Source ordering supports it; final actual evidence should exercise it too. Lifecycle-revision replay, durable reopen, terminal and Worker rollback evidence remain separate requirements.

**D2 closed in source.** DrivingApp lines 221–225 now clear all held/buffered intent and deactivate active/boarding when previously observed capability is lost, even without an explicit gear choice. This closes the ordinary held-throttle race while the control-reply path starts its fenced pause at line 672. Repeated already-OFF replies do not continually disable legacy driving. Sent packet bytes remain untouched. The new component scenario exercises a legacy throttle, OFF control reply, clearing, and pause request; it does not render the transmission display or cover all response classes.

## Remaining source blocker

**D3 — P2: canonical direction disappears on capability loss.** `src/app/features/living-world/DrivingApp.vue:816` still gates the transmission-status paragraph on `reverseGearControls`, exactly as the selector at line 812. Canonical data at lines 148–157 is correctly derived from the saved state, but becomes invisible as soon as permission is absent.

Concrete reproducer: begin ON, receive a canonical running v2 state with `gear:'reverse'` and positive speed, then receive a current successful duplicate/control response with that same reversing state and no reverseGearControls. Hold the subsequent pause response pending (or fail its delivery). Capability becomes false and controls stop, while serverState remains reverse; the template hides the only textual direction status. The contract explicitly requires canonical reverse motion to remain displayed until an authoritative transition changes it. This also applies to an initial OFF load of an already-issued reversing row before reconciliation.

Minimum correction: keep the permission gate on direction choices, but render the saved transmission status whenever relevant canonical lesson state exists, independently of permission. After loss clear requested intent as now; show the saved direction, not an inferred forward/default change. Add a rendered-component assertion for the OFF reversing state with pause pending and then the authoritative stopped/changed response. Do not enable explicit gear input OFF.

## Separate inherited limit

L1 remains inherited from the baseline, not introduced by this repair: service pauseRecord line 109, accepted input line 344, and resume line 384 increment safe-integer revisions/sequences without an exhaustion guard. A valid row at MAX_SAFE_INTEGER can be written into a shape the strict reader later rejects. Restart already guards its own revision. Keep this separately tracked; accepting D1/D2 is not integrity acceptance of exhaustion behavior or authorization to widen this repair silently.

## Next gates

Receive and review the narrow display correction and exact final pins; then obtain actual final-SHA Node/component checks, compiler/build/size/smoke evidence under the agreed resource limits. Add delayed conflicting retry, lifecycle revision retry, full capability response-path and rendered canonical-status coverage. Preserve the original score-zero school, home, wallet and receipts; no qualification or score grants.

F3 remains open: before any v2 issuance, pin an actual compatible OFF reader/writer deployment and rollback artifact on both Node and Worker. Demonstrate isolated v2 durable reopen, OFF current/pause/resume/legacy input and retained receipt/terminal handling, alongside untouched v1 and corrupt-row preservation. C1/eec v1-only rollback is forbidden after v2 issuance. Unit fixtures and source review do not prove process restart, Worker parity, native gameplay, store continuity, release or activation. No paid resources or deadline extension are authorized by this report.
