// The look editor without a DOM: the option lists, the rules for putting something on, the words
// that describe a look, the shapes of the flat figure and the editor's own UI state (which tab is
// open, what the preview is looking at). It is the typed twin of the look pieces in
// src/ui/panels/look-ui.js, which the existing panels still use.
//
// The preview itself (a Three.js canvas, drawn on demand only) is src/scene/avatar-preview.ts and
// is driven from lookPreview.ts. The server validates every look; nothing here is a rule.
import { lookUi } from './lookState.ts'
export { lookUi, markSpun } from './lookState.ts'
import { APPEARANCE } from '../../../game/content/traits.ts'
import type { AccessoryId, BodyId, Look, Wardrobe } from '../../../types/life.ts'
import type { PreviewFocus } from '../../../scene/avatar-preview.ts'

export type SwatchGroup = 'skin' | 'hairColours' | 'outfitColours'
/** The look fields an option button can set. */
export type LookField = 'body' | 'hair' | 'outfit' | 'fabric' | 'skin' | 'hairColor' | 'outfitColor' | 'bottomsColor' | 'face' | 'expression' | 'accessories'
/** What a Sim may wear: the shape of a wardrobe (the editor locks what is not in it). */
export type Owned = Required<Wardrobe>

const hexOf = (group: SwatchGroup, id: string | undefined): string => APPEARANCE[group].find((swatch) => swatch.id === id)?.hex ?? '#888888'
export const lookLabel = (id: string): string => APPEARANCE.labels[id] ?? id
export const hairOptions = (body: BodyId): string[] => [...(APPEARANCE.hair[body] ?? []), ...(APPEARANCE.extra.hair[body] ?? [])]
export const outfitOptions = (body: BodyId): string[] => [...(APPEARANCE.outfits[body] ?? []), ...(APPEARANCE.extra.outfits[body] ?? [])]
const SLOT: Readonly<Record<string, string | undefined>> = Object.fromEntries(APPEARANCE.accessories.map((item) => [item.id, item.slot]))
export const slotOf = (id: string): string | undefined => SLOT[id]
export const worn = (look: Pick<Look, 'accessories'>): AccessoryId[] => (Array.isArray(look.accessories) ? look.accessories : [])

/** The accessories of `look` with `id` put on: it replaces whatever shares its slot; at the limit the oldest gives way. */
export function withAccessory(look: Look, id: AccessoryId): AccessoryId[] {
  const kept = worn(look).filter((other) => other !== id && SLOT[other] !== SLOT[id])
  return [...kept.slice(Math.max(0, kept.length - (APPEARANCE.accessoryLimit - 1))), id]
}
export const withoutAccessory = (look: Look, id: AccessoryId): AccessoryId[] => worn(look).filter((other) => other !== id)

/**
 * What a Sim may wear while it is being created: everything offered except the styles sold only
 * in the Boutique. The same shape as a wardrobe, so the editor locks the rest the same way.
 */
export function starterWardrobe(): Owned {
  const free = <K extends 'hair' | 'outfit' | 'accessories'>(kind: K, ids: string[]): string[] => ids.filter((id) => !(APPEARANCE.boutiqueOnly[kind] as string[]).includes(id))
  return {
    hair: free('hair', [...new Set(APPEARANCE.bodies.flatMap((body) => hairOptions(body.id)))]) as Owned['hair'],
    outfit: free('outfit', [...new Set(APPEARANCE.bodies.flatMap((body) => outfitOptions(body.id)))]) as Owned['outfit'],
    fabric: [...APPEARANCE.fabrics],
    accessories: free('accessories', APPEARANCE.accessories.map((item) => item.id)) as Owned['accessories'],
  }
}

