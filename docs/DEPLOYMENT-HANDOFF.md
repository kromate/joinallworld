# Deployment handoff — 8 October 2026

## Production deployment completed — 8 October 2026

Deployed source **`75d481cc9e8f4fe214485c9e2622f61061861e84`** to `joinallworld-next`. Cloudflare version **`aa48a416-2356-419d-a077-e82c29fac45d`** was deployed at 00:42:16 UTC; public `/api/health` subsequently confirmed `joinallworld-75d481cc9e8f4fe214485c9e262` (the runtime truncates build IDs to 40 characters). The public Durable Object took several minutes to adopt the release after the frontend assets propagated.

- Release tooling type checks and source allow-list were repaired in `dc48d3f6`; CI passed. A first upload was rejected because no-bundle module discovery included static street-pack files. `75d481cc` disables rebundling and additional module discovery in the sealed configuration; CI passed for this final release too: https://github.com/kromate/joinallworld/actions/runs/37709089940.
- Cloudflare accepted the final package: 4,397.90 KiB Worker / 1,704.29 KiB gzip, **184 ms startup**, 5,844 static asset files. Package guard: 17/17; source smoke: 15/15; focused reliability: 46/46; Worker release checks: 5/5; build and download budgets passed.
- Existing `JOINALLWORLD` SQLite namespace `6b84e715f6c444f69971a0b6cde7868b`, class, migration and all existing provider bindings/secrets were preserved. No data restore or namespace replacement occurred.
- Pre-upgrade UTC recovery reference: **2026-10-08T00:41:54.381Z**. This is a reference, not an executed backup. After public propagation, the same synthetic session identity, ₦5,000 balance and duplicate-action receipt passed continuity checks.
- Final live smoke passed **9 checks / 282 requests**, including WebSocket, action replay and 201 city chunks across 40 cities. A browser guest reconnected, retained its name/balance, and loaded Messages after a fresh reload.
- Local evidence: `/tmp/allworld-production-deploy-final.log`, `/tmp/allworld-production-smoke-final.log`, `/tmp/allworld-deploy-guard-python.log`. Synthetic credentials remain private in mode-600 `/tmp/allworld-release-continuity-private.json`; never publish that file.

The historical handoff below describes the state before this deployment. Its roadmap and unverified physical-device/full-suite limitations still apply.

## Historical pre-deployment state

Use **https://github.com/kromate/joinallworld** for source AND releases. Do not use `kromate/v1-allworld`. That repository formerly held the deployment policy; the reviewed policy and pinned tools are now copied into this repository.

All combined gameplay and reliability work was merged through PR #19, merge `4b883d99399eb0d47f86d8f42678b3af1e61d80f`. This follow-up adds the startup correction, self-repository release workflow and this handoff. Use the actual current `origin/main` SHA, not the earlier merge SHA.

**At the original handoff, the new release had not reached production.** Last verified public `/api/health` still reported `joinallworld-4832b7e7507914db8a4d721a7f6`. Release run https://github.com/kromate/v1-allworld/actions/runs/37705444185 passed packaging but Cloudflare rejected upload with error 10021, “Script startup exceeded CPU time limit.” No data restore or namespace replacement was performed. The user requested that another agent perform deployment; this task stopped deployment work at handoff.

## Startup correction

`src/campus/unilag/shuttle.ts` eagerly constructed the full campus walk grid at module import. The CPU profile concentrated time in polygon/grid work. The grid is now created once, on the first valid shuttle-route request, and cached. Route geometry and fare logic were not changed.

A local Wrangler startup profile after the correction reported about 102 ms active time. This is local evidence, not Cloudflare acceptance. The preceding deployed-package diagnostic showed about 637 ms locally and exceeded Cloudflare's limit. The profiles used different bundling paths, so do not present them as a controlled percentage improvement. Re-profile the exact final sealed bundle if necessary.

The focused shuttle suite passed 3/5. Remaining failures: a road/bounding-box assertion for `osm-way-216470248` crossing `central-mosque`, and exact floating-point endpoint equality (`-168.28999999999996` versus `-168.29`). These do not demonstrate a lazy-initialization regression, but their baseline status was not established in this pass. Do not claim the full shuttle suite passes.

## Verified before the startup correction

- Typecheck and 86 focused reliability checks passed.
- Engine contracts 26/26 and affected home/protocol checks 52/52 passed.
- Source smoke 15/15 and exact Worker release checks 5/5 passed.
- Built browser: guest Play now, first action, statement reconciliation, recorded history, Messages request failure/retry, cross-identity recovery masking, and support report P-1 while corrupt test cash remained -1.
- Mobile viewport had no horizontal overflow. A 12-second simulated lifecycle pause resumed with successful life responses. Physical mobile/OS background behavior remains unverified.
- Startup: 614,121 raw, 222,522 gzip, 194,695 Brotli bytes. Reviewed raw limit is 615,000 (originally 609,000); compressed, first-paint and scene limits remain unchanged.
- New self-repository package guard tests passed 15/15. The old-repository package was actually sealed, extracted and revalidated before the startup correction.

