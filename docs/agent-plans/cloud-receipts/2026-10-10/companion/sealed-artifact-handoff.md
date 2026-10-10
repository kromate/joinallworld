# Companion yield exact-source artifact handoff

## Exact source and artifact

- Repository checkout: `/workspace/remote-verification/repositories/worker-companion-yield`
- Source commit: `8a48405963ca526bfe059b413be250d834d50b90`
- Branch: `codex/cloud-companion-yield-20261010`
- Git parent: `eec14690544a4646e4cd8a5ad280d61bbe2709ca`
- Worktree: clean; sole changed source since parent is `src/app/features/companion/CompanionHost.vue`.
- Owned source SHA-256: `c444b94c82a4920ecebe2b0d9db22c726e9e0b876aaf36c4087d1926c0cd94c2`
- Exact sealed local directory: `/workspace/remote-verification/artifacts/companion-yield-8a484059`
- Deterministic tar.gz handoff: `/workspace/remote-verification/artifacts/companion-yield-8a484059.tar.gz`
- Archive SHA-256: `990eb62b8f47be6fbcbb68a78f7fa9cb11bfa669cf2ed65ef5dac8b7fab21b7c`
- Repository release package guard digest: `88c193147084502f7ce7b5b4a8e71e83e625900418908fbbc2f036416975c0b3`
- Guard-manifest SHA-256: `9baa2ffc8a023c9e2d4a133bba1038ea344712c66583ecfa9640621fe818f5c3`
- Packaged Worker SHA-256: `74524d136eb24b8eb9cfc47b134d7d5628e35c02dd21e0d1ca6d4e29e8975f77`
- Package was created with the repository's `scripts/package-joinallworld.mjs` and checked again with `scripts/guard-joinallworld-package.mjs check`, source SHA pinned to `8a484059…`, `publish=false`. It is local only; no upload or deployment occurred.
- Existing `dist/index.html` timestamp: `2026-10-09 23:51:46 UTC`; source, deploy, and public tracked files had no timestamps newer than it at packaging time. The task's prior run record says exact-8a build and download budget passed; no redundant Vite rebuild was run.

## Check evidence retained

- Full strict compiler was subsequently run at 4096 MiB on exact commit `8a484059…`; exact receipt `/workspace/remote-verification/receipts/8a48405963ca526bfe059b413be250d834d50b90/typecheck-cloud-4096-readable/receipt.json`; raw log `command.log`; exit 0, 5 projects, 0 TypeScript/Vue errors, 0 existing JavaScript baselines. Log SHA-256 `08b1beafe4a953a464abc45c3721c465872139627aa63bcd4ee13cd234aa5cfe`.
- Earlier focused companion test (19 passed), Vite build, and `size:download` passed per `/workspace/remote-verification/worker-results/companion-yield/validation.log` (SHA-256 `a9da91f296245e19c62c42fa87c4bbb483ec088b60c41eca7ee1ae79b635a1ac`). That file is a worker validation summary, not raw command output.
- A repository-wide search found no separate retained raw focused-test/build/download logs or corresponding exact receipts for `8a484059…`; only the validation summary remains. They are not represented here as raw logs. Build output was reused because it is current for the exact clean checkout.

## Combined artifact follow-up

Use the exact sealed package together with the later combined WORLD/native artifact for the actual 320px and 390px checks. Confirm lesson feedback/right-edge controls remain visible; the companion floating stage hides and disposes while shell sheets, phone screens, and interactive teaching activity own the foreground, then resumes only when eligible. Confirm the existing companion chat/sheet entry remains reachable and its preferences, memory, logs, and greeting remain intact. These actual viewport, focus/help, and disposal/restoration checks have **not** been performed on this isolated package.
