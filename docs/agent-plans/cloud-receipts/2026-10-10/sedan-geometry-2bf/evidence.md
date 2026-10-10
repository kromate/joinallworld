# Sedan aperture geometry candidate

- Checkout: `/workspace/remote-verification/repositories/sedan-aperture-20261010`
- Branch: `codex/cloud-sedan-aperture-geometry-20261010`
- Base: `3e3e0876fc50f3166a0d0968f8616b577da27870`
- Candidate: `2bfcbf584d3eae3b31a645269904d8e4786af29b`
- Candidate commits: `661acd8df8582502e98c46a99575d0fbec01c257`, `2bfcbf584d3eae3b31a645269904d8e4786af29b`
- Scope: exactly `server/living-world/sedan-aperture.ts` and `server/living-world/sedan-aperture.test.ts`; checkout is clean.

## Source pins verified at base

| Source | SHA-256 |
| --- | --- |
| `src/models/vehicles/sedan-interior.ts` | `3d9a5b3a516031fb7b6e14058a3d3c2615a3f531a38b56781d2f4a66bf8b0a57` |
| `src/models/vehicles/index.ts` | `7db039a0b25373a86354639fd703a96aab3a3de48a3088c14c555cc0fa6afc19` |
| `src/models/vehicles/geometry.ts` | `4bf847bd17a735050daa4686ed0be495c64a7936ed3c65c6e306e740edc94885` |
| `src/app/features/living-world/drivingScene.ts` | `3d42051273229265a17fcc5e04b7e5c95ddb72e7fa5fd00520d910cd19cf006c` |

The selected scene constructs a street-detail sedan. The helper reproduces its profile clipping in source plane order and rounds clipped vertices at Float32 emission. It analytically bounds the clipped door envelope around hinge `(-0.96,0.93,0.89)` over `[0,0.55π]`, includes the pinned street interior/underbody, side glass and trim, and treats the steering wheel over `[-1,1]`. Input validation rejects nonfinite, extra/moving, affine, non-unit, unpinned, duplicate, malformed, and accessor descriptors. Interior-box contacts are distinct from conservative door/steering envelope candidates. A positive geometry result applies only to supplied capsules.

Every return has `canBoard:false`, `authoritativeClearance:false`, and `routeAuthorized:false`. Missing proof lists clothed actor pose, terrain/support, continuous entry motion, full scene collision, and route/yield authority.

## Focused validation

Command: `AGENT_SLOT_DIR=/workspace/remote-verification/agent-slots AGENT_SLOT_HEAVY=1 node --experimental-strip-types scripts/agent-slot.ts heavy -- node --experimental-strip-types --test server/living-world/sedan-aperture.test.ts`

Final result: 9 tests passed, 0 failed, 0 skipped, exit 0, Node `v24.19.0`. The run used the existing shared heavy=1 slot. Raw log: `focused-final.log` (SHA-256 `931455b0ec0f279b78cbd2474c9c5df0af0881b9ef700bc671646b454e125535`). `git diff --check` passed.

The retained `focused-plane-order-failure.log` records an intermediate exact-value expectation mismatch after matching source plane order; the earlier 7/9 fixture run also found an incorrect open-panel point. These were test expectation defects, not production assertions. Corrected focused tests pass on the final candidate. No build matrix, browser, renderer, route integration, publication, deployment, or native acceptance was performed.

The accepted Integration contract branch was not available through the current Git proxy during this run (`git ls-remote` failed to connect to proxy port 8080). The published d40 refinement JSON was read and its SHA-256 verified as `e9d639e3159e21abd201d17f61f08ed0e63a7a4c3f63b9f8a4413acef292046e`.
