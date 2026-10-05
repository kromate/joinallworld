import type { VenueScene } from '../../../types/content.ts'

/**
 * The scene of each Kano venue that has one of its own, by venue id: the scene kind, its variant
 * (src/scene/venues-kano.ts) and, where a spot's id is not a landmark of the scene, the landmark it is pinned to.
 * Every scene here has a `visit` and a `work` landmark, the two spots of these venues, so none needs anchors.
 * A venue that is not listed keeps the bare scene of its kind.
 */
export const KANO_SCENES: Readonly<Record<string, VenueScene>> = Object.freeze({
  'nassarawa-garden': { kind: 'park', variant: 'kano-garden' },
  palace: { kind: 'walk', variant: 'kano-palace-gate' },
  'central-mosque': { kind: 'worship', variant: 'kano-central-mosque' },
  'kurmi-market': { kind: 'market', variant: 'kano-kurmi' },
  'dye-pits': { kind: 'market', variant: 'kano-dye-pits' },
  museum: { kind: 'office', variant: 'kano-museum' },
  'dala-hill': { kind: 'walk', variant: 'kano-dala' },
  'goron-dutse': { kind: 'walk', variant: 'kano-goron-dutse' },
  'kofar-nassarawa': { kind: 'walk', variant: 'kano-gate-nassarawa' },
  'kofar-mata': { kind: 'walk', variant: 'kano-gate-mata' },
  'kofar-kabuga': { kind: 'walk', variant: 'kano-kabuga-site' },
  'kwari-market': { kind: 'market', variant: 'kano-kwari' },
  'sabon-market': { kind: 'market', variant: 'kano-sabon-gari' },
  'buk-old': { kind: 'office', variant: 'kano-old-campus' },
  'buk-new': { kind: 'office', variant: 'kano-new-campus' },
  stadium: { kind: 'viewing', variant: 'kano-stadium' },
  racecourse: { kind: 'park', variant: 'kano-racecourse' },
  'polo-ground': { kind: 'gym', variant: 'kano-polo' },
  'railway-station': { kind: 'hub', variant: 'kano-railway' },
  'road-hub': { kind: 'hub', variant: 'kano-motor-park' },
  'tea-garden': { kind: 'park', variant: 'kano-tea-garden' },
  'film-workshop': { kind: 'office', variant: 'kano-film-yard' },
  'community-house': { kind: 'statehouse', variant: 'kano-community-hall' },
})
