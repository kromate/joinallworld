// The typed boundary to the browser-side JavaScript the new shell still runs on: the panel
// registry, the icon set, the keyboard map. Every existing module the shell uses is imported in
// src/app/legacy/ once and given its contract, so no other file under src/app/ imports a .js
// module and the casts live in one place. When a module is converted to TypeScript its lines here
// are deleted and its importers point at the real file. The DOM-free modules are in ./engine.ts.
import { PANELS as PANELS_JS, sessionGate as sessionGateJs } from '../../ui/panels/index.js'
import { glyph as glyphJs, glyphFor as glyphForJs, hasGlyph as hasGlyphJs, tintOf as tintOfJs } from '../../ui/phone/icons.js'
import { icon as iconJs } from '../../ui/dom.js'
import { getWallpaper as getWallpaperJs } from '../../ui/phone/wallpapers.js'
import { checkReports as checkReportsJs, markReportsRead as markReportsReadJs, noteFiled as noteFiledJs, noteReports as noteReportsJs, reportReplies as reportRepliesJs } from '../../ui/phone/reports.js'
import { shortcutFor as shortcutForJs, shortcutRows as shortcutRowsJs, heldActionFor as heldActionForJs } from '../../ui/keys.js'
import { crowdList as crowdListJs, playersHere as playersHereJs } from '../../scene/crowd.js'
import type { LifeState } from '../../types/life.ts'
import type { SupportReport } from '../../types/support.ts'
import type { NpcContent } from './engine.ts'
import type { LegacyPanel, PanelApi, PanelMeta } from '../types/panel.ts'

// ---- panels --------------------------------------------------------------------------------
/** Every existing panel, sorted. A lazy one is a stub (`pending`) until its group arrives. */
export const LEGACY_PANELS = PANELS_JS as unknown as LegacyPanel[]
export const legacySessionGate = sessionGateJs as unknown as () => LegacyPanel | undefined

// ---- icons ---------------------------------------------------------------------------------
/** A bare <svg> string of the game's icon set; an unknown name draws the "info" mark. */
export const glyph = glyphJs as unknown as (name: string) => string
/** Small interface marks that are not part of the app icon set (src/ui/dom.js). */
const INTERFACE_MARKS: readonly string[] = ['menu', 'eye', 'eye-off', 'chat', 'plus', 'minus', 'fit', 'list']
const interfaceMark = iconJs as unknown as (name: string) => string
/** Any mark by name: an interface mark, 'chevron-down', or a glyph of the icon set. */
export const iconSvg = (name: string): string => (name === 'chevron-down' ? interfaceMark('chevron') : INTERFACE_MARKS.includes(name) ? interfaceMark(name) : glyph(name))
export const hasGlyph = hasGlyphJs as unknown as (name: string) => boolean
/** The glyph name for a panel id. */
export const glyphFor = glyphForJs as unknown as (id: string) => string
export const tintOf = tintOfJs as unknown as (panel: Pick<PanelMeta, 'id' | 'tint'> | null | undefined) => string
export const getWallpaper = getWallpaperJs as unknown as () => string

// ---- report replies (the badge on Report a problem) ----------------------------------------
type ReportStamp = Pick<SupportReport, 'id' | 'at' | 'updatedAt' | 'note' | 'status'>
export const checkReports = checkReportsJs as unknown as (api: Pick<PanelApi, 'view' | 'fetchJson' | 'refresh'>) => void
export const noteReports = noteReportsJs as unknown as (reports: readonly ReportStamp[]) => void
export const markReportsRead = markReportsReadJs as unknown as () => boolean
export const noteFiled = noteFiledJs as unknown as () => void
export const reportReplies = reportRepliesJs as unknown as () => number

// ---- keyboard ------------------------------------------------------------------------------
export interface Shortcut { keys: string[]; label: string; description: string; run: string; group?: string }
export const shortcutFor = shortcutForJs as unknown as (event: KeyboardEvent) => Shortcut | undefined
export const shortcutRows = shortcutRowsJs as unknown as () => { label: string; description: string }[]
export const heldActionFor = heldActionForJs as unknown as (event: KeyboardEvent) => string | undefined

// ---- the crowd in the scene ----------------------------------------------------------------
export interface CrowdPerson { id: string; kind: 'player' | 'npc'; name: string; [key: string]: unknown }
export const crowdList = crowdListJs as unknown as (input: { players?: unknown[]; npcs?: NpcContent[]; selfId?: string | null }) => CrowdPerson[]
export const playersHere = playersHereJs as unknown as (listing: unknown, state: LifeState, cityId: string) => unknown[]
