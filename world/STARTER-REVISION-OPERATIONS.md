# Africa starter extent corrections

`scripts/world/revise-africa-starter.py` is a narrowly scoped, offline correction path for the reviewed Dar es Salaam (`TZ`), Gaborone (`BW`), and Mogadishu (`SO`) starter extents. It reruns the existing bounded compiler from each city's already-pinned OSM cache and Natural Earth source files. It does not make requests or alter the request ledger, source cache, rollout inventory, generator, catalogue, or runtime admission.

The correction uses the current generator's retained-feature bounds and land clipping. It computes the five new assets and receipt in a temporary directory, verifies their source identity, then creates a private versioned archive under `.cache/world-build/africa-starter-revisions/<city>/<revision-id>`. The archive retains the original five assets and receipt, the exact replacement payload, and a source-bound intent before the published directory is moved. Each city payload is capped at 24 MiB total (8 MiB per file); the bounded version archive is capped at about 73 MiB. Cached OSM remains capped at 8 MiB, pinned outlines at four parts and 8 MiB total, and the full plan/apply/resume operation has a 180-second deadline. The existing per-city publication lease serializes this operation with the regular generator. Receipt publication is last. A local crash can leave the city temporarily absent between directory renames; rerun the exact `--resume` command to complete it. The tool never repairs a partial file whose bytes do not match the expected payload prefix, and it refuses unknown or newer output.

First inspect the read-only plan and record its revision ID:

```sh
PYTHON=/Users/anthonyakpan/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3
"$PYTHON" -I -B scripts/world/revise-africa-starter.py --country SO --plan
```

After reviewing the before/after pins, apply only that exact revision:

```sh
"$PYTHON" -I -B scripts/world/revise-africa-starter.py --country SO --apply --revision-id REVISION_ID_FROM_PLAN
```

If interrupted, resume with the same country and revision ID:

```sh
"$PYTHON" -I -B scripts/world/revise-africa-starter.py --country SO --resume --revision-id REVISION_ID_FROM_PLAN
```

Use `TZ` or `BW` in place of `SO` for the other reviewed corrections. Run one country at a time. Do not run the regular generator for that city while a revision is staged. Keep the version archive and original publication evidence. A completed source correction does not establish runtime, browser, production, or release admission; those checks remain with the release owner.

Focused fixture coverage is in `world/tooling/test_revise_africa_starter.py`. It exercises CLI-level recovery at city and receipt publication boundaries, refuses a newer receipt before renaming the city, tests source-race and cache-only acquisition boundaries, and checks corrupt archive refusal. The release owner should run it after the native build/server slot is free; this task intentionally does not execute tests or real corrections.
