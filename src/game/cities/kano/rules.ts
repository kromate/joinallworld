import { NIGERIA } from '../country.ts'
import { CAREER_IDS } from '../../content/career-ids.ts'
import type {CityModuleRules,LgaDefinition} from '../../../types/content.ts'
import {KANO_LINKS} from './links.ts'
export type KanoLocalGovernmentId='kano-municipal'|'dala'|'fagge'|'gwale'|'nassarawa'|'tarauni'|'kumbotso'|'ungogo'
export type KanoDistrictId=KanoLocalGovernmentId
export type KanoHubId='kano-road'|'kano-airport'|'kano-rail'
export const KANO_LGAS=Object.freeze([
  {
    "id": "kano-municipal",
    "name": "Kano Municipal",
    "zone": "mainland",
    "land": 120000,
    "beta": true,
    "districts": [
      "kano-municipal"
    ]
  },
  {
    "id": "dala",
    "name": "Dala",
    "zone": "mainland",
    "land": 95000,
    "beta": true,
    "districts": [
      "dala"
    ]
  },
  {
    "id": "fagge",
    "name": "Fagge",
    "zone": "mainland",
    "land": 110000,
    "beta": true,
    "districts": [
      "fagge"
    ]
  },
  {
    "id": "gwale",
    "name": "Gwale",
    "zone": "mainland",
    "land": 85000,
    "beta": true,
    "districts": [
      "gwale"
    ]
  },
  {
    "id": "nassarawa",
    "name": "Nassarawa",
    "zone": "mainland",
    "land": 100000,
    "beta": true,
    "districts": [
      "nassarawa"
    ]
  },
  {
    "id": "tarauni",
    "name": "Tarauni",
    "zone": "mainland",
    "land": 100000,
    "beta": true,
    "districts": [
      "tarauni"
    ]
  },
  {
    "id": "kumbotso",
    "name": "Kumbotso",
    "zone": "mainland",
    "land": 65000,
    "beta": true,
    "districts": [
      "kumbotso"
    ]
  },
  {
    "id": "ungogo",
    "name": "Ungogo",
    "zone": "mainland",
    "land": 70000,
    "beta": true,
    "districts": [
      "ungogo"
    ]
  }
] satisfies readonly(Omit<LgaDefinition,'id'|'districts'>&{id:KanoLocalGovernmentId;districts:KanoDistrictId[]})[])
export const KANO_MAP_ORIGIN=Object.freeze({
  "x": 571,
  "z": -3336
})
export const KANO_PLAY_BOUNDS=Object.freeze({
  "minX": -145.20976255762844,
  "maxX": 140.64117655830398,
  "minZ": -152.23859276122994,
  "maxZ": 151.06489173937098
})
export const KANO_RULES=Object.freeze({...{
  "id": "kano",
  "name": "Kano",
  "status": "open",
  "unit": "local government",
  "hub": {
    "road": "Kano Road Transport Hub",
    "air": "Mallam Aminu Kano International Airport",
    "rail": "Kano Railway Station"
  },
  "seaPlots": false,
  "hasStateOverview": true,
  "state": {
    "id": "kano",
    "name": "Kano State",
    "unit": "local government"
  },
  country: NIGERIA,
  "timezone": "Africa/Lagos",
  "rentedHomeIds": [
    "kano-kano-municipal-home",
    "kano-dala-home",
    "kano-fagge-home",
    "kano-gwale-home",
    "kano-nassarawa-home",
    "kano-tarauni-home",
    "kano-kumbotso-home",
    "kano-ungogo-home"
  ],
  "defaultRentedHome": "kano-nassarawa-home",
  "defaultName": "New arrival",
  "careerIds": CAREER_IDS,
  "atlas": {
    "lon": 8.52,
    "lat": 12,
    "teaser": "An old walled city of dyeing, markets, campuses and Durbar heritage."
  },
  "districts": [
    {
      "id": "kano-municipal",
      "name": "Gidan Sarkin Kano neighbourhood",
      "localUnitId": "kano-municipal"
    },
    {
      "id": "dala",
      "name": "Dala",
      "localUnitId": "dala"
    },
    {
      "id": "fagge",
      "name": "Fagge",
      "localUnitId": "fagge"
    },
    {
      "id": "gwale",
      "name": "Gwale Rinji",
      "localUnitId": "gwale"
    },
    {
      "id": "nassarawa",
      "name": "Gama, Nassarawa",
      "localUnitId": "nassarawa"
    },
    {
      "id": "tarauni",
      "name": "Tarauni",
      "localUnitId": "tarauni"
    },
    {
      "id": "kumbotso",
      "name": "Chalawa, Kumbotso",
      "localUnitId": "kumbotso"
    },
    {
      "id": "ungogo",
      "name": "Ungogo Arewa",
      "localUnitId": "ungogo"
    }
  ],
  "hubs": [
    {
      "id": "kano-road",
      "name": "Kano Road Transport Hub",
      "mode": "road",
      "venueId": "road-hub"
    },
    {
      "id": "kano-airport",
      "name": "Mallam Aminu Kano International Airport",
      "mode": "air",
      "venueId": "airport"
    },
    {
      "id": "kano-rail",
      "name": "Kano Railway Station",
      "mode": "rail",
      "venueId": "railway-station"
    }
  ],
  "climate": {
    "beta": true,
    "rainChanceByMonth": [
      0.01,
      0.01,
      0.02,
      0.06,
      0.2,
      0.4,
      0.55,
      0.65,
      0.35,
      0.08,
      0.01,
      0.01
    ],
    "clearLabel": "Hot and dry",
    "harmattan": {
      "months": [
        11,
        12,
        1,
        2
      ],
      "label": "Harmattan dust"
    }
  }
},units:KANO_LGAS,mapOrigin:KANO_MAP_ORIGIN,links:Object.values(KANO_LINKS)} satisfies CityModuleRules<'kano','kano',KanoLocalGovernmentId,KanoDistrictId,KanoHubId>)
