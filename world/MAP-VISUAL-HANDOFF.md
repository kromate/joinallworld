# Foreign starter map visual handoff

Prepared 9 October 2026. Claude has not been assigned a writer or started work.
This document records a possible isolated visual assignment and a separate
country-selection report. It does not approve merging or deploying a redesign.

Repository: `https://github.com/kromate/joinallworld`. Current production and
freshly fetched `origin/main` are exactly
`c1f7c1f7369139ce559292318ba9842c23a28267`.
Production has eleven open countries. Start an isolated visual proposal from
that revision, preserving the current player's Nigeria life. WORLD's source
branch is `codex/world-foundation`; do not merge that branch wholesale.
The pending integration candidate is
`eec14690544a4646e4cd8a5ad280d61bbe2709ca` on a separate detached release checkout.
The map/selection files listed below are byte-unchanged between C1 and eec.

Anthony reports a Yaoundé view with a large mostly empty rectangular plane,
two visible venues and a thin straight connection. The actual foreign provider
retains a bounded central OSM sample, while its land/arrival extent also covers
the selected airport. It replaces decorative procedural fabric with source
building boxes. These sources describe starter areas, not complete cities.
Camera framing, silhouettes, materials, labels and explicit geographic context
are useful visual work. Additional real streets/buildings require the separate
source pipeline; drawing invented real houses does not fill its coverage gap.

Relevant source paths:

| Path | Responsibility |
| --- | --- |
| `src/game/cities/africa/map.ts` | Foreign starter geometry validation, source roads/building boxes and lazy scene provider |
| `src/game/cities/africa/types.ts` | Validated country, point, extent and map-origin facts |
| `src/game/cities/africa/contentBuilder.ts` | Fictional visitor services and arrival content |
| `src/game/cities/yaounde/{facts,geometry,map,index,content}.ts` | Currently admitted Cameroon starter data |
| `src/game/cities/dakar/{facts,geometry,map,index,content}.ts` | Currently admitted Senegal starter data |
| `src/map3d/cities/module.ts` | Shared module-to-scene conversion, also used by Nigeria |
| `src/map3d/{index,city-build,houses,roads,camera,labels}.ts` | Shared rendering, geometry, framing and labels |
| `src/city-map.ts` | Simple map fallback |
| `src/map3d/geo/{atlas,info,country-detail}.ts` | Country list, cards, map focus, geographic outline viewer and travel UI |
| `src/map3d/regions.ts` | Playability and country-to-city mapping |
| `src/app/scene/{MapWorld.vue,mapIntent.ts}` | Atlas mounting, entering/opening city and pending map intents |
| `src/app/features/travel/travelModel.ts` | Map level navigation model |

Any assignment needs one explicit file owner. A proposed Claude visual lane can
own `src/game/cities/africa/map.ts` and new foreign-specific visual helpers after
Integration confirms that ownership. Treat shared renderer files as read-only
until their current owner agrees to a concrete interface. Preserve the current
350-building/160-road source caps, lazy loading, disposal, simple fallback and
unchanged startup/download limits. Verify actual Yaoundé and Dakar scenes at
desktop and narrow widths with one serialized Astra browser operator. Record
source SHA, served asset hashes, visible geometry/draw-call costs and screenshots.
Physical-phone performance remains unproven until measured on a phone.

Exclude Nigeria data/IDs/maps, source inventories/receipts/generated files,
country admission manifest/generator/browser-directory reader, registry/bootstrap
migration, saves/server/database/economy, driving/teaching/qualification rules,
household/consent/media, character rigs/rest contacts/stairs, root dependencies,
release guards and budget baselines. Existing remote workers own those lanes.
Integration is the shared-file assembler; WORLD is the sole production uploader.
Work and heavy checks run in the existing remote environment with no new spend.
The current cutoff is 10 October 2026 at 09:00 Lagos, 08:00 UTC.

## Separate Senegal selection report

The reported selection returning to the current location has not been reproduced
in a browser. A screenshot cannot establish a country-to-city mismatch.
Source tracing shows `atlas.ts:select()` opens the selected country/card;
`info.ts:regionInfo()` resolves the country entry's city and travel routes;
`atlas.ts:enterCity()` dispatches `onOpenCity` for the current city and
`onEnterCity` for another; `MapWorld.vue` handles those callbacks separately.
The `Countries` outline viewer is a distinct geographic reference panel.
Clicking a country/list row and purchasing a flight are separate actions.

Independent source inspection also finds only World, Africa and Nigeria in
`regions.ts:ATLAS_LEVELS`. `travelModel.ts:mapLevels()` assigns a foreign country
breadcrumb to the existing Africa level `1`. A foreign country has no dedicated
country atlas level. The country list passes `flyTo: true`, so it can frame the
selected outline and open its card without creating a new level or travelling.
`regionEntry('country', 'sn')` resolves the first open catalogue row with country
ISO `sn`; the admitted facts bind that row to `dakar` and Senegal. This is source
evidence of the current navigation structure. It does not reproduce or prove
the reported return-to-current-location behavior.

The existing remote country worker has been asked to inspect this flow without
editing Integration-owned selection files. Reproduce the precise Senegal row,
card, requested Dakar target, flight/arrival and subsequent map focus with the
original life before choosing a fix. Do not implement a visual workaround that
changes the player's authoritative location or creates another life.
