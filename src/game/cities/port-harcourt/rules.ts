import { NIGERIA } from '../country.ts'
import { CAREER_IDS } from '../../content/career-ids.ts'
import type { CityModuleRules, LgaDefinition } from '../../../types/content.ts'
import { PORT_HARCOURT_LINKS } from './links.ts'

export type PortHarcourtLocalGovernmentId = 'port-harcourt' | 'obio-akpor' | 'eleme' | 'okrika' | 'ikwerre' | 'oyigbo' | 'etche'
export type PortHarcourtDistrictId = 'diobu' | 'rumuola' | 'eleme' | 'okrika' | 'omagwa' | 'oyigbo' | 'etche'
export type PortHarcourtHubId = 'rumuola-road' | 'omagwa-airport' | 'township-rail'
type Seed = Omit<LgaDefinition, 'id' | 'districts' | 'beta'> & { id: PortHarcourtLocalGovernmentId; districts?: PortHarcourtDistrictId[] }

export const PORT_HARCOURT_LGAS = Object.freeze(([
  { id:'port-harcourt',name:'Port Harcourt',zone:'mainland',land:180000,districts:['diobu'] },
  { id:'obio-akpor',name:'Obio/Akpor',zone:'mainland',land:150000,districts:['rumuola'] },
  { id:'eleme',name:'Eleme',zone:'mainland',land:85000,districts:['eleme'] },
  { id:'okrika',name:'Okrika',zone:'east',land:65000,districts:['okrika'] },
  { id:'ikwerre',name:'Ikwerre',zone:'mainland',land:70000,districts:['omagwa'] },
  { id:'oyigbo',name:'Oyigbo',zone:'mainland',land:75000,districts:['oyigbo'] },
  { id:'etche',name:'Etche',zone:'mainland',land:55000,districts:['etche'] },
] satisfies Seed[]).map(({districts=[],...unit})=>Object.freeze({...unit,beta:true,districts})))

export const PORT_HARCOURT_MAP_ORIGIN = Object.freeze({x:-1065,z:4648})
export const PORT_HARCOURT_PLAY_BOUNDS = Object.freeze({minX:-338.6765386194545,maxX:528.8505482204928,minZ:-488.68354032745174,maxZ:426.5120087179339})

export const PORT_HARCOURT_RULES = Object.freeze({
  id:'port-harcourt',name:'Port Harcourt',status:'open',unit:'local government',units:PORT_HARCOURT_LGAS,
  hub:{road:'Rumuola Interchange',air:'Port Harcourt International Airport',rail:'Port Harcourt Railway Station'},seaPlots:false,hasStateOverview:true,
  state:{id:'rivers',name:'Rivers State',unit:'local government'},country: NIGERIA,timezone:'Africa/Lagos',
  rentedHomeIds:['ph-diobu-room','ph-rumuola-flat','ph-eleme-flat','ph-okrika-room','ph-omagwa-flat','ph-oyigbo-house','ph-etche-house'],defaultRentedHome:'ph-rumuola-flat',
  defaultName:'New arrival',careerIds:CAREER_IDS,
  atlas:{lon:7.03,lat:4.82,teaser:'The Garden City: markets, campuses, stadiums and waterways beside the Bonny River.'},
  mapOrigin:PORT_HARCOURT_MAP_ORIGIN,
  districts:[
    {id:'diobu',name:'Diobu',localUnitId:'port-harcourt'},{id:'rumuola',name:'Rumuola',localUnitId:'obio-akpor'},
    {id:'eleme',name:'Alesa-Eleme',localUnitId:'eleme'},{id:'okrika',name:'Okrika',localUnitId:'okrika'},
    {id:'omagwa',name:'Omagwa',localUnitId:'ikwerre'},{id:'oyigbo',name:'Oyigbo',localUnitId:'oyigbo'},
    {id:'etche',name:'Etche',localUnitId:'etche'},
  ],
  hubs:[
    {id:'rumuola-road',name:'Rumuola Interchange',mode:'road',venueId:'rumuola-hub'},
    {id:'omagwa-airport',name:'Port Harcourt International Airport',mode:'air',venueId:'airport'},
    {id:'township-rail',name:'Port Harcourt Railway Station',mode:'rail',venueId:'railway-township'},
  ],
  links:[PORT_HARCOURT_LINKS.lagosRoad,PORT_HARCOURT_LINKS.lagosAir],
} satisfies CityModuleRules<'port-harcourt','rivers',PortHarcourtLocalGovernmentId,PortHarcourtDistrictId,PortHarcourtHubId>)
