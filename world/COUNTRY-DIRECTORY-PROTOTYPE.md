# Country metadata directory prototype

The offline compiler separates country availability from selected-country city
metadata. It reads accepted catalogue/facts from exact production C1
`c1f7c1f7369139ce559292318ba9842c23a28267`, the pinned 43-country rollout
inventory, and local source receipt/facts pairs. It imports no city geometry,
content, rules or travel edges. It writes only beneath the owned
`.cache/world-build/country-directory-output` directory and refuses existing
outputs or symlink parents.

The actual 9 October source checkpoint exported 54 country shards. Its availability
index is 14,060 raw JSON bytes; all shards total 120,463 bytes. Reading Libya adds
2,473 bytes. Initial index loading reads no country shard. Repeated selection
uses the cache. These are raw JSON measurements, not compressed startup sizes,
JavaScript heap measurements or device benchmarks.

All 40 existing Nigeria catalogue rows retain their IDs, names, state metadata,
coordinates, airport bits, open status and order. The generated open Kaduna row
continues to shadow the legacy closed reserved row. Nigeria source trees are
unchanged from C1. Ten accepted foreign cities remain open. The 26 other generated
source cities and 17 selected candidates remain closed. This source inventory has
54 sovereign countries; the game atlas's 56 map entries include a different
country/territory denominator.

The source timezone comes from the inventory's independently selected IANA zone.
Natural Earth's optional timezone remains separate settlement provenance. Missing
or mismatched IANA selection rejects a queued receipt. Dar and Gaborone retain their
original historical packet hashes and explicit audited correction transitions.
Mogadishu's newer packet already pins its corrected receipt. No historical packet
is rewritten.

## Reproduce and check

Use the isolated WORLD checkout and an existing checkout containing C1 Git objects.
The receipt records the exact input checkpoint and code hashes. New source batches
change the export; this acceptance does not certify future input changes.

```sh
node --max-old-space-size=128 --test world/tooling/country-directory-prototype.test.mjs
node --max-old-space-size=128 world/tooling/country-directory-prototype.mjs \
  --release-root "$RELEASE_ROOT" --world-root "$WORLD_ROOT" \
  --out "$WORLD_ROOT/.cache/world-build/country-directory-output/NEW_DIRECTORY"
node --max-old-space-size=128 world/tooling/check-country-directory-prototype.mjs \
  "$WORLD_ROOT" "$RELEASE_ROOT" "$OUTPUT_DIRECTORY" "$INDEX_SHA256"
```

Run these commands through the shared `scripts/agent-slot.ts heavy --wait-ms 0`
wrapper. Admission exit 75 means the command did not run. Preserve failed logs
and use a new output directory; do not remove a successful export to reuse its name.
The independent checker is intentionally tied to this exact C1 and source-count
checkpoint. Updating its expected counts requires review of the new source packet.

The reader verifies index and shard hashes, uses a 512 KiB raw JSON residency cap
including the index, permits at most two distinct pending reads, deduplicates
same-country reads, evicts cached shards by recency, and rejects reads after
disposal. Fixture checks cover tampered bytes, undersized cache, output symlinks,
pending-read limits, Nigeria reservation behavior and timezone provenance.

## Runtime handoff

This Node-only prototype has no game runtime import, deployment, public serving
route or production admission effect. Game bundle savings are unmeasured. The
next adapter must use a portable bounded HTTP reader, an explicitly accepted
destination manifest and lazy country selection. Server travel authority still
needs trusted admitted destination metadata independently of browser loading.
Integration owns that runtime boundary and the combined release. Preserve existing
startup limits, Nigeria journeys and old saves. Verify exact candidate build sizes,
normal country selection, paid travel, save/reload, network failures and mobile
rendering before promotion. Do not merge the WORLD source branch wholesale:
automatic catalogue generation would otherwise register unadmitted city modules.
