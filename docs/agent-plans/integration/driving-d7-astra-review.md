# Driving d7 independent source review

Decision: MODIFY d7ccfa5dfea65dacd541ca1dddc885f7f410df9e. The source fixes OFF explicit-gear replay and adds useful capability fencing, but it does not fully satisfy the adopted replay and control-stop contract.

No code was changed or executed. No tests, compiler, build, server, browser or additional worker were run. The reported 14 service and 6 component passes are supplied results; I inspected their source assertions, not execution logs. I infer no runtime/model or full-build acceptance from those counts.

## Exact source and contract

Read fetched objects in the clean integration repository. Against eec14690544a4646e4cd8a5ad280d61bbe2709ca, the candidate changes exactly the seven assigned files, 645 insertions and 46 deletions.

| File | SHA-256 |
| --- | --- |
| server/living-world/driving-service.ts | 27fddca853b50fe60459b38c2ffd4d8fad34bba8e1c18a59aa3e351982346a25 |
| server/living-world/driving-service.test.ts | 4d780d422733d6c8a19cbcfce730fed8ca47b18d682ef59feb7359b4a4e06f74 |
| src/app/features/living-world/DrivingApp.vue | d869e39821ec80bee80441cf732a12639e56202f712bb66b30a18f4c7cc18c3d |
| src/app/features/living-world/practiceIdentity.test.ts | 79cf0892255a139152566921e72fab82a9d46cc61a14a194fd8807d1d66a5691 |
| src/game/living-world/driving.ts | eceefd4facee9e5085a45e2e691a32c87be94851b518ff2fce012c9dc43f9ded |
| src/game/living-world/driving.test.ts | a959a8376a5fb3b71153f4af2dc6dd21213e294968daa41e49e06b0204a0e15e |
| src/types/living-world.ts | 27757f7089a482d5b046692fdc1d53ed06272788c3633949a2ed6efa64dbc677 |

The pure module and tests exactly match the frozen previously accepted pins. I read the changed runtime functions, new tests and relevant unchanged authorization/lifecycle/cleanup paths.

The adopted amendments were read from remote-driving-handoff-2026-10-10.md at 8eddf7ee6319c675c10cece1252692b759846013, SHA-256 d652692f9a2923776d88041d1cde76b86132f76f7af0bcf1a53f9db5de889a5b, lines 56–60, alongside the earlier independent v2 issuance contract review.

## D1, P1: receipt recognition still follows writes in most input paths

driving-service.ts lines 300–310 recognize the retained receipt before writes only when issuance is OFF and the incoming packet includes explicit gear. With issuance ON, or for any legacy three-field packet, lines 322–334 read the clock and can pause/write before receipt comparison at lines 336–338.

Concrete reproducer:

1. Start a normal authorized journey with literal true. At sufficient time credit accept P={cityId:"lagos",journeyId:J,sequence:1,frames:[{throttle:1,brake:0,steer:0,gear:"reverse"}]}.
2. Snapshot the driving row, leave issuance ON, advance 1600ms, and resend exactly P in the same authenticated city/location/journey.
3. Source prediction: input_timeout logic changes status, speed, gear, timestamps, credit and revision, then returns successful duplicate. The row differs from the committed snapshot.

A legacy packet with the gear field omitted has the same defect even OFF. Setting now below the row watermark instead of advancing produces the clock-reversal variant. An invalid clock rejects a committed exact retry before receipt recognition.

There is also a conflicting-payload case: accept explicit P ON, switch OFF, advance beyond timeout, then resend its retained sequence with gear removed. That structurally valid legacy packet bypasses the early branch, mutates the row and then returns packet_conflict.

Required correction: resolve the exact retained successful receipt and retained-sequence fingerprint conflict once, after strict row validation and current actor/city/location/journey checks, before clock/timeout/issuance/simulation mutations for all input shapes and modes. Keep the stored fingerprint representation and lastPacket-only retention. Do not suppress ordinary timeout/clock safety handling for genuinely new input. Nonmutation applies to the driving row; normal authentication renewal/settlement remains separate.

The added service test at lines 108–181 covers the OFF explicit timeout case and a same-shape conflict, which pass through the new early branch. It does not cover the cases above. Immediate ON retries in the following test do not exercise the defect.

## D2, P2: capability loss leaves legacy driving active during the automatic pause

DrivingApp.vue lines 217–227 deactivate only when hadGearIntent is true. This excludes a player driving with ordinary three-field controls who has received ON capability but never selected Drive or Reverse. The successful control-response path at line 669 then starts lifecycle("pause") on actual capability loss. lifecycle clears held values at line 594 but does not deactivate controls while its request is pending.

Concrete component reproducer:

1. Start with reverseGearControls=true, active=true and requestedGear=null. Hold throttle and send a legacy packet.
2. Resolve that input with a current successful running session and no capability. Keep the automatically issued pause request unresolved.
3. hadGearIntent is false, so active remains true. The old control finishes and controlInFlight becomes false.
4. Invoke the sample and flush timers. They can produce and send another legacy packet before the pause resolves. Touch or keyboard throttle is still accepted because their handlers check active. The extra packet can race the pause's revision and cause a revision-conflict refusal.

This is a new race in the capability-loss reconciliation path. It does not enable explicit reverse while OFF, but it violates the stop-and-reconcile rule before ordinary legacy driving resumes.

