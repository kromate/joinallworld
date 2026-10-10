# Descending-stair contact evidence

## Source and host

- Host: `96cc63a2f9d2`; Node: `v24.19.0`; execution workspace: `/workspace/remote-verification/repositories/worker-graphics-stairs`.
- Frozen V9 worker checkout: `7dd846527b82ba3331400c996bd20dc9cff748e0`, clean and unchanged; `native-clip-solver.ts` SHA256 `9012d19e77633eebaf55b4287165805150b3e48c8118d209d5275adec4f37033`.
- Parent factory trial checkout used read-only: `coordinator-graphics-wiring`, initial trial commit `58922dc609e37f26c0af6ea0ddff71f9ebf76866`; parent later advanced it to manifest-only commit `644cbe79b4c315ff672b9ee2bb5f298a787efa18`. Factory bytes are identical at both commits, SHA256 `23d5de7eb5135d92dfecaa3fd0b79f5d45353f0b61a9f7b0b98f1a5cbd1ac757`.
- Model was requested as `gpt-6-luna`; shell tooling cannot independently attest the serving model.
- Test meshes reproduce the source-home stair flight with 24 actual `BoxGeometry` treads and actual duplex floor; parent transform `(1.1, .35, -.8)`, yaw `.41`, uniform scale `.9`; tile `10/12`, actor scale `.6`; body, clip, and shoe assets were reused (no downloads or purchases).

## Before and cause

The frozen V9 host reproduction used man, descending step 12, phase `.18`, with the original authored shoe and treads. It failed strict phase grounding: closest left sole gap `14.894675661380141 mm`, with no missing surface samples. External bundle instrumentation captured the *first failing stride solve* (`support=stair-feet`, `mode=transition`) and showed the actual host callback returned parent-local tread heights. The diagnostics then exposed the mismatch: the solver compared the minimum sole height against the maximum terrain height sampled under differently elevated vertices, ignoring each vertex's vertical offset from the sole minimum.

The actual first-failure record is in `current-v9-host-stair-diagnostic.json` (SHA256 `878771d39c4787c0338ae1fb8c8b93a96a03e91b3929fabcb144e15bd7be24c5`). Its exception stack ends at `solveAuthoredContacts → apply → sample → stride`; a later flat-feet solve is a rollback sample and was not used to diagnose the failure. The parent factory computes a point-offset-aware support target `contact.y + max_i(heightAt(point) - point.y)`, preserving its motion up-only rule and existing correction, penetration, reach, and sampling limits.

## Verification

All full-asset trials ran serialized through:

```sh
AGENT_SLOT_DIR=/workspace/remote-verification/agent-slots AGENT_SLOT_HEAVY=1 node --experimental-strip-types scripts/agent-slot.ts heavy -- node --experimental-strip-types /workspace/remote-verification/worker-results/graphics-stairs/RUNNER.mjs
```

The exact step-12 regression passed using `run-coordinator-factory-down-step12.mjs`. Its JSON output is `trial-coordinator-down-step12.json`, SHA256 `22e6369f4f16fbf9e4627aebf2640241a856c6c0d289f6af8ce262c616d424e1`: 144 sole points, no missing surface samples, left minimum signed gap `+0.221984 mm`, right minimum `+77.231 mm`, and no penetration over 4 mm. Artifact timestamp: 2026-10-10 00:11:49 UTC.

The corrected grid runner `run-coordinator-factory-grid.mjs` (SHA256 `dae9206caa749a23a4acd672b134814dd7a503fbcbb83c88418893f6a1bf019a`) passed 16/16 cases: both body families × both directions × phases `.18`, `.42`, `.68`, `.91`, on the same transformed actual stair meshes. Each case sampled 144 sole vertices, reported no host sample gaps and no penetration beyond the existing 4 mm allowance, and had at least one point within 4 mm of a tread. JSON: `trial-coordinator-family-direction-phases.json`, SHA256 `db7851a9dfae0c52bb7799b21370cb56e2cc5b30a6ab3a12ec70603759e85fbc`. Artifact timestamp: 2026-10-10 00:14:48 UTC.

The explicit both-soles-below case used the same actual descending tread and lowered the placed actor 200 mm before the stride solve. Both soles began below their local supports (left `-201.365 mm`, right `-59.866 mm`) and ended clear (left `+0.222 mm`, right `+77.231 mm`). JSON: `trial-coordinator-both-below.json`, SHA256 `a84282c05701b6e8cf7b0a92d0acb4b9ba93c35b806c2b11f451a8f6ae9f994b`. Artifact timestamp: 2026-10-10 00:14:30 UTC.

A separate constant-floor identity check covered three floor heights and tilted point sets; the new target equals the previous flat-floor target exactly in all cases. JSON: `flat-floor-identity.json`, SHA256 `dde2b42fca4a12f7154c821e131b1539ce5070599b12d86cc8a8844e2f52df80`.

An independent artifact assertion command exited 0 and confirmed the 16 grid cases, 144 points per case, both-below precondition and postcondition, original step-12 regression metadata, and all three flat-floor identities. The initial grid invocation completed the tests and wrote its JSON but exited 1 in external report formatting (`factorySourceSha256` referenced an undefined local after test completion). The runner-only typo was fixed; the unchanged assertions then completed in the clean 16/16 run above.

No phone FPS or production acceptance is claimed. This worker made no source edits, commit, or push; the parent owns the tested factory patch.
