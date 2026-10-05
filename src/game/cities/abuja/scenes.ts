import type { VenueScene } from '../../../types/content.ts'

/**
 * The scene of each Abuja venue that has one of its own, by venue id: the scene kind, its variant
 * (src/scene/venues-fct.ts) and, where a spot's id is not a landmark of the scene, the landmark it is pinned to.
 * A venue that is not listed keeps the bare scene of its kind.
 */
export const ABUJA_SCENES: Readonly<Record<string, VenueScene>> = Object.freeze({
  'millennium-park': { kind: 'park', variant: 'fct-terraces', anchors: { visit: 'fountains' } },
  'national-mosque': { kind: 'worship', variant: 'fct-mosque', anchors: { visit: 'court' } },
  'christian-centre': { kind: 'worship', variant: 'fct-church', anchors: { visit: 'court' } },
  'eagle-square': { kind: 'park', variant: 'fct-parade', anchors: { visit: 'square' } },
  'arts-village': { kind: 'market', variant: 'fct-crafts', anchors: { visit: 'pottery' } },
  'wuse-market': { kind: 'market', variant: 'fct-lockups', anchors: { visit: 'lane' } },
  'garki-market': { kind: 'market', variant: 'fct-sheds', anchors: { visit: 'sheds' } },
  'gwagwalada-market': { kind: 'market', variant: 'fct-open', anchors: { visit: 'ground' } },
  'national-stadium': { kind: 'viewing', variant: 'fct-stadium', anchors: { visit: 'gates' } },
  velodrome: { kind: 'gym', variant: 'fct-velodrome', anchors: { visit: 'rail' } },
  'children-zoo': { kind: 'park', variant: 'fct-zoo', anchors: { visit: 'paddocks' } },
  uniabuja: { kind: 'office', variant: 'fct-campus-gate', anchors: { visit: 'senate' } },
  'nile-university': { kind: 'office', variant: 'fct-campus-glass', anchors: { visit: 'plaza' } },
  'baze-university': { kind: 'office', variant: 'fct-campus-court', anchors: { visit: 'court' } },
  'idu-station': { kind: 'hub', variant: 'fct-rail', anchors: { visit: 'platform' } },
  'utako-hub': { kind: 'hub', variant: 'fct-motor-park', anchors: { visit: 'bays' } },
  'city-gate': { kind: 'walk', variant: 'fct-gate', anchors: { visit: 'view' } },
  'gwarinpa-evening': { kind: 'rooftop', variant: 'fct-evening', anchors: { visit: 'stage' } },
  'community-house': { kind: 'statehouse', variant: 'fct-hall', anchors: { visit: 'notices' } },
  'kubwa-garden': { kind: 'park', variant: 'fct-garden-ayo', anchors: { visit: 'ayo' } },
  'gwagwalada-garden': { kind: 'park', variant: 'fct-garden-plots', anchors: { visit: 'plots' } },
  'jabi-lake-park': { kind: 'park', variant: 'fct-lake', anchors: { walk: 'promenade' } },
})
