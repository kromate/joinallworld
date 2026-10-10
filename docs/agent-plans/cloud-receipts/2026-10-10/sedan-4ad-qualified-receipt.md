# Sedan aperture contract repair receipt

- Checkout: `/workspace/remote-verification/repositories/sedan-aperture-20261010`
- Branch: `codex/cloud-sedan-aperture-contract-repair-20261010`
- Base: `2bfcbf584d3eae3b31a645269904d8e4786af29b`
- Candidate commit: `4ad527e6ad2751c8e9b4580dba51ad4ae25f5b4b`
- Final tree: clean; only the allocated `server/living-world/sedan-aperture.ts` and `server/living-world/sedan-aperture.test.ts` changed from base.
- Focused command: `AGENT_SLOT_DIR=/workspace/remote-verification/agent-slots AGENT_SLOT_HEAVY=1 node --experimental-strip-types scripts/agent-slot.ts heavy -- node --experimental-strip-types --test server/living-world/sedan-aperture.test.ts`
- Focused result: exit 0, 15 tests, 15 pass, 0 fail, 0 skipped, 130.323089 ms.
- `focused-contract-repair.log` is a hand-normalized summary, not verbatim raw output (its displayed duration is 0.499016 ms; the original execution reported 0.499558 ms). Preserve it as historical context only. SHA256 `689850e14c8e36dc0affc453e9eac4292da713ad7a223b019db54c5e42ff76b8`. The original exact response was not recovered, so no raw-log claim is made.
- Source hashes: implementation `e821730b3a197c1d7261764e0a64a3ba5c228f0e993a72702bae4fb3977b2da3`; tests `446cecce541f9f042ac6129c84268adcf173360c4fb0ffea69e301139f765aa9`.
- Pinned source hashes verified unchanged: `sedan-interior.ts` `3d9a5b3a516031fb7b6e14058a3d3c2615a3f531a38b56781d2f4a66bf8b0a57`; `index.ts` `7db039a0b25373a86354639fd703a96aab3a3de48a3088c14c555cc0fa6afc19`; `geometry.ts` `4bf847bd17a735050daa4686ed0be495c64a7936ed3c65c6e306e740edc94885`; `drivingScene.ts` `3d42051273229265a17fcc5e04b7e5c95ddb72e7fa5fd00520d910cd19cf006c`.
- Accepted allocation contract hashes: MD `fb1ab9ad2038cd5e1eb0882211ea531b956603761de391c5d6498b923246278d`; JSON `bfb59d8ceab6812cacc04256e44b3544e92738ae7c000a8610f2f686f9a0ac9c`.
- Remaining qualification: source pin/Float32 emission site and source-phase checks passed, but actual Three CPU mesh construction was not executed because this checkout has no `node_modules`; no dependency installation or external path was introduced.
- No full compiler/build/budget/browser tests, publication, integration, or authority activation were performed.
