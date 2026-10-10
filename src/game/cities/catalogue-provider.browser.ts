import { NIGERIA_CITY_CATALOGUE_ROWS, NIGERIA_CITY_LOADERS } from './nigeria-catalogue.generated.ts'
import { FOREIGN_ADMITTED_CITIES } from './foreign-admission.generated.ts'
import { COUNTRY_DIRECTORY_DESCRIPTOR } from './country-directory.generated.ts'
import { TRUSTED_CITY_FACTS_ROWS } from './trusted-city-facts.generated.ts'
import type { CityCatalogueEntry, CityModuleLoader } from './catalogue.ts'

const reserved: CityCatalogueEntry = Object.freeze({id:'kaduna',name:'Kaduna',state:Object.freeze({id:'kaduna',name:'Kaduna State'}),lon:7.4359863,lat:10.5182899,open:false,airport:false,teaser:'A city on the Kaduna River, at the end of the railway from Abuja. It is not open yet.',preview:Object.freeze(['The railway from Idu to Rigasa','Homes and local governments','Road travel to neighbouring cities'])})
const nigeria: readonly CityCatalogueEntry[] = Object.freeze(NIGERIA_CITY_CATALOGUE_ROWS.map(([id,name,stateId,stateName,lon,lat,airport])=>Object.freeze({id,name,state:Object.freeze({id:stateId,name:stateName}),lon,lat,open:true,airport:airport===1})))
const facts = new Map(TRUSTED_CITY_FACTS_ROWS.map(([id,name,source,countryId,lon,lat,airport])=>[id,Object.freeze({id,name,source,countryId,lon,lat,airport:airport===1,open:true})]))
const foreignIds: Set<string> = new Set(FOREIGN_ADMITTED_CITIES.map(row=>row.id))
const ready = new Map<string,CityCatalogueEntry>()
const failures = new Set<string>(), pending = new Set<string>(), listeners = new Set<()=>void>()
const changed=()=>listeners.forEach(fn=>fn())
let directory: Promise<import('../../browser/countryDirectory.ts').RuntimeCountryDirectory>|null=null
let runtimeRef: import('../../browser/countryDirectory.ts').RuntimeCountryDirectory|null=null
const openDirectory=()=>directory??=(async()=>{const {openRuntimeCountryDirectory}=await import('../../browser/countryDirectory.ts');runtimeRef=await openRuntimeCountryDirectory({descriptor:COUNTRY_DIRECTORY_DESCRIPTOR,admittedForeignCities:FOREIGN_ADMITTED_CITIES,nigeriaCatalogue:nigeria});return runtimeRef})()
export const TRUSTED_CITY_FACTS=Object.freeze(Object.fromEntries(facts))
export const trustedCityFacts=(id:string)=>facts.get(id)??null
export const trustedCountryIds=()=>Object.freeze([...new Set(TRUSTED_CITY_FACTS_ROWS.map(row=>row[3]))])
export const catalogueEntries=()=>{for(const id of ready.keys())if(!runtimeRef?.getCatalogue(id))ready.delete(id);return Object.freeze([...nigeria,...(nigeria.some(row=>row.id===reserved.id)?[]:[reserved]),...ready.values()])}
export const catalogueEntry=(id:string)=>{const row=nigeria.find(row=>row.id===id)??(id===reserved.id&&!nigeria.some(row=>row.id===id)?reserved:ready.get(id)??null);if(row&&foreignIds.has(id)&&runtimeRef?.getCatalogue(id)==null){ready.delete(id);return null}return row}
export const catalogueState=(id:string)=>{if(id===reserved.id&&!facts.has(id))return 'closed';if(!facts.has(id))return 'unknown';if(!foreignIds.has(id))return 'ready';return ready.has(id)?'ready':pending.has(id)?'pending':failures.has(id)?'failed':'unprepared'}
export async function prepareCountryCatalogue(id:string):Promise<readonly CityCatalogueEntry[]>{const iso=id==='nigeria'?'ng':id;if(iso==='ng')return nigeria;const work=[...facts.values()].filter(row=>row.countryId===iso);if(!work.length)throw new RangeError(`country is not admitted: ${iso}`);pending.add(iso);changed();try{const dir=await openDirectory(),rows=await dir.prepareCountry(iso);for(const row of rows)ready.set(row.id,row);failures.delete(iso);return rows} catch(error){failures.add(iso);throw error}finally{pending.delete(iso);changed()}}
export async function prepareCityCatalogue(id:string):Promise<CityCatalogueEntry|null>{const fact=facts.get(id);if(!fact)return catalogueEntry(id);if(fact.countryId==='ng')return catalogueEntry(id);await prepareCountryCatalogue(fact.countryId);return catalogueEntry(id)}
export function cityLoader(id:string):CityModuleLoader|undefined{if(!facts.has(id))return undefined;const fact=facts.get(id)!;if(fact.countryId==='ng')return NIGERIA_CITY_LOADERS[id];return async()=>{await prepareCityCatalogue(id);const {FOREIGN_CITY_LOADERS}=await import('./foreign-loaders.generated.ts');const loader=FOREIGN_CITY_LOADERS[id];if(!loader)throw new RangeError(`City rules are not available: ${id}`);return loader()}}
export async function countryDirectory(){return (await openDirectory()).countries()}
export const subscribeCatalogueChanges=(listener:()=>void)=>{listeners.add(listener);return()=>listeners.delete(listener)}
