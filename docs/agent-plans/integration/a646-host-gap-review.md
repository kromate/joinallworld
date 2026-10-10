# Host replay gap review

**APPROVE_H1_H2_H3_TEST_SOURCE_CLOSURE_ONLY.** All three previously identified test-design gaps are addressed in exact `a6461c2208d9621bf79f69fb5409d5bc43cd7746`. Actual execution acceptance remains with Root's separate raw-evidence review.

The cumulative comparison against `f4ba55eb66d5bd1171be64d170a6d4753d8a033d` changes three test files. It includes the independently reviewed 91-line counter addition as well as both host-test repairs. The counter file matches its d38 reviewed hash. Production Node/Worker host files and the driving service are byte-identical to f4. The integration checkout remains clean at `3e3e0876fc50f3166a0d0968f8616b577da27870`.

**H1 is closed in source.** Node lines 115–131 capture the genuine issued v2 row, exact packet receipt and once map, close server/store, advance the constructor clock by 2000ms, reopen OFF and send the original POST/input before GET/current. The intervening reads inspect the file without requesting a driving route. Duplicate success, absent capability, unchanged entire issued row and unchanged once map are required. Worker lines 115–126 do the equivalent after an actual 1600ms wait and Miniflare disposal/recreation against the same SQLite directory. The service timeout is 1500ms. Its first driving request is also the original POST, followed by full row and SQL receipt comparisons. GET/current pausing is tested afterward.

**H2 is closed in source.** Both hosts create the resume receipt through normal HTTP, retain immediate duplicate checks, then accept ordinary OFF legacy input and refuse new explicit gear. Node lines 164–172 and Worker lines 160–166 capture the latest row and receipt set, perform another actual close/dispose and reopen, and make the identical old resume POST their first driving request. They require duplicate success with no capability and no persisted row or receipt changes. The request intentionally carries its original revision despite subsequent input, so success depends on the retained lifecycle receipt rather than reapplying the transition.

**H3 is closed in source.** The Node helper now spreads an options object instead of always passing a boolean flag. Lines 77–88 test omission with env='1'; lines 92–101 test the runtime string 'true', also with env='1'. Neither may advertise capability or issue v2 through explicit reverse. Literal true at line 104 activates issuance. Later reopens cover explicit false and omission. JSON.parse supplies the invalid value only in test code; production authority remains strict literal equality. Worker's omitted/'0'/'true'/whitespace negative cases and exact '1' positive case remain intact.

Requests, snapshots, delays and restarts are sequentially awaited. Node uses actual createServer, route registration, HTTP and devices.json with awaited store.close. Worker uses the production entry in a Miniflare workerd SQLite Durable Object with persistent storage across dispose/recreate; inspection SQL only reads. Neither host test directly seeds driving state or funds a wallet. Node's controlled constructor clock is a scoped protocol/drive-time fixture; Worker uses real waits. No money timer, score or qualification authority is changed.

Source approval has specific limits. The tests exercise graceful close/dispose of the same implementation, not a separately pinned rollback artifact or crash recovery. Worker uses a test-built bundle, stub ASSETS and default collection layout. The new cold responses assert duplicate/code/capability and persisted full-row equality; they do not separately assert every canonical response field. H2 proves that the pre-close receipt set survives cold replay unchanged, without comparing every intervening pre-close operation against receipt creation time. These limits do not reopen H1–H3.

I did not inspect a bound a646 execution log or compiler receipt in this review and ran nothing. Root subsequently reported the cloud compiler finding TS2722 on the optional store.close call at Node test line 34. That unresolved compiler finding holds integration despite the H1–H3 source-design approval. A successor was reported in progress without its full published SHA; no acceptance transfers to it. The old f4 two-PASS result does not transfer. Compatible OFF artifact-before-issuance, exact integrated compiler/build/budget/protocol checks, sealed Node/Worker and native UI gates remain open. A v2 store must never be rolled back to C1/eec v1-only readers. No deployment, activation, shared-source edit or provider action is approved.

| Immutable path at a646 | SHA-256 |
| --- | --- |
| server/living-world/driving-host-reopen.test.ts | `82731568b0c6bce3727d60be7076d5daf9e3a5e401451db6d0345a9e2b362cef` |
| deploy/living-world-driving-v2.edge.test.ts | `6875c0f267fe873be23331c21882a1f8fe95510fd03945b9a098a6874db60b49` |
| server/living-world/driving-service.test.ts | `5db571a1305c31f854a6378c66c11950be020d3427258e199268ab05d30380c6` |
| server/living-world/driving-service.ts | `ef7b0bc85c9fd34a467b85f39fa8450d248476315806d47a566a981a6590c319` |
| server/server.ts | `c6499252095e1e7548b25fb2566dfb56ec94bc2b8328a957403f90e3a2c31181` |
| server/types.ts | `a54a8daba84cf6a87e64cad9c6027fd0a4f50b46b5734130102d8bf3842868f9` |
| server/routes/living-world.ts | `39ecdf13390562eccadbfc3aaa76b082188b4d7045131e3124a94fd5dcc6c8e6` |
| deploy/cloudflare-worker.ts | `efef66d80ae36134fe95271e0eea0391e7789b9e4b3834aa68ace8f5f09c795b` |

