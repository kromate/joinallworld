# Third-party notices

Allworld is released under the MIT licence (see [LICENSE](LICENSE)). It includes or depends on the following third-party material.

## Map and geographic data

The data is stored as generated modules under `src/map3d/geo/data/` and `src/models/geo/data/`. Sources, hashes and retrieval details are recorded in `src/models/geo/provenance.json`.

- **Natural Earth** (country, state/province, populated places, rivers and lake centrelines, coastline). Public domain. "Made with Natural Earth." <https://www.naturalearthdata.com/about/terms-of-use/>. Files come from <https://github.com/nvkelso/natural-earth-vector>. Borders are Natural Earth's default view and imply no position on any dispute.
- **geoBoundaries** (Kenya county boundaries, ADM1). Licence: geoBoundaries gbOpen, CC BY 4.0 collection; the source metadata states Public Domain. Required attribution: "geoBoundaries, William & Mary geoLab, RCMRD GeoPortal / Africa GeoPortal; KEN-ADM1-32016919, year 2020, release 9469f09. Simplified, rounded, and converted to an ES module by Allworld." Licence: <https://creativecommons.org/licenses/by/4.0/>. Source: <https://www.geoboundaries.org/api/current/gbOpen/KEN/ADM1/>.
- **geoBoundaries** (Lagos State outline and its 20 local governments, with the derived lagoon). CC BY 4.0: <https://creativecommons.org/licenses/by/4.0/>. Attribution: "geoBoundaries gbOpen, Nigeria ADM1 (NGA-ADM1-27671186) and ADM2 (NGA-ADM2-59680162), release 9469f09, year 2022, original source GRID3; William & Mary geoLab. Modified: simplified, quantised and converted to ES modules by Allworld." Sources and hashes are recorded in `src/models/geo/provenance.json`; source metadata: <https://www.geoboundaries.org/api/current/gbOpen/NGA/>.
- **Wikidata** (capital-city supplement; items Q1024647, Q1061665, Q304976, Q648749). CC0. <https://www.wikidata.org/wiki/Wikidata:Licensing>
- **OurAirports** (selected airport coordinates). Public domain. <https://ourairports.com/data/>

## Runtime dependencies

| Package | Licence |
| --- | --- |
| [Three.js](https://threejs.org/) | MIT |
| [Vue](https://vuejs.org/) | MIT |
| [Vite](https://vite.dev/) | MIT |
| [ws](https://github.com/websockets/ws) | MIT |
| [@sentry/browser](https://github.com/getsentry/sentry-javascript) | MIT |
| [posthog-js](https://github.com/PostHog/posthog-js) | Apache-2.0 AND MIT |

Transitive dependencies keep their own licences in `node_modules`.
