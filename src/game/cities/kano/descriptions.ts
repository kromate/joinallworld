export { activity, hospitalSpots, spot, work } from '../contentBuilder.ts'
export type { CityContentSpec, CityVenueSeed } from '../contentBuilder.ts'
import { buildCityContent as buildSharedCityContent, type CityContentSpec } from '../contentBuilder.ts'
export const buildCityContent = <City extends string>(spec: CityContentSpec<City>) => buildSharedCityContent({ ...spec, unitLabel: 'local government', wishPrefix: 'kano' })
