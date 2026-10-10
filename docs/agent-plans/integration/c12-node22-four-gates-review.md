# Exact-c12 Node 22 four-phase receipt review

## Pins and evidence integrity

- Receipt publication: `8774dc3b85a78d32df5922fe9ccf5ca590d0a175`, tree `af150f0081dce304d774d546497880e28dfdd7b1`, parent `1fb6fd64308eb64fa7db8038e562d96623c94689`.
- WORLD review: `d6d8c2ee8b5e3168820e9f9268791e0f31814ec6`, tree `b1f9df41efe80edf32f3cb2f96c60c5623f17e86`.
- Every receipt names exact source `c12b8ebd83cd301475fb1d7bf9e143af260d6621`, parent `0a5e2983126e3dac406af1c3a121e9cbfef78feb`, Node `v22.23.3`, npm `11.9.0`, `AGENT_SLOT_HEAVY=1`, and `allowance_guard_at_start.heavy_slots=1`.

Independent SHA-256 recomputation matches all eight WORLD phase pins:

| phase | receipt SHA-256 | command-log SHA-256 | exit |
|---|---|---|---:|
| `node22-compiler4096` | `33a62bc7b3d64595bf1a7d1d263582901e5179e5dcec89ef6e91173adf4669e6` | `12565987d4bb68da8e9dc4338783ab59f36dcce1a853016fb25e1614e03d51d1` | 0 |
| `node22-build` | `4c36e8d72612108394106e6840a2898957daf79328ae95c1bb24780812899572` | `11f7f6c6f6e10328797f89b1bda0edd863ec96933c3c3389c5d11cefc8bac13c` | 0 |
| `node22-download` | `d941c9cec57b77e7d9e68de6fcbeeacac91801ba80170862f5dc1812c057915b` | `0895e3c75190956c48da3422509b2559e59d2290902ec97b771ef274fd33fef9` | 0 |
| `node22-smoke` | `e85b3fec173a2f4624b701fc7cabfd3ae34f29c3b92184eb401a153a150d94f1` | `88fd176ae95ba1765471a2a7ae5b5ac0c24bc4ae03b08a3992049ee05117edb1` | 0 |

## Phase results

### Compiler

- Exact command: `node --experimental-strip-types scripts/agent-slot.ts heavy -- npm run typecheck`.
- The phase name alone is not heap evidence. The actual receipt environment explicitly records `NODE_OPTIONS=--max-old-space-size=4096`, so this compiler phase used a 4,096 MiB old-space cap. The other three phases record 1,536 MiB.
- Result: `Typecheck clean: 5 projects, 0 errors in .ts and .vue, 0 baselined in existing JavaScript.` Wrapper duration is 161.176580 seconds.

### Build

- Exact command: `node --experimental-strip-types scripts/agent-slot.ts heavy -- python3 /workspace/remote-verification/lease-phase-guard.py npm run build`; old-space cap 1,536 MiB.
- The log reports **2,130 modules transformed**, not 2,135, and `✓ built in 59.02s`.
- Receipt wrapper duration is 153.908229 seconds. These are different clocks: the wrapper includes heavy-slot waiting, the lease guard, prebuild/preflight/catalogue checks, and Vite; 59.02 seconds is Vite’s reported build interval.

### Download budget

- Exact command is the same guarded envelope with `npm run size:download`; old-space cap 1,536 MiB; wrapper duration 97.756403 seconds.
- All ten measured gates pass; two unmatched asset gates are n/a:

| gate | measured | budget | margin |
|---|---:|---:|---:|
| loading raw | 91,469 | 92,000 | 531 |
| loading gzip | 35,568 | 37,000 | 1,432 |
| first-paint Brotli | 35,693 | 36,800 | 1,107 |
| startup raw | **614,258** | 615,000 | 742 |
| startup gzip | **222,677** | 223,000 | 323 |
| startup Brotli | **195,402** | 195,600 | 198 |
| scene-host raw | 177,152 | 192,000 | 14,848 |
| scene-host gzip | 66,031 | 71,000 | 4,969 |
| base-body Brotli | 138,098 | 300,000 | 161,902 |
| clip-pack Brotli | 55,111 | 200,000 | 144,889 |

Wardrobe-item and street-tile Brotli are n/a because no matching files exist. Startup is measured over all 55 cities; Lagos is largest. First paint has 5 files and Lagos startup has 28.

### Smoke

- Exact guarded command ends `npm run test:smoke`; old-space cap 1,536 MiB; wrapper duration 4.056737 seconds.
- TAP result: 15 tests, 15 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo; test-run duration 2,675.421914 ms.
- The log enumerates automatic startup raw/gzip values for all 55 admitted cities, including all 15 foreign cities.

## Provenance and acceptance boundary

All receipts record matching `head_after`, empty `git_status_after`, `source_unchanged=true`, no signal, and no hard stop. However, every `source_pins_before` and `source_pins_after` map is empty, and no `head_before` or `git_status_before` field is present. The evidence supports an exact clean recorded after-state, not per-file before/after pin parity or an independently recorded clean before-state.

These originals support acceptance of four exact-c12 Node 22 phases: compiler, production build, download budget, and smoke. They do not replace or expand the earlier focused 125-test evidence. They also do not remove the previously recorded full-host result of 1,027 tests / 1,024 pass / 3 known skips. Full game/UI/release/native/deployment acceptance remains separate.

No command, test, build, install, network operation, compiler, or metadata/source mutation was performed locally.
