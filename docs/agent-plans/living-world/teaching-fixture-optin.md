# Proposed teaching fixture opt-in migration

Status: **unapplied migration proposal**. Patch base: `8f39fa52f54ef79530ff88f2cc181e6b1bdd6d5f`. The changes are in [`teaching-fixture-optin.patch`](./teaching-fixture-optin.patch) and touch only the pure-engine teaching test helper, the two Node server fixture options, and the browser QA fixture options.

The selected integration contract keeps interactive starts disabled by default. Node tests opt in per fixture with `ServerOptions.interactiveTeachingStarts: true`; Worker opt-in is separately sourced from `INTERACTIVE_TEACHING_STARTS === '1'`. This patch does not modify either host or set an environment variable.

`src/game/teaching-career.test.ts` adds the explicit flag to its shared context helper so its existing positive interactive-shift cases remain intentional. `server/teaching-career.test.ts` opts in at both fixture constructions, retaining the disk and lazy-flush settings in the failed-write case. `scripts/living-world-browser-qa.mjs` adds the same option to its existing disposable fixture; the public onboarding sequence, rendered controls, and native keyboard event sequence remain unchanged.

The companion [`teaching-start-gate-tests.patch`](./teaching-start-gate-tests.patch) is still separate. Integration owns applying the gate and fixture migrations together, adding the corresponding Worker opt-in and gate-off recovery coverage, and running the paired acceptance suites. Neither artifact enables starts in an ordinary host or proves Node/Worker policy parity.

Validation performed: `git apply --check docs/agent-plans/living-world/teaching-fixture-optin.patch` succeeds against the stated base. The migration remains unapplied; no tests, typecheck, build, browser, or server were run.
