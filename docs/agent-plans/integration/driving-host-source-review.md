# Driving trusted-host source review

Decision: **APPROVE_TRUSTED_HOST_SOURCE_ONLY**. No new source blocker found in the four host changes. The two published PASS results support genuine HTTP and durable storage paths, with the specific proof gaps below. This review does not approve issuance activation, release or rollback.

The reviewed base is `1b225b90faf375b8195058ee17257e7d31cf8a98`, host source `e8a1bd30319e63931e47a43f833f74a83f500d2c`, tests `f4ba55eb66d5bd1171be64d170a6d4753d8a033d`, and published execution receipt `d69d6c2e863550764f7a35b0c69ba78343b58aa3`. All reads used immutable Git objects in the integration repository. I ran no tests, compiler, build, server or browser and changed no source.

Node defaults to OFF and normalizes only literal `true` in `server/server.ts:161,519`. Its environment object is not an issuance channel. Worker accepts only `env.REVERSE_GEAR_ISSUANCE === '1'` in `deploy/cloudflare-worker.ts:376`. The route registry captures the trusted context value at `server/routes/living-world.ts:12`; the service captures it once at line 153. No browser, request body or saved-life claim can enable it. No production configuration or binding is enabled by this diff.

Exactly four source files change in the host commit; exactly two tests follow. The strict v1/v2 reader, writer, input replay, clocks, safe-integer guards, pure driving, UI and associated base tests are unchanged. Retained `lastPacket` replay remains at `driving-service.ts:316–320`, after actor/journey/context validation and before issuance, clock, exhaustion and timeout handling. OFF permits existing v2 reads, pause/resume and three-field frames, retains v2, refuses new explicit gear and omits the response capability. D1/D2/D3 and L1 source conclusions remain intact. This is a driving-row guarantee: existing generic session/life settlement before replay can still change other state.

The Node test uses actual `createServer`, localhost HTTP requests, normal session/action/driving routes, `devices.json` readback, server/store close and reopen with the same directory. The Worker test bundles the production entry, uses Miniflare's actual SQLite Durable Object with persistent storage across disposal, sends normal HTTP requests and inspects SQL without seeding driving rows. It also reopens again after the OFF legacy write. These are meaningful host tests.

Three proof gaps need precise follow-up:

1. **H1: first request after reopen is not replay.** Node lines 113–122 and Worker lines 122–132 call GET/current before retrying the retained packet. GET already pauses and rewrites the running row. Comparing replay with that paused row cannot prove replay precedes timeout on a cold running row. Add a case that persists successful running v2, closes/disposes, waits beyond timeout, reopens OFF and sends the original POST/input first. Compare the full driving row and original receipt with the pre-close snapshot. Then test GET pausing independently. The source ordering is correct; these existing assertions overstate that particular runtime proof.

2. **H2: lifecycle receipt retry does not cross restart.** Node lines 124–133 and Worker lines 134–143 create a resume receipt after reopen and immediately retry it. This proves immediate idempotence. Capture the receipt and row, close/dispose again, reopen OFF and retry the identical lifecycle request first to prove durable receipt reuse. The existing tests do prove retained input-packet replay across the earlier reopen, subject to H1.

3. **H3: Node default/literal runtime matrix is incomplete.** The helper at Node lines 17–18 always passes a boolean; calls use false and true. Add omitted-option and representative nonboolean truthy-option cases before claiming the complete runtime authority matrix. Worker already tests omitted, '0', 'true', whitespace and exact '1'. Node's source check is strict and its existing env='1' negative case is useful.

The Worker SQL assertions cover the default collection layout, not a separate entries-layout matrix. Its ASSETS response is a stub, and its test-built Worker is not a pinned sealed artifact. Node reads its final OFF legacy write from disk but does not reopen again after that write.

The immutable log has SHA-256 `167d9462c809082ef284bbe4fd33766a1e6db0dad8e7b3429e4c37954074ea40` and reports 2 PASS, 0 failed, 0 skipped under Node v24.19.0. The receipt records exit 0, 8.806209 seconds, one heavy slot and a 1536 MiB heap. Its before/after source pin maps are empty. The reported f4 HEAD and clean tracked status do not establish full unchanged-byte provenance. I accept the published results for the assertions present, without claiming a local rerun or inheriting compiler/build/budget results.

Before real issuance, build and pin the compatible OFF artifact and prove it opens the retained v2 store. Never roll that store back to C1/eec v1-only readers. Same-source OFF configuration testing does not close this artifact-ordering requirement. Exact integrated candidate checks, sealed Worker/Node stage journeys, actual native capability-loss behavior, and preservation of original score-zero qualification, school, home, wallet and receipts remain required. Existing component tests with `render: null` inspect setup/computed values and do not prove DOM behavior.

The existing cloud integration writer owns shared host/types and any bounded test additions. WORLD retains stage-tool ownership. This review authorizes no deployment, binding/secret change, provider tier change or issuance activation.

Exact SHA-256 pins at the tests ref:

| File | SHA-256 |
| --- | --- |
| server/server.ts | `c6499252095e1e7548b25fb2566dfb56ec94bc2b8328a957403f90e3a2c31181` |
| server/types.ts | `a54a8daba84cf6a87e64cad9c6027fd0a4f50b46b5734130102d8bf3842868f9` |
| server/routes/living-world.ts | `39ecdf13390562eccadbfc3aaa76b082188b4d7045131e3124a94fd5dcc6c8e6` |
| deploy/cloudflare-worker.ts | `efef66d80ae36134fe95271e0eea0391e7789b9e4b3834aa68ace8f5f09c795b` |
| server/living-world/driving-host-reopen.test.ts | `62189f28ca37633bf6ae8f3f65707633cc2eada1d3bc96e63295b0429172386b` |
| deploy/living-world-driving-v2.edge.test.ts | `54a56f003a732e93c4ea786ddf84fe0ba0ddcc05e2f079fe7814ae0be372fb5e` |
| server/living-world/driving-service.ts | `ef7b0bc85c9fd34a467b85f39fa8450d248476315806d47a566a981a6590c319` |
| server/living-world/driving-service.test.ts | `c3297399a1248aaa3cfa7bf35fc332415ca3f59a8feb19d0ef0e1752b4993027` |
| src/app/features/living-world/DrivingApp.vue | `b08e09dfc72baae923438f48f4a0b983b8b2f0437789933b714932bc3a1e13b6` |
| src/app/features/living-world/practiceIdentity.test.ts | `3b6173241b941a7ee439df1b2d29de89225b9ef1fa908b927046c4869f2cd66d` |
| src/game/living-world/driving.ts | `eceefd4facee9e5085a45e2e691a32c87be94851b518ff2fce012c9dc43f9ded` |
| src/game/living-world/driving.test.ts | `a959a8376a5fb3b71153f4af2dc6dd21213e294968daa41e49e06b0204a0e15e` |
| src/types/living-world.ts | `27757f7089a482d5b046692fdc1d53ed06272788c3633949a2ed6efa64dbc677` |

