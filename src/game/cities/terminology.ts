import { cityRules } from './registry.ts'

/** Public terminology; persisted city, lga and governor keys remain unchanged. */
export const civicTitle = (cityId: string): string => cityRules(cityId)?.civicTitle ?? 'Governor'
export const civicOffice = (cityId: string): string => civicTitle(cityId) === 'Governor' ? 'State House' : `${civicTitle(cityId)}’s office`
export function cityUnit(cityId: string, plural = false): string {
  const unit = cityRules(cityId)?.unit ?? 'local government'
  return plural ? `${unit}s` : unit
}
export function cityUnitArticle(cityId: string): string {
  const unit = cityUnit(cityId)
  return `${/^[aeiou]/i.test(unit) ? 'an' : 'a'} ${unit}`
}
