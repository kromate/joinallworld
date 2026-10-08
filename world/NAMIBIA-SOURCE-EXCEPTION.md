# Namibia ADM1 source mismatch: research note

**Status:** unresolved source exception; no replacement is admitted. **Research date:** 2026-10-08. No boundary payload was downloaded or inspected for this note.

## What is known

The existing pinned gbOpen candidate is geoBoundaries release commit `9469f09592ced973a3448cf66b6100b741b64c0d`, package path `releaseData/gbOpen/NAM/ADM1/geoBoundaries-NAM-ADM1.geojson`, SHA-256 `f68d643fc2f030809de3a38fb85a78212cf0d38911d150e8521201a0d0c6441d`. Its bytes parse as 13 source features, while the pinned report's expected count is 14. This is a source-integrity/count mismatch. The stored count must not be lowered and no missing region may be invented.

The official geoBoundaries current gbOpen API still identifies Namibia as `NAM-ADM1-33880854`, reports 14 ADM1 units, lists `Natural Earth` as the source and exposes that same short commit and candidate path. Its metadata distinguishes **represented year 2022**, **source-data update date 21 April 2023**, and **package build date 12 December 2023**. These are different fields; none is the local capture time of the metadata snapshot. The geoBoundaries PR that introduced the NAM ADM1 source was opened 21 April 2023 and merged 2 May 2023; the changed source artifact was `sourceData/gbOpen/NAM_ADM1.zip`. These facts make a stale or incomplete source geometry plausible, but they do not prove it: the 14-unit metadata could itself be stale or count a different version/representation. Only comparing a verified replacement's unit identities and boundaries can resolve that.

Independent Namibian sources support the present-day count of 14 regions. The Regional Councils Act schedule as amended by Proclamation 25 of 2013 lists Kavango East and Kavango West separately; the Ministry of Urban and Rural Development lists 14 regional councils; and the Namibia Statistics Agency's 2023 Census report includes an administrative map of regional boundaries. This establishes a useful current administrative-count check, not which exact polygons the pinned 2022 representation should contain.

## Bounded replacement candidates

1. **geoBoundaries gbHumanitarian Namibia ADM1, exact pinned release path:** commit `9469f09592ced973a3448cf66b6100b741b64c0d`, `releaseData/gbHumanitarian/NAM/ADM1/geoBoundaries-NAM-ADM1.geojson`. The official current API identifies this as `NAM-ADM1-65246180`, reports 14 units, names `Namibia Statistics Agency (NSA), HDX` as source, and gives the license `Creative Commons Attribution 3.0 Intergovernmental Organisations (CC BY 3.0 IGO)`. Its metadata says **represented year 2011**, **source-data update date 19 January 2023**, and **build date 12 December 2023**. This is a specific immutable-path candidate, not an approved pin: its 2011 represented year predates the 2013 Kavango split, so the 14 count and its version history need explanation; polygon count, unique feature keys, topology and geometry coverage remain unverified. The license differs from the currently permitted Natural Earth original-source predicate and requires explicit policy review before any fetch.

2. **Namibia Statistics Agency / National Spatial Data Infrastructure (NSDI) source:** the NSA NSDI site links a Metadata Browser and Digital Namibia portal, describes NSA's NSDI coordination role, and notes its 2021 census-mapping work. The NSA 2023 Census report provides a regional-boundary map. Request a dataset record and an immutable/versioned download from the named custodian; the pages found here are not themselves a hash-pinned polygon dataset. The Ministry of Agriculture, Water and Land Reform's Directorate of Survey and Mapping describes responsibility for geospatial infrastructure, GIS databases and mapping, making it another official custodial route. Do not treat a map image or a live service as a reviewed source pin.

## Exact next source-resolution task

Create one **Namibia-only, metadata-first source resolution** against the existing 10m country-directory identity. Preserve the current terminal 13-versus-14 record, exact old source hash, attempt history and ledgers. Do not retry that identity or change its expected unit count.

First compare the geoBoundaries API metadata candidates above and request the NSA/NSDI or Survey and Mapping custodian's exact versioned regional-boundary dataset. For every candidate, record the stable dataset/version identifier, exact immutable file URL and eventual SHA-256/byte length, feature and distinct-unit counts, stable per-region keys/names, source-data vintage/represented year, update timestamp, package/build timestamp, metadata-capture UTC, source/custodian, full license text/URL, attribution and redistribution terms. Keep the four time concepts separate. Reject any candidate that cannot explain the 14-region denominator or has unresolved duplicate/missing identities.

For the humanitarian candidate specifically, require an explicit license/policy predicate for CC BY 3.0 IGO and attribution before fetch. Do not infer permission from `gbHumanitarian`, an API listing, or the country count. For an NSA/NSDI dataset, require explicit reuse/redistribution terms and custodian attribution before fetch; its official origin alone does not establish an open license. Current source admission is Natural Earth-only, so either candidate needs policy review before transport.

Only after a candidate is reviewed should a separate immutable pin/request be proposed with its exact URL, full commit/version, metadata pin, expected 14 features and source SHA. Then validate all 14 unique feature keys and compare names, extent, adjacency/topology and represented-year/legal basis. Keep the existing coarse Natural Earth country ID (`Namibia`'s current `NE_ID`) stable. If fine feature keys or the fine source identity change, prepare an explicit old-to-new identity and save/migration review; never assume ordinal order or names alone preserve identity.

## Evidence links

- geoBoundaries gbOpen current Namibia ADM1 metadata and exact source URL: [official API response](https://www.geoboundaries.org/api/current/gbOpen/NAM/ADM1/).
- geoBoundaries gbHumanitarian current Namibia ADM1 metadata and exact source URL: [official API response](https://www.geoboundaries.org/api/current/gbHumanitarian/NAM/ADM1/).
- geoBoundaries source-introduction review: [NAM ADM1 PR #2835](https://github.com/wmgeolab/geoBoundaries/pull/2835) (merged 2 May 2023; source archive change was `sourceData/gbOpen/NAM_ADM1.zip`).
- Namibian legal region schedule: [Regional Councils Act schedule, as amended by Proclamation 25 of 2013](https://namiblii.org/akn/na/act/1992/22/eng%402013-08-09).
- Current regional-council list: [Namibia Ministry of Urban and Rural Development](https://murd.gov.na/en/sub-national-governments).
- Census-era administrative map and report: [2023 Population and Housing Census Main Report](https://nsa.org.na/document/2023-population-and-housing-census-main-report/).
- Official geospatial discovery/custodianship route: [Namibia NSDI](https://nsa.org.na/nsdi/), including its [Metadata Browser](https://geofind.nsa.org.na/) and [Digital Namibia portal](https://digitalnamibia.nsa.org.na/).
- Official mapping custodian route: [Directorate of Survey and Mapping, MAWLR](https://mawlr.gov.na/directorate-of-survey-and-mapping).
