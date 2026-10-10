// Generated from validated admitted city modules. No HTTP data supplies routing authority.
import { NIGERIA_CITY_CATALOGUE_ROWS } from './nigeria-catalogue.generated.ts'

export type TrustedCityFactsRow = readonly [id: string, name: string, source: 'nigeria' | 'foreign', countryId: string, lon: number, lat: number, airport: 0 | 1]

const FOREIGN_TRUSTED_CITY_FACTS = [
  ["accra","Accra","foreign","gh",-0.218662,5.55198,1],
  ["algiers","Algiers","foreign","dz",3.048607,36.765011,1],
  ["lome","Lomé","foreign","tg",1.220811,6.133883,1],
  ["nairobi","Nairobi","foreign","ke",36.814711,-1.281401,1],
  ["yaounde","Yaoundé","foreign","cm",11.514705,3.868647,1],
  ["abidjan","Abidjan","foreign","ci",-4.020207,5.323126,1],
  ["addis-ababa","Addis Ababa","foreign","et",38.698059,9.035256,1],
  ["cape-town","Cape Town","foreign","za",18.433042,-33.918065,1],
  ["cotonou","Cotonou","foreign","bj",2.404355,6.36298,1],
  ["dakar","Dakar","foreign","sn",-17.475076,14.717778,1],
] satisfies readonly TrustedCityFactsRow[]

export const TRUSTED_CITY_FACTS_ROWS: readonly TrustedCityFactsRow[] = Object.freeze([
  ...NIGERIA_CITY_CATALOGUE_ROWS.map(([id, name, , , lon, lat, airport]) => Object.freeze([id, name, 'nigeria', 'ng', lon, lat, airport] as const)),
  ...FOREIGN_TRUSTED_CITY_FACTS.map((row) => Object.freeze(row)),
])
