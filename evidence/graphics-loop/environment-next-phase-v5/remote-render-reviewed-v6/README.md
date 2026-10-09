# Remote render review v6

V5's actual run (`37894413114`) reached no browser work: the runner created `supervisor-events.jsonl`, then the controller rejected that legitimate new file because its result-directory allowlist permitted only `browser.log`. V6 establishes a narrow ownership contract instead of broadening the whitelist.

The runner creates a fresh per-run directory with `exist_ok=False`, exclusively creates `supervisor-events.jsonl`, writes and fsyncs a run-unique 128-bit owner token in its first `supervisor-initialized` record, and passes that token only to the controller. The controller accepts exactly two regular, nonsymlink entries: `browser.log` and `supervisor-events.jsonl`. It requires the fsynced first record to carry the current token and validates every subsequent newline-terminated record against it. It ignores only a final unterminated append tail, avoiding a reader/writer race. Any extra file, prior capture, malformed complete record, wrong owner, or additional preexisting directory content is rejected.

The fixed package remains run `37892370818`, commit `6ad217d26d02c268af70ccb69758bca75b19d6f4`, artifact `environment-whole-slice-v5-reviewed-v4-37892370818`. The remote-only diagnostic group ceiling is 2 GiB; Node old-space remains 96 MiB and the timeout remains 60 seconds. Those limits do not alter game, phone, or package budgets.

`test-result-dir-contract-v6.mjs` exercises a legitimate freshly initialized directory, a partial append tail, a malformed complete record, an unrelated old capture, an owner-token mismatch, and an extra JSONL artifact in a temporary directory. The controller still emits phase events and the supervisor records process state/RSS peaks. No browser, build, server, or publication is part of this preparation.
