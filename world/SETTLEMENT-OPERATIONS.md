# Selected place source: bounded operation

This is a separate builder source for selected city/town reference points. It supports a later compact orientation/label inventory; it does not establish real houses, navigation, official administrative containment or playable destinations. Nigeria remains the protected `legacy-ng` provider. No game/database/startup module changes are part of admission.

## Capture and repeat

Run from the isolated world worktree. Preserve its acquisition lock and source-family history:

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- node --experimental-strip-types world/settlement-acquire-cli.ts --cache-only
```

A fresh setup may omit `--cache-only` only after the exact `world/settlement-capture.json` metadata body is provisioned at its pinned local path. This CLI does not discover or refresh metadata. The candidate GitHub metadata must be independently checked and frozen before updating pins. No moving latest, alternate host or automatic retry is supported. Verified cache access remains available when source attempts or aggregate network allowance cannot fund a new request.

The fixed source is `geojson/ne_10m_populated_places.geojson` at Natural Earth commit `ca96624a56bd078437bca8184e78163e5039ad19`. Expected body: **19,359,003 bytes**; Git blob **376fb028c390a7a23213800ae4babaa6f534a0f3**. Metadata is **1,222 bytes**, SHA-256 **2b71dfe218d25c0d1adb926e32518cb499bc059c5d1b853a3a7ecc634b629896**, retained at `.cache/world-build/evidence/settlement-admission/source-api.json`. Its receipt records metadata traffic separately. Website release 5.1.2 is not assigned to this Git file or capture date.

`settlement-types.ts` freezes a 32 MiB source, 64 MiB family lifetime network, 64 MiB cache, 512 MiB sampled process RSS, 120-second remaining deadline, two lifetime attempts per immutable request, 512 cache entries/depth five, 512 KiB audit/64 records/8 KiB records, and a 100 MiB free-disk reserve plus operation headroom. This is a single local builder input, never a player download. Filesystem sync cannot be forcibly preempted; a final deadline check rejects a late caller result, even when durable source/receipt or a terminal row has already been written. Read the actual ledger before resuming.

Exact URLs, no redirects, identity encoding, admitted transport MIME, metadata SHA/blob/size, streamed byte count/Git blob, and an independent saved-file rehash bind the response. GitHub raw serves this `.geojson` as `application/octet-stream`; this transport is admitted with the same byte/hash checks. HTML is rejected. CLI exit 0 emits JSON, exit 1 emits bounded failure text. SIGINT/SIGTERM abort retains attempt evidence. Unknown/incomplete transfers keep the full expected body plus 64 KiB reservation; never reset, delete or reclassify them as zero.

## Actual acceptance — 8 October 2026

The first actual request rejected the unanticipated octet-stream header before body measurement. Its full **19,424,539-byte** unknown-transfer reservation and failed terminal remain. A zero-body HEAD verified HTTP 200, octet-stream, identity transport and the exact declared length; the reviewed adapter and fixtures were corrected without changing source identity, caps or history. The second/final allowed request captured **19,359,003 bytes**, raw SHA-256 **9b8e3de09048ef00dfc70357dbb9fa324493f214b5e0ae4daf1aa79a8d10116b**, with the exact Git blob. It took **13.78 seconds**, maximum process RSS **107,544,576 bytes** as measured by macOS `/usr/bin/time -l`.

Request identity: **42132340ed32bed7cf7be4b52f15d451eb81f235ceea042871e3b10f0117fc99**. Source/receipt live under `.cache/world-build/settlement-source-cache/`; its `network-audit.jsonl` is distinct from all country/Admin1/building/fine campaigns. Total charged source-family traffic is **38,783,542 bytes = 19,359,003 measured + 19,424,539 unknown reservation**. Two actual starts remain; no more capture attempts for this immutable request. Use the verified cache.

Retained evidence includes `settlement-capture-first.{json,stderr}` (failed; no success JSON), `settlement-capture-second.{json,stderr}` (success), and `settlement-admission/source-head.json`. Focused reviewed acquisition fixtures pass **24/24**, including observed octet-stream, HTML rejection, interrupted body cleanup and verified cache access after request/aggregate allowance exhaustion. Fixtures never touch actual output or accounting. Full-world TypeScript passes; an earlier root-added test syntax error was corrected and its failure logs retained. The final full world suite passes **389/389** after two older timing-dependent Admin1 fixtures were made phase-driven. No Admin1 runtime cap or production adapter changed. Full World TypeScript passes.

## Next product boundary

Admit only literal fields proven by the independent full-source audit. Bind every place to the exact source pin and accepted 258-map-unit parent manifest, preserve canonical source keys and ordinals, and account for linked/protected/unlinked/ambiguous/invalid rows. Do not join `ADM1NAME` by text or substitute ISO/name/case fallbacks. Coordinates come from exact source Point geometry, not display latitude/longitude columns.

Then freeze deterministic inspection, compact country-lazy publication and browser-reader interfaces before assigning narrow Luna owners. Keep proposed published output below 16 MiB aggregate and country index/point assets below 512 KiB; measure them before acceptance. Each layer remains separate from Admin1, terrain/climate sidecars and real building/road pilots. An inventory of selected points is neither all settlements nor a completed world. Nigerian lighting/lagoon improvements remain implemented separately; eventual combined game integration must remeasure startup and normal travel.

## Independent raw/schema admission

`settlement-sources.json` and `settlement-parent.json` freeze verified input/parent identities; `settlement-admission.json` binds the retained **50,711-byte** independent report, SHA **77759261a374d35a492783f910d815cb21f2e355f4988c759b050d65c5a18024**. The independent audit imports no compiler or inspector. It checks duplicate JSON keys, fatal UTF-8/nonfinite numbers, source bytes/SHA/Git blob, complete raw parent codes and pinned identity-sidecar hash, exact field/type/key distributions and point coordinates. It took **1,425 ms**, peak RSS **327,876,608 bytes**. It does not independently verify every parent hierarchy node; the separate parent-directory audit accepted the full 267-node identity chain.

Raw results: **7,342** features, all exact two-ordinate valid Points; **137** property fields; **7,342** unique, positive safe-integer literal uppercase `NE_ID` values, no missing/null/duplicate/invalid keys. Literal `ADM0_A3` is a three-character string for every row. Exact parent ADM0 code matching yields **7,257 linked points / 221 countries**, **68 protected Nigeria** and **17 unlinked** (`SJM` one, `SSD` 15, `TKL` one). **36** of 258 parent units have no direct source-code match. All source rows are conserved; nothing was reassigned, dropped or snapped. A South Sudan SSD/SDS discrepancy needs an explicit independently evidenced crosswalk; no ISO/name fallback is admitted.

`NAME`, `NAMEASCII` and `FEATURECLA` are strings for all rows; maximum UTF-8 lengths are 35, 33 and 22 bytes. `SCALERANK` is an integer 0–10. `ADM1NAME` is null on 119 rows and text on the rest, never a verified parent key. `POP_MAX` includes -99; `TIMEZONE` has 1,183 nulls. These raw fields do not establish a census, authoritative timezone or administrative containment. Coordinates must come from original Point geometry. Duplicate place names exist, including three different Londons in the representative audit; never identify or join places by name.

Read-only replay from the saved source and pins:

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- .cache/world-build/tooling/venv/bin/python3.12 -I world/tooling/audit_settlement_source.py
```

This standard-library tool emits one bounded JSON report on stdout, writes no files and uses no network. Redirect to a new evidence filename if retaining a replay; do not overwrite the original report named by admission. Elapsed/RSS fields vary between replays; compare the source/schema/count/key/country evidence separately. The cap and RSS units reflect the current macOS runtime, not a portable physical-device claim.

Actual cache repeat (`settlement-capture-cache-v2.{json,stderr}`) took **0.15 seconds**, maximum process RSS **125,353,984 bytes**, used **zero network**, returned the identical source/hash/request and left two actual attempts unchanged. Earlier cache/audit launch receipts show only a shared-heavy-slot timeout; no work or attempt occurred during those waits.

The tracked replay ran successfully and reproduced all source/schema/count/key/country evidence exactly after excluding variable elapsed/RSS fields. Replay SHA **7c2832094c4014c01bda8249d8403814aaf5f5c3acc13749ae6250395318ee4d**, 50,711 bytes; tool SHA **aaf7f80100edbf8058f30ce9d12240fb5850944f2e29e009fd7a8d5db22862f3**. `settlement-admission/cache-and-replay-verification.json` independently reconciles cache identity and the two original journal attempts/charges. The original audit hash remains unchanged.