// ---- the editor's own state -----------------------------------------------------------------
// Tabs group the options by what they change. `focus` is where the preview looks while a tab is open.
export interface ChipsGroup { kind: 'chips'; field: LookField; title: string }
export interface SwatchesGroup { kind: 'swatches'; field: LookField; title: string; group: SwatchGroup }
export interface Section { id: string; title: string; icon: string; focus: PreviewFocus; groups: (ChipsGroup | SwatchesGroup)[] }
export const SECTIONS: readonly Section[] = [
  { id: 'body', title: 'Body', icon: 'person', focus: 'body', groups: [{ kind: 'chips', field: 'body', title: 'Body type' }, { kind: 'swatches', field: 'skin', title: 'Skin tone', group: 'skin' }, { kind: 'chips', field: 'face', title: 'Face shape' }, { kind: 'chips', field: 'expression', title: 'Expression' }] },
  { id: 'hair', title: 'Hair', icon: 'scissors', focus: 'head', groups: [{ kind: 'chips', field: 'hair', title: 'Hairstyle' }, { kind: 'swatches', field: 'hairColor', title: 'Hair colour', group: 'hairColours' }] },
  { id: 'outfit', title: 'Outfit', icon: 'boutique', focus: 'body', groups: [{ kind: 'chips', field: 'outfit', title: 'Outfit' }, { kind: 'chips', field: 'fabric', title: 'Fabric' }] },
  { id: 'colours', title: 'Colours', icon: 'frame', focus: 'body', groups: [{ kind: 'swatches', field: 'outfitColor', title: 'Outfit colour', group: 'outfitColours' }, { kind: 'swatches', field: 'bottomsColor', title: 'Bottoms colour', group: 'outfitColours' }] },
  { id: 'extras', title: 'Extras', icon: 'crown', focus: 'body', groups: [{ kind: 'chips', field: 'accessories', title: `Accessories · up to ${APPEARANCE.accessoryLimit}, tap again to take one off` }] },
]
const HEAD_FIELDS: ReadonlySet<string> = new Set(['hair', 'hairColor', 'skin', 'face', 'expression'])

/** Where the preview should look now: head and shoulders while hair, face or skin is being changed. */
export function lookFocus(): PreviewFocus {
  if (lookUi.zoomOverride) return lookUi.zoomOverride
  if (lookUi.lastField) return HEAD_FIELDS.has(lookUi.lastField) ? 'head' : 'body'
  return SECTIONS.find((item) => item.id === lookUi.section)?.focus ?? 'body'
}
/** Show the whole Sim again (after a shuffle, say), whatever was last being changed. */
export function lookFocusBody(): void { lookUi.lastField = 'body'; lookUi.zoomOverride = null }
/** The Face / Full body switch of the stage. */
export function toggleZoom(): PreviewFocus {
  lookUi.zoomOverride = lookFocus() === 'head' ? 'body' : 'head'
  return lookUi.zoomOverride
}
/** Open a tab of the editor (an unknown id opens the first). */
export function openLookTab(id: string): void {
  lookUi.section = SECTIONS.some((item) => item.id === id) ? id : 'body'
  lookUi.lastField = null
  lookUi.zoomOverride = null
}

/** The ids offered for a field. */
export function optionsOf(field: LookField, look: Look): string[] {
  switch (field) {
    case 'body': return APPEARANCE.bodies.map((item) => item.id)
    case 'hair': return hairOptions(look.body)
    case 'outfit': return outfitOptions(look.body)
    case 'accessories': return APPEARANCE.accessories.map((item) => item.id)
    case 'face': return [...APPEARANCE.faces]
    case 'expression': return [...APPEARANCE.expressions]
    default: return [...APPEARANCE.fabrics]
  }
}
/** Whether `id` is what the look has for `field` (optional fields fall back to their default; accessories are a list). */
export function chosen(look: Look, field: LookField, id: string): boolean {
  if (field === 'accessories') return (worn(look) as string[]).includes(id)
  const value: string | undefined = field === 'face' ? look.face ?? APPEARANCE.faces[0] : field === 'expression' ? look.expression ?? APPEARANCE.expressions[0] : look[field]
  return value === id
}
/** The swatch's label ('Light brown') for a colour id. */
export const swatchLabel = (group: SwatchGroup, id: string): string => APPEARANCE[group].find((swatch) => swatch.id === id)?.label ?? id
export const titled = (id: string): string => { const text = String(lookLabel(id)); return text.charAt(0).toUpperCase() + text.slice(1) }

