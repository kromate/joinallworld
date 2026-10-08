# Africa urban samples v1

This is a three-request, source-pinned Overture campaign. It samples small fixed cells around three Natural Earth populated-place points. It does not claim complete city geometry, municipal boundaries, civic centres, or Africa-wide urban coverage. The point records provide stable source identity and coordinates; the campaign cells are explicit acquisition selections derived from those coordinates.

## Admission evidence

The selected-place manifest is `17932383d2d75ce733a3cfae8e455d053be778fc09dcaa5ca06707416e55b61e`; its source is Natural Earth 10m populated places at release commit `ca96624a56bd078437bca8184e78163e5039ad19`, SHA-256 `9b8e3de09048ef00dfc70357dbb9fa324493f214b5e0ae4daf1aa79a8d10116b`, 19,359,003 bytes. Its verified parent country-directory manifest is `b3fb51b5660ed22b2ee354235c60291d6857b3dd9245afbabec3fc15918c8501`; that directory records the older accepted inventory hash `8c40558c7cd6eff38be2c6d94bdaaafc04bfdc3f601fb45c4441d16b4b7d0a4f` as its identity-continuity baseline. The same exact Natural Earth `NE_ID` country feature keys are present in both generations for Senegal, Ethiopia, and Tanzania, and Nigeria remains `legacy-ng` / provider `legacy-ng`.

The anchor snapshot records each selected-place inspection ordinal, full-feature hash, literal `NE_ID` source key, country point-asset SHA/length, point coordinates, and the exact acquisition request digest. The request digest is the acquisition implementation’s SHA-256 over canonical `{compiler, selection, sourceConfig}` where the selection contains schema version, request ID, inventory unit, region, provider, release, and layers. Request limits are not part of that selection hash; they remain independently validated and bounded by the campaign configuration.

These are three records from one pinned Natural Earth release. Natural Earth calls the source class `Admin-0 capital` for all three. For Dar es Salaam this is an obsolete capital classification: preserve it as provenance, but do not present Dar es Salaam as Tanzania’s current capital. The labels describe the source fields and are not a review of present legal or administrative status.

## Frozen cells and caps

Each region is a `cell` exactly 0.004 degrees wide and high, centered on its pinned point. The points are Dakar (Senegal, `Africa/Dakar`, NE_ID `1159151513`), Addis Ababa (Ethiopia, `Africa/Addis_Ababa`, NE_ID `1159151549`), and Dar es Salaam (Tanzania, `Africa/Dar_es_Salaam`, NE_ID `1159151305`). The fixture pins country parents by exact Natural Earth country identity keys, not by names or ISO fallback.

Each request pins Overture release `2026-09-23.1`, layers `buildings` and `roads`, and caps 32,000,000 network bytes, 10,000,000 output bytes, 5,000 features, 600,000 ms, 1,536 MB memory, and 128,000,000 disk bytes. The campaign total is capped at 96,000,000 network bytes, 30,000,000 input bytes, 40,000,000 output bytes, 512,000,000 disk bytes, 5,400,000 ms overall, 600,000 ms per job, 1,536 MB memory, and two attempts. A protected Nigeria `legacy-ng` entry follows the three requests at priority 3 and produces no world content.

Request priorities are 0–2 in Dakar, Addis Ababa, Dar es Salaam order. The first bounded invocation should use one job; inspect its source identity, measured response, coverage and exceptions before choosing a later invocation. The durable campaign journal retains conservative network reservations when transfer metrics are unknown and retains measured network, input, output and shared-cache disk usage. Resuming does not reset attempts or budgets. Empty source coverage is a measured exception, never filled with synthetic geometry.

The bounded first-job command is:

```sh
node --experimental-strip-types world/campaign-cli.ts run world/campaign-fixtures/africa-urban-samples-v1.json --inventory-manifest "$PWD/.cache/world-build/output/inventory/manifests/8c40558c7cd6eff38be2c6d94bdaaafc04bfdc3f601fb45c4441d16b4b7d0a4f.json" --python "$PWD/.cache/world-build/tooling/venv/bin/python3.12" --max-jobs 1
```

Root reviewed the cached source rows, exact country links and frozen requests. Actual first/resume source responses, compilation, exceptions and resource measurements are recorded separately in [AFRICA-URBAN-SAMPLES-OPERATIONS.md](AFRICA-URBAN-SAMPLES-OPERATIONS.md). Climate, terrain, live weather, global coverage, playability, and licensing conclusions beyond the already admitted Overture source configuration are outside this sample campaign.
