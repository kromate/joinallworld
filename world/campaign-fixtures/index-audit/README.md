# Portable retained source captures

This directory distributes the complete, unchanged raw inputs of three small
test queries. `manifest.json` binds six files (797,134 bytes) to their original
SHA-256 and byte pins in `world/regional-fanout.json` and `world/grid-query.json`.
The two overlapping Dakar experiments contain 473 and 1,810 source ordinals. They
are separate captures, not additive national geometry. The third retained Senegal
query has zero features; that does not establish physically empty geography.

The data comes from Overture release `2026-09-23.1`, Buildings and Transportation.
The raw extract and acquisition receipt bytes are unchanged. The only change is
their location in this test package. All source lists and notices in the receipts
are preserved. No mutable campaign ledger, usage journal, index, player record or
Nigeria replacement data is included. Test observations are explicitly synthetic
and do not prove campaign membership or completed gameplay.

The geographic database contents in this directory are available under the
[Open Database License (ODbL) v1.0](https://opendatacommons.org/licenses/odbl/1-0/).
The complete corresponding machine-readable test data is distributed here without
an additional fee. This database notice applies to these geographic fixtures; it
governs these database fixtures separately from the application code.

© OpenStreetMap contributors, Overture Maps Foundation.

Overture's Buildings attribution includes OpenStreetMap contributors, Esri
Community Maps contributors, Microsoft Global ML Building Footprints, Google Open
Buildings, USGS 3DEP, Qian Shi 2023 and work derived from IGN BTN 2024. Transportation
includes OpenStreetMap contributors and TomTom. The acquisition receipts preserve
the source-specific metadata for these queries. See the official
[Overture attribution and licensing](https://docs.overturemaps.org/attribution/),
[OpenStreetMap copyright](https://www.openstreetmap.org/copyright),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) and the ODbL link above.
The theme-license and notice requirements were checked 9 October 2026.

Tests prefer the original pinned cache entry if it exists. A corrupt or unsafe
existing entry fails rather than falling back. When the cache entry is absent,
tests verify and read this exact copy without creating a cache, downloading source
data or changing protected build state. These fixtures make the selected audit,
ingestion and session checks reproducible from a clean checkout. They do not make
the separate full retained-campaign test reproducible: that test also requires its
original immutable bindings and protected campaign ledger.
