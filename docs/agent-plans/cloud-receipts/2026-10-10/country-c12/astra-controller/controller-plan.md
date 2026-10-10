# Frozen source-only country browser controller

The actual controller is `country-controller.v1.mjs`, 51,913 bytes, SHA-256 `214e77832e8b8d09cb4ecfa0c2565f52fabc1ec20dd3803a67c96efc2c74decf`. It is mode 0444 and has not been executed. The separate source pin map is `selected-source-pins.json`, SHA-256 `88e6552f906c5648eaf5143502c70f6d545fb0aec591260abca75c802dc4210b`, containing 62 exact regular-file pins. Earlier 25fa/d721/a937 drafts are superseded and must not be approved as this controller.

The numeric contract is the full published `711aac363b4f3315e8a236a9d1acd5b0d52b7b2a:world/REMOTE-COUNTRY-BROWSER-ACCEPTANCE.md`, copied as `world-contract-711aac36.md`, SHA-256 `f38bdb14436f78a37516d961159519444ea249755ade95edf1cf43dc88ee7460`. Both supplemental published Git JSON files were read in full: `review-inputs/supplemental-toolchain-review.json` from WORLD 8a05b17e, SHA-256 `38d72ba5e65a621ff7604a00602a590cc065a14051159142c14e84108d79b338`, and `review-inputs/own-seal-acceptance.json` from WORLD 51d53aee, SHA-256 `5ab75af54cd864bf3f9a60e46e1db50d331bb9aa2fbe1a23a40f7b630bad276a`. These supplement the unchanged numeric contract.

The source remains clean c12b8ebd83cd301475fb1d7bf9e143af260d6621. The independent package remains 28e4f93df5e608b63d3d862173b03b418d70c141803de7f69a6ed836ffb5030d; its existing own seal passed 14 checks covering 15 cities and 31 assets in 144,672 ms. No seal, build, package, host suite or UI was rerun. The historical artifact API Forbidden result remains distinct and unchanged.

## Operator and review boundary

The supported spawn request selected `gpt-6-astra`, reasoning `high`, `fork_turns=none`; the actual tool response accepted task `/root/country_browser_astra`. The tool returned no UUID or backend model ID. WORLD's separately published supplemental receipt binds thread bridge `01a123d0-cf20-70c1-ad9e-5f824abef065` to this task and configured request. `operator-binding.json` keeps those provenance sources distinct. No provider backend identity is inferred from the task name.

The existing WORLD owner owns the stage, private control, exactly-once credit and single SIGWINCH. This controller can mechanically launch the exact helper only if a named WORLD owner explicitly delegates that launch in the independently reviewed receipt. Integration/Astra must approve the exact immutable controller, source-pin map, candidate package, browser/helper arguments, actual existing lease handles, mailbox protocol and emergency cleanup. `review-proposal.NOT-APPROVED.json` is deliberately unusable: approval flags are false and actual reviewers/lease handles are absent.

The launch gate reads a private mode-0600 review JSON, verifies its SHA-256 against the explicitly supplied CLI digest, checks all approval/scope/source fields and the exact controller/source-pin hashes, requires named reviewers and actual lease handle strings, and rejects stale receipts. The trusted owner must supply the approved receipt and its digest after the real review; a hash alone does not authenticate an invented reviewer. No clock passage or source-only publication constitutes approval.

## Proposed CLI and process ownership

After exact review only, the existing owner would invoke:

```text
setsid node --max-old-space-size=256 /workspace/remote-verification/worker-results/c1-third-five/astra-controller/country-controller.v1.mjs --run --review /ABSOLUTE/PRIVATE/approved-review.json --review-sha256 ACTUAL_APPROVED_RECEIPT_SHA256
```

This is a proposal, not a command run during source preparation. Existing supported execution permissions must permit the reviewed loopback process; no proxy, authentication or network settings are changed. There are no dependency installs or new services.

