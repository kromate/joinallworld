# Driving 44c source and host-option contract

**APPROVE the narrow D3 source correction**, conditional on actual final-byte verification. This is not rendered UI, runtime, stage, rollback or activation acceptance. Candidate `44c1e540ed0244276a2ea74609aa9dec9ffd377c`, fetched branch `origin/codex/cloud-living-final-safety-20261010`; compared with `6769279eb4a573e8bec4a8eb94a72ef7f911389e` in `the clean integration checkout`. Exactly two files changed, 14 insertions and 3 deletions. No source edits, execution, tests, compiler, browser or extra worker were used for this review.

## D3 closure and proof boundary

`src/app/features/living-world/DrivingApp.vue:149` adds `hasCanonicalGear` from an own gear field in the canonical server state. Line 817 now shows transmission status when capability is true **or** that canonical gear exists. The selector at line 813 still requires capability, and `selectGear`/outbound held-gear gates remain unchanged. Thus a current OFF reply retaining a v2 reverse state keeps its textual Reverse status while a pause is pending, and a new OFF load of a gear-bearing state also retains that status. Requested intent still clears; capability loss does not manufacture a forward or paused canonical state. Strict server readers require gear for v2 and exclude it for v1, so this is a suitable presentation discriminator for valid replies. No new authority is conferred by seeing it.

D1 and D2 from the prior review remain source-closed: the service bytes are unchanged from 676. Exact retained replay precedes clock/timeout/issuance writes after auth and context, and actual ON-to-OFF clears held legacy throttle as well as explicit gear intent. Inherited revision/sequence exhaustion L1 remains separately open; no evidence or scope was transferred to it.

The new test assertions at practiceIdentity lines 458–469 check `hasCanonicalGear`, computed status text, canonical state equality and eventual authoritative pause. They are useful setup/lifecycle checks. They do **not** demonstrate visibility: the harness at lines 64–74 explicitly replaces the component renderer with `render: () => null`. The assertion label “remains visible” therefore exceeds what this test observes. Do not cite its pass as rendered proof. Actual rendered verification must show the Reverse status with permission absent and pause pending, no direction selector, and the subsequently authoritative direction/status. Test initial OFF v2 load as well as loss, and a genuine direction-changing response in addition to the test's paused-but-still-reverse reply.

Exact SHA-256 pins:

| File | Pin |
|---|---|
| DrivingApp.vue | b08e09dfc72baae923438f48f4a0b983b8b2f0437789933b714932bc3a1e13b6 |
| practiceIdentity.test.ts | 3b6173241b941a7ee439df1b2d29de89225b9ef1fa908b927046c4869f2cd66d |
| server/living-world/driving-service.ts, unchanged | 7e7abcb72ddfe2dcbde041e6faaf48c51b336ec1e01e5bff07eded5329282b61 |

Other service/pure/types test and runtime pins remain the 676 pins. Supplied test counts are not independently executed proof here.

## Actual trusted host ports

The production route factory at `server/routes/living-world.ts:12` still calls `createDrivingService(ctx)` with no option. The candidate service at lines 148–155 supports `reverseGearIssuance?: boolean` and captures `options.reverseGearIssuance === true` once. Consequently ordinary Node and Worker routes remain OFF; tests that replace the route factory with a configured one do not prove real host configuration.

The existing teaching capability demonstrates the real composition:

- `server/server.ts:65–67,158–159,514–516`: optional boolean in `ServerOptions`, default false, conditional trusted `RouteContext` field. The normal entrypoint at line 771 calls `createServer()`; dev.ts also uses defaults.
- `server/types.ts:1137–1143`: startup `RouteContext` carries the host capability, separate from request/body/save types and ordinary public config.
- `deploy/cloudflare-worker.ts:242–243,366–373`: named optional Worker binding, strict equality with the literal string `'1'`, converted to a boolean in the context built once per object. This is host configuration, not a cookie or client capability.
- `wrangler.jsonc:10` contains only BUILD_ID in vars; no reverse or teaching activation is currently declared there.

Approve a narrow remote implementation contract using those exact ports:

1. Add `reverseGearIssuance?: boolean` to ServerOptions and RouteContext with a host-only comment. Normalize Node input using literal `=== true`, default OFF. Do not add a process.env fallback or accept `'true'`, `'1'`, numbers, browser state, saved rows or request bodies as Node option authority.
2. Add exactly one optional Worker binding, proposed name `REVERSE_GEAR_ISSUANCE?: string`, read once as `env.REVERSE_GEAR_ISSUANCE === '1'`. Only the host boundary translates that exact string to boolean; the service constructor still accepts only literal true. Omitted, `'0'`, `'true'`, whitespace and other values cannot enable it. Do not add an ON production vars entry, new secret, account tier, provider binding, or new arbitrary-variable injection mechanism.
3. In the shared living-world route factory call `createDrivingService(ctx, { reverseGearIssuance: ctx.reverseGearIssuance === true })`. Capture at construction; changing a later request or mutable options object must not enable an existing service. The route factory is shared by Node and Worker; keep one implementation. Qualification/evidence readers remain available independently of issuance.
4. Add real-host route checks through these host ports. A configured alternate test route alone is insufficient. Prove omitted/false/string Node options and omitted/invalid Worker bindings are OFF, literal true/exact binding `'1'` are ON, and capabilities are absent OFF on every relevant reply. Strict v1/v2 readers and existing-v2 OFF writers remain unconditional.

