import { NIGERIA } from '../country.ts'
import { CAREER_IDS } from '../../content/career-ids.ts'
import type { CityModuleRules, LgaDefinition } from '../../../types/content.ts'
import { ABUJA_LINKS } from './links.ts'
export type AbujaAreaCouncilId = 'abuja-municipal' | 'bwari' | 'gwagwalada' | 'kuje' | 'kwali' | 'abaji'
export type AbujaDistrictId = 'garki' | 'wuse' | 'maitama' | 'asokoro' | 'gwarinpa' | 'jabi' | 'utako' | 'lugbe' | 'kubwa' | 'gwagwalada' | 'kuje' | 'kwali' | 'abaji' | 'central-business-district'
export type AbujaHubId = 'utako-road' | 'abuja-airport' | 'idu-rail'
export const ABUJA_LGAS = Object.freeze([
  {
    "id": "abuja-municipal",
    "name": "Abuja Municipal (AMAC)",
    "zone": "mainland",
    "land": 200000,
    "beta": true,
    "districts": [
      "garki",
      "wuse",
      "maitama",
      "asokoro",
      "gwarinpa",
      "jabi",
      "utako",
      "lugbe",
      "central-business-district"
    ]
  },
  {
    "id": "bwari",
    "name": "Bwari",
    "zone": "mainland",
    "land": 100000,
    "beta": true,
    "districts": [
      "kubwa"
    ]
  },
  {
    "id": "gwagwalada",
    "name": "Gwagwalada",
    "zone": "mainland",
    "land": 85000,
    "beta": true,
    "districts": [
      "gwagwalada"
    ]
  },
  {
    "id": "kuje",
    "name": "Kuje",
    "zone": "mainland",
    "land": 70000,
    "beta": true,
    "districts": [
      "kuje"
    ]
  },
  {
    "id": "kwali",
    "name": "Kwali",
    "zone": "mainland",
    "land": 55000,
    "beta": true,
    "districts": [
      "kwali"
    ]
  },
  {
    "id": "abaji",
    "name": "Abaji",
    "zone": "mainland",
    "land": 50000,
    "beta": true,
    "districts": [
      "abaji"
    ]
  }
] satisfies readonly (Omit<LgaDefinition, 'id' | 'districts'> & {id:AbujaAreaCouncilId;districts:AbujaDistrictId[]})[])
export const ABUJA_MAP_ORIGIN = Object.freeze({x:-560,z:-67})
export const ABUJA_PLAY_BOUNDS = Object.freeze({minX:-779.878228194056,maxX:256.88000739216454,minZ:-387.3430978342153,maxZ:712.5986358358927})
export const ABUJA_RULES = Object.freeze({...{
  "id": "abuja",
  "name": "Abuja",
  "status": "open",
  "unit": "area council",
  "civicTitle": "Community Chair",
  "hub": {
    "road": "Utako Motor and Bus Terminal",
    "air": "Nnamdi Azikiwe International Airport",
    "rail": "Idu Station"
  },
  "seaPlots": false,
  "hasStateOverview": true,
  "state": {
    "id": "fct",
    "name": "Federal Capital Territory",
    "unit": "area council"
  },
  country: NIGERIA,
  "timezone": "Africa/Lagos",
  "rentedHomeIds": [
    "fct-garki-home",
    "fct-wuse-home",
    "fct-maitama-home",
    "fct-asokoro-home",
    "fct-gwarinpa-home",
    "fct-jabi-home",
    "fct-utako-home",
    "fct-lugbe-home",
    "fct-kubwa-home",
    "fct-gwagwalada-home",
    "fct-kuje-home",
    "fct-kwali-home",
    "fct-abaji-home",
    "fct-central-business-district-home"
  ],
  "defaultRentedHome": "fct-kubwa-home",
  "defaultName": "New arrival",
  "careerIds": CAREER_IDS,
  "atlas": {
    "lon": 7.49,
    "lat": 9.06,
    "teaser": "A planned capital of parks, markets, campuses and satellite towns."
  },
  "districts": [
    {
      "id": "garki",
      "name": "Garki",
      "localUnitId": "abuja-municipal"
    },
    {
      "id": "wuse",
      "name": "Wuse",
      "localUnitId": "abuja-municipal"
    },
    {
      "id": "maitama",
      "name": "Maitama",
      "localUnitId": "abuja-municipal"
    },
    {
      "id": "asokoro",
      "name": "Asokoro",
      "localUnitId": "abuja-municipal"
    },
    {
      "id": "gwarinpa",
      "name": "Gwarinpa",
      "localUnitId": "abuja-municipal"
    },
    {
      "id": "jabi",
      "name": "Jabi",
      "localUnitId": "abuja-municipal"
    },
    {
      "id": "utako",
      "name": "Utako",
      "localUnitId": "abuja-municipal"
    },
    {
      "id": "lugbe",
      "name": "Lugbe",
      "localUnitId": "abuja-municipal"
    },
    {
      "id": "kubwa",
      "name": "Kubwa",
      "localUnitId": "bwari"
    },
    {
      "id": "gwagwalada",
      "name": "Gwagwalada",
      "localUnitId": "gwagwalada"
    },
    {
      "id": "kuje",
      "name": "Kuje",
      "localUnitId": "kuje"
    },
    {
      "id": "kwali",
      "name": "Kwali",
      "localUnitId": "kwali"
    },
    {
      "id": "abaji",
      "name": "Abaji",
      "localUnitId": "abaji"
    },
    {
      "id": "central-business-district",
      "name": "Central Business District",
      "localUnitId": "abuja-municipal"
    }
  ],
  "hubs": [
    {
      "id": "utako-road",
      "name": "Utako Motor and Bus Terminal",
      "mode": "road",
      "venueId": "utako-hub"
    },
    {
      "id": "abuja-airport",
      "name": "Nnamdi Azikiwe International Airport",
      "mode": "air",
      "venueId": "airport"
    },
    {
      "id": "idu-rail",
      "name": "Idu Station",
      "mode": "rail",
      "venueId": "idu-station"
    }
  ]
},units:ABUJA_LGAS,mapOrigin:ABUJA_MAP_ORIGIN,links:Object.values(ABUJA_LINKS)} satisfies CityModuleRules<'abuja','fct',AbujaAreaCouncilId,AbujaDistrictId,AbujaHubId>)