The controller must be its own Linux process-group leader. It records Linux birth ticks, converts the first owned PID's age to monotonic T0 with two conservative clock ticks, and keeps PID/start-tick identity for every observed owned descendant. It creates separate recorded stage, Chromium and UI-driver process groups. The UI driver is a local process running the same immutable source, not another agent or paid worker. It inherits a 256 MiB Node heap bound; the stage Node heap is 768 MiB. The 4 GiB aggregate RSS bound, rather than these heap settings, covers all four groups and descendants.

The exact proposed helper and Chromium argv arrays are in the review JSON. Helper: unchanged 55f38b9... bytes, policy af748ec..., exact source/package/tooling paths, `--interactive-teaching-starts 0 --seconds 720 --retain-store`, fresh private control, no resume or renewal. Chromium: existing pinned 151.0.7922.173, `--headless=new`, reviewed `--no-sandbox`, fresh private profile, loopback ephemeral CDP, one `about:blank` target, 390×844 initial viewport. No shared browser is attached or stopped.

## Bounds and terminal meaning

| Item | Enforcement |
| --- | --- |
| Whole phase | 900 seconds from first owned Linux PID birth, including preflight, bootstrap and cleanup |
| Ready | 120 seconds including CDP readiness and live pre-UI publication acknowledgement; otherwise no UI |
| Helper | Exactly 720 seconds after the helper's bootstrap, unchanged helper |
| Last new action | min(actual stage deadline − 60 seconds, T0 + 780 seconds) |
| Aggregate RSS | 4 GiB; 250 ms target sampling, any gap over 500 ms is a failure |
| HTTP | 20-second cancellable controller fetches; browser HTTP timers cancel page loading on timeout |
| CDP / screenshot | 10 / 15 seconds; timed-out CDP connection closes |
| PNG | 2 MiB each, at most 32, 48 MiB total, bound checked before retention |
| Output | 16 MiB aggregate logs/structured observations, including discarded child output and mailbox observations |
| Owner mailbox | 64 KiB per mode-0600 request/response; normally 30-second wait, pre-UI publication 20 seconds |
| Allowance | Current shared main allowance must exceed 4 before launches/new actions; owner updates the existing policy file |

Resource failures stop new input. RSS still above the ceiling after a one-second disposal opportunity causes recorded emergency group cleanup and PARTIAL. At T0+890 seconds the supervisor begins emergency owned-group SIGKILL if still necessary, leaving ten seconds for absence checks and a bounded terminal receipt. It never represents this as graceful Miniflare disposal. Normal completion waits for the unchanged helper's own deadline event, actual successful exit, and private `stageStatus: stopped` on the same store.

The controller cannot prove its own absence while writing its receipt. Even with all five journeys completed it reports `JOURNEY_COMPLETE_OWNER_FINALIZATION_PENDING`, keeps `leaseReleaseEligible: false`, and requires the existing owner to verify controller/group absence after exit and only then release the three actual leases. Any earlier failure is PARTIAL. The root must still review screenshots and all owner evidence before acceptance.

## UI and actor decisions

One game tab is reused on two distinct actual origins, 127.0.0.1 and localhost at the same stage port. A fresh profile starts with no cookies. CDP document responses must prove loopback resolution and the correct port for each navigation. Cookies stay in the browser: actor A's session must be present only on A's origin and absent on B's before B onboarding. No cookie, actor DB, private save or previous local actor is imported.

The driver uses the pinned Creator UI, ordinary input and wheel scrolling, defaults for look/spirit, and explicitly selects Lagos/Ikeja through the visible home controls. It waits for the actual new-mode settlement operation to close the creator. Actual onboarding cash is measured from the HUD and reconciled with the owner baseline; it is never assumed.

Actor A visits Cairo/Rabat/Kigali, round-trip fares 1,762,000. Actor B visits Kampala/Lusaka, fares 1,196,000. Each actor receives exactly one owner-authorized 2,000,000 fictional credit and identical-ID/payload replay. The controller has no admin POST implementation and cannot generate a second grant after ambiguity.

