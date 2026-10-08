Campaign tests create pinned local plan snapshots in temporary workspaces and use the tracked basic GeoJSON fixture. No preview or production cache data is written. `inputBytes` is a hard cumulative 64,000,000,000-byte ceiling: local sources charge their exact SHA-256/byte pin once, while acquisitions reserve remaining input capacity before calling the adapter, bound its output allowance by that capacity, then settle to the acquired exact-extract pin. Retries and repairs retain prior network reservations/spend; matching exact input pins are not charged twice. Torn final usage-journal records are audited before recovery.

`accra-real.json` is the bounded production acceptance fixture. It binds the Ghana/Accra Overture request and protected `legacy-ng` Nigeria entry to the verified Natural Earth inventory hash `8c40558c7cd6eff38be2c6d94bdaaafc04bfdc3f601fb45c4441d16b4b7d0a4f`. Run it with the campaign CLI, `--inventory-manifest` pointing to that content-addressed inventory manifest, and `--python` pointing to `.cache/world-build/tooling/venv/bin/python3.12`. The real adapter reuses `.cache/world-build/acquisitions`; campaign ledger, output and repair quarantine remain under `.cache/world-build/campaigns/<id>/`.

`representative-real.json` pins seven strict requests from `world/pilots/representative-requests.json`, followed by protected `legacy-ng`: Accra, Nairobi, Cape Town, the Libya/Sahara sparse probe, London, Fiji, and Antarctica. Durable ledger priority is now implemented and claims order by `priority`, `available_at`, then `id`; priorities are 0–7 in that order. Existing pre-priority ledgers migrate with priority zero, then an exact-identity enqueue refreshes scheduling priority (a leased job cannot be reprioritized). Its campaign caps are 256,000,000 network bytes, 5,400,000 ms total duration (90 minutes), 80,000,000 input bytes, 100,000,000 output bytes, 1,500,000,000 disk bytes, 1,536 MB memory, 600,000 ms per job, and two attempts.

Operate it in bounded batches. First run only the cached Accra job and review its report before authorizing later regions. Once authorized, `--max-jobs` selects that many jobs from the durable priority queue:

```sh
node --experimental-strip-types world/campaign-cli.ts run world/campaign-fixtures/representative-real.json --inventory-manifest /absolute/path/to/.cache/world-build/output/inventory/manifests/8c40558c7cd6eff38be2c6d94bdaaafc04bfdc3f601fb45c4441d16b4b7d0a4f.json --python /absolute/path/to/.cache/world-build/tooling/venv/bin/python3.12 --max-jobs 1
node --experimental-strip-types world/campaign-cli.ts status representative-real-v2
```

After reviewing and approving the first result, resume one job per invocation until status reports no queued work:

```sh
node --experimental-strip-types world/campaign-cli.ts resume world/campaign-fixtures/representative-real.json --inventory-manifest /absolute/path/to/.cache/world-build/output/inventory/manifests/8c40558c7cd6eff38be2c6d94bdaaafc04bfdc3f601fb45c4441d16b4b7d0a4f.json --python /absolute/path/to/.cache/world-build/tooling/venv/bin/python3.12 --max-jobs 1
```

Every acquisition reserves campaign network/input/output/disk capacity in the durable usage journal before calling the adapter. Failed attempts retain their network reservation and spend; resuming does not clear the journal or reset those totals. `status` exposes remaining work and source-unit outcomes after each step.

The `representative-real-v2` acceptance campaign is terminal with status `exception`: 4 of 7 source units compiled, 3 have explicit exceptions, the protected Nigeria unit completed, and no work remains queued. Accra, Nairobi, Cape Town, and London produced 1,123 features in total. Sahara and Antarctica each returned an empty source extract, which is recorded as an empty-geography exception rather than coverage. Fiji failed twice with `Server returned nothing (no headers, no data)`; both attempts took about 162 seconds and network bytes were unmeasurable. Each failed attempt retains its full 32,000,000-byte reservation. Cumulative campaign network accounting is 113,303,391 bytes: 49,303,391 measured and 64,000,000 reserved with unknown transfer. This is a bounded representative acceptance result, not whole-world coverage.

The terminal resume report is recorded in `.cache/world-build/evidence/representative-v2-final-resume-3.json`; Fiji attempt details are in `.cache/world-build/acquisition-attempts/50dca48498a75f98b449a48be7bdc3fef4897ffd9c5fe7e57ab2a29f60bca38a/attempts.jsonl`. See `world/FIJI-DIAGNOSIS.md` for the offline transport/index diagnosis and proposed observability work.

Production runs with the real acquisition adapter require `--inventory-manifest` pointing to the content-addressed inventory manifest. The runner checks the manifest hash and walks content-addressed reachable nodes to verify requested unit IDs and the source-unit denominator; it saves that path/hash binding for later `status` verification. Tests may inject the adapter and use isolated temporary snapshots.
