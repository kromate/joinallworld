# Choose the check that matches the change

The default push and pull request checks use Node 24. Type checking runs alongside a second job that builds the game, checks download budgets, and runs three existing smoke-test files. Each job has a five-minute timeout.

Run the same fast checks locally with:

```sh
npm ci --no-audit --no-fund
npm run check:fast
```

The fast checks omit the exhaustive test suite, Node 22 compatibility, and the Worker and Miniflare edge suite. A five-minute timeout is a guard, not evidence that a run completed successfully. Hosted-runner timings remain to be measured.

Run the full local checks when a change affects authentication, persistence, the economy, city data or loading, the Worker, or dependencies:

```sh
npm ci --no-audit --no-fund
npm ci --ignore-scripts --no-audit --no-fund --prefix deploy/tooling
npm run check:full
```

The full local command runs the exhaustive Node suite and the complete edge suite after the type check, build, and download budget. It runs once for the SHA you plan to release.

To run the full checks in CI, open the `CI` workflow, choose **Run workflow**, select the reviewed branch or tag, and set `full_checks` to `true`. Confirm that the run's commit SHA is the one you intend to release. The manual job checks Node 22 and Node 24, installs the pinned Worker tooling, and runs the edge suite. The normal push and pull request jobs stay on the fast path.

Choose one place for full validation: locally, manual source CI, or the private release workflow's `full_checks` option. Record the checked SHA and the result. If the source changes, the result no longer covers that revision. Fast mode does not automatically verify or attest a local full-check result; choosing the appropriate checks remains the release operator's responsibility.

The private release workflow still builds its exact source SHA, checks download budgets, runs source and Worker smoke checks, and seals the package. Deployment consumes that sealed artifact without building it again. Its full-check option defaults off, so a local full run is not automatically repeated before deploying.

## Local measurement, October 7, 2026

On Node 24.14.1, an isolated copy of source `e659ca1d304001cae8bda4f15d00dca4d8d97ff6` with these pipeline changes completed `npm run check:fast` in 61.07 seconds. All five type projects, download budgets, and 15 assertions passed. The private workflow's exact five-check Worker command and pass-count assertion passed in another 2.73 seconds, using pinned Wrangler 4.147.0 tooling. Dependencies were already installed. These measurements do not include a cold install, GitHub queue, or deployment.
