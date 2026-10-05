import type { VenueScene } from '../../../types/content.ts'

/**
 * The scene of each Port Harcourt venue that has one of its own, by venue id: the scene kind, its variant
 * (src/scene/venues-rivers.ts) and, where a spot's id is not a landmark of the scene, the landmark it is pinned to.
 * A venue that is not listed keeps the bare scene of its kind.
 */
export const PORT_HARCOURT_SCENES: Readonly<Record<string, VenueScene>> = Object.freeze({
  'pleasure-park': { kind: 'park', variant: 'ph-lake' },
  'isaac-boro-park': { kind: 'park', variant: 'ph-cenotaph' },
  'garden-city-amusement': { kind: 'park', variant: 'ph-rides' },
  'garden-city-evening': { kind: 'park', variant: 'ph-bandstand' },
  'mile-one-market': { kind: 'market', variant: 'ph-block' },
  'mile-three-market': { kind: 'market', variant: 'ph-rows' },
  'oil-mill-market': { kind: 'market', variant: 'ph-junction' },
  'railway-township': { kind: 'walk', variant: 'ph-station' },
  wharf: { kind: 'walk', variant: 'ph-wharf' },
  'tourist-beach': { kind: 'beach', variant: 'ph-creek' },
  'bonny-jetty': { kind: 'hub', variant: 'ph-terminal' },
  'okrika-jetty': { kind: 'hub', variant: 'ph-pier' },
  'rumuola-hub': { kind: 'hub', variant: 'ph-interchange' },
  'yakubu-gowon-stadium': { kind: 'viewing', variant: 'ph-main-stand' },
  'adokiye-stadium': { kind: 'viewing', variant: 'ph-bowl' },
  'government-house': { kind: 'statehouse', variant: 'ph-gra-gate' },
  uniport: { kind: 'office', variant: 'ph-avenue' },
  rsu: { kind: 'office', variant: 'ph-senate' },
  iaue: { kind: 'office', variant: 'ph-college' },
  'trans-amadi': { kind: 'office', variant: 'ph-industry' },
  refinery: { kind: 'refinery', variant: 'ph-creek-view' },
  'bole-kitchen': { kind: 'buka', variant: 'ph-bole' },
})
