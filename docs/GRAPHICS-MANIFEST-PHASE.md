# Street manifest deduplication phase

The current street manifest duplicated its complete immutable version for Lagos and Ibadan. The current entry is now a strict city/version pointer; the server resolves the same immutable data and returns the same projected gameplay manifest and tiles. Legacy full current manifests and explicitly requested retained versions remain supported. No client renderer, world geometry, tile, door, account or persistence schema changes.

Publication validates and writes immutable data before atomically switching the current entry. Invalid, missing, nested or mismatched targets fail closed. Current static manifest URLs revalidate (`no-cache`); versioned URLs remain immutable. Existing four-entry manifest/pending caps, 60-second current lookup cache, tile limits and download/package caps remain unchanged.

## Verification

Isolated `codex/graphics-phase-one` build from bb59728a plus the listed source changes; subsequent test-only commits changed no built runtime bytes. Source inventory: 7,594 files, SHA-256 da920570beccee633396e88b5be8a896592ee30739675f24c67d846c2ebb2e74. Node focused checks 24/24; built-dist Worker checks 52/52; five-project typecheck, build and download limits pass. Earlier data audit preserved all 10,225 tiles and 15,920 doors and matched 42 sampled projected responses; all 5,120 other street files remained identical.

| Entire distribution | Raw bytes | gzip bytes | Brotli Q11 bytes |
| --- | ---: | ---: | ---: |
| Immutable original 1a329026 | 84,369,438 | 11,639,126 | 9,148,382 |
| Isolated phase candidate | 77,529,393 | 10,952,039 | 8,737,437 |
| Reduction | 6,840,045 | 687,087 | 410,945 |

These are complete per-file local compression sums, not observed HTTP transfer. First paint including HTML/CSS: 90,861 / 35,514 / 35,393 raw/gzip/Brotli versus original 100,903 / 39,763 / 35,424. Largest startup (Lagos): 614,295 / 222,576 / 194,713 versus original 624,171 / 226,773 / 194,750. The original baseline and limits were not reset or raised.

This evidence covers the isolated manifest phase. It does not certify concurrent country-map additions or the graphics overhaul. The release owner must rerun checks on the exact integrated source and seal that package before deployment. WORLD retains production ownership under [AGENT-COORDINATION.md](AGENT-COORDINATION.md). No production upload was performed by GRAPHICS for this phase. Character LOD, clothing, foliage and other renderer experiments are excluded; physical-phone graphics performance remains unverified.
