# World builder checkpoint — 8 October 2026

The full objective remains active. Builder work is isolated on `codex/world-foundation` in `/Users/anthonyakpan/.codex/worktrees/world-foundation/joinallworld`; game data and the advancing primary checkout are untouched. Foundation commits are `c6e246e5` and `d45cd58d`. New production-ingestion work is undergoing final integration validation.

## Implemented and measured

- The pinned Natural Earth 110m inventory has 177 source units, 186 hierarchy nodes and 176 outlines, with Nigeria protected as `legacy-ng`. Latest manifest is `8c40558c7cd6eff38be2c6d94bdaaafc04bfdc3f601fb45c4441d16b4b7d0a4f`; logical published size is 354,201 bytes. Country identities are independent of source release. This coarse source omits microstates and small territories.
- The preview lazily verifies and loads hierarchy nodes and outlines with byte limits and an LRU cache. Browser checks covered Fiji's dateline, Antarctica, protected Nigeria, desktop and narrow layouts. The current real Accra v2 pack was also checksum-verified and displayed. Only the selected tile is drawn; automatic camera-driven cell streaming is not implemented yet.
- Overture `2026-09-23.1` acquisition uses a pinned static STAC index, bbox pushdown and exact intersection, a bounded range proxy, private DuckDB tooling, resource supervision, immutable receipts and append-only attempt evidence. Compiler v2 filters transportation to `subtype=road`; historical v1 extracts can contain rail/water tagged as roads and remain preserved.
- The real v2 Accra extract is 113,357 bytes with 314 features, SHA `16fa23b6761af554a7cb11c9fa979bef5ddaed46cf2216b006e92094923fe26d`. It fetched 16,519,093 measured response bytes in 44,826 ms. The coordinator independently verified bytes, hash, feature count and upstream byte sum.
- `representative-real-v2` compiled cached Accra into 12 tiles with 233 buildings / 81 roads / 127,539 serialized bytes, fetching no new network data. Manifest: `34442dbc40ed2db8d987370141f4e88fb3b1e58336347dbab5b5a72af067a847`. Its remaining six geographic probes and protected Nigeria entry have not yet been accepted. The campaign has bounded caps and resume journals; acquisition and shared-cache accounting serialize under one canonical-root lock.
- Six pinned NASA POWER/MERRA2 point responses total 139,156 bytes and cover monthly 1991–2020 climate normals. They distinguish temperature, relative humidity, precipitation rate and scalar wind; Antarctica is cold and Sahara is dry in the measured samples. Profiles are published separately and not yet attached to world packs. Terrain metadata exists; terrain tiles have not been ingested.

## Nigeria rendering, explicitly authorized by the user

An independent worktree at `/Users/anthonyakpan/.codex/worktrees/nigeria-rendering/joinallworld`, branch `codex/nigeria-rendering`, now contains commit `6ad7579b`: filmic tone mapping, rebalanced lighting and clearer land/building/water colors. Map data, geometry, identities, saves, travel, catalogue and database behavior are unchanged. Builder ingestion still excludes Nigeria.

All 24 map tests, five-project typecheck, production build and download budget checks pass there. Full-layer fixtures measure 84,643 triangles / 34 calls and 84,749 / 38, below 90,000 / 40. First paint is 35,421 bytes Brotli and Lagos startup 194,779 bytes Brotli. Browser checks covered Lagos at desktop and 390-pixel width, no horizontal overflow, flat-map fallback and restoration, with no console errors. Visual comparisons are night-only; controlled day/dusk and inland-city visual checks remain follow-ups. No merge or deployment occurred. See that worktree's `docs/NIGERIA-RENDERING.md`.

## Validation and next work

The current integrated world suite passes 78 tests; world TypeScript validation also passes after the abortable shared-lock fix. Python and preview build need a final settled run. See `M2-VALIDATION.md` for evidence and limits.

1. Finish final Python/build checks, then commit the verified ingestion/environment/preview milestone.
2. Observe the authorized remaining representative run, currently live under the 256 MB network / 90-minute campaign / 1.5 GB disk caps. It has exposed a queue-ordering bug: insertion priority is not respected by the existing claim query. Let this authorized probe run finish, then review a backwards-compatible durable priority fix before any changed-queue run; do not claim Africa-first scheduling yet. Review actual coverage exceptions and throughput before scaling.
3. Ingest terrain with a declared vertical datum; complete finer global administrative/city inventory and stable aliases; attach climate profiles; add visible-cell streaming and eviction/disposal checks.
4. Measure physical low-end device and real journey transfer costs, verify distribution licences, and implement the separately tested gameplay adapter. Preserve Nigeria and concurrent graphics work.

No paid jobs, external publication, merge or deployment have started. Tiny-cell results do not establish whole-world completion in two days. Agents work only while the session is active; a persistent bounded runner also requires an awake machine. Failed acquisition attempts retain conservative reservations when exact response bytes are unavailable.
