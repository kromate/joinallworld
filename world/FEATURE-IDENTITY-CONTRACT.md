# Complete source-feature identity and global owner v1

The pure contract below is implemented. Focused identity/country-grid/pack checks
passed31/31; the World compiler passed after a test-helper narrowing correction.
The body/owner implementation did not change between those checks. The durable index, campaign hook,
independent capture/index verifier and country compilation are not implemented.
This does not alter any existing pack ID, game entity, acquisition identity, grid,
Nigeria map, save, database or published product.

## Inputs and authority

`identifySourceFeature(feature, binding)` is a pure, synchronous function in
`feature-identity.ts`. The caller supplies the complete parsed Feature and an
explicit `{provider:'overture', release, layers}` binding. The release spelling is
`YYYY-MM-DD.N` (one to three revision digits); this accepts no implicit latest
release. Actual acquisition still requires its existing pinned release. Supported
receipt layers are buildings and roads; literal `properties.sourceLayer` values
are buildings and transportation, respectively. A supported feature whose layer
is absent from the binding throws an integrity error. An unknown projection is an
explicit source exception, never a guessed layer.

The pure function cannot prove receipt/extract integrity or provenance. The later
ingestion hook must independently verify request, release, layer-specific source
records, exact pinned bytes, SHA256, count and ordinal before calling it. Source
exceptions must retain the pinned capture/ordinal and participate in conservation
accounting; they cannot be silently dropped or count as acquired geometry.

## Key and complete-body version

The exact key tuple is `{provider:'overture',release,sourceLayer,sourceFeatureId}`.
Hash existing `pack.canonicalJson(tuple)` as UTF8 SHA256, **without a newline**.
Keep all tuple fields alongside the hash. Neither query/campaign name, requested
layer combination, capture bbox, country, source label nor feature coordinates
belong in the key. Source IDs must be strings, nonempty, at most256 UTF16 code
units, without whitespace/C0/DEL characters. Spelling and case are exact; numeric
IDs are ordinal-bound unsupported exceptions and are not coerced.

Hash the complete admitted Feature using the same existing canonical JSON and
no-newline UTF8 rule. Preserve all properties, nulls, source array order, multipart
order, rings/holes, original coordinates and additional finite coordinate
components. Object key order is canonical. Body changes under one key require the
future store to retain both versions and mark an explicit conflict; never choose
arrival order or overwrite. Geometry-only equality is insufficient. Different
releases/layers remain separate keys. This key is source accounting, **not** a
lifelong game house ID. A later entity crosswalk must explicitly handle verified
source versions, aliases, splits and merges before persistence integration.

The existing canonicalizer is unchanged. Before invoking it, reject `__proto__`
keys at any depth, cycles, nonfinite/non-JSON values, hidden/accessor/symbol
properties, nonplain objects/arrays and sparse/extra-property arrays. Its current
object normalization can lose `__proto__` fields; no reduced Feature may be hashed.
The hook must parse bounded raw JSON, never pass executable objects/proxies.

Preflight counts exact canonical UTF8 bytes, including punctuation, JSON escapes,
paired/lone surrogates and numeric spelling, before allocating the encoded body.
An escaped string cannot expand beyond the bound before rejection. The actual
encoder byte count must then agree, or ingestion fails closed. This does not
replace the earlier raw-byte reader cap or the later store/WAL/resource limits.

## Deterministic owner, separate from coverage

Scan every actual supported vertex: all polygon rings including holes, all
multipolygon parts and all line/multiline parts. The admitted geometry types are
Polygon/MultiPolygon for buildings and LineString/MultiLineString for transportation.
Coordinates need at least two finite components, with longitude/latitude inside
WGS84; lines need two distinct 2D source vertices and closed rings need three.
These structural checks do not establish polygon topology or spherical validity.

For each **derived candidate only**, map longitude+180 to−180 and the longitude
of either exact pole to−180. Choose the lexicographically least candidate by
longitude, then latitude. Preserve the original source body. Ring winding,
rotation and multipart order cannot change owner, although they can change body
version. The anchor is a source vertex, not a centroid, bbox corner or query edge.

Assign the candidate through existing `geographicGridOwner(anchor,1)`, yielding
`geo-grid-v1:l1:xCOLUMN:yROW`. Its fixed half-degree lattice uses exact IEEE754
dyadic arithmetic before floor; do not compute rounded `(lon+180)*2`. Exact
internal boundaries belong east/north; +180 shares−180 ownership; +90 is row359,
−90 row0, both with column0. Ownership can lie outside all current query roots.
It says nothing about query completeness, country membership, clipping, renderer
coverage or playability. Owner-area coverage and country relations remain separate.

## Bounds and exception result

Frozen pure limits: ID256 code units, JSON depth32,500,000 visited nodes,
200,000 source positions,20,000,000 canonical Feature bytes. Smaller caller/capture
limits still prevail. All bounds remain enforced during the later raw-byte reader
and index transaction; these are not database/WAL/lifetime capacity claims.

Admitted results contain identity version, tuple/hash, complete body hash/bytes,
derived anchor/global cell and source position count. Exceptions contain a bounded
fixed code/message only: unsupported ID representation, invalid ID, unsupported
source layer, unsafe JSON, resource limit, invalid Feature, unsupported geometry
or invalid geometry. No invented key/anchor is returned for exceptions.

## Verification and subsequent gates

New focused fixtures cover exact keys/complete-body conflicts, literal independent
hash vectors, unchanged inputs, layer-set/release separation, all geometry parts,
seam/poles and adjacent binary-double boundary values, ID exceptions, unsafe trees,
resource caps and integrity failures. The independent Python fixture oracle uses
`Fraction(float)` to reconstruct exact binary positions. Its hash scope is only
ASCII integer-only fixtures, avoiding an unsupported claim that Python JSON is a
general ECMAScript canonicalizer. It is not a raw-capture/store verifier.

Next, during WORLD's explicitly handed-back intensive turn: profile the already pinned
positive overlapping Dakar extracts without network. Freeze measured index/transaction/WAL
limits before implementing durable capture/observation/conflict transactions.
Commit before marking the existing query job complete; replay after an index
commit/ledger crash must conserve ordinals and never manufacture complete coverage.
Independent raw-capture reconstruction and a cache-only overlapping-query pilot
must pass before country geometry compilation. Existing unknown source reservations
and immutable products remain untouched.
