import type { CityModule } from '../../../types/content.ts'
import { ABUJA_RULES } from './rules.ts'
import type { AbujaAreaCouncilId,AbujaDistrictId,AbujaHubId } from './rules.ts'
export const abujaCity = Object.freeze({id:'abuja',rules:ABUJA_RULES,loadContent:async()=>(await import('./content.ts')).ABUJA_CONTENT,loadMap:async()=>(await import('#city-map/abuja')).ABUJA_MAP,loadRoutes:async()=>(await import('#city-map/abuja')).ABUJA_ROUTE_GEOMETRY} satisfies CityModule<'abuja','fct',AbujaAreaCouncilId,AbujaDistrictId,AbujaHubId>)
export {ABUJA_RULES,ABUJA_LGAS,ABUJA_MAP_ORIGIN} from './rules.ts'
