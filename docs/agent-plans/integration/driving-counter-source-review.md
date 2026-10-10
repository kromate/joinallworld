# Driving counter test source review

**APPROVE_COUNTER_TEST_SOURCE_DELTA_ONLY.** No blocking test-design defect found in the new 91 lines. Runtime results remain unaccepted until the raw run is bound to immutable source.

Candidate `d38baceb29a7618b4a5ed06fe7075065d01488fa` versus base `1b225b90faf375b8195058ee17257e7d31cf8a98` changes **seven files**. Six are the previously reviewed e8/f4 host and host-test files. Only `server/living-world/driving-service.test.ts` changes versus `f4ba55eb66d5bd1171be64d170a6d4753d8a033d`, with 91 additions. This is not a test-only whole commit relative to 1b.

At test lines 606–663, four awaited scenarios cover v1/v2 and elapsed timeout/future clock watermark. Each seeds revision and nextSequence at MAX_SAFE_INTEGER minus one, with a prior receipt whose sequence is one below nextSequence. Those values satisfy the unchanged strict reader. v2 is first created through accepted explicit forward input; it is not merely relabeled. The tested three-field packet then advances both counters exactly to MAX_SAFE_INTEGER and replaces the synthetic prior receipt with a genuine accepted packet receipt.

After the timeout or future-watermark setup, the identical packet must succeed with duplicate=true and leave the complete driving row unchanged at maximum counters. A new packet with sequence MAX_SAFE_INTEGER must fail sequence_exhausted without changing that row. These assertions catch moving exhaustion refusal or mutating timeout handling before retained replay. They also assert that the v1/v2 version survives the final accepted write.

At lines 666–694, the actor's location changes to library while its running v1 driving row has maximum revision. All six routes, current/start/input/pause/resume/restart, must refuse with revision_exhausted. Each response and complete-row comparison finishes before the next request begins. The final 9-addition/9-deletion commit replaces immediately started promises with functions invoked inside the awaited loop. There is no unawaited async-forEach or leftover request race in this matrix.

The fixture creates an actual Node HTTP server and store. However, configuredDrivingRoutes at lines 18–30 replaces the driving route module to construct the real service with trusted ON. This is useful service testing; it does not verify the normal Node/Worker host authority wiring.

Keep the claims precise:

- These tests prove unchanged driving fields, including timestamps, counters, state and retained packet. They do not prove that no clock is read. Start reads/checks the clock at service lines 212–217 before the exhaustion guard at 220. Restart does so at 254–260 before 261; pause/resume at 368–369 before 374. Generic session/life settlement, rate accounting and lifecycle once receipts are outside the row snapshot.
- The six-route matrix uses a single v1 row and a valid stable clock. It does not cross every route with v2, wrong city/actor or invalid clocks. Current pauses running rows even without a mismatch, so that case alone does not establish a separate context branch.
- The final safe transition is tested for input, using legacy frames on v1 and retained v2. It does not add last-safe pause/current/resume/restart transitions or explicit-gear boundary frames. The base already tests several exhaustion refusals independently.
- The new-input case has both counters exhausted and correctly expects sequence_exhausted first. The existing base tests revision-only exhaustion separately.
- The reversed-clock cases place stored timestamps ahead of the fixture clock. This satisfies strict timestamp ordering and exercises the future-watermark condition; it is not an actual operating-system clock change.
- No close/reopen, Worker, OFF-host or native UI claim follows from these additions. Host H1–H3 remain independent. Computed tests using render:null still prove no DOM behavior.

The reported 18 focused PASS has no reviewed raw immutable receipt yet. I ran no test or source code. Parent also reports the base Brotli result of 195610 bytes exceeds the 195600 cap by 10 bytes. This review neither remeasures nor waives that failure. Exact changed-source compiler/build/budget, compatible OFF rollback artifact and sealed/native gates remain open.

Root must verify the complete seven-file provenance before integration. The same Living cloud writer owns test corrections; this review changes no source and activates nothing.

| Immutable file at d38 | SHA-256 |
| --- | --- |
| server/living-world/driving-service.test.ts | `5db571a1305c31f854a6378c66c11950be020d3427258e199268ab05d30380c6` |
| server/living-world/driving-service.ts | `ef7b0bc85c9fd34a467b85f39fa8450d248476315806d47a566a981a6590c319` |
| server/test-fixture.ts | `d376084667d9978e37a0d07d1d374c190c153cc368759a16bda38833dd0199a9` |