One cloud integration writer owns this four-file host patch: `server/server.ts`, `server/types.ts`, `server/routes/living-world.ts`, `deploy/cloudflare-worker.ts`, plus narrowly associated host tests. Serialize `server/types.ts` with household integration work; no concurrent shared-file writers. The UI worker need not modify any host, store or deployment settings. No authority or activation is implied merely by merging these default-OFF ports.

## Finite stage ports and original-store sequence

WORLD's current helper `world/tooling/serve-sealed-africa.mjs` is separately pinned `55f38b91528966dbb43dfc80274471de11fb010b2bc3dc66b9b4f2712d619f56`; policy `stage-capability-policy.mjs` is `af748ece4eccbb2a9dfc7ad9901a13b3d06d4afc1ef497c53bf140d74a51b5ef`. These bytes support only teaching starts. They cannot honestly claim reverse issuance from the game commit alone.

After the host patch is reviewed, WORLD alone should add an independently parsed `--reverse-gear-issuance 1|0` to the finite stage tool and its policy. Omission is OFF for every fresh/resumed process window; a saved ON checkpoint records history, not renewed permission. Emit only the named REVERSE_GEAR_ISSUANCE binding for explicit ON. Do not inherit arbitrary environment variables, overload teaching starts, alter sealed assets/package bytes, or introduce production flags. The existing teaching setting, fixed data store, restart, deadlines, source/package verification, process ownership and cleanup protections remain required.

Ready/control/restart evidence must include the requested/effective reverse setting, actual binding presence, fresh endpoint capability presence/value, game source SHA and package digest, exact helper/policy hashes, store/checkpoint identity and previous mode. A control file must never become authority to silently re-enable ON. Same-window restarts must preserve the explicitly granted setting and deadline; a new finite window must require explicit ON again. Changing ON→OFF uses a controlled restart on the same retained store and port under existing ownership rules. Do not change the running store path or synthesize a replacement original journey.

For Node, the real programmatic port is `createServer({ reverseGearIssuance: true|false, ...existingStageOptions })`. Use an explicitly reviewed finite Node stage launcher/harness, default OFF, which preserves its existing store and shutdown behavior. Normal `server.ts`/dev entrypoints should continue calling defaults. No current Node reverse CLI exists; do not describe the proposed launcher as implemented. Both Node and sealed Worker stage tooling need their own reviewed bytes and fresh capability observations.

Mandatory order before any actual v2 issuance:

1. Build/review/pin a compatible candidate OFF artifact for each host and its rollback package. Deploy/stage that OFF artifact first on the authorized retained store. Record existing actor, original school journey, score 0, home, wallet and receipts; read/operate untouched v1 safely. Verify capabilities absent and new explicit forward/reverse/mixed packets refuse atomically. A corrupt row remains untouched.
2. With compatible OFF artifacts and store continuity proved, explicitly authorize the finite stage ON setting. Verify actual endpoint capability, continue the same original journey through ordinary controls, and demonstrate reverse/braking on the native client. Do not call lesson restart, reset score, grant a qualification, edit state, or replace the actor to manufacture a pass. Record permitted packet and canonical server state; observe positive speed with reverse gear rather than heading teleport.
3. Stop/reopen the exact durable store with the pinned compatible OFF artifact. Prove the accepted v2 row survives, exact retained retry is nonmutating after timeout/clock scenarios, and OFF current/pause/resume/legacy forward packets work without downgrading row shape. New explicit gear remains refused. Distinguish the expected safe pause on GET/reopen from the nonmutating input replay requirement.
4. On the rendered desktop/mobile client, observe loss clearing all input and stopping production while preserving an in-flight packet; display canonical Reverse while the safe pause is pending; fence stale ON replies at the same revision; reconnect/reconcile before ordinary legacy driving. Include blur/hidden/disconnect/reopen, original-store continuity, and 48px keyboard/touch direction controls ON. Viewport emulation and physical-device evidence are different claims.

F3 remains mandatory: no C1/eec v1-only process or rollback may read a store after a durable v2 issuance. Disabling issuance is a supported v2 reader/writer mode, not a downgrade. Mixed deployment versions require compatibility before any writer enables v2. Actual Node/Worker durable reopen and rollback proof cannot be replaced with a fixture, source diff, setupValue assertion, or reported count.

## Remaining gates and limits

Actual final pinned Node/Worker host checks, full compiler/build/size/smoke, rendered/native journey, durable reopening, and OFF rollback artifacts remain missing from this review. L1 safe-integer exhaustion remains separately inherited and unresolved. Before any production activation, receive exact deployed identities, controls and rollback readiness under the original approval process; no tier/provider/secret changes are authorized now. This contract identifies the finite path to real permitted/refused/native evidence; it does not authorize execution by this reviewer, new paid resources, resetting the original school/home/wallet, or extending the existing deadline.

Host source pins at 44c: server.ts `c551d2a3f1b157b908cbc7ab6dc57d993019d43cf73494bb0f5cf9e49722d5e7`; types.ts `d391f5d9b16a5ae53b2cb67f4d01ffa7078095b224adf9eb214bdb0fe9d85b4b`; living-world route `5d2840b17d0d0abba4c5afa208296699b34d35a9e24dc2b65d1236c25fa4bd3d`; cloudflare-worker.ts `b53d611a9d3cf71c400a186eef8aa8c0495dce7df14c6623ada4ca42d68a6982`. These pins describe the unwired OFF state, not the proposed additions.
