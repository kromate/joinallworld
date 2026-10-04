// Pieces of existing UI that Vue panels still draw through the adapter: the look preview and
// editor (src/ui/panels/look-ui.js), the local-government card (lga-card.js), the "Follow on
// WhatsApp" link and the Hints/wallpaper preferences of the phone. They are HTML-string pieces
// owned by other panels, so a component hosts each as a LegacyPanel (`hosted`) instead of writing
// the markup itself. Each line goes when the piece it wraps is converted.
import { chooseLook as chooseLookJs, lookEditor as lookEditorJs, lookStage as lookStageJs, lookSummary as lookSummaryJs, lookTabClick as lookTabClickJs, mountLookPreview as mountLookPreviewJs, sameLook as sameLookJs, withAccessory as withAccessoryJs, withoutAccessory as withoutAccessoryJs } from '../../ui/panels/look-ui.js'
import { bindLgaCard as bindLgaCardJs, renderLgaCard as renderLgaCardJs } from '../../ui/panels/lga-card.js'
import { channelLink as channelLinkJs, load as loadGrowthJs } from '../../ui/panels/growth-client.js'
import { WALLPAPERS as WALLPAPERS_JS, getWallpaper as getWallpaperJs, setWallpaper as setWallpaperJs } from '../../ui/phone/wallpapers.js'
import type { AccessoryId, Look, Wardrobe } from '../../types/life.ts'
import type { LifeState } from '../../types/life.ts'
import type { LegacyPanel, PanelApi, PanelView } from '../types/panel.ts'

/** An existing-style piece shown in place: nothing registers it, a component hosts it with LegacyPanel. */
export function hosted(id: string, render: (state: LifeState, view: PanelView, api: PanelApi) => string, bind?: (root: HTMLElement, api: PanelApi) => void): LegacyPanel {
  return { id, title: id, placement: 'modal', render, ...(bind ? { bind: (root, api) => { bind(root, api) } } : {}) }
}

// ---- the look ------------------------------------------------------------------------------
export const lookSummary = lookSummaryJs as unknown as (look: Look) => string
export const sameLook = sameLookJs as unknown as (a: Look, b: Look) => boolean
export const withAccessory = withAccessoryJs as unknown as (look: Look, id: AccessoryId) => AccessoryId[]
export const withoutAccessory = withoutAccessoryJs as unknown as (look: Look, id: AccessoryId) => AccessoryId[]
/** The look after choosing `value` in `group`. `owned` (a wardrobe) limits what a body change falls back to. */
export const chooseLook = chooseLookJs as unknown as (look: Look, group: string, value: string, owned?: Wardrobe | null) => Look
/** From a click handler: switches the editor's tab; true if the click was on one. */
export const lookTabClick = lookTabClickJs as unknown as (target: Element) => boolean
export interface StageOptions { variant?: 'hero' | 'wide' | 'mini'; name?: string; tools?: string; caption?: string }
/** The preview stage's markup. `tools` and `caption` are ready-made, already escaped HTML. */
export const lookStage = lookStageJs as unknown as (look: Look, options?: StageOptions) => string
export const lookEditor = lookEditorJs as unknown as (look: Look, options?: { owned?: Wardrobe | null }) => string
/** Shows the 3D preview in the stage inside `root`; a root without a stage releases it. */
export const mountLookPreview = mountLookPreviewJs as unknown as (root: Element, look: Look, options?: { name?: string }) => void

// ---- the local-government card -------------------------------------------------------------
export const renderLgaCard = renderLgaCardJs as unknown as (state: LifeState, view: PanelView, options?: { heading?: string; compact?: boolean }) => string
export const bindLgaCard = bindLgaCardJs as unknown as (root: Element, api: PanelApi, options?: { onChosen?: (lga: string) => void; redraw?: () => void }) => void

// ---- Settings ------------------------------------------------------------------------------
/** The "Follow Allworld on WhatsApp" link, once the growth hello has arrived; '' before. */
export const channelLink = channelLinkJs as unknown as () => string
/** Say hello to the growth service unless a fresh answer is here. */
export const loadGrowth = loadGrowthJs as unknown as (api: PanelApi) => Promise<void>
export const WALLPAPERS = WALLPAPERS_JS as unknown as readonly { id: string; label: string }[]
export const getWallpaper = getWallpaperJs as unknown as () => string
/** False when the browser would not save the choice (it still applies until the tab closes). */
export const setWallpaper = setWallpaperJs as unknown as (id: string) => boolean

/** Escape text for the HTML pieces above (src/ui/dom.js esc). */
export const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[char] ?? char)

// ---- the goal chip's offer to settle in -------------------------------------------------------
import { nextNudge as nextNudgeJs, nudged as nudgedJs } from '../../quick-start/model.ts'
import { keepNudges as keepNudgesJs, nudgesOf as nudgesOfJs } from '../../quick-start/entry.js'
/** What was offered before on this device: how many times, which reasons, and the Lagos day of the last. */
export interface NudgeMemory { count: number; reasons: string[]; day: number | null }
export interface NudgeFacts { guest: boolean; activities: number; firstAt: number | null; busy: boolean; day: number }
/** The reason to offer settling in now ('first-reward', 'third-activity', 'next-day'), or null. */
export const nextNudge = nextNudgeJs as unknown as (facts: NudgeFacts, memory: NudgeMemory) => string | null
export const nudged = nudgedJs as unknown as (memory: NudgeMemory, reason: string, day: number) => NudgeMemory
export const nudgesOf = nudgesOfJs as unknown as (life: string) => NudgeMemory
export const keepNudges = keepNudgesJs as unknown as (life: string, value: NudgeMemory) => void
