# Africa starter coverage and next batch

The pinned inventory has 43 remaining-country rows and eleven excluded rows, a dataset denominator of 54 sovereign-country candidates. The atlas has 56 country-or-territory entries, a different denominator. Ten earlier-wave city modules are present: Yaoundé, Lomé, Accra, Nairobi, Algiers, Cotonou, Abidjan, Dakar, Cape Town and Addis Ababa. All ten foreign starters and Nigeria are deployed in C1. Full CI, all-ten sealed verification and scoped native round trips passed before its production upload. The provider accepted version c844916f-0ffb-49f1-9c26-ccc6d2ec9469 at100%; the public backend adopted C1 at21:35:32UTC and original synthetic identity, nine saved fields and duplicate receipt passed at21:35:43UTC. The live eleven-open map, green country polygons and five new fare cards were independently observed at21:38UTC; see production-c1-eleven-country-acceptance.json. This read-only production witness does not claim completed production flights or physical-device acceptance. Do not treat generated files or source packets as runtime or production admission.

Within the 43 remaining-country rows, twenty-six now have generated city modules and receipts. Sixteen are represented in source packets for batches three through six, five in the seventh packet and five in the eighth packet. This includes Conakry, the separate sixth one-city packet. These twenty-six have no runtime admission. Seventeen rows have no generated starter module or receipt. Sixteen have a selected settlement point, an exact ISO join, an IANA timezone, a same-ISO scheduled OurAirports candidate, and no recorded inventory gaps. South Sudan is the remaining row: its pinned place point has no selected-place output asset and its place/country ADM0_A3 values differ (`SSD`/`SDS`). A source-selection packet exists for Juba, but it is an evidence-gated path and is not part of the proposed batch. Nigeria already has playable cities; it is excluded by design, with no new foreign-starter module planned. Across the 54-country dataset denominator, 36 foreign rollout starter modules have been generated; 17 remaining candidates have no starter, while Nigeria retains its existing playable implementation; this count describes generated source, not game admission.

The actual seventh acquisition window produced Somalia (`SO`, Mogadishu), Libya (`LY`, Tripoli), Tunisia (`TN`, Tunis), Sierra Leone (`SL`, Freetown) and Liberia (`LR`, Monrovia). Each has matching Natural Earth ISO joins, no recorded inventory gaps, a pinned IANA timezone and a same-country scheduled airport candidate. The selected airport candidates are large-airport records for the first four and a medium-airport record for Liberia. The static catalogue row-plus-loader sizes, computed using the builder's serializer against the pinned inventory, are 143, 134, 132, 146 and 140 bytes respectively, within the existing 150-byte cap. The frozen fa8 contract ran in14.088 seconds, then its exact-contract resume ran in2.816 seconds with all15 source/request files unchanged. These are source-run results, not runtime or whole-city acceptance.

The Natural Earth settlement records classify these points as Admin-0 capitals, but that classification may be stale; this packet does not claim current official capital status. Airport names and coordinates are OurAirports dataset records, not official ARPs or evidence of current operations or service. They remain distinct from the city coordinates. No airport schedules, routes, building coverage or whole-city coverage are inferred.

## Bounded runner command

The following command documents the executed initial window; do not repeat it as a new acquisition. Resume only the original frozen contract against its exact original tool pins. It acquires any uncached country samples serially; it does not reset request ledgers. Use the known executable paths for the local Node and Python runtimes:

```sh
PYTHON="/Users/anthonyakpan/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
NODE="/Users/anthonyakpan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
"$PYTHON" -I -B world/tooling/run_africa_starters.py \
  --country SO --country LY --country TN --country SL --country LR \
  --seconds 600 --max-countries 5 --max-reserved-bytes 41943040 \
  --python "$PYTHON" --node "$NODE"
```

The runner freezes a content-addressed contract and report under `.cache/world-build/playable-africa-runs/`. Its final JSON reports `status: complete`, the country list, contract hash/path and report path; the report records each city's `verified` status. The maximum potential request reservation is five times the existing 8 MiB per-city allowance (40 MiB); each city remains under the existing 45-second acquisition, 350-building, 160-road and 6,000-point limits. The six generated files per city are the existing five city assets plus a receipt. The runner also performs its existing source checks and isolated destination verifiers. If a run stops partway, resume only its exact contract; do not start a new identical acquisition contract.

The seventh source packet is committed in `seventh-five.json` and `seventh-five.md`. Independent review found37 Mogadishu road vertices outside its declared bounds, plus64 in Dar es Salaam and11 in Gaborone. All three cached-source corrections now complete and resume successfully. Independent auditing proves zero retained vertices outside corrected bounds, every original road/building coordinate unchanged, and source/request ledger hashes unchanged. Old outputs are preserved in versioned archives; original batch packets remain historical. The revised seven-city isolated engine check passes in3.814s. The v1 revision identity omitted its transitive compiler hash; its historical limitation remains in starter-extent-revisions-acceptance.json. The prospective V2 helper now pins the imported compiler/publication helper and passes14 fixtures, with legacy archive resume refused before publication. Completed V1 archives and their original results remain untouched. The seventh packet pins actual current receipts/assets and corrected-source verification, with `registeredInProduction: false`. Original earlier packets remain historical; their corrected Dar/Gaborone receipt lineage is explicit in the extent audit rather than silently rewritten.

The17 still-missing inventory rows are SS,TD,SZ,BI,LS,GA,NE,BF,GW,MR,GQ,GM,SC,MU,KM,ST,CV. All exceptSS have no recorded selection gaps. This list was derived from exact countryIso2 receipt joins on9October21:50UTC, not guessed city names. Further acquisition remains serial and bounded; source generation does not open these countries in production.


## Eighth source window

Central African Republic/Bangui, Sudan/Khartoum, Djibouti/Djibouti,
Eritrea/Asmara and Mali/Bamako completed in12.093s under frozen contract
`2e6db21dd8d400ba1f6031afe505db808379a6b73659f5b01523c8f438a42168`
on exact source `f3160b8064bb3ab4a68e5d8c13b0bdd6da75db3f`. The exact-contract
resume completed in3.261s with all15 cache/source/request files byte-identical.
Every retained building/road coordinate lies within its declared bounds. The
source packet `eighth-five.json` binds36 source files,1,750 retained buildings,
402 roads and4,436,730 actual source bytes. The finite window cap was60s,
max5countries/40MiB potential reservation; source acquisition remained serial.
Both windows passed source checks and isolated gameplay verification. No
production registry, flights, database or Nigeria map was changed.

Next source batch can select TD/SZ/BI/LS/GA after a fresh read-only plan, keeping
per-city and cumulative window limits. New source code must be committed before
freezing a new run. Existing completed contracts/ledgers remain historical;
never reset one to bypass source drift or an exhausted request.
