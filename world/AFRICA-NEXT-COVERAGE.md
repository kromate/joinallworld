# Africa starter coverage and next batch

The pinned inventory has 43 remaining-country rows and eleven excluded rows, a dataset denominator of 54 sovereign-country candidates. The atlas has 56 country-or-territory entries, a different denominator. Ten earlier-wave city modules are present: Yaoundé, Lomé, Accra, Nairobi, Algiers, Cotonou, Abidjan, Dakar, Cape Town and Addis Ababa. The first five foreign starters and Nigeria are currently live; the second five are source modules, and the next-five runtime candidate C1 is not deployed. Do not treat generated files or source packets as runtime or production admission.

Within the 43 remaining-country rows, sixteen have generated city modules and receipts represented in source packets for batches three through six. This includes Conakry, the separate sixth one-city packet. These sixteen have no runtime admission. Twenty-seven rows have no generated starter module or receipt. Twenty-six have a selected settlement point, an exact ISO join, an IANA timezone, a same-ISO scheduled OurAirports candidate, and no recorded inventory gaps. South Sudan is the remaining row: its pinned place point has no selected-place output asset and its place/country ADM0_A3 values differ (`SSD`/`SDS`). A source-selection packet exists for Juba, but it is an evidence-gated path and is not part of the proposed batch. Nigeria already has playable cities; it is excluded by design, with no new foreign-starter module planned. Across the 54-country dataset denominator, 26 rollout starter modules have been generated and 28 do not have a new rollout starter module; this count describes generated source, not game admission.

The proposed seventh batch is Somalia (`SO`, Mogadishu), Libya (`LY`, Tripoli), Tunisia (`TN`, Tunis), Sierra Leone (`SL`, Freetown) and Liberia (`LR`, Monrovia). Each has matching Natural Earth ISO joins, no recorded inventory gaps, a pinned IANA timezone and a same-country scheduled airport candidate. The selected airport candidates are large-airport records for the first four and a medium-airport record for Liberia. The static catalogue row-plus-loader sizes, computed using the builder's serializer against the pinned inventory, are 143, 134, 132, 146 and 140 bytes respectively, within the existing 150-byte cap. The runner's own plan phase must independently confirm these identities and sizes before it freezes a run contract.

The Natural Earth settlement records classify these points as Admin-0 capitals, but that classification may be stale; this packet does not claim current official capital status. Airport names and coordinates are OurAirports dataset records, not official ARPs or evidence of current operations or service. They remain distinct from the city coordinates. No airport schedules, routes, building coverage or whole-city coverage are inferred.

## Bounded runner command

After review and when the shared heavy slot is available, invoke the existing runner once with the explicit selection and finite bounds. It acquires any uncached country samples serially; it does not reset request ledgers. Use the known executable paths for the local Node and Python runtimes:

```sh
PYTHON="/Users/anthonyakpan/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
NODE="/Users/anthonyakpan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
"$PYTHON" -I -B world/tooling/run_africa_starters.py \
  --country SO --country LY --country TN --country SL --country LR \
  --seconds 600 --max-countries 5 --max-reserved-bytes 41943040 \
  --python "$PYTHON" --node "$NODE"
```

The runner freezes a content-addressed contract and report under `.cache/world-build/playable-africa-runs/`. Its final JSON reports `status: complete`, the country list, contract hash/path and report path; the report records each city's `verified` status. The maximum potential request reservation is five times the existing 8 MiB per-city allowance (40 MiB); each city remains under the existing 45-second acquisition, 350-building, 160-road and 6,000-point limits. The six generated files per city are the existing five city assets plus a receipt. The runner also performs its existing source checks and isolated destination verifiers. If a run stops partway, resume only its exact contract; do not start a new identical acquisition contract.

There is no `seventh-five.json` yet. Existing batch packets pin actual receipts, generated source files and run evidence; creating one before the serial run would invent results. Once the five cities have completed and their checks pass, a packet can be assembled from the actual receipts and source hashes, with `registeredInProduction: false` until separate runtime admission.
