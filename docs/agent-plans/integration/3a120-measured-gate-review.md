# 3a120 published measured-gate receipt review

## Public pins and reviewed evidence

- Publication: `1fb6fd64308eb64fa7db8038e562d96623c94689`, tree `a0d8af7b3f97e075482e4806734b7a5988cebb11`, parent `9d165a7e089c1299a9d90375a951d054ec29248e`.
- Measured source: `3a120c8e6d335488472cc9018a4f978b0e7ab56a`, tree `98df07ec74299478eaa6c98997947dbe906fded5`, parent `3e3e0876fc50f3166a0d0968f8616b577da27870`.
- Reviewed only the four public `receipt.json` and `command.log` pairs under `docs/agent-plans/cloud-receipts/2026-10-10/world-3a/` in the publication tree. The receipts reference no source manifest: both `source_pins_before` and `source_pins_after` are empty objects.

## Execution identity

All four receipts name source SHA `3a120c…`, its parent `3e3e08…`, branch `codex/cloud-lagos-flights-startup-budget-20261010`, the existing Codex cloud `/workspace` environment, and declared escalated execution mode. Builds ran under Node `v22.23.3` and `v24.19.0`, npm `11.9.0`.

The exact command envelopes were:

- Build: `node --experimental-strip-types scripts/agent-slot.ts heavy -- npm run build`
- Size: `node --experimental-strip-types scripts/agent-slot.ts heavy -- npm run size:download`

Every receipt records `NODE_OPTIONS=--max-old-space-size=1536`, `AGENT_SLOT_HEAVY=1`, and `allowance_guard_at_start.heavy_slots=1`. This proves a single heavy-slot gate. No receipt or command log contains a `maxWorkers` field or argument, so literal `maxWorkers=1` is not independently evidenced.

## Receipt and log integrity

| Receipt | Node | exit | duration | command-log blob | recomputed SHA-256 |
|---|---:|---:|---:|---|---|
| `lagos-compact-node22-build` | 22.23.3 | 0 | 62.373381s | `89ac16408f4747a311f8ea700d391720cdd96aea` | `1d450e166fe3cd7e84d77ef5cd04b26174efc8d59e10bcf4dfa3468c66498899` |
| `lagos-compact-node22-size` | 22.23.3 | 1 | 111.148231s | `fe7a67e8ba73c62cba98e4c2f2d64d4d20229882` | `09b1b5876bafebc56b64e00e7f26d1b51d664712e09a9dcd7b50c810b7bbe46e` |
| `lagos-compact-node24-build` | 24.19.0 | 0 | 104.181968s | `333183faa87c88f43ffb4042e2a0b89dc8401882` | `15c990bd2ae3dd7fca163582073c8ecde2c7765191a1985b3d124ff4981eff43` |
| `lagos-compact-node24-size` | 24.19.0 | 1 | 191.036955s | `ffaaac1194c4cc1d0a7af496204bcc42b17fe513` | `1aebeb85ca9b20f9a049901e4ae93f9a7962b5194e715d356f905a86dc46b84e` |

Each recomputed log hash exactly matches its receipt. Both build logs report 2,135 modules transformed and a completed Vite build. Exit totals are two zero exits and two nonzero exits; there are no test-case counts because neither command is a test command.

## Cross-runtime measurements and gates

Node 22 and Node 24 logs are identical for every budget measurement:

| Gate | measured | budget | result |
|---|---:|---:|---|
| first-paint JS raw (`LOADING_RAW`) | 91,469 | 92,000 | pass |
| first-paint JS gzip (`LOADING_GZIP`) | 35,569 | 37,000 | pass |
| first-paint total Brotli | 35,699 | 36,800 | pass |
| startup JS raw | 614,092 | 615,000 | pass by 908 |
| startup JS gzip | 222,987 | 223,000 | pass by 13 |
| startup total Brotli | 195,739 | 195,600 | **fail by 139** |
| scene host raw | 177,152 | 192,000 | pass |
| scene host gzip | 66,028 | 71,000 | pass |
| base bodies Brotli | 138,098 | 300,000 | pass |
| clip pack Brotli | 55,111 | 200,000 | pass |
| wardrobe item Brotli | unmeasured/no matching file | 60,000 | n/a |
| street tile Brotli | unmeasured/no matching file | 60,000 | n/a |

The startup maximum is Lagos over all 55 cities. The summary covers 5 first-paint files and 28 Lagos-startup files. Each size log ends `1 budget(s) exceeded: STARTUP_BROTLI`, consistent with receipt exit 1. Gate counts per runtime are 9 pass, 1 fail, and 2 n/a.

## Provenance gaps and conclusion

- Receipts record `head_after=3a120c…`, empty `git_status_after`, and `source_unchanged=true`; this supports a clean, unchanged after-state.
- They omit `head_before` and `git_status_before`. Clean-before cannot be verified from these originals.
- `source_pins_before` and `source_pins_after` are empty. No source-file paths or content hashes are recorded, and no source manifest is referenced. The fetched Git object verifies the source commit/tree pin, but these receipts do not prove per-file source hashes.
- The evidence proves two successful cross-runtime builds and two reproducible size-gate failures. It does **not** support a measured-pass or source-integration acceptance for `3a120c…` because `STARTUP_BROTLI` remains over budget in both runtimes.

No build, test, compiler, browser, server, or Git mutation was performed for this review.