Full exhaustive suites were not run. Current local logs are `/tmp/allworld-final-acceptance.log`, `/tmp/allworld-owner-mask-final-focused.log`, `/tmp/allworld-self-release-final-guard.log`, `/tmp/allworld-startup-shuttle-tests.log`, and `/tmp/allworld-worker-lazy-profile.log`.

## Deployment procedure

1. Fetch and inspect `joinallworld/main`, its CI, and the clean source SHA. Do not overwrite dirty user files. The primary checkout `/Users/anthonyakpan/Desktop/JoinAllworld` is older and dirty; **do not deploy it**. The integrated checkout is `/Users/anthonyakpan/.codex/worktrees/neighbourhood-life/JoinAllworld`.
2. Run the appropriate fast checks for this final revision. Follow `deploy/README.md` for pinned tooling, immutable source validation, sealing and local checked-package deployment. Do not deploy the ordinary checkout configuration directly.
3. Preserve Worker `joinallworld-next`, binding `JOINALLWORLD`, class `JoinAllworldState`, and migration `joinallworld-sqlite-v1`. Existing namespace is `6b84e715f6c444f69971a0b6cde7868b` (SQLite). Preserve existing Firebase, mail, relay and AI bindings/secrets.
4. The self-repository `.github/workflows/joinallworld-release.yml` defaults to package-only. GitHub automation still needs `CLOUDFLARE_API_TOKEN` in a protected `production` environment and `ALLWORLD_CF_ACCOUNT_ID`. They were not copied or created. Never paste secrets into chat or commit them. An existing local Wrangler login was verified; use only the authorized account when performing a checked local release.
5. Record a fresh pre-upgrade UTC recovery reference and synthetic identity/balance/receipt continuity. A timestamp is not an executed backup. Current local helper `/tmp/allworld-release-continuity.mjs refresh` uses private mode-600 data at `/tmp/allworld-release-continuity-private.json`; no credential values are in this repository. If those temporary files are gone, recreate only synthetic verification actors.
6. After deployment, wait until `https://joinallworld.com/api/health` shows the expected build. Run `node /tmp/allworld-release-continuity.mjs after` where available and `node --experimental-strip-types scripts/smoke.ts https://joinallworld.com`. Verify the actual page and Messages/reconnect flow. A successful upload is not proof of public propagation.

The package keeps a 5 MiB per-file ceiling, 6,500 archive entries and 100 MiB aggregate payload, with file allow-lists, digest validation and traversal/link rejection. These bounds cover the roughly 5,800 files and 84 MB of built assets, including retained street packs.

## Scope and remaining work

See `RELIABILITY-IMPLEMENTATION.md` for the implemented SQLite-compatible checkpoint, and `reliability-2026-10-07/` for the historical wider plan. PostgreSQL cutover, full balanced accounting/reconciliation, room partitioning, provider recovery, capacity and physical-device acceptance are NOT complete. Do not activate the partial PostgreSQL prototype or describe all roadmap items as shipped.

The user asked to conserve nearly exhausted AI usage: use one cheaper implementation agent at a time, bounded fixes and focused verification. Existing Cloudflare Workers Paid is authorized with **no upgrades**; Neon must remain Free.

A separate Neon Free project `allworld-core` was created in London: `small-cloud-54968280`, Vercel store `store_lT31Y7zYjvVAXx3X`. Production is not connected. Synthetic rehearsal branch `br-floral-bonus-za3epo8h` expires 8 October 2026 at 22:09:41 UTC. Its temporary private connection file is `/tmp/allworld-neon-rehearsal-url`; do not print it. No production data was copied. The unrelated `neon-red-crystal` database must not be used.

Unported reliability prototypes remain in the older checkout and its archive `/var/folders/3x/y9y7vtp934q97zk_sl810lj40000gn/T/allworld-reliability-port-ea2hbod6`; do not apply that patch wholesale. Companion Goalmatic and Store Studio changes are separate repositories/commits (`b41a1add` and `441152e`), not deployed by this work. Real commerce and phone/ID provider activation need their own verified configuration.

Local preview was restored at http://127.0.0.1:5184/ from the integrated checkout. The temporary browser fixture was stopped and its disposable data removed. A cosmetic follow-up remains: recovery phone-header No service/battery wording while support is reachable.