/** `look` with one field set. The server validates the result. */
export const withField = (look: Look, field: string, value: string): Look => ({ ...look, [field]: value })

/**
 * The look after choosing `value` in `group`. Switching body keeps the hairstyle and outfit
 * when the new body has them, otherwise falls back to the first one allowed (and owned, when
 * `owned` — a wardrobe — is given). Also notes what was changed, so the preview knows where to look.
 */
export function chooseLook(look: Look, group: string, value: string, owned?: Owned | null): Look {
  lookUi.lastField = group === 'accessories' ? (['eyes', 'head', 'ears', 'neck'].includes(SLOT[value] ?? '') ? 'hair' : 'body') : group
  lookUi.zoomOverride = null
  if (group === 'accessories') return { ...look, accessories: (worn(look) as string[]).includes(value) ? withoutAccessory(look, value as AccessoryId) : withAccessory(look, value as AccessoryId) }
  const next = withField(look, group, value)
  if (group !== 'body') return next
  const fit = (kind: 'hair' | 'outfit', options: string[]): string => {
    const current: string = next[kind]
    const ownedIds: readonly string[] | undefined = owned?.[kind]
    return options.includes(current) && (!ownedIds || ownedIds.includes(current)) ? current : options.find((id) => !ownedIds || ownedIds.includes(id)) ?? options[0] ?? current
  }
  return { ...next, hair: fit('hair', hairOptions(next.body)) as Look['hair'], outfit: fit('outfit', outfitOptions(next.body)) as Look['outfit'] }
}

/** "Woman · Braids · Owambe · Ankara · Glasses" */
export const lookSummary = (look: Look): string => [look.body, look.hair, look.outfit, look.fabric, ...worn(look)].filter(Boolean).map(titled).join(' · ')
/** The preview's text alternative: everything the picture shows, in words. */
export function lookAlt(look: Look, name = 'Your Sim'): string {
  const wearing = worn(look)
  return `${name}: ${titled(look.body)}, ${swatchLabel('skin', look.skin).toLowerCase()} skin, ${titled(look.hair).toLowerCase()} hairstyle in ${swatchLabel('hairColours', look.hairColor).toLowerCase()}, ${titled(look.outfit).toLowerCase()} outfit in ${titled(look.fabric).toLowerCase()} ${swatchLabel('outfitColours', look.outfitColor).toLowerCase()}, ${swatchLabel('outfitColours', look.bottomsColor).toLowerCase()} bottoms${wearing.length ? `, wearing ${wearing.map((id) => titled(id).toLowerCase()).join(', ')}` : ''}.`
}
/** The look as the scene code takes it: style ids as they are, colours as hex values. */
export interface SceneLook { body: string; hair: string; outfit: string; fabric: string; accessories: string[]; face: string; expression: string; skin: string; hairColor: string; outfitColor: string; bottomsColor: string }
export const sceneLook = (look: Look): SceneLook => ({
  body: look.body, hair: look.hair, outfit: look.outfit, fabric: look.fabric, accessories: [...worn(look)], face: look.face ?? APPEARANCE.faces[0] ?? 'oval', expression: look.expression ?? APPEARANCE.expressions[0] ?? 'smile',
  skin: hexOf('skin', look.skin), hairColor: hexOf('hairColours', look.hairColor), outfitColor: hexOf('outfitColours', look.outfitColor), bottomsColor: hexOf('outfitColours', look.bottomsColor),
})

/**
 * A random look a new Sim may wear: nothing that is sold only in the Boutique, and up to two of
 * the free accessories. `random` returns 0 ≤ n < 1.
 */
