# Sofa upholstery diagnostic integrated recipe v5

This v5 recipe corrects a duplicate manifest creation in v4. The package job creates `source-pins-sofa-v1.json` exactly once: the CPU runner owns the sole `source-seal` phase. The workflow does not call that `wx` sealer separately. The render job is a fresh checkout and creates only its own `review-sources-sofa-v5.json`; it validates the downloaded CPU package without trying to recreate the package's source-pins file.

The source-pins schema and the ten existing CPU compiler/finalizer helpers remain sofa-v1 `/3` compatible. The CPU runner seals v5 workflow/recipe inputs and then invokes those helpers serially under the established 384 MiB group / Node 96 MiB / 25-second bound. The v5 workflow, branch, CPU/render artifact names, render runner paths, and recipe-pin schema are consistent.

The render job checks and links its controller before Chrome, then compares baseline/candidate Home across eight seated captures: day/night × normal/close. It records counters, seat anchors, and source/output hashes under the existing 2 GiB / Node 96 MiB / 60-second diagnostic render limit. This is not phone or production-size acceptance. No build or browser render has run for v5.