Required correction: on an actual true-to-false capability transition, stop active/boarding and clear all held and unsent control state even when no gear was selected. Reconcile through the existing fenced lifecycle behavior. Do not stop normal legacy driving on every repeated already-OFF reply. Preserve the already-sent packet's bytes and sequence.

The new component regression starts by selecting reverse and adding a second explicit intent before OFF arrives. It therefore forces hadGearIntent=true and misses this branch.

## What the source does satisfy

- The constructor captures options.reverseGearIssuance === true once. Omitted, false and string values cannot enable it. The only production call remains createDrivingService(ctx) at server/routes/living-world.ts:12, so production issuance is unwired and OFF.
- The optional response capability is generated by the service wrapper, absent OFF and never written into the lesson. Exact body and save-key validation prevents a browser/save capability claim from enabling issuance.
- OFF rejects any complete new packet containing explicit forward or reverse, including mixed legacy/geared frames, before stepping any frame or charging credit. It does not upgrade a v1 row. The early OFF branch checks strict saved-row validity, actor access, city/location and journey before retained replay.
- Strict v1/v2 reading is independent of the option. Version 1 rejects gear; version 2 requires it and its speed/status constraints. Existing v2 pause, resume and legacy input preserve the gear field and v2 writer shape. New journeys remain v1. Qualification evidence uses the same strict reader independently of the gate.
- Capability updates now cover shared responses and successful lifecycle/restart paths. Request-captured capabilityEpoch prevents a previously queued ON response from restoring permission after an observed OFF response at the same saved revision. Context changes and unmount revoke permission and advance the fence.
- The client gates both selection and outgoing explicit frames. It does not rewrite an in-flight packet. Requested and canonical gear remain distinct. The new direction buttons have a 48px minimum height. Existing blur/hidden/account/location/unmount cleanup remains present.
- The unchanged pure proposal brakes before direction change, caps reverse at 3m/s, keeps backward checkpoint entry blocked, clears dwell on reverse request and retains position/heading on rejected movement. It contains no score increase or lowered qualification threshold. A retained score-zero attempt cannot pass through this change alone. No estate, original-home, wallet or credential grant code was added.

The OFF branch now returns reverse_gear_disabled for an old unretained explicit sequence, rather than sequence_conflict. It still refuses and never claims historical replay. Preserve or explicitly settle the contract's diagnostic policy when consolidating D1; do not extend lastPacket into an invented history.

## Inherited guard limitation

Revision exhaustion is checked for explicit lesson restart, but remains unchecked in pauseRecord at line 109, accepted input at line 352 and resume at line 392. This is inherited from eec, not introduced by reverse.

A strict-reader-valid running row with revision=Number.MAX_SAFE_INTEGER, nextSequence=1 and lastPacket=null can accept a fresh legacy input after100ms. It writes revision beyond the safe-integer range and becomes unreadable on the next strict read. current/pause can overflow revision too; an exhausted input sequence can also overflow.

The existing exhaustion test covers lesson restart only. Do not report comprehensive rollover protection. This needs a separately scoped correction or explicit recorded limitation before runtime integrity acceptance; this review does not silently widen the cloud worker's ownership.

## Test coverage and remaining evidence

The source tests meaningfully compare saved rows for OFF explicit refusal, mixed-packet refusal, timeout replay and conflict. They exercise literal true versus omitted/false/string options, OFF new v1 creation, ON reverse, OFF v2 current/resume/legacy writing, malformed gear and corrupt v1/v2 shapes. The component tests inspect outgoing packet bytes, requested/canonical labels, successful pause capability loss, queued intent clearing and a delayed same-revision ON response. Existing identity/unmount fences remain tested.

Required additions include D1 and D2, reversed-clock retained replay, replay after a lifecycle revision, terminal v2 replay, old unretained sequence and foreign-context attempts, successful OFF resume/restart and refusal/duplicate capability loss, repeated OFF legacy responses, and fresh re-enable after reconciliation. The delayed-ON component response is synthetic; it proves the local epoch mechanism, not a real deployment race. The mode-switch service fixture shares one live store and service construction context; it is not process reopen, Worker parity or deployment rollback evidence.

Next finite gates:

1. Cloud owner corrects D1/D2 with failing regressions, reports actual focused results and returns exact final commit/file hashes for fresh independent source review. No local heavy checks.
2. Finish the actual Node24 five-project compiler, build, size and smoke checks with their authorized resource limits, exact commands/exits/counts/skips and preserved failure logs. Keep startup limits 615000 raw, 223000 gzip and 195600 Brotli. The existing counts do not substitute for these checks.
3. Independently review eventual Node/Worker bindings and pin a deployed compatible OFF reader/writer/service rollback image before any durable v2 issuance. Prevent a mixed deployment containing v1-only readers. C1/eec is forbidden as rollback for a store that has received v2.
4. Prove actual durable reopen and rollback using exact artifacts: untouched v1, live/paused/terminal v2, corrupt rows, retained receipts, authorized pause/resume/legacy continuation and failed-write recovery. Preserve the same journey and its earned state across process restart. Explicit lesson restart is a different operation and cannot be used to reset the observed acceptance attempt.
5. Complete original-store desktop/mobile/native continuation, road-edge recovery, direction braking, capability loss/disconnect/blur/reopen, original score-zero school/home/wallet continuity and no invented qualification. Label physical-phone evidence separately from viewport emulation. Full candidate CI, exact-SHA staging, live continuity and release observation remain separate requirements.

No activation, release, deployed rollback, native gameplay or original-store acceptance is granted. No paid resources are authorized, and this review does not extend the human cutoff or usage stop.

