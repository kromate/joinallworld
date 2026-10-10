# c12 cloud package root-metadata review

## Evidence pins

- WORLD metadata commit `d559946e030c79ea5df21e4ea1bad89e05897fd2`, tree `a36276797be9cf6dbae7df0219f05c34752a8c99`, parent `94079eed212d521aab6b7dd748db94a3459f00b3`.
- Public receipts commit `1fb6fd64308eb64fa7db8038e562d96623c94689`, tree `a0d8af7b3f97e075482e4806734b7a5988cebb11`, parent `9d165a7e089c1299a9d90375a951d054ec29248e`.
- Package source `c12b8ebd83cd301475fb1d7bf9e143af260d6621`, parent `0a5e2983126e3dac406af1c3a121e9cbfef78feb`.

Raw SHA-256 of the reviewed public metadata blobs:

| file | SHA-256 |
|---|---|
| `world/c12-cloud-package-comparison.json` | `1f0211ed8abd362a652d4b36677850b548ae5e84ccab01fbe864d975c16d2b1d` |
| `world/c12-worker-build-layout-diagnosis.json` | `e9d03b14d238b30aa2d18cf75be32e81f85b810a0cb2635272bc82d56ec4d87f` |
| `world/c12-sealed-public-file-index.json` | `48e2ad7b6e1dc87a34416ccdd506b2c78fa58fd261b41c287f5e747441aa2e55` |
| independent `manifest.json` | `86aa7c726f5cb735fa0519e3681c703738daddfcaa3b3a2d239a773949483aa9` |
| independent `provenance.json` | `20569e31fc21137528165552e7504878d5e5f4fc364768aaa26dc94e022a1b18` |
| retained-package `receipt.json` | `b777a5cbcb2679e23e397b95a899e91854a6e2c3e41c179008d49b0d97619b57` |
| retained-package `command.log` | `289c1317da527c9955767be441c16305bca0560dd973a880b47789f3a4cdd85d` |

The manifest and command-log hashes recompute exactly to their recorded values.

## Full ordered metadata comparison

The sealed index and independent manifest each contain 6,227 unique payload paths. Their path arrays are identical in both set and exact order. Every row has exactly `path`, nonnegative integer `bytes`, and a lowercase 64-hex `sha256`.

- 6,226 payload rows have identical path, byte count, and SHA-256.
- The sole changed row is index 6,225, `worker.js`:
  - original public: 4,851,144 bytes, `fd7fa978cda473d67bdf5c006bcb3289b901180cdfd9123c49bb405fc976fbf4`
  - independent cloud: 4,846,908 bytes, `443f113d0070ba6d3df6dd52ba8204a479011b10b0592e275893c2ffc021839b`
  - difference: **-4,236 bytes**
- Original payload sum: 102,339,028 bytes. Independent payload sum: 102,334,792 bytes.
- Both manifest files are 1,416,390 bytes. Original manifest SHA-256 is `d5a3b4e5dd80be8dc57a0296e9af4b7898ff23c7875aeedf342b879b6e94a314`; independent manifest SHA-256 is `86aa7c726f5cb735fa0519e3681c703738daddfcaa3b3a2d239a773949483aa9`.
- Each package therefore has 6,228 physical files including its manifest. Original total is 103,755,418 bytes; independent total is 103,751,182 bytes, also -4,236.

This directly corrects the earlier provenance fields `original_files=6228`, `file_count_difference=-1`, and `total_file_bytes_difference=-1420626`, which compared payload-entry counts with physical-file counts. The later comparison metadata records the corrected equal file count and -4,236-byte total difference.

## Digest and source contract

- Original package digest recorded by the sealed index: `3a018ad0bd2b7325360a9aeff607f0331610e2e22c6b42081fdb7dd4175a4331`.
- Independent package digest recorded consistently by provenance, command log, and WORLD comparison: `28e4f93df5e608b63d3d862173b03b418d70c141803de7f69a6ed836ffb5030d`.
- Independent manifest contract metadata is `sourceSha=c12b8ebd83cd301475fb1d7bf9e143af260d6621` and `publish=false`.
- WORLD says the latter digest was recomputed from actual published file metadata using the pinned guard. The allowed evidence includes only the guard source hash, `9d0af289e2e0699dbd63011c300721ad58bff46a550e5d5950215b731ed61c8e`, not the algorithm source or payload bytes. I verified every digest input exposed by the two manifests, but did not execute the guard; an independent algorithm-level digest recomputation is therefore not claimed here.

The Worker diagnosis attributes the exact 4,236 bytes to 353 removed `game-source/` prefixes on ESM initializer keys, and its predicted normalized Worker hash equals the independent Worker hash. That is diagnostic metadata, not proof of normalization semantics or acceptance of new payload bytes.

## Tool recipe, retained output, and provenance limits

- Outer receipt command: `node --experimental-strip-types scripts/agent-slot.ts heavy -- python3 /workspace/remote-verification/package-c12-independent.py`; Node `v24.19.0`, npm `11.9.0`, 1,536 MiB old-space cap, one heavy slot, exit 0, duration 223.494209 seconds.
- Inner recipe: `node scripts/package-joinallworld.mjs <source-checkout> <independent-output> c12b8e… false <deploy/tooling>`; exit 0, duration 1.276827671 seconds.
- Method explicitly packages the retained exact c12 `dist`; it is not a fresh game build and not a GitHub artifact download. `original_transport_forbidden_retained=true`; no alternate artifact retrieval is recorded.
- Retained build raw-log SHA-256: `35602fc7962f5527f4a1a534ea98831b667b32baaafe6bcf93c46bcfcecc114f`. Provenance records 6,225 retained `dist` files and an unchanged census.
- Source pins record `package.json=ff2e40d7…145d9`, `package-lock.json=d3a82d0f…efa9`, tooling package/lock `caea42b0…ce21` / `9bb2971f…e98`, Worker JS/TS `4e8d3324…225d` / `a36e7587…7093`, package tool `8fe11772…cef1a`, and guard tool `9d0af289…61c8e`. The receipt itself has empty `source_pins_before/after`; detailed pins live only in provenance.
- Receipt and provenance record `head_after=c12b8e…`, empty status after, and `source_unchanged=true`. They do not record head/status before. The original build receipt has no historical per-file dist census, so retained-output attribution remains bounded by the stated filenames/mtimes, raw-log hash, source pin, and clean after-state.

## Result boundary

The metadata comparison verifies equal ordered path inventory, 6,226 unchanged payload records, and one 4,236-byte Worker difference. It does not establish actual new payload bytes, run the on-disk guard, prove package policy/config/path types, inherit the original seal, prove browser journeys, or accept any deployment. No Artifact Forbidden workaround appears in the reviewed recipe.

No tests, guard, build, compiler, artifact download, browser, or source mutation was performed locally.
