// Pieces of existing UI that Vue panels still draw through the adapter: the local-government card (lga-card.js), the "Follow on
// WhatsApp" link and the Hints/wallpaper preferences of the phone. They are HTML-string pieces
// owned by other panels, so a component hosts each as a LegacyPanel (`hosted`) instead of writing
// the markup itself. Each line goes when the piece it wraps is converted.
import { bindLgaCard as bindLgaCardJs, renderLgaCard as renderLgaCardJs } from '../../ui/panels/lga-card.js'
import { channelLink as channelLinkJs, load as loadGrowthJs } from '../../ui/panels/growth-client.js'
import { WALLPAPERS as WALLPAPERS_JS, getWallpaper as getWallpaperJs, setWallpaper as setWallpaperJs } from '../../ui/phone/wallpapers.ts'
import type { LifeState } from '../../types/life.ts'
import type { LegacyPanel, PanelApi, PanelView } from '../types/panel.ts'

/** An existing-style piece shown in place: nothing registers it, a component hosts it with LegacyPanel. */
export function hosted(id: string, render: (state: LifeState, view: PanelView, api: PanelApi) => string, bind?: (root: HTMLElement, api: PanelApi) => void): LegacyPanel {
  return { id, title: id, placement: 'modal', render, ...(bind ? { bind: (root, api) => { bind(root, api) } } : {}) }
}

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
import { keepNudges as keepNudgesJs, nudgesOf as nudgesOfJs } from '../../quick-start/entry.ts'
/** What was offered before on this device: how many times, which reasons, and the Lagos day of the last. */
export interface NudgeMemory { count: number; reasons: string[]; day: number | null }
export interface NudgeFacts { guest: boolean; activities: number; firstAt: number | null; busy: boolean; day: number }
/** The reason to offer settling in now ('first-reward', 'third-activity', 'next-day'), or null. */
export const nextNudge = nextNudgeJs as unknown as (facts: NudgeFacts, memory: NudgeMemory) => string | null
export const nudged = nudgedJs as unknown as (memory: NudgeMemory, reason: string, day: number) => NudgeMemory
export const nudgesOf = nudgesOfJs as unknown as (life: string) => NudgeMemory
export const keepNudges = keepNudgesJs as unknown as (life: string, value: NudgeMemory) => void
