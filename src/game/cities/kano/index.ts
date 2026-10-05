import type {CityModule} from '../../../types/content.ts'
import {KANO_RULES} from './rules.ts'
import type {KanoLocalGovernmentId,KanoDistrictId,KanoHubId} from './rules.ts'
export const kanoCity=Object.freeze({id:'kano',rules:KANO_RULES,loadContent:async()=>(await import('./content.ts')).KANO_CONTENT,loadMap:async()=>(await import('./map.ts')).KANO_MAP} satisfies CityModule<'kano','kano',KanoLocalGovernmentId,KanoDistrictId,KanoHubId>)
export {KANO_RULES,KANO_LGAS,KANO_MAP_ORIGIN} from './rules.ts'
