# Complete source-feature identity and global owner v1

Pure identity and strict pinned-capture binding are implemented. Current focused
capture/identity/country-grid/pack checks passed53/53 and World TypeScript passed
at the unchanged1536MiB heap. The cached positive overlap experiment passed; see
[FEATURE-IDENTITY-OPERATIONS.md](FEATURE-IDENTITY-OPERATIONS.md). The durable index, campaign hook,
independent capture/index verifier and country compilation are not implemented.
This does not alter any existing pack ID, game entity, acquisition identity, grid,
Nigeria map, save, database or published product.

[Fixed resource/recovery witnesses](INDEX-RESOURCE-OPERATIONS.md) now pass12/12,
including real spilled-WAL interruption, per-file/page limits and CPU/wall/RSS/output
guards. Near-byte-cap19MB identity and guarded cached overlap also pass. Actual
Node SQLite hard_heap_limit is unenforced with DEFAULT_MEMSTATUS=0; no native hard
heap or final store/quota acceptance is claimed. The durable schema, maximum-row/
conflict/blocked-checkpoint and same-version replay gates remain next.

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

## Strict raw capture parsing

`capture-json.ts` and its six fixtures pass in the focused53-case run. The reader
is intended for the future index hook; it does not replace existing acquisition/cache parsing or rewrite old pins.
It uses strict UTF8 and bounded JSON construction, rejecting duplicate decoded
object keys (including escaped spellings), nonfinite numeric results, trailing
data, malformed grammar and exceeded byte/node/depth limits. Native parsing of
individual tokens preserves ECMAScript numeric/string semantics; no entire-object
parse may silently discard an earlier field. `__proto__` remains an own data
property for explicit feature admission rejection, without prototype mutation.

Its hard reader bounds are20,000,000 bytes/3,000,000 values/depth64;
caller-specific extract or receipt limits may only reduce these. It takes an
unshared byte snapshot and has no filesystem/network/ledger operations. The
future hook must first verify the exact pinned byte snapshot, then use this reader
for both receipt and extract, validate their mutual binding, and account for every
original Feature ordinal. Ambiguous/corrupt capture JSON must block capture commit
and ledger completion; it is not a zero-row extract or a skippable feature.

Capture records bind requestHash plus exact extract/receipt hashes and lengths.
Feature occurrences bind that immutable capture and original zero-based ordinal.
Campaign observations additionally bind campaign/plan/query job/address; they are
many-to-one with occurrences and never become feature identities. A repeated
request with different pinned bytes is a capture integrity conflict, not replay.
No capture marker may be written for failed/subdivided/missing acquisitions. A
future single immediate index transaction must commit all ordinal dispositions
before the existing fenced ledger completion; indexed-but-incomplete jobs remain
pending and require idempotent verified replay, never manufactured coverage.

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

The cached positive Dakar overlap experiment now passes with zero network:2,283
ordinals,1,810 unique versions,473 duplicates and no conflicts. It is a disposable
prototype, not the durable index. Next measure bounded worst-case and failure
behavior before freezing index/transaction/WAL limits and implementing durable
capture/observation/conflict transactions.
Commit before marking the existing query job complete; replay after an index
commit/ledger crash must conserve ordinals and never manufacture complete coverage.
Independent raw-capture reconstruction and a cache-only overlapping-query pilot
must pass before country geometry compilation. Existing unknown source reservations
and immutable products remain untouched.

## Pinned-snapshot binding

`capture-binding.ts` composes the strict reader with exact extract/receipt
byte pins and a supplied acquisition expectation. It preserves the original
feature array order, including duplicates or unsupported rows for later explicit
ordinal dispositions; it does not filter, deduplicate or admit geometry. The
capture stamp includes the request hash and both exact byte pins. A changed receipt
under the same request produces a different stamp; the future store must reject
that changed-pair replay rather than silently replacing the prior capture.

It checks receipt/extract request, selection, source-layer/attribution policy,
historical upstream accounting, feature counts and metadata agreement. Current
extract-size/feature bounds remain enforced. Historical network and duration
counts use the original receipt request limits, because acquisition identity
deliberately excludes execution budgets; lowering a cache-only job budget must
not charge the historical transfer again. STAC item count640 matches the existing
pinned acquisition policy, rather than inventing a new permissive bound.

The supplied request hash is trusted only through the existing acquisition/plan
pin chain: this helper does not reconstruct it from the historical source
configuration or authenticate the referenced upstream contents. It has no I/O,
network, clocks, database writes, ledger completion or game integration. Nine
snapshot-binding fixtures, six reader and seven source/composition fixtures pass
with the existing31 identity/grid/pack cases. World TypeScript and the cached
positive capacity experiment pass. Durable quotas, store recovery and the
ingestion hook still require their separate acceptance gates.

## Retained source-configuration reconstruction

`capture-request.ts` reconstructs the exact existing acquisition hash
using `world-source-compiler-v2`, normalized request selection and the complete
retained source configuration. It excludes execution limits, as `acquire.ts`
does, and adds no newline. The strict reader rejects ambiguous fields before
canonicalization. The current release schema is checked explicitly: both source
collections,512 building and128 transportation items, pinned URLs/host, ODbL
strings, attribution and official-static release status. It verifies a supplied
raw configuration SHA/length first; the reader is bounded to64,000 bytes/1,000
values/depth8. These are small configuration bounds, not proposed DB/WAL quotas.

Seven source/composition fixtures include the independently retained positive Dakar
request hash `9bc75fe39e8bde3be9394b941776939c7bb6a13acd03172f773acf91267d8bbe`
and exact repository source-configuration pin1,297 bytes/SHA
`7ac2f2babcab7e4dd330a2f2e3476708129653022ba7bd0a94c9cbf69184656c`.
They test policy/attribution changes, duplicates/unsafe fields, raw-byte/key-order
differences, wrong pins, selection changes and unchanged budget-only identity.
Tests never read the actual acquisition cache/ledger/output; the fixed positive
request values are copied into the fixture. All seven pass in the53-case run.

The tracked capacity script `tooling/profile_feature_identity.ts` invokes the
`bindConfiguredCapture` entry point, which requires retained configuration
bytes/pin and reconstructs source identity before snapshot binding. It returns
compiler/configuration provenance with the capture; the future ingestion hook
must use this composition. Standalone stages exist for isolated checks, not to
bypass verification. The synthetic zero-row composition fixture is not evidence
that the actual473-feature Dakar capture is empty. No upstream STAC content is
downloaded or independently authenticated by these helpers.

The measured disposable prototype conserves every ordinal as admitted/exception,
binds capture and version foreign keys, and verifies a completed zero-byte WAL
truncate. It does not accept a durable store, replay/crash recovery, country
coverage or playability. Actual source hashes, commands and bounded measurements
are in FEATURE-IDENTITY-OPERATIONS.md. Nigeria, acquisition ledgers, existing
products and the game runtime are unchanged by this builder-only milestone.
