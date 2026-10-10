# Living driving candidate evidence

Candidate: `d7ccfa5dfea65dacd541ca1dddc885f7f410df9e`  
Branch: `codex/cloud-living-reverse-20261010` (pushed to `origin`, no force)  
Baseline: `eec14690544a4646e4cd8a5ad280d61bbe2709ca`  
Packet checkout: `1bf8ddbeeeafbde3ced2d3884bd4d55a7ce99647` (read-only worktree)  
Runtime: Node `v24.19.0`; shell hostname `96cc63a2f9d2`; assigned host label `durable`.  
Model: configured/requested `gpt-6-luna`, high reasoning; runtime model ID and this subworker's model attestation are not exposed in shell/tool metadata.

## Frozen patch verification

The four frozen patch SHA256 values matched before application:

- `reverse-road-edge-regression.patch`: `1eec18cb72ebfb2c89f73501a3e30026515503eec01e91515dec3c991661e0ce`
- `reverse-gear-implementation.patch`: `9482e2cdff947f726298040ee32c6102623277ee67ca1d05c84955999901f1d7`
- `server-test-assertion-addon/assertion-addon.patch`: `513c65cc4ae59b30de92f1ab3b27cd6de7315183d133e5fa37f2f0847715ab9f`
- `ui-addon-abc7d746/reverse-ui-controls.patch`: `abc7d746bb47b5b23094b1baca1def5847feee737f30ba3728326133a803046e`

The frozen pure files remain byte-identical to the packet hashes: `src/game/living-world/driving.ts` `eceefd4facee9e5085a45e2e691a32c87be94851b518ff2fce012c9dc43f9ded`; `src/game/living-world/driving.test.ts` `a959a8376a5fb3b71153f4af2dc6dd21213e294968daa41e49e06b0204a0e15e`.

Astra review source was fetched without merging. Commit `e01cc46f3cd02bc46689a148bd0412b60888bc0d`, review Markdown SHA256 `9622fb4370b882510b876ef7840a7d266799158442e9d9535bc3d5fc609bc905`, JSON SHA256 `092969b843f8a762db4ad131323a83e7c56d3e768e4184ac9974fb2c89276f09`.

## Final focused checks on the committed SHA

Both commands ran through `AGENT_SLOT_DIR=/workspace/remote-verification/agent-slots AGENT_SLOT_HEAVY=1 node --experimental-strip-types scripts/agent-slot.ts heavy -- ...`, with a 1536 MiB Node heap limit and one test worker. Escalated shell execution was used so nested Node worker output was visible.

| Command | Exit | Tests | Pass | Fail | Skipped | Test duration | Command elapsed | Log SHA256 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `node --max-old-space-size=1536 --experimental-strip-types --test --test-concurrency=1 server/living-world/driving-service.test.ts` | 0 | 14 | 14 | 0 | 0 | 1.61 s | 2 s | `012c71c41564355cc15505e82287f085449d3556d1fb86dac4126b140d2f3f08` |
| `node --max-old-space-size=1536 --experimental-strip-types --test --test-concurrency=1 src/app/features/living-world/practiceIdentity.test.ts` | 0 | 6 | 6 | 0 | 0 | 9.32 s | 9 s | `66584f4222614137ef778ec308744d049d6292b8a1417fa7a8a36a7881d5abaf` |

The service suite covers literal `true` versus omitted/false/string options, default-OFF v1 creation and refusal without driving-row mutation, ON reverse, exact accepted retry after timeout without row changes, conflict refusal, OFF v2 pause/resume and legacy three-field control, and existing corruption/terminal/receipt paths. The component suite covers initial capability absence, ON gear controls, buffered gear loss, immutable already-sent input, pause on loss, and an older same-revision ON response that cannot restore capability.

## Setup and earlier diagnostic runs

The assigned checkout had no `node_modules`. Initial frozen focused attempts therefore exited 1 before test execution (`ws` missing in service tests; `vite` missing in component tests). The missing modules were resolved by a local symlink to `/workspace/joinallworld/node_modules`; both `package.json` and `package-lock.json` SHA256s match across the checkouts (`ff2e40d7cefe461e9f08588b288d6063b9cf8c6db1838effe3b326ca9e7145d9` and `d3a82d0f0d7e750bee84042a2ab36dcaa655cf6e7c9bdb8047823e507112efa9`). No dependencies, manifest or lockfile were changed. The symlink remains untracked locally so the parent can run full checks; remove it after those checks.

Other pre-commit exploratory runs are preserved in this directory. Restricted shell execution hid nested-worker diagnostics. One visible service run on an intermediate implementation had 12/13 pass; the old test still used default OFF while expecting reverse, and was updated to construct the service with literal trusted `true`. Those runs are superseded by the passing committed-SHA results above.

## Whitelist and final file hashes

The candidate commit changes exactly these seven files:

- `server/living-world/driving-service.ts`: `27fddca853b50fe60459b38c2ffd4d8fad34bba8e1c18a59aa3e351982346a25`
- `server/living-world/driving-service.test.ts`: `4d780d422733d6c8a19cbcfce730fed8ca47b18d682ef59feb7359b4a4e06f74`
- `src/app/features/living-world/DrivingApp.vue`: `d869e39821ec80bee80441cf732a12639e56202f712bb66b30a18f4c7cc18c3d`
- `src/app/features/living-world/practiceIdentity.test.ts`: `79cf0892255a139152566921e72fab82a9d46cc61a14a194fd8807d1d66a5691`
- `src/types/living-world.ts`: `27757f7089a482d5b046692fdc1d53ed06272788c3633949a2ed6efa64dbc677`
- `src/game/living-world/driving.ts`: `eceefd4facee9e5085a45e2e691a32c87be94851b518ff2fce012c9dc43f9ded`
- `src/game/living-world/driving.test.ts`: `a959a8376a5fb3b71153f4af2dc6dd21213e294968daa41e49e06b0204a0e15e`

The production living-world route still constructs `createDrivingService(ctx)` without options; v2 issuance remains unwired. No binding, route registry, auth, scene, wallet, accounting, save, storage migration, deployment or release files changed.

## Remaining checks and limits

Full typecheck/build/download-budget/smoke are left for the parent to run once on this committed candidate. No actual browser or physical phone session, original-store continuation, Node/Worker parity, durable v2 reopen/rollback, independent implementation acceptance, staging, activation or release was verified here. The reviewed implementation has not been approved for activation. Score, licence, qualification and wallet state were not changed.
