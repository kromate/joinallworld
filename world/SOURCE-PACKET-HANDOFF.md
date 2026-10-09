# Source packet handoff check

`check-source-packet.py` proves only that declared source-file bytes match Git blobs at one exact commit. It reads packet JSON, resolves the requested commit, and uses `git cat-file` against that immutable commit. It does not inspect the target worktree contents, change refs, check out files, fetch objects, or write into the target repository. Packet JSON is limited to 1 MiB; each pinned blob is limited to 16 MiB.

The result names the exact `targetSha`, packet SHA-256 values, selected and omitted paths, and source mismatches. A passing result sets `sourceIdentity: true` and always keeps `releaseReady: false`. This check says nothing about builds, tests, provider state, runtime behavior, deployment, or whether production-open-country metadata is factual.

For the first-five packet, audit all 45 declared source files at the same exact Integration commit:

```sh
INTEGRATION_WORKTREE=/Users/anthonyakpan/Desktop/allworld-integration
INTEGRATION_SHA=39d94b117a6ab4b0e8e063b835889517c9d70dca

python3 scripts/world/check-source-packet.py \
  --target "$INTEGRATION_WORKTREE" \
  --ref "$INTEGRATION_SHA" \
  --packet world/playable-africa/packet.json
```

The airport-desk repair packet contains an audit workflow outside the source-only handoff. Audit its two reviewed source paths explicitly and separately at that same commit. The result must list `.github/workflows/airport-desk-audit-ci.yml` under `omittedPaths`:

```sh
python3 scripts/world/check-source-packet.py \
  --target "$INTEGRATION_WORKTREE" \
  --ref "$INTEGRATION_SHA" \
  --packet world/playable-africa/airport-desk-repair.json \
  --path src/game/content/venues-transport.ts \
  --path src/game/content/venues-transport.test.ts
```

Do not omit the two `--path` flags for the airport repair packet: without them, all packet entries—including the audit workflow—are selected for comparison. The explicit selection fails if either path is missing or undeclared, or if a selection is repeated. The checker lists omitted packet paths in its JSON result rather than silently approving them.

Synthetic CLI tests run with:

```sh
python3 -m unittest world.tooling.test_source_packet -v
```

At the exact example commit, the first-five comparison passed all 45 files and
the airport comparison passed both selected files. Ten isolated CLI tests pass,
including mutable-worktree independence, wrong or missing committed source,
explicit omissions, file-mode refusal and a FIFO packet with no writer.
These results leave `releaseReady: false`; production remains outside this check.
