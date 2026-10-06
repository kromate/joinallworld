import { activity, buildCityContent as buildSharedCityContent, hospitalSpots, spot, work } from '../contentBuilder.ts'
import type { CityContentSpec, CityPoint, CityBounds, CityPersonSeed, CitySpotSeed, CityVenueSeed } from '../contentBuilder.ts'
import type { CityContent, TravelModeDefinition } from '../../../types/content.ts'

export type OgunPoint = CityPoint
export type OgunBounds = CityBounds
export type OgunSpotSeed = CitySpotSeed
export type OgunVenueSeed = CityVenueSeed
export type OgunPersonSeed = CityPersonSeed
export type OgunHouseSeed = CityContentSpec<string>['houses'][number]
export type OgunContentSpec<City extends string> = CityContentSpec<City>
export { activity, hospitalSpots, spot, work }

export function peopleFor(venues: readonly OgunVenueSeed[], names: readonly string[]): readonly OgunPersonSeed[] {
  if (names.length < venues.length * 2) throw new Error('Two distinct names are required for every public venue')
  return Object.freeze(venues.flatMap((venue, index) => [
    { name: names[index * 2]!, role: `${venue.name} guide`, quotes: [`Ẹ káàbọ̀. ${venue.description}`, `I help people find their way around ${venue.district}.`] as const },
    { name: names[index * 2 + 1]!, role: `${venue.name} regular`, quotes: [`I come to ${venue.name} often enough to know its rhythm.`, `Ask me what changes around ${venue.district} from morning to evening.`] as const },
  ]))
}

export function buildOgunContent<City extends string>(spec: OgunContentSpec<City>): CityContent<City> {
  return buildSharedCityContent({ ...spec, unitLabel: 'local government', wishPrefix: 'ogun', sound: { motif: 'talking-drum', ambience: 'calm', key: 5 } })
}

export const OGUN_LOCAL_MODES: readonly TravelModeDefinition[] = Object.freeze([
  { id: 'trek', label: 'Trek', icon: '🚶', fare: 0, seconds: 13, needs: { energy: -10, hygiene: -7 }, xp: { fitness: 15 }, exposed: true, eventChance: 0.4, blurb: 'Free and best for short distances.', beta: true },
  { id: 'okada', label: 'Okada', icon: '🏍️', fare: 250, seconds: 5, needs: { hygiene: -3 }, exposed: true, eventChance: 0.15, blurb: 'Fast through local traffic, with no roof.', beta: true },
  { id: 'danfo', label: 'Bus', icon: '🚌', fare: 250, seconds: 9, needs: {}, eventChance: 0.2, blurb: 'A shared bus on the main routes.', beta: true },
  { id: 'cab', label: 'Taxi', icon: '🚕', fare: 450, seconds: 7, needs: { energy: 1 }, eventChance: 0.15, blurb: 'A direct ride across town.', beta: true },
])