export function randomLook(random: () => number = Math.random): Look {
  const pick = <T>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(random() * list.length))] as T
  const free = starterWardrobe()
  const body = pick(APPEARANCE.bodies).id
  let look: Look = {
    body, hair: pick(hairOptions(body).filter((id) => (free.hair as string[]).includes(id))) as Look['hair'], outfit: pick(outfitOptions(body).filter((id) => (free.outfit as string[]).includes(id))) as Look['outfit'], fabric: pick(APPEARANCE.fabrics),
    skin: pick(APPEARANCE.skin).id, hairColor: pick(APPEARANCE.hairColours).id, outfitColor: pick(APPEARANCE.outfitColours).id, bottomsColor: pick(APPEARANCE.outfitColours).id,
    accessories: [], face: pick(APPEARANCE.faces) as Look['face'], expression: pick(APPEARANCE.expressions) as Look['expression'],
  }
  for (let count = Math.floor(random() * 3); count > 0; count--) look = { ...look, accessories: withAccessory(look, pick(free.accessories)) }
  return look
}

/** The same look, whatever order the accessories are in and whether or not the optional fields are spelled out. */
const canonical = (look: Look): string => JSON.stringify([look.body, look.hair, look.outfit, look.fabric, look.skin, look.hairColor, look.outfitColor, look.bottomsColor,
  [...worn(look)].sort(), look.face ?? APPEARANCE.faces[0], look.expression ?? APPEARANCE.expressions[0]])
export const sameLook = (a: Look, b: Look): boolean => canonical(a) === canonical(b)

// ---- the flat figure ------------------------------------------------------------------------
/** One element of the flat figure's SVG: drawn by AvatarFigure.vue, never as markup. */
export interface Shape { tag: 'path' | 'circle' | 'rect' | 'ellipse'; attrs: Record<string, string | number> }
const path = (d: string, fill: string, extra: Record<string, string | number> = {}): Shape => ({ tag: 'path', attrs: { d, fill, ...extra } })
const circle = (cx: number, cy: number, r: number, fill: string, extra: Record<string, string | number> = {}): Shape => ({ tag: 'circle', attrs: { cx, cy, r, fill, ...extra } })
const rect = (x: number, y: number, width: number, height: number, fill: string, extra: Record<string, string | number> = {}): Shape => ({ tag: 'rect', attrs: { x, y, width, height, fill, ...extra } })

/** [behind the head, in front of it] */
function hairShapes(style: string, colour: string): [Shape[], Shape[]] {
  const cap = path('M38 46a22 22 0 0 1 44 0c-6-9-14-12-22-12s-16 3-22 12Z', colour)
  switch (style) {
    case 'bald': return [[], []]
    case 'low-cut': return [[], [cap]]
    case 'classic': return [[], [path('M36 50a24 24 0 0 1 48 0c-4-12-16-18-30-14-8 2-14 7-18 14Z', colour)]]
    case 'afro': return [[circle(60, 40, 31, colour)], []]
    case 'curls': return [[], [cap, ...[40, 50, 60, 70, 80].map((x, i) => circle(x, i % 2 ? 26 : 30, 7, colour))]]
    case 'bun': return [[], [cap, circle(60, 20, 10, colour)]]
    case 'ponytail': return [[path('M80 34c16 4 18 26 10 44-3-14-6-24-14-32Z', colour)], [cap]]
    case 'long': return [[path('M34 46a26 26 0 0 1 52 0v42H34Z', colour)], [cap]]
    case 'locs': return [[34, 41, 79, 86].map((x) => rect(x - 3, 40, 6, 44, colour, { rx: 3 })), [cap]]
    case 'braids': return [[33, 38, 43, 77, 82, 87].map((x) => rect(x - 1.5, 40, 3, 56, colour, { rx: 1.5 })), [cap]]
    default: return [[], [cap]]
  }
}