Foreign travel uses the actual atlas country card and enabled flight quote. Nigeria return uses the Nigeria atlas level, Lagos state card and explicit Lagos city selector when offered. Geographic Countries outlines are not travel. Exact fare and 20-second duration, visible progress, natural elapsed duration, destination identity and wallet delta must agree. Fare confirmation uses the actual same-city button. A lookup that is missing, disabled, occluded, ambiguous or mismatched fails. No forced click, direct application function, action API, save mutation, skip or accelerated clock is used.

At each foreign city the driver chooses the shortest uniquely labelled, enabled, visible free activity lasting at most 20 seconds; no eligible control means an explicit gap. It observes start and ordinary completion, verifies cost/duration, and requires WORLD's independent successful-result receipt. This narrow deterministic selection was made by the assigned Astra operator; the runner cannot invent a substitute. Mutating browser HTTP requests must settle before subsequent clicks, and gameplay operations are awaited sequentially through visible completion.

Each city gets actual 320/390 PNGs, DOM focus styling, hit-target/occlusion measurements and iframe geometry. Widgets are not hidden. These are browser viewport observations, not physical-phone claims. Each completed home-city boundary needs WORLD's protected-state and original-prefix comparison. After the first boundary WORLD sends exactly one SIGWINCH; the controller records the helper's actual safe restart stdout event for the owner's read, reloads normally and requires saved-state verification. All completed, incomplete and unvisited cities remain distinct.

## Private WORLD mailbox protocol

Runtime files exist only in a newly created mode-0700 `/workspace/remote-verification/private/country-astra-<uuid>` directory. They are never part of this source packet or Git. Request and response schemas are documented in `owner-mailbox-schema.json`. The owner must process them promptly within the finite phase using its already authorized routes and ownership; no mailbox worker or new service is installed here.

Each `<requestId>.request.json` is created once, mode 0600. Every response is a new mode-0600 `<requestId>.response.json`, bound to the exact request ID and SHA-256, the named owner, and `verified: true`. The controller never retries a failed funding request with another ID. A missing response causes PARTIAL. This is a trusted local owner interface, not a cryptographic signature scheme or permission for another user to write receipts.

Requests, in order: publish safe live pre-UI handles/deadlines/RSS; capture private baseline and fund/replay once per actor; verify each local activity's actual result; verify each home-city checkpoint; perform one exact restart after the first completed boundary; verify reloaded saved state. The owner must not publish the generic request envelope, which contains private store identity. It publishes only the safe nested pre-UI provenance and allowed origin/cookie-count facts. Full actor baseline, authentication, SQLite and cookie contents stay private.

## Verified preparation and remaining gates

`node --check country-controller.v1.mjs` passed. Actual cloud Node v24.19.0 ran only the unchanged helper's non-starting `--help`: exit 0 in 51 ms, stdout 1,948 bytes SHA-256 `9d52480410eb46c34cb205f18ed0f295913a0b788b3b04267189b09cee187d0a`, stderr zero. That proves the actual seven-file local import closure loads; it does not start Miniflare or demonstrate UI behavior. `helper-help-receipt.json` records the exact command and helper pin.

All source and browser/runtime pins are prepared for live verification, including the Chromium ELF and all existing ws JavaScript modules. No screenshot, actor, funding, stage, browser or restart occurred during preparation. The pinned game checkout has no tracked changes. No environment draft was changed because this task expressly holds execution for source review.

Remaining gates are real independent review of the exact 214e source and 88e pin map, actual owner/reviewer/lease bindings, approval of the WORLD mailbox actions and group cleanup, then a fresh quota check. UI feasibility, actual memory/time fit, responsive owner receipts, rendering, actual cookie separation and cleanup remain unrun and unproved. The controller fails conservatively if any of those conditions is absent; the source packet is not browser acceptance or deployment approval.
