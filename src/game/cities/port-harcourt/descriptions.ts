export { activity, hospitalSpots, spot, work } from '../contentBuilder.ts'
export type { CityContentSpec, CityPersonSeed, CityVenueSeed } from '../contentBuilder.ts'
import { buildCityContent as buildSharedCityContent, type CityContentSpec } from '../contentBuilder.ts'
export const buildCityContent = <City extends string>(spec: CityContentSpec<City>) => buildSharedCityContent({ ...spec, unitLabel: 'local government', wishPrefix: 'ph' })
import type { TravelModeDefinition } from '../../../types/content.ts'
import type { CityPersonSeed, CityVenueSeed } from '../contentBuilder.ts'

export const PORT_HARCOURT_LOCAL_UNIT_DESCRIPTIONS = Object.freeze({
  'port-harcourt': 'The old township, Diobu markets, waterfront and railway heart of the capital.',
  'obio-akpor': 'The metropolitan ring of universities, stadiums, neighbourhoods and Aba Road.',
  eleme: 'The eastern industrial and refinery corridor beside the estuary.',
  okrika: 'Island and mainland communities linked by creeks, fishing and jetties.',
  ikwerre: 'The northern airport and stadium approach through Omagwa and Igwuruta.',
  oyigbo: 'The eastern road and rail gateway toward Aba.',
  etche: 'The north-eastern communities beyond the urban edge.',
})

export const PORT_HARCOURT_LOCAL_MODES: readonly TravelModeDefinition[] = Object.freeze([
  { id:'trek',label:'Trek',icon:'🚶',fare:0,seconds:13,needs:{energy:-10,hygiene:-7},xp:{fitness:15},exposed:true,eventChance:0.4,blurb:'Free and best for short distances.',beta:true },
  { id:'keke',label:'Keke',icon:'🛺',fare:250,seconds:8,needs:{hygiene:-1},eventChance:0.18,blurb:'A familiar short-hop ride away from restricted major roads.',beta:true },
  { id:'danfo',label:'Bus',icon:'🚌',fare:250,seconds:9,needs:{},eventChance:0.2,blurb:'A shared bus on the main routes.',beta:true },
  { id:'cab',label:'Taxi',icon:'🚕',fare:500,seconds:7,needs:{energy:1},eventChance:0.15,blurb:'A direct ride across the metropolis.',beta:true },
  { id:'boat',label:'Boat',icon:'⛴️',fare:800,seconds:40,needs:{},eventChance:0,blurb:'A direct waterfront trip between declared jetties.',beta:true },
])

export function riversPeople(
  venues: readonly CityVenueSeed[], names: readonly string[],
  voices: Readonly<Record<string, readonly [string, string, string, string]>>,
): readonly CityPersonSeed[] {
  if (names.length !== venues.length * 2 || new Set(names).size !== names.length) throw new Error('Two distinct names are required for every public venue')
  return Object.freeze(venues.flatMap((venue,index) => {
    const voice = voices[venue.id]
    if (!voice) throw new Error(`Missing resident voices at ${venue.id}`)
    return [
      { name:names[index*2]!,role:voice[0],quotes:[voice[1],`I can show you around ${venue.district}.`] as const },
      { name:names[index*2+1]!,role:voice[2],quotes:[voice[3],`How far? There is always something happening at ${venue.name}.`] as const },
    ]
  }))
}
