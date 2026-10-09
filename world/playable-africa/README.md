# Playable African starter destinations

This packet adds source-backed starter modules for Yaoundé, Lomé, Accra, Nairobi and Algiers. It is separate from the world-data viewer. A registered module can participate in the existing game lifecycle: fly from Lagos, arrive at its sourced airport, visit game venues, eat, work, reload a saved visit and fly home.

Production registration is a separate Integration-owned patch in `integration.patch`. Until that patch, generated catalogue outputs, startup budgets and browser acceptance pass on the assembled candidate, these countries are not open on production. The first release should open a country through its starter capital. It does not represent complete city or national coverage.

## What exists

Each city has a real Natural Earth capital point and a sourced airport reference point. Land is clipped from pinned Natural Earth country outlines to a window containing the capital and airport. A serial, bounded OpenStreetMap extraction supplies central streets and building rings. The five maps retain 1,475 building footprints and 622 street segments. Building silhouettes currently use the footprint's bounding box; missing heights are explicitly estimated. The lazy geometry chunks total about 500 KiB before compression and load only with the selected city map.

Guest homes, transit stops, meals, clinic activities, workshops, markets, reflection areas and community notices are fictional game venues, explicitly identified in content. They are not claims about real businesses, households, religious institutions or foreign elections. Prices and jobs use the existing provisional Allworld economy. No currency conversion, commercial airline schedule, live weather or complete street-level simulation is claimed.

The current renderer uses the existing stylized city frame. Source longitude/latitude is retained, but the frame's fixed standard parallel distorts east-west scale farther from Nigeria, especially Algiers. A later global/local projection milestone should improve scale without changing saved city, home or venue identities.

## Sources and repeatability

`data-inventory.json` records pinned capital/country source assets and coverage gaps. `airports.json` records aviation-source reference points, source precision, airport identities and cross-checks. Algeria's coordinate evidence includes an explicitly labelled archival AIP mirror. Accra's current official airport name differs from its former Kotoka name.

Each `<city>-sources.json` retains the OSM request URL, raw SHA-256, timestamp, retained and observed feature counts, omissions, byte limits, clipping inputs and generated asset hashes. Raw XML stays in the separate builder cache; no contributor identity fields enter the game assets. Relations are omitted by this starter converter. Building and road caps deliberately omit excess features rather than imply complete mapping.

Run `python3 scripts/world/build-playable-africa.py --check` to verify the tracked asset hashes offline. To regenerate on this workstation, run the script without `--acquire`; it requires the existing pinned raw cache and verifies its receipt. Explicit `--acquire` permits missing central samples, one request at a time, with an 8 MiB/45-second request boundary and two reserved request allowances per city. Identical failed requests are not silently retried. The initial wider Yaoundé query exhausted a boundary; the retained ledger records it separately from the smaller accepted request.

## Validation and release

The focused suite passes 16 tests under a 256 MiB Node heap. Five cases validate real map geometry, bounded source decoration and initial camera bounds containing the actual airport. Five validate the existing opened content contract. Five use isolated registry admission to exercise normal engine flight departure, exact fare deduction, duplicate-departure refusal, in-flight save/reload, airport arrival, visitor meal, unfinished-activity departure refusal, visitor reload and return to the original Lagos home/plot/style. One validates the reusable factory. These are engine and source results, not browser, host-receipt or production acceptance.

Each city has separate lazy rules, content and map entries. Its content wrapper calls the shared starter builder, so selecting one city does not fetch another city's content or map.

The dedicated remote audit checks Node 22 and 24 and strict TypeScript on the exact published packet. The first audit at `f2b9c9ab` passed all runtime cases and pinned assets on both versions, but its compiler invocation omitted `--types node`. The follow-up corrects the invocation without weakening assertions or contracts; its exact commit needs a fresh passing audit. A local broad compiler dependency check exceeded its bounded 256 MiB heap; no local memory limit was raised. Integration must then apply/review the small shared patch, regenerate compact catalogue/loaders/routes, adapt the source-check branch for these foreign modules, and run the combined startup/download, host, client, game and browser gates. Configured budgets stay unchanged.

Try the first deployed batch from Map → Africa: choose Cameroon, Togo, Ghana, Kenya or Algeria, use its capital's flight card, visit a meal or recreation venue, reload and return to Nigeria. Verify the original home and character progress remain. Check the same journey on a phone. Deployment identity, exact source and these results must be recorded before claiming the countries are live.

Next expansion uses the same module and source builder. Add a sourced capital, airport, real central sample and source receipt, then verify the same travel and save contracts. Deeper streets, real landmarks, regional conditions and additional cities can arrive incrementally after countries become usable.
