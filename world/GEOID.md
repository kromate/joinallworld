# EGM2008 to ellipsoidal height: research contract

This note is research for a possible conversion of the Accra Copernicus GLO-90 sidecar into the height convention used by `world/geo.ts` and the world pack. It does not implement conversion, install a geoid grid, or add converted values to the game. Source review is coordinator validation within the already-authorized scope; any external publication still requires user authorization.

## Height equation and sign

Let `H` be the source gravity-related/orthometric height in EGM2008, `N` the EGM2008 geoid height (geoid minus WGS84 reference ellipsoid), and `h` the WGS84 ellipsoidal height. The conversion is:

```text
h = H + N
H = h - N
```

The sign is easy to reverse. GeographicLib defines `N` as the geoid's height above the ellipsoid and states `h = N + H`; its `--msltohae` mode is the orthometric-to-ellipsoid direction. PROJ's `vgridshift` applies `Ztarget = Zsource + multiplier × gridvalue`, with historical default multiplier `-1`. PROJ's example with that default converts ellipsoidal height to a geoid height. Therefore the EGM2008-to-ellipsoid direction must add the grid undulation: use the inverse of the ellipsoid-to-EGM operation or an explicitly verified positive multiplier for an undulation grid. Never copy a pipeline without proving its source/target direction and axis order. [GeographicLib GeoidEval](https://geographiclib.sourceforge.io/html/GeoidEval.1.html), [PROJ vertical grid shift](https://proj.org/en/stable/operations/transformations/vgridshift.html)

