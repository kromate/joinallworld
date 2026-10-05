import { project } from '../../geo/frame.ts'
import { pointInPart } from '../lga.ts'
import { cityRules } from '../../game/cities/registry.ts'
import { cityUnit } from '../../game/cities/terminology.ts'
import type { CityStateOverview, LonLatPolygon } from '../../types/content.ts'

export interface OverviewCity { id: string; name: string; units: readonly { id: string }[] }
const escape = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
const number = (value: number): string => String(Math.round(value * 100) / 100)
const polygonPath = (polygons: readonly LonLatPolygon[]): string => polygons.flatMap(polygon => polygon.map(ring => ring.map(([lon, lat], index) => {
  const point = project(lon, lat)
  return `${index ? 'L' : 'M'}${number(point.x)} ${number(point.z)}`
}).join('') + 'Z')).join('')

/** The atlas card uses the same administrative-unit metadata as the overview. */
export function stateOverviewToggleHtml(stateId: string, cityId: string, expanded: boolean): string {
  return `<button type="button" class="atlas-chip" data-atlas-state-overview="${escape(stateId)}" aria-expanded="${expanded}">${expanded ? 'Hide state overview' : `View all ${escape(cityUnit(cityId, true))}`}</button>`
}

/** A geographic overview is an inspection surface; its controls never move a character. */
export function stateOverviewHtml(overview: CityStateOverview, cities: readonly OverviewCity[], selectedCity: string | null, expanded: { units?: boolean; landmarks?: boolean } = {}, currentCity: string | null = null): string {
  const points = [...overview.outline, ...overview.neighbours.flatMap(item => item.polygons)].flatMap(polygon => polygon.flatMap(ring => ring.map(([lon, lat]) => project(lon, lat))))
  if (!points.length) throw new TypeError('A state overview needs an outline')
  const minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x))
  const minZ = Math.min(...points.map(point => point.z)), maxZ = Math.max(...points.map(point => point.z))
  const span = Math.max(maxX - minX, maxZ - minZ), margin = span * 0.025
  const units = overview.localUnits.map(unit => ({ ...unit, city: cities.find(city => city.units.some(item => item.id === unit.id)) }))
  const unitName = cityRules(cities[0]?.id ?? '')?.unit ?? 'local government'
  const landmarks = (overview.landmarks ?? []).map(item => {
    const unit = units.find(unit => unit.polygons.some(polygon => pointInPart(item.lon, item.lat, polygon)))
    return { ...item, status: item.context ?? unit?.city?.name ?? (unit ? 'Coming soon' : 'State landmark'), city: item.context ? undefined : unit?.city }
  })
  const departureHtml = (item: NonNullable<CityStateOverview['landmarks']>[number]): string => {
    const departure = item.departure
    if (!departure) return ''
    return departure.cityId === currentCity
      ? `<button type="button" data-atlas-departure="${escape(item.id)}">${escape(departure.label)}</button>`
      : `<small>Outing departs from ${escape(cityRules(departure.cityId)?.name ?? departure.cityId)}.</small>`
  }
  const open = units.filter(unit => unit.city).length
  const title = (name: string, city?: OverviewCity): string => `${name} · ${city ? city.name : 'Coming soon'}`
  const svg = `<svg class="atlas-state-map" viewBox="${number(minX - margin)} ${number(minZ - margin)} ${number(maxX - minX + margin * 2)} ${number(maxZ - minZ + margin * 2)}" aria-hidden="true" focusable="false">
    ${overview.neighbours.map(item => `<path d="${polygonPath(item.polygons)}" fill="#d7ddcf" fill-rule="evenodd" stroke="#75826e" stroke-width="${number(span * 0.002)}"><title>${escape(item.name)} · neighbouring state</title></path>`).join('')}
    <path d="${polygonPath(overview.outline)}" fill="#eef0eb" fill-rule="evenodd" stroke="#345d43" stroke-width="${number(span * 0.003)}"/>
    ${units.map(unit => `<path d="${polygonPath(unit.polygons)}" fill="${unit.city?.id === selectedCity ? '#39734d' : unit.city ? '#b4d4a8' : '#e4e6e0'}" fill-rule="evenodd" stroke="#66755e" stroke-width="${number(span * 0.001)}" ${unit.city ? `data-atlas-inspect-city="${escape(unit.city.id)}"` : ''}><title>${escape(title(unit.name, unit.city))}</title></path>`).join('')}
    ${(overview.water ?? []).map(polygon => `<path d="${polygonPath([polygon])}" fill="#7cb9cd" fill-rule="evenodd" pointer-events="none"/>`).join('')}
    ${landmarks.map(item => { const point = project(item.lon, item.lat); return `<circle cx="${number(point.x)}" cy="${number(point.z)}" r="${number(span * 0.006)}" fill="#a86c25"><title>${escape(item.name)} · ${escape(item.status)}</title></circle>` }).join('')}
  </svg>`
  return `<section class="atlas-state-overview" aria-label="${escape(overview.name)} ${escape(unitName)}s"><h3>${escape(overview.name)} · ${escape(unitName)}s</h3>${svg}<p class="atlas-state-key">Green: open city · grey: coming soon. Neighbouring outlines provide context.</p><details${expanded.units ? ' open' : ''}><summary data-atlas-overview-section="units">${units.length} ${escape(unitName)}s · ${open} in open cities · ${units.length - open} coming</summary><ul>${units.map(unit => `<li>${unit.city ? `<button type="button" data-atlas-inspect-city="${escape(unit.city.id)}">${escape(unit.name)} <small>${escape(unit.city.name)}</small></button>` : `<span>${escape(unit.name)} <small>Coming soon</small></span>`}</li>`).join('')}</ul></details>${landmarks.length ? `<details${expanded.landmarks ? ' open' : ''}><summary data-atlas-overview-section="landmarks">State landmarks</summary><ul>${landmarks.map(item => `<li><span>${escape(item.name)} <small>${escape(item.status)}</small></span>${departureHtml(item)}</li>`).join('')}</ul></details>` : ''}</section>`
}
