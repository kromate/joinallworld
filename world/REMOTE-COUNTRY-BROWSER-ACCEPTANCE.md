# Five-country browser acceptance contract

This is the next acceptance task for the existing cloud country owner and
Integration's existing Astra reviewer/operator. It is a test of the game from
normal UI, separate from source checks and from production deployment.

## Inputs that must be proved before launch

- Clean source: `c12b8ebd83cd301475fb1d7bf9e143af260d6621`.
- Actual package manifest and guard digest, recipe/tool pins and build provenance.
  The independently reproduced cloud package is a separate candidate until its
  full file comparison proves otherwise. Preserve the artifact API Forbidden
  result; do not change credentials or retrieve it through another route.
- Stage helper SHA-256:
  `55f38b91528966dbb43dfc80274471de11fb010b2bc3dc66b9b4f2712d619f56`.
- Capability policy SHA-256:
  `af748ece4eccbb2a9dfc7ad9901a13b3d06d4afc1ef497c53bf140d74a51b5ef`.
- Verify the complete seven-file relative import closure recorded in
  [the tooling review](c12-browser-toolchain-review.json). The stage imports
  `verify-sealed-africa.mjs`, which imports the coverage and admin-rate modules.
  Shipping only the stage and policy files fails before startup. Check actual
  regular files and all seven hashes in the cloud controller preflight.
- Actual existing Chromium 151 binary, existing `ws`/CDP helper source and
  reviewed launch arguments. No dependency installation is part of this task.
- Named existing Astra reviewer/operator and the exact immutable UI controller
  source. Review its selectors against the pinned app and actual visible UI.
  Failed lookups and blocked controls must remain failures, not force-clicks.

## Resources and ownership

Use the existing provided cloud capacity with one heavy, one server and one
browser lease. No new worker or paid service. Publish the actual lease/process
handles and stage deadline before the first browser action. The phase lasts at
most 900 seconds; stop new actions 60 seconds before its natural deadline.
Do not restart or extend the stage to avoid the deadline.

The stage's internal timer starts after its bootstrap requests. It cannot enforce
the complete phase duration by itself. The immutable controller must use these
bounds, measured from its first owned process launch:

| Resource | Required bound |
| --- | --- |
| Complete phase, including bootstrap and cleanup | 900 seconds |
| Bootstrap and readiness | 120 seconds; otherwise fail before any browser action |
| Exact stage helper duration | `--seconds 720`; no renewal |
| Last new browser action | Earlier of stage deadline minus 60 seconds and phase start plus 780 seconds |
| Aggregate RSS of owned controller, stage, browser and descendants | 4 GiB; sample at most 500 ms apart and abort on excess |
| Individual HTTP request | 20 seconds, with request cancellation |
| CDP command | 10 seconds |
| Screenshot | 15 seconds; at most 2 MiB per PNG, 32 PNGs and 48 MiB total |
| Public logs and structured observations | 16 MiB total; no raw private state |

These are launch limits, not measured performance claims. The previous capability
probe used about 1.285 GB and does not prove this journey fits them. Publish actual
peak RSS, elapsed time, output sizes and any exceeded limit. Resource failure is
a partial result, never acceptance or permission to repeat with larger bounds.

The controller must stop browser actions on timeout/resource failure and preserve
owned checkpoints. Normal success uses the helper's natural deadline and actual
clean disposal. Review the emergency process-group cleanup explicitly: Miniflare
has its own INT/TERM/HUP hooks, so those signals do not prove graceful disposal.
At the overall deadline, terminate only the recorded owned group, record failed
or interrupted cleanup honestly, retain the private store, and release leases
only after confirming the owned processes are absent. Do not silently alter the
pinned helper to add another signal or claim a stopped checkpoint after a kill.
Require main allowance above 4% before starting a new phase; preserve active
work and use the final 4% for checkpoints and reporting.

WORLD owns the stage, its private control and exactly-once funding/restart.
The existing Astra operator owns the browser actions. The cheaper country
worker may prepare source and run approved immutable automation; it must not
invent UI decisions or supply proof of actions it did not observe.

## Two fresh actors and one visible game tab

Create a fresh cloud SQLite store and normal guest lives through the game UI.
Do not transfer any Mac/eec player, cookie, profile, database or private baseline.
Use two distinct localhost origins and verify their actual browser resolution
and cookie separation before onboarding. Onboard and inspect one actor at a
time, keeping only one active game tab to bound scene residency. Close only
owned tabs and preserve ordinary browser cookies when changing actors.

| Actor | Cities, in order | Round-trip fare total |
| --- | --- | ---: |
| A | Cairo, Rabat, Kigali | 1,762,000 |
| B | Kampala, Lusaka | 1,196,000 |

All five together cost 2,958,000 before local activities, so one actor with a
single 2,000,000 credit is insufficient. Capture actual starting cash and home,
ownership, inventory, original ledger/receipt prefixes and identity. Do not
assume an onboarding lottery outcome.

Fund each fresh actor once with a fictional 2,000,000 credit through the actual
root-authorized `POST /api/admin/players/:id/act` route. Persist its intent before
dispatch, then replay the identical clientId and payload. Prove duplicate:true,
one credit/wallet effect/receipt/audit and no replay balance change. Never issue
a new credit intent after an ambiguous result; read the original result/state.
Keep full owner baselines and authentication private. Public evidence contains
only allowed facts, hashes and synthetic deltas.

## Journey loop and evidence

For each assigned city, perform the following normal UI sequence:

1. Select its actual country/card and quoted flight. Record the quoted fare and
   duration, city/country identity, focus/hit target and the start result.
2. Wait the natural 20-second flight and observe completed arrival. Do not use
   skip buttons, clock manipulation, direct action APIs or raw save writes.
3. Observe the rendered city/map and actual geography. Perform one short local
   activity offered by the visible game, recording its cost, duration and result.
4. Inspect the map/controls at 320 and 390 pixels. Save bounded actual PNGs and
   focus/hit-target observations. Record the existing external-widget overlap;
   do not hide it or infer physical-phone performance from the viewport.
5. Return through the normal UI, wait the real duration, and observe home arrival.
   Compare protected identity/home/ownership/inventory and original prefixes.
   Explain only actual fare, activity, wallet and location changes.

After a complete city/home checkpoint, WORLD performs one exact-helper
SIGWINCH restart on the same port/store without extending the deadline. Reload
through normal browser navigation and prove saved identity, home, wallet and
receipt state. An open port or queued restart is not a successful reconnect.

Checkpoint each completed city separately. The result must list completed,
incomplete and unvisited cities; selecting a card is not a completed journey.
If resources, cash, UI readiness or time prevent a step, keep the exact gap and
preserve the compatible store/profile at a safe boundary. No re-onboarding,
reset, extra grant or assumption that later visits passed.

## Terminal review and deployment

Restore viewport, close only owned tabs, terminate only owned browser processes
through the approved cleanup, release leases and capture actual stage expiry.
Retain a private stopped store/control when work is partial. Prove owner/group
absence and the saved-state checkpoint; never publish credentials or raw state.

WORLD/Integration review actual screenshots, actions, protected state, once-only
funding, restart and cleanup evidence together with the remaining exact-source
release tests. Production16 requires an accepted deployed package, fresh main
synchronization, original Nigeria continuity and actual live country/map checks.
Neither this contract nor a source-equivalent package is deployment acceptance.
