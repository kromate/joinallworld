# Terrain vertical conversion — source review, 8 October 2026

Status: research gate advanced; no grid downloaded, transformation executed or
terrain attached. Existing [Copernicus pilot](TERRAIN.md), source hashes,8MiB
terrain response limit, campaign budgets and reservations remain unchanged.

## Conversion direction

Use `h = H + N`: orthometric source height H plus geoid undulation N yields the
WGS84 ellipsoid height h. GeographicLib explicitly documents this relation and
the reverse subtraction. Do not apply a constant city offset or relabel H as h.
([GeographicLib geoid documentation](https://geographiclib.sourceforge.io/C++/doc/geoid.html))

PROJ's vertical shift applies `target = source + multiplier × gridvalue` and
defaults to multiplier−1. Thus conversion direction must be explicit; a bare
`vgridshift` command is unsuitable for this forward conversion. Future validation
must compare known positive and negative N, forward/reverse results, axis order,
coordinate units and same-model independent reference values. Required grids must
not use optional `@` prefixes or silently fall back when absent.
([PROJ vertical shift](https://proj.org/en/stable/operations/transformations/vgridshift.html))

## Candidate grids and measured-scope caveats

OSGeo documents `us_nga_egm08_25.tif` as a public-domain,2.5-minute global EGM2008
grid derived with GeographicLib from the NGA model. The source and regeneration
script are identified in the official repository. This is a compatible model
candidate, not yet a hash-pinned admitted input.
([OSGeo source/licensing record](https://github.com/OSGeo/PROJ-data/blob/master/us_nga/us_nga_README.txt))

The official PROJ CDN lists that COG at76.9MB. This does **not** fit the current
terrain importer cap; no opportunistic full-file read or automatic grid download
is authorized through that importer. An eventual separate geoid acquisition needs
its own explicit bounded request, counted traffic/disk, exact content hash and
offline operation after verification. Range reads alone do not establish the
whole-file hash. ([PROJ grid catalogue](https://cdn.proj.org/))

GeographicLib also supplies a5-minute EGM2008 PGM candidate, listed as19MB
uncompressed and11MB compressed. Its documented format supports random access,
offset/scale metadata and local-window caching. Published bilinear interpolation
and quantization error estimates are0.478m maximum/12mm RMS **against that gravity
model**, not real-world survey accuracy. These figures are not automatically
applicable to another publisher's TIFF. Compact-grid licence, exact archive/hash,
safe extraction and reference agreement remain admission gates. A1-minute grid's
full cache needs about0.5GB; do not preload it on this laptop.
([GeographicLib datasets and interpolation](https://geographiclib.sourceforge.io/C++/doc/geoid.html))

## Concrete next gate

1. Select and pin one EGM2008 input/version with compatible metadata and explicit
   licence; bound compressed bytes, extracted members/bytes, reads and memory.
2. Disable implicit PROJ/GDAL networking. Verify exact local grid content before
   evaluating a small native window. Reuse installed terrain tools where possible;
   a new package or expanded source request is a separate reviewed implementation.
3. Test seam/poles, pixel-posting conventions, nodata, interpolation and positive/
   negative undulation; reconstruct independently using the same pinned model.
4. Publish a separate conversion sidecar preserving original H, derived N/h,
   source/grid/method hashes and uncertainty. Keep prior terrain products immutable.

Conversion still does not make Copernicus DSM bare-earth ground: its roof/vegetation
semantics remain as already recorded in TERRAIN.md. Do not derive house foundations
or certify driveable road clearance from those pixels. Terrain/pack attachment and
renderer acceptance remain later stages, after the identity/index country pipeline.
