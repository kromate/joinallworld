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

## Finite native QA stage

`world/tooling/serve-sealed-africa.mjs` starts the same exact sealed Worker and packaged ASSETS on an ephemeral `127.0.0.1` port with a new temporary SQLite store. It verifies the same clean source SHA and package guard, then creates a synthetic founder guest, loads its Lagos life, signs in through the fixture provider, and confirms the root admin identity using normal HTTP routes. Only the pinned synthetic Firebase key endpoint is answered; all other Worker outbound requests are refused. The launcher registers stop and restart signal handlers before starting Miniflare, so an interrupted startup still cleans up its temporary files and listener.

The launcher creates a new mode-0600 control file with `wx`; it refuses an existing path. This private file contains the loopback URL and port, exact source and package identities, owner PID, SQLite storage path and marker, stage deadline, public synthetic-provider JWK, and synthetic founder cookie for the authenticated admin-credit route. It never prints the cookie or persists the private signing key. The native operator may create a separate ordinary browser guest, complete onboarding, then use the supplied cookie with the existing `/api/admin/players/<publicId>/act` credit endpoint if the journey needs a funded balance. No save or balance row is edited.

After readiness, `SIGWINCH` serially disposes and restarts the same sealed Worker and ASSETS on the same loopback port with the same SQLite directory. It does not create another identity, reauthenticate, issue another credit, change saved fields or clocks, or reset the original lifetime. An overlapping restart signal is refused. Each completed restart writes sanitized JSON evidence containing the source SHA, package digest, stage URL, `storeReused: true`, and restart count. SIGINT, SIGTERM, or the original deadline stops the stage. By default, the launcher removes both its own control file and temporary store. With `--retain-store`, it retains the store and updates its same owned control file to `stageStatus: "stopped"`; the checkpoint contains synthetic cookies and must stay private, outside Git, and out of public artifacts. The native stage owner is responsible for removing retained files after QA.

```sh
node --experimental-strip-types world/tooling/serve-sealed-africa.mjs \
  --source "$RELEASE_SOURCE" \
  --package "$SEALED_PACKAGE" \
  --sha "$SOURCE_SHA" \
  --tools "$MINIFLARE_TOOLS" \
  --control "$PRIVATE_STAGE_CONTROL" \
  --seconds 600 \
  --retain-store
```

For a new stage, `--control` must be an absolute path that does not already exist. `--seconds` defaults to 600 and is limited to 900; a signal restart does not extend it. `--retain-store` retains the SQLite directory and private stopped checkpoint; without it both are removed. To resume a retained checkpoint, pass its exact path as both `--control` and `--resume-control`:

```sh
node --experimental-strip-types world/tooling/serve-sealed-africa.mjs \
  --source "$RELEASE_SOURCE" \
  --package "$SEALED_PACKAGE" \
  --sha "$SOURCE_SHA" \
  --tools "$MINIFLARE_TOOLS" \
  --control "$PRIVATE_STAGE_CONTROL" \
  --resume-control "$PRIVATE_STAGE_CONTROL" \
  --seconds 600 \
  --retain-store
```

Resume accepts only a mode-0600 checkpoint owned by the current user with `stageStatus: "stopped"`, a dead previous owner PID, matching source and verified package digests, a canonical private store path, matching private store marker, fixed loopback port, and public fixture JWK. It verifies the saved founder cookie through `/api/admin/me` before replacing the checkpoint contents in place with the new PID and finite deadline. It does not create an actor, authenticate again, grant credit, or modify SQLite directly. If startup fails before that verification and control update, the stopped checkpoint and store are preserved for retry. Standard output contains only the stage URL, build ID, source SHA, package digest, deadline, sanitized restart evidence, and (when retained) the storage path. This stage is local synthetic QA; it does not deploy or prove production continuity.

### Interrupted native stage recovery

The pinned Miniflare exit hook handles SIGHUP by immediately exiting 129, and SIGINT/SIGTERM by immediately exiting 130/143. The first actual SIGHUP restart therefore terminated the host before its private checkpoint could be marked stopped. Its SQLite save and original funding intent remained present; no restart pass was recorded. SIGWINCH is outside both pinned exit-hook signal sets and is now the owned stage restart command. Use the internal stage deadline for graceful cleanup, with enough time before the outer watchdog for disposal. Signals remain emergency stops and can require explicit interrupted recovery.

For an unfinished checkpoint still marked running, `--resume-control` refuses by default. After independently confirming the watchdog process group is gone, pass `--recover-interrupted` alongside it. The helper requires both the old owner PID and the old owned process group to be absent, as well as all existing source, package, marker, private-file and original-cookie checks. It never accepts cleanup_failed checkpoints. It reopens the same port/store/player/key and performs no new login, grant, clock or save edit. A failed recovery with unsuccessful disposal marks cleanup_failed and prevents another automatic recovery. This mode assumes the documented watchdog launched the helper as the leader of its own process group.
