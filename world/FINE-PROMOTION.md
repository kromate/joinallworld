# Bounded administrative source promotion and preparation

This stage prepares exact reviewed administrative inputs before the cache-only fine compiler. It runs only in the isolated world worktree; no game data, Nigeria identity, saves, routes, catalogue or database is written. A prepared country is administrative geography, not a playable destination. Current full-denominator compile acceptance is Rwanda and Djibouti; Namibia remains a source exception.

## Admission and source evidence

`fine-promotion-types.ts` freezes policy `natural-earth-public-domain-local-ingestion-v1`. `fine-promotion-load.ts` verifies the hash-addressed 258-unit catalogue, complete country directory and frozen full metadata snapshot before `fine-promotion.ts` rechecks the selected original row. The request binds the exact parent directory/catalogue hashes, full metadata SHA/length, original row ordinal/SHA/length, country ID/code/ISO/name, layer/type/year/build/count, full 40-character commit and exact raw GitHub pointer URL. The selected row is canonicalized without changing its original fields. The published pin records that row's hash, while the request retains the complete snapshot identity; the existing pin metadata ceiling is unchanged.

Only Natural Earth originals with public-domain metadata and the official terms URL are admitted under this first policy. Nigeria and Ghana are explicitly excluded, including at pointer-request validation. [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/) identify its vector/raster data as public domain. The [geoBoundaries API](https://www.geoboundaries.org/api.html) distinguishes its gbOpen package attribution from original boundary-license metadata and describes immutable GitHub archives. Pins retain original-source evidence, gbOpen CC BY 4.0 package attribution, represented year/build date and a source-depiction boundary policy. Neither a URL nor a license string proves political correctness, complete coverage, or readiness for distribution.

The actual pilots use full commit `9469f09592ced973a3448cf66b6100b741b64c0d`, consistent with the frozen discovery row's short commit. The metadata snapshot is 350,392 bytes, SHA `3c742bab8428c987437e48dc5a9a6df826d5b47d3e06c613356733bd4ce3da98`; catalogue is `dda57deffe7d09612a9595aedba4f7378821d328d2111039906854dd1d702a4a`; directory is `b3fb51b5660ed22b2ee354235c60291d6857b3dd9245afbabec3fc15918c8501`. The snapshot was captured on 8 October 2026, but source build dates are December 2023 and represented years are older; capture time does not make the geography current.

## Stages and limits

1. Validate explicit selections in a named `world/*.json` configuration (64 KiB, 1–16 unique countries, exact keys and full commits). Inspection performs no downloads.
2. Capture one canonical Git LFS pointer from an exact full-commit URL. `fine-lfs.ts` requires the supported three LF-terminated lines, fatal UTF-8, positive canonical size and exact SHA-256; extensions fail closed. `fine-pointer-acquire.ts` rejects redirects, compressed bodies, unexpected response URLs and missing/invalid lengths before reading. The pointer receipt distinguishes the pointer body's hash from the geometry target SHA/length.
3. Publish immutable original-row/request/pin/admission artifacts under `.cache/world-build/fine-promotions/`. Admission reports intentionally say geometry/topology are not yet verified; preparation evidence describes later stages.
4. `fine-prepare-run.ts` durably claims a request-hash job, captures or verifies the exact geometry through `acquireFineSource`, runs existing supervised planar topology, and calls the pure fine inventory compiler to prove source feature count, identities and geometry limits. Only qualified results appear in `prepared`.
5. The coordinator independently reviews qualified evidence and explicitly adds pin/topology paths to a separate compile registry. Preparation never silently rewrites `fine-campaign-sources.json` or automatically admits all discovered sources.

| Resource | Enforced ceiling |
|---|---|
| Pointer body / transfer duration | 4 KiB / 30 seconds |
| Aggregate lifetime pointer network | 64 KiB across requests |
| Pointer cache / audit | 256 KiB each; audit 128 records |
| Geometry source / per-source lifetime network | 8 MiB each |
| Aggregate lifetime geometry network | 64 MiB across source SHAs |
| Geometry cache / audit | 40 MiB / 2 MiB, audit 512 records |
| Promotion output | 2 MiB, 128 entries, depth four |
| Preparation state / database | 2 MiB, 128 entries, depth four / 512 KiB |
| Preparation session / jobs | 120 seconds maximum / 1–16 claims (default two) |
| Preparation lifetime attempts | Two per immutable request; verified source-count mismatch is terminal immediately |
| Fine geometry | 32 units / 150,000 positions |
| Free disk / preparation RSS | 100 MiB plus write/download reserves / 512 MiB |

Pointer and geometry transfers reserve allowance durably before network access. Unknown or interrupted transfers keep conservative reservations; measured overshoot is retained rather than capped away. Reservations, malformed audits, partial records, symlinks and quota exhaustion fail closed. Cache-only repeats never reset accounting. Verified cache hits remain readable when transfer quotas are exhausted. Geometry's new aggregate budget does not alter old city-campaign accounting or permit Fiji retries.

Preparation uses its own owner/token lock and durable SQLite lease ledger; acquisition/publication use the existing shared lock only for their own stages. Locks are not nested around the whole campaign. State/database/WAL/temporary-publication growth and free-space reserves are checked. Completed resumes revalidate request, pointer, pin, source, topology report and pure inventory without rerunning the topology child. Corruption is preserved for diagnosis. Transient attempts retry after 60 seconds within lifetime limits; verified immutable count failure terminalizes the live lease without pretending unused attempts occurred. A future version requires a new request identity, not a ledger reset.

## Actual first/repeat pilots

| Country | Pointer bytes | Geometry bytes | Metadata count | Verified result |
|---|---:|---:|---:|---|
| Djibouti | 130 | 15,132 | 6 | Six source regions; all planar-valid; admitted |
| Namibia | 131 | 170,117 | 14 | Actual 13 features; terminal source-count mismatch |

Total new measured response-body traffic is **185,510 bytes** (261 pointers + 185,249 geometry), with zero unknown transfers. These are body measurements, not estimates of total wire traffic. First pointer repeats, later preparation resumes and fine campaign repeats use zero network.

Djibouti geometry SHA is `797fdc48fb9176f33134a279e4cac3436ec190af3340c5a76ee887321137235e`. Its fine manifest `f25fa2cb8f9502d799f64ab2f0e70cb05eac0d89e545737af15a26b7ee7f3e42` contains Arta, Tadjourah, Obock, Djibouti, Dikhil and Ali Sabieh: six exact source regions, 312 positions, 22,603 logical bytes in 11 referenced files. Independent reconstruction verifies full geometry, source keys, stable IDs, asset hashes and unchanged old Rwanda/directory hashes. The planar report has six valid, zero invalid/unsupported; this does not establish spherical validity or boundary correctness.

Namibia geometry SHA is `f68d643fc2f030809de3a38fb85a78212cf0d38911d150e8521201a0d0c6441d`. Its 13-feature source includes unified `Kavango` and `Caprivi` labels. [Ohangwena Regional Council](https://ohangwenarc.gov.na/about-the-region) describes Namibia as having 14 regions and names neighboring Kavango West. The inference is that the captured source does not match its claimed 14-unit coverage; the exact source-count discrepancy alone is sufficient for rejection. Do not infer fidelity from the metadata's represented-year field, invent a missing region, or change the expected count to 13. Research a new, matching, license-reviewed source/metadata version and retain this terminal evidence.

Djibouti has one preparation attempt. Namibia's first run encountered the mismatch before permanent classification was implemented; its next cached claim terminalized it. The real ledger therefore honestly retains **three total attempts**, one completed/one failed/zero pending. A subsequent cache-only resume keeps all three, performs no network or topology child, and reports no new attempt failures. New identical immutable mismatches terminalize on their first actual attempt.

The separate `fine-campaign-africa-pilots.json` registry includes unchanged Rwanda plus qualified Djibouti. First/repeat compile reports are identical: **258 units, two compiled, 255 exceptions, one protected Nigeria, zero pending/network**. Plan `bba0a6130e1e22b1d6f0125e1872ebd866036d6f8bb08ddbc85ff33b40b58eb6`; report `83b869ac660f26490e89dc9f90022e565657445fcb5f7dfa5d6c0f006acd97df`. Namibia is still a generic unreviewed-source row in the compile plan because it has no qualified input; preparation evidence provides its detailed mismatch. A terminal queue is not worldwide completion.

## Commands and recovery

Run from `/Users/anthonyakpan/.codex/worktrees/world-foundation/joinallworld`. Inspect before an explicitly selected capture. Capture downloads a pointer only; preparation may download admitted geometry unless `--cache-only` is supplied.

```sh
node --experimental-strip-types world/fine-promotion-cli.ts inspect world/fine-promotion-sources.json
node --experimental-strip-types world/fine-promotion-cli.ts capture world/fine-promotion-sources.json DJI
node --experimental-strip-types world/fine-promotion-cli.ts cached world/fine-promotion-sources.json DJI
node --experimental-strip-types world/fine-prepare-cli.ts world/fine-promotion-sources.json --max-jobs 2 --duration-ms 120000
node --experimental-strip-types world/fine-prepare-cli.ts world/fine-promotion-sources.json --max-jobs 2 --duration-ms 120000 --cache-only
```

The final command now verifies the completed Djibouti result and reports the retained Namibia terminal failure. A successful process exit means the bounded run produced its report, not that every country succeeded. Check `prepared`, `failed`, `pending`, attempts and network fields. `prepared` and `pending` describe the selected configuration; `failed` retains terminal ledger history (deduplicated by country), and `attempts` totals the lifetime ledger, including older versions. A replacement version does not erase its prior failure. `networkBytes: null` means an operation lacked exact transfer accounting; consult durable audits rather than treating null as zero.

Use the reviewed compile commands in [FINE-CAMPAIGN.md](FINE-CAMPAIGN.md). For another batch, freeze a new explicit selection configuration and independently reviewed compile registry. Old terminal preparations may coexist, but unselected queued/leased jobs require resolution before another configuration is claimed. Do not delete ledgers/audits, reset budgets, retry excluded sources or weaken limits to make a batch pass. Remaining aggregate capacity and state reserves must be checked before scaling. The two-minute runner is resumable, not an installed two-day supervisor; session closure or sleep stops active agent work.

## Validation and next work

All **285 integrated Node tests** and full world TypeScript pass. Isolated fixtures cover strict joins/configs, pointer deadlines and overshoot, stale reservations, corrupt/partial audit, aggregate exhaustion, cache reuse, symlinks, abort/lease recovery, immutable count failure and completed-output tampering. Tests do not mutate the actual build ledger. The unchanged client graph retains its previously accepted preview build; this checkpoint did not rerun that build.

Evidence in `.cache/world-build/evidence/`: `fine-promotion-all-tests.tap`, `fine-promotion-final-typecheck.*`, `fine-promotion-independent-verification.json`, `fine-preparation-{first,terminal,repeat}.json`, `fine-africa-pilots-{first,repeat,independent-verification}.json`. Browser at actual 586×804, document width 586, verifies six regions and visually inspects Arta with zero console errors; `djibouti-arta-preview.jpg` captures that outline. No playable-city, physical-device or worldwide-detail claim follows.

Next: another explicit African admission batch within remaining quotas; reviewed replacement Namibia data; distinct over-limit partition product; deeper settlement coverage; terrain datum/environment attachment; bounded persistent supervision; physical-device/soak checks; separately tested gameplay integration. Nigeria's accepted visual upgrade remains on `codex/nigeria-rendering` with future sourced buildings/roads and licensed photorealism attached through the adapter, preserving existing identities and saves.
