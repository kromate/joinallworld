import { project } from '../../geo/frame.ts'
import { pointInPart } from '../lga.ts'
import type { CityStateOverview, LonLatPolygon } from '../../types/content.ts'

/** An open city of the state: its local units, and (for the pin and the travel lines) where the atlas marks it. */
export interface OverviewCity { id: string; name: string; units: readonly { id: string }[]; at?: { lon: number; lat: number } }
/** A place outside the state that a travel link leaves for (Lagos, Ibadan): a named end of a line, not a pin to tap. */
export interface OverviewPlace { id: string; name: string; lon: number; lat: number }
/** One travel link between two cities, with what the sheet says about it. */
export interface OverviewLink { id: string; a: string; b: string; mode: string; label: string; fare: number; minutes: number; km: number }
/** What the state view adds to the local governments: the player's city, the links, the places they leave for, and the link in focus. */
export interface OverviewExtras { current?: string | null; links?: readonly OverviewLink[]; outside?: readonly OverviewPlace[]; link?: string | null }

const escape = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
const number = (value: number): string => String(Math.round(value * 100) / 100)
const percent = (value: number): string => String(Math.round(value * 1000) / 10)
const naira = (value: number): string => `₦${Number(value).toLocaleString('en-NG')}`
const MODE: Readonly<Record<string, string>> = { road: 'Bus', rail: 'Train', air: 'Flight' }
const polygonPath = (polygons: readonly LonLatPolygon[]): string => polygons.flatMap(polygon => polygon.map(ring => ring.map(([lon, lat], index) => {
  const point = project(lon, lat)
  return `${index ? 'L' : 'M'}${number(point.x)} ${number(point.z)}`
}).join('') + 'Z')).join('')

/** The width the state map is laid out for when pin names are placed; the real width only scales every distance alike. */
const STAGE_PX = 340
/** Where a name sits against its pin; the `far-` sides are set further out and drawn with a leader line to the pin they name. */
type Side = 'below' | 'above' | 'right' | 'left' | 'far-below' | 'far-above' | 'far-right' | 'far-left'
const FAR = 26
interface Box { l: number; r: number; t: number; b: number }
const nameBox = (x: number, y: number, name: string, where: Side): Box => {
  const w = name.length * 6.6 + 8, h = 16, far = where.startsWith('far-'), gap = 12 + (far ? FAR : 0), side = far ? where.slice(4) : where
  return side === 'below' ? { l: x - w / 2, r: x + w / 2, t: y + gap, b: y + gap + h } : side === 'above' ? { l: x - w / 2, r: x + w / 2, t: y - gap - h, b: y - gap }
    : side === 'right' ? { l: x + gap, r: x + gap + w, t: y - h / 2, b: y + h / 2 } : { l: x - gap - w, r: x - gap, t: y - h / 2, b: y + h / 2 }
}
const clash = (a: Box, b: Box): boolean => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b