function fabricShapes(fabric: string): Shape[] {
  if (fabric === 'ankara') return ([[46, 84], [70, 90], [52, 104], [74, 112], [46, 122], [62, 124]] as const).map(([x, y], i) => circle(x, y, 5, i % 2 ? '#fff' : '#f2c14e', { opacity: '.55' }))
  if (fabric === 'adire') return ([[48, 86], [60, 86], [72, 86], [54, 100], [66, 100], [48, 114], [60, 114], [72, 114]] as const).map(([x, y]) => circle(x, y, 3.5, 'none', { stroke: '#fff', 'stroke-width': 1.5, opacity: '.7' }))
  if (fabric === 'aso-oke') return [44, 52, 60, 68, 76].map((x) => rect(x - 1.5, 76, 3, 54, '#fff', { opacity: '.4' }))
  return []
}

/** The figure's elements in drawing order (viewBox 0 0 120 190). `look` is state.onboarding.look. */
export function avatarShapes(look: Look): Shape[] {
  const skin = hexOf('skin', look.skin), hair = hexOf('hairColours', look.hairColor)
  const top = hexOf('outfitColours', look.outfitColor), bottom = hexOf('outfitColours', look.bottomsColor)
  const outfit = look.outfit
  const sleeves = outfit === 'office' || outfit === 'hoodie' || outfit === 'site-work' ? 'long' : outfit === 'chill' ? 'none' : 'short'
  const arm = (x: number): Shape[] => [rect(x, 76, 11, 48, sleeves === 'long' ? top : skin, { rx: 5.5 }), ...(sleeves === 'short' ? [rect(x, 76, 11, 20, top, { rx: 5.5 })] : [])]
  const legs: Shape[] = outfit === 'owambe' && look.body === 'woman'
    ? [path('M40 126h40l12 46H28Z', top), rect(30, 150, 60, 7, bottom, { opacity: '.9' })]
    : [rect(43, 126, 15, 48, outfit === 'chill' ? skin : bottom, { rx: 5 }), rect(62, 126, 15, 48, outfit === 'chill' ? skin : bottom, { rx: 5 }), ...(outfit === 'chill' ? [rect(42, 126, 36, 22, bottom, { rx: 5 })] : [])]
  const detail: Shape[] = outfit === 'office' ? [path('M52 74l8 12 8-12Z', '#fff'), path('M58 84h4l2 22-4 5-4-5Z', '#20232c')]
    : outfit === 'hoodie' ? [path('M50 112h20v10H50Z', '#0002'), { tag: 'path', attrs: { d: 'M57 76v14M63 76v14', stroke: '#fff', 'stroke-width': 1.5 } }]
      : outfit === 'site-work' ? [rect(38, 92, 44, 6, '#f4e04d'), rect(38, 112, 44, 6, '#f4e04d')] : []
  const [back, front]: [Shape[], Shape[]] = look.hair === 'gele'
    ? [[], [path('M34 44c-6-22 14-34 28-30 16-8 34 8 24 30-10-10-38-10-52 0Z', top), { tag: 'path', attrs: { d: 'M44 30c10-6 24-6 34 0', fill: 'none', stroke: '#fff', 'stroke-width': 1.5, opacity: '.6' } }]]
    : hairShapes(look.hair, hair)
  const hood = outfit === 'hoodie' ? [path('M34 78a26 30 0 0 1 52 0Z', top)] : []
  return [
    { tag: 'ellipse', attrs: { cx: 60, cy: 178, rx: 42, ry: 8, fill: '#0000001a' } }, ...hood, ...back,
    ...legs, rect(42, 170, 17, 8, '#20232c', { rx: 4 }), rect(61, 170, 17, 8, '#20232c', { rx: 4 }),
    ...arm(27), ...arm(82), rect(38, 74, 44, 58, top, { rx: 10 }), ...fabricShapes(look.fabric), ...detail,
    rect(54, 62, 12, 14, skin), circle(60, 48, 22, skin),
    circle(52, 48, 2.4, '#20232c'), circle(68, 48, 2.4, '#20232c'), { tag: 'path', attrs: { d: 'M52 57q8 7 16 0', fill: 'none', stroke: '#20232c', 'stroke-width': 2, 'stroke-linecap': 'round' } },
    ...front,
  ]
}
