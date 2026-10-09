# Teaching browser QA batch

This manual batch checks the rendered fictional Teaching lesson against the built candidate and an isolated local Node HTTP server fixture. The fixture advertises a build ID derived from the exact source SHA. It exercises two disposable teachers: one in desktop Chromium and one at a 390 × 844 CSS-pixel touch-emulated viewport. It does not use a production account, alter a real save, call answer endpoints directly, or claim a physical-device or complete-world journey, Worker run, or cloud staging result.

## Run

Run only on a disposable remote CI runner with the candidate already built and an installed Chrome/Chromium executable. The script imports the existing `server/test-fixture.ts`, which creates a loopback server and a private temporary data directory. The browser receives only those generated fixture cookies. Browser requests are intercepted: same-origin fixture requests continue, other origins are blocked and make the run fail. Chrome uses its own temporary profile and process group, both removed during teardown.

```sh
CHROME=/usr/bin/google-chrome \
LW_QA_SOURCE_SHA="$GITHUB_SHA" \
LW_QA_OUTPUT_DIR="$RUNNER_TEMP/teaching-browser-qa" \
node --experimental-strip-types --test scripts/living-world-browser-qa.mjs
```

The repository build must have produced `dist/index.html` first. `CHROME` is mandatory and must be an executable path; the receipt records the browser version actually returned by DevTools. `LW_QA_SOURCE_SHA` is required and must match `git rev-parse HEAD`, so results cannot silently attach to a different checkout. `LW_QA_OUTPUT_DIR` is required, must be outside the source checkout, and should point to a runner-temporary directory. The script writes at most five success screenshots plus one bounded initial-render failure screenshot, and atomically writes `receipt.json` on success or failure. On initial-render failure, the receipt records only fixed DOM-presence flags, allowlisted generic UI-text flags, document readiness, and a capped runtime-exception count. It never records arbitrary page text, exception messages, URLs beyond the local-root boolean, names, cookies, session IDs, save contents, request headers, or raw errors. Retain screenshots and the receipt only as the manual run's review artifact. The script does not upload artifacts or update release status.

The Node test has a 120-second limit. Its Chrome child runs in an owned process group and is terminated on success, failure, timeout, or test teardown. No shell is used to start the browser. Each navigation and reload waits for a new main-frame loader and its actual `load` lifecycle event; the script then waits for the visible lesson state and server-derived HUD balance before it accepts the page as hydrated. Fixed sleeps are not used as navigation evidence.

## What it proves

The script provisions both test teachers through actual `/api/session` and `/api/action` calls: apply for the teaching job, go to the work spot, then start the authored teaching activity. It loads the built app with each disposable session cookie and requires the real `TeachingShift` component to render. Desktop uses a rendered wrong choice, verifies no stage or wage advancement, advances the fixture clock by two minutes, reloads, and verifies the retry is restored. It then submits the three authored choices through native DevTools keyboard/mouse input. The second teacher remains unchanged during that completion.

At 390 × 844, it records document overflow and rendered choice target sizes, progresses with touch events, reloads during the lesson, and finishes the remaining choice. Both actors must have one terminal completion and one authored wage ledger row after reload. A completed session must remain completed without a second wage.

The success screenshots are `teaching-desktop-before.png`, `teaching-desktop-reloaded.png`, `teaching-desktop-after.png`, `teaching-mobile-before.png`, and `teaching-mobile-after.png`. An initial desktop-render failure may also include `failure-desktop-render.png`. The JSON receipt includes the exact source SHA, matching fixture health/build value, observed Chromium version, Node/platform, viewport measurements, and screenshot names. A failure receipt has `result: "failed"`, a bounded phase code such as `desktop-reload-retry`, and makes no acceptance claim; the test itself also fails. It contains no raw error text.

## Limits

This is a headless desktop browser and emulated 390px touch viewport, not physical-device testing. It does not certify 320px, landscape, accessibility beyond the checked controls, production hosting, or the mapped school-to-rental journey. A failed assertion remains a failure; do not omit a screenshot, retry until green, seed a completed lesson, or replace browser input with direct state changes or answer HTTP calls. Initial-render diagnostics can show whether the built app shell, quick-start gate, lesson, balance, or scene became visible, but do not establish a root cause automatically. Review the exact-SHA receipt and screenshots separately before treating the batch as accepted.

## Exact remote execution

ROOT workflow `.github/workflows/living-world-browser-qa.yml` runs only on a deliberately frozen `codex/living-world-browser-qa-*` push or explicit dispatch once the workflow exists on default main. Each run pins checkout, environment and artifact to the same GitHub event/source SHA. It also checks the two complete legacy-save migration suites and unchanged build/download budgets before browser input. Missing artifacts fail the run. No secrets, deployment or preview endpoint are used. A source-only review and Node `--check` are not browser acceptance.

Protocol references: [Chromium input](https://chromedevtools.github.io/devtools-protocol/tot/Input/), [Chromium emulation](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/), and [runner image inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md). Record the actual browser version; the inventory is not an exact execution receipt.
