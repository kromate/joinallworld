# Bounded African starter runner

`world/tooling/run_africa_starters.py` serially coordinates the existing starter planner/acquirer, its offline source receipt checker, and the isolated playable-destination verifier. It is a thin source-workflow wrapper; it does not replace a whole-world campaign queue, alter the generator or its ledgers, admit cities to shared runtime registries, or establish hosted, browser, release, or production acceptance.

Run it from a committed WORLD checkout with the machine-wide heavy slot available. It acquires `scripts/agent-slot.ts heavy` once for the entire bounded run, refuses an already occupied slot, and processes one country fully before starting the next. The existing planner continues to reject Nigeria and the first release waves. A run freezes the Git commit, generator, converter, verifier, inventory, slot helper, runner, atomic publication helper, selected plan identities, executable paths, and execution/download budgets into a content-addressed contract under `.cache/world-build/playable-africa-runs/`. The commit must have no unrelated tracked changes; untracked importable or executable source under `src/game/`, `scripts/world/`, or `world/` also blocks the run. Selected city outputs, their receipts, unrelated Markdown drafts, and the deploy tooling's `node_modules` symlink are handled as existing workflow artifacts. The run directory and its contract/report files are canonical real paths owned by the current user and private mode `0700`/`0600`; an existing contract is never replaced. The adjacent report is updated after each phase so completed cities and partial work remain visible.

```sh
python3 world/tooling/run_africa_starters.py \
  --country EG --country MA --country RW \
  --node /absolute/path/to/node \
  --python /absolute/path/to/python3 \
  --seconds 600 \
  --max-countries 5 \
  --max-reserved-bytes 41943040
```

The defaults are 600 seconds, five countries, and 40 MiB of potential source reservation. Each uncached country reserves the existing generator's 8 MiB request allowance before the run begins. A request attempt stays owned by the generator's original per-city cache and ledger. The runner never clears or retries a spent request. It invokes generation, `--check`, then `verify-playable-destination.ts` for each city before advancing. The verifier runs with a 256 MiB Node heap. Every Python child runs with `-I -B`, so importing the generator cannot create an untracked source bytecode file before the frozen-tree check. Child output capture is bounded. The runner terminates and reaps its owned process group if the finite outer deadline expires, including grandchildren that outlive the process-group leader.

Resume only the exact frozen contract; its country selection and budgets cannot be changed:

```sh
python3 world/tooling/run_africa_starters.py \
  --resume "$PWD/.cache/world-build/playable-africa-runs/<contract-sha256>/contract.json"
```

Resume requires the same clean tracked Git commit, source hashes, and executable paths. A city already verified is replayed through the offline source check and isolated engine verifier without another acquisition. An interrupted request is never repeated: the runner only continues offline if the original cache is present. Failed matching attempts remain visible in the generator's original ledger and the run report.

South Sudan is refused unless the explicit Juba selection packet and its exact SHA-256 are both supplied on a new run:

```sh
python3 world/tooling/run_africa_starters.py --country SS \
  --juba-selection world/playable-africa-rollout/south-sudan/selection.json \
  --juba-selection-sha256 <exact-packet-sha256> \
  --node /absolute/path/to/node --python /absolute/path/to/python3
```

The generator publishes through `world/tooling/atomic_starter_publication.py`, which binds staged assets and receipt bytes to a private durable intent. If a partial city output or stage exists, this runner allows the offline generator to resume only when the city's current-UID private staging directory contains a bounded regular `intent.json` matching the planned country and city and the original source cache is present. It records `publicationRecoveryRequested` separately and never acquires source data for recovery; the generator rechecks source and payload pins before publishing. Missing, mismatched, symlinked, or otherwise unowned intent and missing cache remain preserved and refused for manual review.

The run contract and report are local cache evidence. Generated source assets, receipts, request caches, and attempt ledgers remain in their existing locations and remain authoritative. This runner does not deploy, modify Nigeria, change shared catalogue/runtime admission, or claim whole-city or country coverage.

Focused tests use temporary fixture roots and child processes only:

```sh
python3 -m unittest discover -s world/tooling -p 'test_run_africa_starters.py' -v
```
