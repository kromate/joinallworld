# Bounded local fine supervisor

The supervisor composes existing source preparation and administrative compilation for **explicit frozen inputs**. It does not discover countries, widen source licences, install scheduling, change game data, or declare destinations playable. `fine-supervisor-cli.ts` accepts one named configuration; the SHA-256 of its exact bytes identifies durable state. Successful preparation is admitted to local compilation only after the existing source, topology and compiler gates. Existing curated campaign registries remain immutable.

## Run and resume

```sh
node --experimental-strip-types scripts/agent-slot.ts heavy --wait-ms 60000 -- node --experimental-strip-types world/fine-supervisor-cli.ts run world/fine-supervisor-libya-cache.json
```

Run the same command to resume. This checked-in demonstration is **cache-only**, limited to ten minutes of lifetime charged runtime, four cycles, one preparation job and three compile jobs per cycle. Preparation and compilation each have a 120-second cap. It seeds the reviewed Rwanda/Djibouti registry and prepares Libya; no new acquisition is expected. Config references bind the original preparation and seed file bytes by SHA-256. Seed pins and topology paths are also frozen in state. Changing a bound input is a rejection, not a silent source refresh.

The CLI supports graceful SIGINT/SIGTERM cancellation. It is an ordinary local process: continued operation requires a running process and awake machine. No daemon, heartbeat or automatic restart was installed. Active chat agents stop with the session; a separately launched runner can operate while the chat is closed only while its process remains alive. A two-day configured upper bound is permitted by the contract, **not a measured completion time or two-day soak result**.

## Bounds and recovery

The schema allows at most 48 hours of cumulative charged execution, 64 cycles, 120 seconds per stage, 60 seconds per retry wait, 16 preparation jobs and 300 compilation jobs per cycle. Existing acquisition lifetime network/audit/cache caps, preparation leases/attempts and campaign budgets remain authoritative. The supervisor adds a 512 MiB RSS check, 100 MiB free-disk reserve and aggregate state bounds of 2 MiB / 128 entries / depth four. State scans reject symlinks and nonregular entries; atomic writes preserve an additional 512 KiB reserve. One shared supervisor lock serializes state admission across configuration hashes. Other runner/acquisition locks still protect their own resources.

A cycle's full two-stage time reservation is fsynced before dispatch. Successful cycles charge monotonic elapsed time; interrupted cycles retain their entire reservation. Retry waits have separate durable reservations. Resume reaps only a provably dead lock owner, charges unfinished reservations, and performs fresh source/output verification before reporting terminal success. It never resets attempts or upstream network reservations. A fully spent budget returns `budget-exhausted` with `currentVerification: false`, `campaign: null` and no cached result claims; empty result fields then mean verification was denied, not that the queue finished.

`terminal` / `terminal-with-exceptions` describe only the frozen supplied queue. `measuredNetworkBytes` counts observed preparation results during this supervisor's lifetime, not all historical acquisition. `unknownNetworkTransfers` retains observed unmeasured operations; `unobservedCycles` separately records interrupted cycles whose results were not observed. Consult the durable source audits for authoritative reservations. Exceptions include catalogue/source coverage gaps and retained historical preparation failures.

Preserve `.cache/world-build/fine-supervisor/<configHash>/state.json`, upstream ledgers, audits, sources and immutable products. Do not delete state to recover quota or make terminal failures disappear. Corrupt state or changed bindings fail closed; investigate exact evidence before creating a reviewed new source/configuration version.

## Actual acceptance — 8 October 2026

Two real invocations of `fine-supervisor-libya-cache.json` passed, with config hash `3c2a237a16d31d176cbe85b9bb13094945192c86742cd99237c1b14eaf21bc51`. Both freshly verified three compiled countries, 254 exceptions, one protected Nigeria and zero pending across 258 map units. Preparation lifetime attempts stayed at four; the historical Namibia 14-versus-13 mismatch remained explicit. Both invocations recorded zero measured network, unknown transfers and unobserved cycles. Lifetime cycles advanced one to two; charged runtime advanced 1,331 to 2,581 ms. Campaign plan/report stayed identical:

- Plan: `b0d1ec87ab2386ce3a7edec5da2c4bf72a7a7439694ae6f910be34e9962f3bc4`.
- Report: `cecbc1e802322b88b9bd4d1043e6e1f6c18bd22d6aa022caf66b5ce5c8544e20`.

Evidence is `.cache/world-build/evidence/fine-supervisor-{first,repeat,independent-verification}.json`. Twelve isolated tests cover real child-process SIGKILL recovery, stale-owner handling, interrupted/caught cycles and waits, exhausted budgets, changed bindings, malformed reservations, duplicate cycle IDs, corrupted state, symlinks and aggregate state admission across configurations. They use temporary fixtures and do not mutate actual build state. See [PROGRESS.md](PROGRESS.md) for integrated checks.