The target vertical meaning is EGM2008 gravity-related height (EPSG:3855); the game-side 3D position is WGS 84 ellipsoidal height (EPSG:4979). The primary sources reviewed here do not establish which specific EPSG operation should be selected for this product. Defer exact registry operation codes and one-minute versus 2.5-minute operation claims until an official IOGP/EPSG registry record is available. The PROJ-data README does identify the NGA-derived 2.5-minute grid and describes it as transforming physical heights to WGS84 ellipsoidal heights. Do not silently substitute EGM96 or another national height datum. [PROJ-data NGA README](https://github.com/OSGeo/PROJ-data/blob/master/us_nga/us_nga_README.txt)

## Model, realization and tide-system limits

NGA describes EGM2008 as a worldwide geoid model and publishes geoid heights relative to the WGS 84 ellipsoid. Its model is supplied both as spherical-harmonic coefficients and precomputed global grids. The PROJ-data NGA README identifies `us_nga_egm08_25.tif` as a GeoTIFF-converted 2.5-arc-minute worldwide undulation grid, sourced from NGA, public domain, produced with GeographicLib, and intended to transform physical heights to WGS84 ellipsoidal heights. The PROJ CDN catalog currently lists that asset at 76.9 MB. [NGA EGM2008](https://earth-info.nga.mil/GandG/wgs84/gravitymod/egm2008/index.html), [PROJ-data NGA README](https://github.com/OSGeo/PROJ-data/blob/master/us_nga/us_nga_README.txt), [PROJ CDN catalog](https://cdn.proj.org/)

The Accra terrain source reports product-level EGM2008 and the GLO-90 handbook gives WGS84-G1150 horizontally, but the COG itself has no vertical GeoKey. A future converted sidecar must keep that evidence distinction. NGA describes its grid relative to the WGS 84 ellipsoid, but that alone does not establish a tile-specific G1150-to-current-realization transformation. Do not claim a centimetre-accurate realization transfer; preserve the source realization label and exact grid/operation metadata. WGS84 realization, observation epoch, and survey-grade accuracy are outside the current metre-scale terrain pilot.

The NGA one-minute grid identifier appearing in secondary registry mirrors includes `WGS84_TideFree`; this note does not treat that as primary verification for the grid proposed here. EGM2008 coefficients and grids must not be interchanged with a mean-tide or zero-tide model without a documented permanent-tide correction. Preserve the exact selected grid name and its official tide-system documentation. If the selected grid's tide convention or the COG's source vertical convention cannot be established from primary material, stop and keep ellipsoidal conversion unknown.

The geoid model contributes its own sampling/interpolation error; it does not remove the much larger source DEM error, DSM-versus-ground difference, or local vertical-control differences. GeographicLib documents interpolation/quantization estimates for its EGM2008 grids: its 2.5-minute grid's cubic estimates are about 0.031 m max / 0.8 mm RMS and its one-minute grid's are about 0.0022 m max / 0.7 mm RMS; these are grid-vs-model interpolation estimates, not total elevation accuracy. [GeographicLib grid accuracy table](https://geographiclib.sourceforge.io/html/GeoidEval.1.html)

## Candidate grids and bounded retrieval

There are two plausible routes, neither selected for implementation yet:

| Candidate | Evidence | Trade-off |
| --- | --- | --- |
| PROJ-data `us_nga_egm08_25.tif` | OSGeo README says 2.5′ global COG, public domain; CDN listing reports 76.9 MB. | Coarser than EPSG's 1′ preferred operation, but enough to test the conversion sign and likely commensurate with a GLO-90 tile. Global object is too large to blindly fetch under a small pilot budget. |
| NGA one-minute EGM2008 grid | NGA offers EGM2008 coefficient and interpolation-grid products. A one-minute tide-free filename appears in secondary registry mirrors, but this note does not treat that as primary verification. | A distributable pinned byte object, authoritative transformation record, checksum, and suitable bounded access route have not been established here. |

PROJ's optional network mode retrieves grid parts from `cdn.proj.org` and caches downloaded chunks in a SQLite `cache.db`; its default cache ceiling is 300 MB. It can also download an entire grid. This default transparent cache is not an adequate acquisition receipt or budget guard for this project: a future task should use a pinned asset and an explicit byte-accounted range layer, or download and verify a complete pinned artifact outside the regional run. GDAL `/vsicurl/` supports remote random range reads for servers that support them, and COG structure is suitable for such access, but the server's range behavior, grid chunk layout, actual transfer volume, and grid ETag/checksum have not been tested here. Do not assume that an Accra window has a particular byte cost or promise bounded sparse access before measuring it under a hard cumulative response cap. [PROJ network capabilities](https://proj.org/en/stable/usage/network.html), [GDAL `/vsicurl/` documentation](https://gdal.org/en/stable/user/virtual_file_systems.html)

PROJ-data documents the grid as public domain. PROJ and GeographicLib software have separate software licenses; the grid-data license does not license the implementation. Retain asset/provider/license attribution and a source commit or release pin. Before any future use, record the exact URL, product filename, published byte length, full-file SHA-256 if obtained, media type, source revision, acquisition method, response bytes, and any HTTP validators. For sparse retrieval, record each requested range, exact `Content-Range`, response bytes/hash and validator, then hash the deterministic assembled crop. A crop hash is not a full source-grid hash; preserve that distinction. If no independently published checksum is available, an ETag is only an opaque validator and must never be called SHA-256.

## Small Accra conversion milestone

The next conversion task should operate only on the existing Accra sidecar's 25 native sample coordinates and their EGM2008 source values. It should not convert or publish a full terrain surface, fill ocean/no-data, change the sidecar's immutable source file, or attach results to world-pack/game types. Output should be a separately versioned derived sidecar/receipt with each row carrying input `H`, sampled geoid undulation `N`, output `h`, algorithm/grid version, interpolation method, tide system, source COG SHA-256, grid asset pin, and explicit vertical CRS IDs. Preserve the raw `H` alongside `h`.

Before declaring conversion valid, obtain reference geoid values for points in and around the Accra window from an independent NGA route (NGA's GeoGRAV/Earth-Info EGM calculator or NGA coefficient synthesis), record its method/version and returned precision, and compare against a separately implemented pinned-grid interpolation. Include at least: an exact grid node, a non-node bilinear point, a point near the Accra window edge, and a point on either side of one grid cell boundary. The fixture must capture real returned values and never contain hand-entered or guessed values. Cross-check at least one `H → h` and the inverse `h → H`, demonstrate the sign using `h-H=N`, and include a deliberately reversed-sign negative test. The grid interpolation tolerance must be based on the selected grid's documented spacing/interpolation estimate and observed NGA reference precision; do not report it as DEM vertical accuracy.

Out-of-grid, missing-grid, nodata, malformed-grid, unsupported CRS, invalid mask, or non-finite values must return an explicit unknown/error state and prevent ellipsoid conversion. Do not substitute zero undulation, EGM96, a network-downloaded unpinned fallback, or PROJ's default grid if the required grid is missing. On conversion failure the existing valid cache remains intact and no changed artifact is published.

Only after the 25-sample comparison passes should a separate review decide whether a future world/terrain seam needs a *new derived datum field* (for example, source EGM2008 `H` and WGS84-ellipsoid `h` kept as distinct quantities). The existing `geo.ts` `Anchor.height` is consumed as ellipsoidal metres by its ECEF equations; adding a height from an unconverted DSM sample would shift every local-up coordinate by the geoid undulation. Even after conversion, a DSM cell top is still a surface elevation, not a bare-earth building base. Do not add terrain to `geo.ts`, the shared world types, rollout builds, or game assets as part of the geoid-only pilot.

## Primary references

- [NGA EGM2008 product page](https://earth-info.nga.mil/GandG/wgs84/gravitymod/egm2008/index.html) — model and published WGS84 geoid grid products.
- [NGA Earth Gravitational Model information](https://earth-info.nga.mil/geograv) — geoid as a gravity equipotential surface relative to WGS84 ellipsoid and current NGA access route.
- [PROJ-data `us_nga_README.txt`](https://github.com/OSGeo/PROJ-data/blob/master/us_nga/us_nga_README.txt) — NGA source, 2.5′ grid, GeoTIFF, public-domain status, intended physical-to-ellipsoidal transformation.
- [PROJ CDN catalog](https://cdn.proj.org/) — current EGM2008 grid asset and listed size.
- [PROJ vertical grid-shift operation](https://proj.org/en/stable/operations/transformations/vgridshift.html) — target equation, sign multiplier, formats and inverse semantics.
- [PROJ network grid loading](https://proj.org/en/stable/usage/network.html) — optional CDN loading, range-part cache, default cache limit, full-file API.
- [GeographicLib `GeoidEval`](https://geographiclib.sourceforge.io/html/GeoidEval.1.html) — sign equation, HAE/MSL modes, WGS84 ellipsoid, model grid spacing and interpolation estimates.
- [GDAL virtual file systems](https://gdal.org/en/stable/user/virtual_file_systems.html) — range reads and COG remote access constraints.
