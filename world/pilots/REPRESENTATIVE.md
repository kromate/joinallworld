# Representative Overture acquisition requests

Prepared for coordinator review, 8 October 2026. This is a bounded request catalogue; it does not start a campaign or access Overture. All request objects use the frozen `AcquisitionRequest` schema, Overture release `2026-09-23.1`, and both `buildings` and `roads`. Reference metadata is a sibling of each strict request object, never an extra request field.

## Inventory binding and order

The requests bind to the locally published inventory manifest `8c40558c7cd6eff38be2c6d94bdaaafc04bfdc3f601fb45c4441d16b4b7d0a4f` from Natural Earth Admin 0 release `ca96624a56bd078437bca8184e78163e5039ad19` (country source-feature denominator: 177). The catalogue records that exact manifest hash and relative manifest path. Each `inventoryUnitId` is the country node ID from this manifest:

| Priority | Request | Inventory unit | Reference / selection |
| --- | --- | --- | --- |
| 1 | Accra | Ghana `country:natural-earth:NE_ID%3A1159320793` | Completed-cache selection; exact existing ID, region identity, layer set, timezone, and bounds retained. |
| 2 | Nairobi | Kenya `country:natural-earth:NE_ID%3A1159320971` | KICC mapped building near the NASA POWER point. |
| 3 | Cape Town | South Africa `country:natural-earth:NE_ID%3A1159321431` | GeoNames populated-place point near the NASA POWER point. |
| 4 | London | United Kingdom `country:natural-earth:NE_ID%3A1159320713` | Authoritative Trafalgar Square point near the NASA POWER point. |
| 5 | Fiji antimeridian probe | Fiji `country:natural-earth:NE_ID%3A1159320625` | Query candidate on longitude 180°; wrapped bounds exercise the antimeridian. |
| 6 | Antarctica 10°E, 80°S | Antarctica `country:natural-earth:NE_ID%3A1159320335` | Bounded uninhabited geographic probe at the existing NASA POWER point. |
| 7 | Sahara 20°E, 23°N | Libya `country:natural-earth:NE_ID%3A1159321017` | Bounded uninhabited geographic probe at the existing NASA POWER point. |

Africa is first. Nigeria (`legacy-ng`, `NG`) is excluded and no request targets it. The inventory manifest itself marks Nigeria protected and provides no world outline for it.

Accra preserves the completed cache selection under `accra-overture-pilot`, including region ID `gh-accra-overture-pilot` and bounds `[-0.207, 5.552, -0.203, 5.556]`. The cache identity uses the request's selection fields; changing those fields would miss the existing cache. The limits are updated to this lane's frozen per-request caps. The GeoNames Accra point is nearby but falls just outside this fixed box, so the cell stays where the cache is and the catalogue calls this out rather than pretending it is recentered.

Nairobi, Cape Town, and London use 0.004° by 0.004° cells centered on their recorded public reference coordinates. Fiji's 0.004° geographic probe is centered on longitude 180° and latitude −16.7984° and encoded with west greater than east: `[179.998, -16.8004, -179.998, -16.7964]`. Fiji wraps the antimeridian in the bound country outline too. The Fiji coordinate is a query candidate near the documented Waiyevo locality; the catalogue does not claim it is the meridian marker.

The Antarctica and Sahara requests are 0.004° cells centered on the existing POWER samples (10°E, 80°S and 20°E, 23°N). They are explicitly named uninhabited geographic probes. `AQ` and `LY` come from the inventory country units. Their timezones are null because these coordinates are climate samples, not known stations. The probes make no built-up-area or settlement claim; if Overture returns no features, that empty result becomes measured coverage evidence later.

All requests use source-derived country codes; inhabited city timezones are supported by the cited gazetteer or local source, while the geographic probes use `null`. Coordinates identify sampled locations only; they are not assertions that Overture contains buildings or roads. An empty result is a valid observation, not fabricated geometry.

## Proposed bounded campaign envelope

All seven requests carry the same per-job limits: network 32,000,000 bytes, extract/output 10,000,000 bytes, 5,000 features, 600,000 ms, 1,536 MB memory, and 128,000,000 bytes disk. Run one heavy worker at a time. The campaign envelope reserves 256,000,000 network bytes (224,000,000 for one pass across seven requests plus 32,000,000 for one retry), 5,400,000 ms duration, 80,000,000 input bytes, 100,000,000 output bytes, and 1,500,000,000 disk bytes. These are explicit aggregate caps; apply per-job caps as well. The user has already authorized these bounded pilot acquisitions, so routine request execution does not need a separate approval prompt. Root integration review is the remaining gate before campaign execution.

## Reference URLs

- Accra: [GeoNames Accra](https://www.geonames.org/2306104/accra.html), [NASA POWER monthly service](https://power.larc.nasa.gov/docs/services/api/temporal/monthly/).
- Nairobi: [OpenStreetMap KICC way 123414930](https://www.openstreetmap.org/way/123414930), [GeoNames Nairobi](https://www.geonames.org/184742/nairobi.html).
- Cape Town: [GeoNames Cape Town](https://www.geonames.org/3369157/cape-town.html), [City of Cape Town City Hall](https://www.capetown.gov.za/Work%20and%20business/See-all-City-facilities/our-signature-venues/cape-town-city-hall).
- London: [UK Planning Data Trafalgar Square entity](https://www.planning.data.gov.uk/entity/11101255), [Greater London Authority Trafalgar Square](https://www.london.gov.uk/who-we-are/city-halls-buildings-and-squares/trafalgar-square).
- Fiji: [Fiji evacuation-centre gazetteer PDF](https://www.fijivillage.com/documents/North_%20Evacuation_Centres.pdf) places Waiyevo Methodist School at 16.7984°S, 179.997°W; [GeoNames Taveuni](https://www.geonames.org/4035893/taveuni-island.html) gives the Pacific/Fiji context; [Taveuni meridian-crossing reference](https://www.electricscotland.com/independence/sip/fiji.pdf) is locality context only, not evidence that the probe coordinate is the marker.
- Antarctica and Sahara sample coordinates: exact NASA POWER request URLs and service reference are in the catalogue; [Overture DuckDB guide](https://docs.overturemaps.org/getting-data/duckdb/) documents pinned-source spatial selection.
