# Sealed first-five Africa verification

`world/tooling/verify-sealed-africa.mjs` runs the first-five travel and homeward journey fixtures against the exact `worker.js` and `assets/` in a sealed package. It first requires a clean tracked source checkout at the supplied commit, checks the package with that source checkout's package guard, and confirms the package manifest names the same source SHA. Miniflare receives the packaged Worker bytes directly, real packaged ASSETS, a fresh SQLite `JOINALLWORLD` store, and a synthetic provider used only for the founder test identity. The saved SQLite store is reused across the journey's host restarts and removed at the end.

The verifier also fetches `/` and the content-addressed `map` and `geometry` chunks for each of Yaoundé, Lomé, Accra, Nairobi, and Algiers through the Worker ASSETS binding. It checks each packaged file against its manifest and every served body against the exact expected bytes. The Worker intentionally makes HTML preview-image URLs absolute; the verifier applies that exact pinned source transform to the manifest-verified HTML before comparing its served SHA. JavaScript bodies must match their manifest hashes unchanged. The journey fixtures exercise session creation, onboarding, route actions, persisted fare receipts, reload/restart, arrival, a visitor meal, return, and the existing homeward tests.

Run it from a Node 24 runner with the source checkout, sealed package, and installed Miniflare tooling available as absolute paths:

```sh
node --experimental-strip-types world/tooling/verify-sealed-africa.mjs \
  --source "$RELEASE_SOURCE" \
  --package "$SEALED_PACKAGE" \
  --sha "$SOURCE_SHA" \
  --tools "$MINIFLARE_TOOLS"
```

`SOURCE_SHA` must be the exact 40-character lowercase commit SHA used for the sealed package. `MINIFLARE_TOOLS` is the directory whose `package.json` resolves the pinned `miniflare` package. The command emits one JSON result; it exits nonzero on failed checks and always reports `releaseReady: false`.

The registered Africa starter audit workflow also has an optional sealed-package job. After the branch is pushed and the release SHA is known, request that job from the existing workflow (the `sealed_source_sha` input must be the exact commit SHA):

```sh
gh workflow run africa-starter-audit-ci.yml --ref codex/world-foundation \
  -f sealed_source_sha="$SOURCE_SHA"
```

That workflow builds and seals the same source commit on its existing runner, invokes this verifier, and retains the sealed package and JSON evidence as a workflow artifact. It does not deploy. The remote verification process has a 175-second outer timeout followed by at most five seconds before killing its process group, including any owned Worker child. A timeout fails the job and cannot produce an accepted package artifact. The CLI also bounds requests and Worker disposal; its work deadline is 168 seconds.

This is isolated synthetic verification, not production continuity evidence. The canonical fixtures authenticate a synthetic founder and use the authenticated admin wallet route to fund or set exact-fare test balances; they do not represent ordinary guest progression. For simulation and failure cases, the existing fixture advances time through its isolated SQLite store, installs and removes temporary SQLite fault triggers, and temporarily changes then restores only its synthetic homeward-ticket and liability fields. These changes are confined to the fresh temporary test database. The harness does not inspect or mutate production state, use credentials or cookies from a live service, call a real provider, deploy, or establish physical-phone behavior. It performs no build and makes no package changes. Run it only after the package has been sealed; the verifier itself does not create or modify that package.