/** A geographic overview is an inspection surface; its controls never move a character. */
export function stateOverviewHtml(overview: CityStateOverview, cities: readonly OverviewCity[], selectedCity: string | null, expanded: { units?: boolean; landmarks?: boolean } = {}, extras: OverviewExtras = {}): string {
  const placed = cities.flatMap(city => city.at ? [{ ...city, at: city.at }] : [])
  const outside = extras.outside ?? []
  const points = [...overview.outline, ...overview.neighbours.flatMap(item => item.polygons)].flatMap(polygon => polygon.flatMap(ring => ring.map(([lon, lat]) => project(lon, lat))))
  if (!points.length) throw new TypeError('A state overview needs an outline')
  const minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x))
  const minZ = Math.min(...points.map(point => point.z)), maxZ = Math.max(...points.map(point => point.z))
  const span = Math.max(maxX - minX, maxZ - minZ), margin = span * 0.025
  const view = { x: minX - margin, z: minZ - margin, w: maxX - minX + margin * 2, h: maxZ - minZ + margin * 2 }
  const units = overview.localUnits.map(unit => ({ ...unit, city: cities.find(city => city.units.some(item => item.id === unit.id)) }))
  const landmarks = (overview.landmarks ?? []).map(item => {
    const unit = units.find(unit => unit.polygons.some(polygon => pointInPart(item.lon, item.lat, polygon)))
    return { ...item, status: unit?.city?.name ?? (unit ? 'Coming soon' : 'State landmark'), city: unit?.city }
  })
  const open = units.filter(unit => unit.city).length
  const title = (name: string, city?: OverviewCity): string => `${name} · ${city ? city.name : 'Coming soon'}`

  // Travel links, drawn in the same projection between the places they join.
  const where = new Map<string, { x: number; z: number; name: string }>()
  for (const city of placed) { const point = project(city.at.lon, city.at.lat); where.set(city.id, { x: point.x, z: point.z, name: city.name }) }
  for (const place of outside) { const point = project(place.lon, place.lat); where.set(place.id, { x: point.x, z: point.z, name: place.name }) }
  const links = (extras.links ?? []).filter(link => where.has(link.a) && where.has(link.b))
  const focus = links.find(link => link.id === extras.link) ?? null
  const lit = (link: OverviewLink): boolean => focus ? focus.id === link.id : Boolean(selectedCity) && (link.a === selectedCity || link.b === selectedCity)
  const line = (link: OverviewLink): string => { const a = where.get(link.a)!, b = where.get(link.b)!; return `M${number(a.x)} ${number(a.z)}L${number(b.x)} ${number(b.z)}` }
  const lines = links.map(link => `<path class="atlas-state-link is-${escape(link.mode)}${lit(link) ? ' is-lit' : ''}" d="${line(link)}" fill="none"><title>${escape(MODE[link.mode] ?? link.mode)} · ${escape(where.get(link.a)!.name)} to ${escape(where.get(link.b)!.name)} · ${escape(naira(link.fare))} · about ${link.minutes} min</title></path>`).join('')
  const hits = links.map(link => `<path class="atlas-state-hit" d="${line(link)}" fill="none" stroke="transparent" data-atlas-state-link="${escape(link.id)}"><title>${escape(MODE[link.mode] ?? link.mode)} · ${escape(where.get(link.a)!.name)} to ${escape(where.get(link.b)!.name)}</title></path>`).join('')

  const svg = `<svg class="atlas-state-map" viewBox="${number(view.x)} ${number(view.z)} ${number(view.w)} ${number(view.h)}" aria-hidden="true" focusable="false">
    ${overview.neighbours.map(item => `<path d="${polygonPath(item.polygons)}" fill="#d7ddcf" fill-rule="evenodd" stroke="#75826e" stroke-width="${number(span * 0.002)}"><title>${escape(item.name)} · neighbouring state</title></path>`).join('')}
    <path d="${polygonPath(overview.outline)}" fill="#eef0eb" fill-rule="evenodd" stroke="#345d43" stroke-width="${number(span * 0.003)}"/>
    ${units.map(unit => `<path d="${polygonPath(unit.polygons)}" fill="${unit.city?.id === selectedCity ? '#39734d' : unit.city ? '#b4d4a8' : '#e4e6e0'}" fill-rule="evenodd" stroke="#66755e" stroke-width="${number(span * 0.001)}" ${unit.city ? `data-atlas-inspect-city="${escape(unit.city.id)}"` : ''}><title>${escape(title(unit.name, unit.city))}</title></path>`).join('')}
    ${landmarks.map(item => { const point = project(item.lon, item.lat); return `<circle cx="${number(point.x)}" cy="${number(point.z)}" r="${number(span * 0.006)}" fill="#a86c25"><title>${escape(item.name)} · ${escape(item.status)}</title></circle>` }).join('')}
    ${lines}${hits}
  </svg>`

  // Pins and names are HTML over the map, so that a pin is a button of at least 44 pixels however small the map is drawn.
  const at = (id: string): { left: number; top: number } => { const place = where.get(id)!; return { left: (place.x - view.x) / view.w, top: (place.z - view.z) / view.h } }
  const stageH = STAGE_PX * view.h / view.w
  const pinBoxes = new Map<string, Box>([...placed.map(city => city.id), ...outside.map(place => place.id)].map(id => [id, { l: at(id).left * STAGE_PX - 22, r: at(id).left * STAGE_PX + 22, t: at(id).top * stageH - 22, b: at(id).top * stageH + 22 }]))
  const taken: Box[] = []
  const side = (id: string, name: string, preferred: readonly Side[]): Side => {
    const spot = at(id), x = spot.left * STAGE_PX, y = spot.top * stageH
    const free = preferred.find(candidate => {
      const box = nameBox(x, y, name, candidate)
      return box.l >= 0 && box.r <= STAGE_PX && box.t >= 0 && box.b <= stageH && !taken.some(other => clash(box, other)) && ![...pinBoxes].some(([other, around]) => other !== id && clash(box, around))
    }) ?? preferred[0]!
    taken.push(nameBox(x, y, name, free))
    return free
  }
  const pins = placed.map(city => {
    const here = city.id === extras.current, picked = city.id === selectedCity, spot = at(city.id)
    const label = side(city.id, here ? `${city.name} You are here` : city.name, ['below', 'above', 'right', 'left', 'far-below', 'far-above', 'far-right', 'far-left'])
    return `<button type="button" class="atlas-state-pin${here ? ' is-here' : ''}${picked ? ' is-selected' : ''} at-${label}" style="left:${percent(spot.left)}%;top:${percent(spot.top)}%" data-atlas-inspect-city="${escape(city.id)}" aria-pressed="${picked}" aria-label="${escape(city.name)}${here ? ', you are here' : ', open'}"><i aria-hidden="true"></i><span><b>${escape(city.name)}</b>${here ? '<small>You are here</small>' : ''}</span></button>`
  }).join('')
  const ext = outside.filter(place => links.some(link => link.a === place.id || link.b === place.id)).map(place => {
    const spot = at(place.id), label = side(place.id, place.name, ['right', 'left', 'above', 'below'])
    return `<span class="atlas-state-ext at-${label}" style="left:${percent(spot.left)}%;top:${percent(spot.top)}%"><i aria-hidden="true"></i><span>${escape(place.name)}</span></span>`
  }).join('')
  const stage = `<div class="atlas-state-stage" style="aspect-ratio:${number(view.w)} / ${number(view.h)}">${svg}${ext}${pins}</div>`

  // What the lines say: the link in focus, else the links of the chosen city, else how to ask.
  const name = (id: string): string => where.get(id)?.name ?? id
  const detail = (link: OverviewLink): string => `${escape(MODE[link.mode] ?? link.mode)} · ${escape(naira(link.fare))} · about ${link.minutes} min · ${link.km} km`
  const own = selectedCity ? links.filter(link => link.a === selectedCity || link.b === selectedCity) : []
  const caption = focus
    ? `<div class="atlas-state-links" role="status"><p><b>${escape(name(focus.a))} ⇄ ${escape(name(focus.b))}</b><span>${escape(focus.label)}</span><span>${detail(focus)}</span></p></div>`
    : own.length
      ? `<div class="atlas-state-links"><h3>Travel from ${escape(name(selectedCity!))}</h3><ul>${own.map(link => `<li><button type="button" data-atlas-state-link="${escape(link.id)}" aria-pressed="false"><b>${escape(name(link.a === selectedCity ? link.b : link.a))}</b><span>${detail(link)}</span></button></li>`).join('')}</ul></div>`
      : links.length ? '<p class="atlas-state-key">Tap a city or a line for fares and times.</p>' : ''

  return `<section class="atlas-state-overview" aria-label="${escape(overview.name)} local governments"><h3>${escape(overview.name)} · ${placed.length > 1 ? 'cities and ' : ''}local governments</h3>${stage}${caption}<p class="atlas-state-key">Pins: open cities · grey: coming soon${links.length ? ' · lines: travel links (dashed: train)' : ''}. Neighbouring outlines provide context.</p><details${expanded.units ? ' open' : ''}><summary data-atlas-overview-section="units">${units.length} local governments · ${open} in open cities · ${units.length - open} coming</summary><ul>${units.map(unit => `<li>${unit.city ? `<button type="button" data-atlas-inspect-city="${escape(unit.city.id)}">${escape(unit.name)} <small>${escape(unit.city.name)}</small></button>` : `<span>${escape(unit.name)} <small>Coming soon</small></span>`}</li>`).join('')}</ul></details>${landmarks.length ? `<details${expanded.landmarks ? ' open' : ''}><summary data-atlas-overview-section="landmarks">State landmarks</summary><ul>${landmarks.map(item => `<li><span>${escape(item.name)} <small>${escape(item.status)}</small></span></li>`).join('')}</ul></details>` : ''}</section>`
}
