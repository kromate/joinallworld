import type { ParametricVenueDesign, SceneKind, VenueScene } from '../../../types/content.ts'
import type { CitySpec, RealPlaceFact, RealPlaceKind } from '../spec.ts'

interface PlaceArchetype {
  readonly kind: SceneKind
  readonly variant?: 'church' | 'mosque'
}

const ARCHETYPES: Readonly<Record<RealPlaceKind, PlaceArchetype>> = Object.freeze({
  airport: { kind: 'airport' },
  church: { kind: 'worship', variant: 'church' },
  'civic-landmark': { kind: 'walk' },
  college: { kind: 'office' },
  'craft-centre': { kind: 'market' },
  eatery: { kind: 'buka' },
  garden: { kind: 'park' },
  government: { kind: 'statehouse' },
  heritage: { kind: 'walk' },
  hospital: { kind: 'hospital' },
  industry: { kind: 'refinery' },
  market: { kind: 'market' },
  mosque: { kind: 'worship', variant: 'mosque' },
  museum: { kind: 'walk' },
  nightlife: { kind: 'club' },
  park: { kind: 'park' },
  polling: { kind: 'polling' },
  polytechnic: { kind: 'office' },
  port: { kind: 'hub' },
  'rail-station': { kind: 'hub' },
  'road-hub': { kind: 'hub' },
  salon: { kind: 'salon' },
  savings: { kind: 'office' },
  school: { kind: 'office' },
  sport: { kind: 'viewing' },
  stadium: { kind: 'viewing' },
  university: { kind: 'office' },
})

export const sceneKindFor = (kind: RealPlaceKind): SceneKind => ARCHETYPES[kind].kind

export function formulaSceneFor(place: RealPlaceFact, palette: CitySpec['homePalette']): VenueScene {
  const archetype = ARCHETYPES[place.kind]
  const design: ParametricVenueDesign = {
    palette: { wall: palette.back, roof: palette.left, accent: palette.floor[1], ground: palette.floor[0] },
    roof: place.scene.roof,
    sign: place.scene.sign,
    ...(place.scene.props ? { props: place.scene.props } : {}),
    ...(place.scene.landmark ? { landmark: place.scene.landmark } : {}),
  }
  return Object.freeze({ kind: archetype.kind, ...(archetype.variant ? { variant: archetype.variant } : {}), design })
}

export const buildFormulaScenes = (spec: CitySpec): Readonly<Record<string, VenueScene>> => Object.freeze(Object.fromEntries(
  spec.places.map(place => [place.id, formulaSceneFor(place, spec.homePalette)]),
))
