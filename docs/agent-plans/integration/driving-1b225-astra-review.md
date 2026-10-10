# Driving 1b225 finite source review

**APPROVE the L1 source correction.** Candidate `1b225b90faf375b8195058ee17257e7d31cf8a98` on fetched `origin/codex/cloud-living-final-safety-20261010`, compared with `44c1e540ed0244276a2ea74609aa9dec9ffd377c` in `the clean integration checkout`. This is source acceptance of the finite repair, not runtime, DOM, durable-reopen, release or activation acceptance. No source edits, tests, compiler, runtime, browser or additional workers were used.

Exactly two files change: eight guard lines in `server/living-world/driving-service.ts`, and 89 test lines in its service test. No deletions. No new blocking source finding was identified in this delta.

## L1 closure

The strict reader at service lines 51–78 already requires positive safe-integer revision and nextSequence, nextSequence <= revision, and a retained receipt sequence equal to nextSequence minus one. MAX_TIME at line 16 is Number.MAX_SAFE_INTEGER. Each path that can increment a valid row now proves its increment stays within that bound before modifying the driving row:

| Mutation | Guard and write in candidate |
|---|---|
| GET/current reload or context safe pause | Guard line 187 before clock, pauseRecord at 193 and write at 194. |
| Start request's existing-running context pause | Guard line 220 before pause/write at 221–222. Its earlier clock read does not mutate the driving row. |
| Restart context pause and fresh monotonic revision | Existing guards at 261 and 272 precede pause at 262 or revision+1 at 275. |
| Input with changed city/location | Guard at 304 before clock/pause/write at 305–308. This remains a separate context-refusal transition, not a replay bypass. |
| New input timeout/reversed-clock pause and accepted simulation | nextSequence guard 322 and revision guard 323 precede clock at 325, pauses at 330/334, simulation and the increments at 349. |
| Pause/resume request with changed context | Guard 374 before pause/write 375–376. |
| Explicit pause | Guard 382 before pauseRecord 383. |
| Explicit resume | Guard 386 before pauseDriving, state/credit changes at 388–390 and revision increment at 392. |

`pauseRecord` itself remains a private incrementing helper at 106–109; all present call sites were inspected and are dominated by the guards above. New ordinary journeys initialize revision and nextSequence to 1 at 227–229; they do not increment an exhausted value. This does not authorize restarting/replacing the original observed school attempt.

At MAX_SAFE_INTEGER-1 a valid single increment can reach MAX_SAFE_INTEGER safely. At the maximum, a new affected mutation refuses with revision_exhausted or sequence_exhausted, leaving the entire stored driving row unchanged. No wrap, reset, implicit new journey, credit spend or partial state change is introduced. The maximum row remains strictly readable, though a running exhausted row cannot receive another persisted pause/step; the response must leave controls stopped rather than pretend recovery. A separate recovery policy would require its own approval.

The nonmutation claim is scoped to the driving row. Existing access still renews/settles the authenticated session, and ctx.once may perform existing receipt maintenance. This patch does not promise a byte-identical whole database on every refusal. Invalid preexisting driving rows still fail the unchanged strict reader before the new guards and are not repaired or replaced. The delta adds no corrupt-row rewrite path.

## Earlier findings remain closed in source

**D1:** After strict envelope/auth/session context, row validation, city/location and journey matching, input lines 316–320 return the sole retained successful receipt or same-sequence fingerprint conflict. These precede sequence_conflict (321), both new exhaustion guards (322–323), OFF issuance refusal (324), clock (325), timeout and simulation. Exact replay at maximum revision/sequence therefore remains available and nonmutating. Old unretained sequences cannot gain duplicate status; context safety checks still precede replay. No historical-receipt expansion was introduced.

**D2/D3:** DrivingApp and its test are byte-identical to 44c. Actual capability loss stops held ordinary throttle and explicit gear intent; repeated already-OFF legacy operation remains possible after reconciliation. Sent packet bytes are preserved. Canonical transmission display uses capability OR canonical gear, while direction selectors remain capability-only. No UI authority, score, home, wallet or qualification behavior changes in this delta.

