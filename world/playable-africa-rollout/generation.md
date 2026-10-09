# Serial playable city generation

The first ten starters have separate frozen packets. This generator handles explicitly selected remaining countries from the pinned inventory. It never edits Nigeria, the shared catalogue, atlas, databases, or deployment flags. Country admission and production release belong to Integration after the real host, browser and download checks.

The first generated rollout batch is Egypt/Cairo, Morocco/Rabat, Rwanda/Kigali, Uganda/Kampala and Zambia/Lusaka. Each has real retained OSM building rings and streets, a pinned Natural Earth settlement point and clipped land, an OurAirports airport dataset point, a lazy map/content module, and fictional starter services with a beta game flight to Lagos. This is a small central sample, not a completed city or country. Airport dataset points do not establish official ARPs, current operations or commercial routes. Weather and prices still use provisional game behavior.

```sh
python3 scripts/world/build-africa-starters.py --country EG --plan
python3 scripts/world/build-africa-starters.py --country EG --acquire
NODE_OPTIONS=--max-old-space-size=256 node --experimental-strip-types scripts/world/verify-playable-destination.ts cairo
python3 scripts/world/build-africa-starters.py --country EG --check
```

Select countries explicitly and process one city at a time, including its verifier before the next. Acquisition reuses the original 8 MiB / 45-second converter and its persistent request ledger; failed requests cannot be retried identically or reset. Nigeria and the first two release waves are refused. Existing directories without matching owned receipts and changed prior outputs are refused. Source gaps and catalogue rows beyond the existing 150-byte limit are refused before acquisition.

`--plan` performs no writes or requests and reports hypothetical acquisition intent. `--check` verifies generated asset pins and original cached source hashes offline. `--check-assets` is a separately named, narrower check for clean CI checkouts: it verifies tracked inventory/receipt identities and five generated asset pins without requiring the ignored source caches. Neither check invokes a source network request.

The remote rollout audit runs Node 22 and 24, generated asset checks, each isolated map/content/flight/save/activity/return journey, and strict TypeScript. This source audit does not replace assembled-game verification, hosted durable-save receipts, native navigation, budgets, or production acceptance. Keep the next batches out of a release already being checked so the first visible country improvements can ship independently.

Seven candidate rows currently exceed the compact catalogue limit, and South Sudan has a retained source-join gap. They remain explicitly refused until a reviewed compact representation or source repair preserves the existing contracts. Do not raise a budget or change geography to conceal those gaps.
