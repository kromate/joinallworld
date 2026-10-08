# Deployment handoff — 8 October 2026

## Correct repository and live state

Use **https://github.com/kromate/joinallworld** for source AND releases. Do not use `kromate/v1-allworld`. That repository formerly held the deployment policy; the reviewed policy and pinned tools are now copied into this repository.

All combined gameplay and reliability work was merged through PR #19, merge `4b883d99399eb0d47f86d8f42678b3af1e61d80f`. This follow-up adds the startup correction, self-repository release workflow and this handoff. Use the actual current `origin/main` SHA, not the earlier merge SHA.

**The new release has NOT reached production.** Last verified public `/api/health` still reported `joinallworld-4832b7e7507914db8a4d721a7f6`. Release run https://github.com/kromate/v1-allworld/actions/runs/37705444185 passed packaging but Cloudflare rejected upload with error 10021, “Script startup exceeded CPU time limit.” No data restore or namespace replacement was performed. The user requested that another agent perform deployment; this task stopped deployment work at handoff.

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
