# Sourced regional environment pilot

This pilot creates immutable monthly climate sidecars from a bounded NASA POWER point request. It is a sourced fallback for regional conditions; it is **not ERA5**, and it does not update game types, world packs, or the production pipeline. Existing climate-shaped consumers can read `profile`, while `source`, `baseline`, `point`, `derivation`, and `exceptions` preserve the evidence and limitations separately.

## NASA POWER pilot

The pinned query uses the monthly point service with `community=SB`, parameters `T2M,RH2M,PRECTOTCORR,WS10M`, and inclusive years 1991–2020. These four parameters are below POWER's 20-parameter point-request limit. The pilot points are in [`environment-sources.json`](./environment-sources.json), along with exact query URLs, raw response checksums and byte lengths. Requests are performed serially. The adapter allows no more than six pilot points, 1 MB per response, 30 seconds per attempt, two retries, and 6 MB of total response-body bytes across the entire batch. Bodies from failed HTTP responses and retries count toward this shared batch limit. It does not crawl the global API.

The downloaded response metadata reports POWER API 2.10.0, MERRA-2 among its data sources, a `-999` fill value, and local solar time (LST). Every parameter contains 390 keyed values: 360 year/month observations and 30 annual month-13 values. The implementation validates all records and units, then derives normals only from the 360 monthly records. Missing, sentinel, non-finite, or incomplete values are errors; they are never replaced with zero. API source metadata gives native MERRA-2 spacing as 0.5° latitude by 0.625° longitude. Each point represents a native-grid sample, not a station observation or region-wide spatial average. POWER rounds response geometry to three decimal places; the manifest retains both requested coordinates and the returned sample coordinates, and rejects a returned point that does not match the request at that precision.

| Field | POWER unit | Profile calculation |
| --- | --- | --- |
| `T2M` | °C | Arithmetic mean of the provider's 30 monthly means for each calendar month. |
| `RH2M` | % | Arithmetic mean of the direct relative-humidity values; no temperature/dewpoint derivation. |
| `PRECTOTCORR` | mm/day | Multiply each year's monthly mean rate by that Gregorian month's actual number of days; average the 30 monthly totals, in mm. |
| `WS10M` | m/s | Arithmetic mean of scalar wind speed at 10 m; not derived from vector components. |

Sample January and July outputs from the pinned 1991–2020 payloads:

| Request point | January: °C / % / mm / m/s | July: °C / % / mm / m/s |
| --- | --- | --- |
| Accra | 27.216 / 77.718 / 21.111 / 3.0857 | 24.5407 / 88.2423 / 89.962 / 4.0177 |
| Nairobi | 20.274 / 64.3767 / 44.0303 / 5.0183 | 18.4887 / 64.2547 / 17.0913 / 3.337 |
| Cape Town | 20.0303 / 77.852 / 12.152 / 7.1447 | 14.343 / 79.0737 / 75.4643 / 6.0083 |
| London | 4.0593 / 93.2073 / 64.077 / 5.8437 | 17.5047 / 76.1933 / 55.2937 / 4.3857 |
| Antarctica (10°E, 80°S) | −25.3973 / 89.823 / 4.1023 / 6.0067 | −54.214 / 91.053 / 2.6867 / 10.073 |
| Sahara (20°E, 23°N) | 11.348 / 41.243 / 1.8807 / 3.6727 | 30.0343 / 20.1257 / 0.8887 / 4.3337 |

These are model/reanalysis grid values for named request points, not regional summaries. The Antarctic sample returned complete monthly values in this pilot; it does not establish station-level or coast-wide coverage. If another point returns missing coverage or fill values, that region must carry an explicit exception instead of an invented zero or inherited profile.

Raw source bytes are content-addressed under `.cache/world-build/environment-source-cache/`; published raw sources and manifests are immutable files under `.cache/world-build/output/environment/{sources,manifests}/`. Both stores use atomic immutable publication after checking canonical directory ancestors. The manifest is written last. Cache reads validate their in-root path, regular-file type, pinned length (up to 1 MB), and checksum before use. Rebuilds can use the exact locally pinned raw payloads without another API request. `environment-cli.ts fetch` and `fetch-all` are the only network commands; build commands are cache-only. No credentials are used.

NASA documents the [monthly point service](https://power.larc.nasa.gov/docs/services/api/temporal/monthly/) and its [custom climatology service](https://power.larc.nasa.gov/docs/services/api/temporal/climatology/). We request annual monthly records and calculate the 30-year monthly normals ourselves so the averaging and precipitation-total algorithm remain explicit. NASA asks users to avoid excessive synchronous requests and documents rate limiting; local batch caps are intentionally much smaller than bulk ingestion. Attribution is retained in every manifest. The response itself does not state a separate product license; follow the [NASA POWER citation/reference guidance](https://power.larc.nasa.gov/docs/referencing/) and [NASA Earthdata data-use policy](https://www.earthdata.nasa.gov/engage/open-data-services-and-software/data-and-information-policy).

## Terrain source contract (metadata only)

No elevation tiles are downloaded by this adapter. The [AWS registry entry](https://registry.opendata.aws/copernicus-dem/) describes Copernicus DEM GLO-90 as a public global 90 m product and GLO-30 as a public but limited-coverage 30 m product. The [official product readme](https://copernicus-dem-30m.s3.amazonaws.com/readme.html) identifies the product as a **digital surface model (DSM)**: buildings, infrastructure and vegetation can appear in the surface. It is not bare-earth terrain. The readme notes ocean tiles are absent; ocean elevation must not be silently treated as measured zero.

The registry/readme checked for this contract do not establish a per-tile vertical datum or geoid conversion. Datum and geoid are therefore **unknown** here; do not claim ellipsoidal heights or convert them. Any later terrain ingestion must retain tile-level source metadata and state DSM versus bare-earth semantics, horizontal/vertical reference systems, processing, and unresolved datum explicitly.

## Primary references

- [NASA POWER monthly temporal API](https://power.larc.nasa.gov/docs/services/api/temporal/monthly/)
- [NASA POWER climatology API](https://power.larc.nasa.gov/docs/services/api/temporal/climatology/)
- [NASA POWER methodology and data sources](https://power.larc.nasa.gov/docs/methodology/data/sources/)
- [NASA POWER service request guidance](https://power.larc.nasa.gov/docs/tutorials/service-data-request/api/)
- [NASA POWER referencing guidance](https://power.larc.nasa.gov/docs/referencing/)
- [Copernicus DEM AWS registry](https://registry.opendata.aws/copernicus-dem/)
- [Copernicus DEM official product readme](https://copernicus-dem-30m.s3.amazonaws.com/readme.html)