**DOM proof remains absent.** practiceIdentity.test.ts lines 64–74 replace the component renderer with `render: () => null`. The computed/setup assertions do not demonstrate a visible DOM node, accessible status, layout, or native behavior. This distinction remains mandatory despite source D3 closure.

## Test-source assessment and actual evidence still needed

The new case at service-test lines 517–605 meaningfully snapshots full driving rows for maximum-revision current/pause/input/resume refusals; maximum nextSequence refusal; a last-safe legacy revision increment and retained replay; and a v2 legacy step reaching maximum revision while retaining v2 gear and replayability. The separate existing restart maximum guard test remains present. These are source scenarios, not tests executed by this reviewer.

Precise gaps: the new case does not exercise a last-safe **nextSequence** increment from maximum-1 to maximum; its last-safe legacy/v2 cases raise revision while sequences remain small. It does not replay a real accepted maximum-sequence receipt, combine exhausted replay with timeout/reversed clock, or directly execute exhausted city/location branches for start/input/lifecycle. Those paths are bounded in source, but must not be described as covered by this new test. Add or obtain actual focused boundary evidence where required for final integrity acceptance. Earlier timeout/clock replay scenarios remain unchanged. Final-SHA tests should also preserve malformed/unsafe/contradictory rows across both reader versions.

Real Node24 and Worker SQLite/DO route execution, durable process close/reopen, storage-failure handling, retained-receipt continuity, final compiler/build/size/smoke and native original-store gameplay remain separate gates. Source hashes do not supply any of these results.

The actual candidate route still calls `createDrivingService(ctx)` without an issuance option (`server/routes/living-world.ts:12`). Therefore this candidate by itself remains OFF through the normal host route. The existing cloud integration writer now owns the real default-OFF four-file host patch; this review neither duplicates that writer nor assumes unreceived wiring. WORLD separately owns stage tooling and its own pins. Review and execute the eventual integrated bytes, not merely the already-tested configured-route fixture.

F3 is unchanged: before any v2 issuance, pin and actually stage/deploy compatible OFF Node and Worker reader/writer artifacts and their rollback identity. Continue the original actor, school journey and score 0 through the explicitly authorized ON stage; retain home, wallet and prior receipts. Reopen that exact durable store OFF and demonstrate v2 current/pause/resume/legacy control and exact retained replay, with no new explicit-gear acceptance. Never use C1/eec v1-only rollback after v2 exists. No reset, qualification grant, payment, production activation, new resources or deadline extension is authorized.

## Exact SHA-256 pins

| File | SHA-256 |
|---|---|
| server/living-world/driving-service.ts | ef7b0bc85c9fd34a467b85f39fa8450d248476315806d47a566a981a6590c319 |
| server/living-world/driving-service.test.ts | c3297399a1248aaa3cfa7bf35fc332415ca3f59a8feb19d0ef0e1752b4993027 |
| src/app/features/living-world/DrivingApp.vue | b08e09dfc72baae923438f48f4a0b983b8b2f0437789933b714932bc3a1e13b6 |
| src/app/features/living-world/practiceIdentity.test.ts | 3b6173241b941a7ee439df1b2d29de89225b9ef1fa908b927046c4869f2cd66d |
| src/game/living-world/driving.ts | eceefd4facee9e5085a45e2e691a32c87be94851b518ff2fce012c9dc43f9ded |
| src/game/living-world/driving.test.ts | a959a8376a5fb3b71153f4af2dc6dd21213e294968daa41e49e06b0204a0e15e |
| src/types/living-world.ts | 27757f7089a482d5b046692fdc1d53ed06272788c3633949a2ed6efa64dbc677 |

Only the first two pins differ from 44c. This report does not transfer reported execution evidence to future host or stage changes.
