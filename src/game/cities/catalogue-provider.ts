import { CITY_CATALOGUE, CITY_LOADERS } from './catalogue.ts'
import type { CityCatalogueEntry, CityModuleLoader } from './catalogue.ts'
import { TRUSTED_CITY_FACTS_ROWS } from './trusted-city-facts.generated.ts'

export const TRUSTED_CITY_FACTS = Object.freeze(Object.fromEntries(TRUSTED_CITY_FACTS_ROWS.map(([id,name,source,countryId,lon,lat,airport]) => [id,Object.freeze({id,name,source,countryId,lon,lat,airport:airport===1,open:true})])))
export const trustedCityFacts = (id: string) => TRUSTED_CITY_FACTS[id as keyof typeof TRUSTED_CITY_FACTS] ?? null
export const trustedCountryIds = () => Object.freeze([...new Set(TRUSTED_CITY_FACTS_ROWS.map(row => row[3]))])
export const catalogueEntries = (): readonly CityCatalogueEntry[] => CITY_CATALOGUE
export const catalogueEntry = (id: string): CityCatalogueEntry | null => CITY_CATALOGUE.find(row => row.id === id) ?? null
export const catalogueState = (id: string) => catalogueEntry(id) ? (catalogueEntry(id)!.open ? 'ready' : 'closed') : 'unknown'
export async function prepareCountryCatalogue(_id: string): Promise<readonly CityCatalogueEntry[]> { return CITY_CATALOGUE }
export async function prepareCityCatalogue(_id: string): Promise<CityCatalogueEntry | null> { return catalogueEntry(_id) }
export function cityLoader(id: string): CityModuleLoader | undefined { return CITY_LOADERS[id] }
export const countryDirectory = async () => Object.freeze(trustedCountryIds().map(countryId => ({ iso2: countryId, name: countryId === 'ng' ? 'Nigeria' : CITY_CATALOGUE.find(row => row.countryISO === countryId)?.countryName ?? countryId.toUpperCase(), status: countryId === 'ng' ? 'legacy' : 'accepted', cityCount: TRUSTED_CITY_FACTS_ROWS.filter(row => row[3] === countryId).length })))
export const subscribeCatalogueChanges = (_listener: () => void) => () => {}
