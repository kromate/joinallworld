// The typed boundary to the parts of the existing Phone that arrive with it (not in the first
// download): app tints, the wallpaper choice, and the check for a moderator's reply. Imported only
// by the Phone's own component, so they stay out of the entry chunk.
import { tintOf as tintOfJs } from '../../ui/phone/icons-more.ts'
import { getWallpaper as getWallpaperJs } from '../../ui/phone/wallpapers.ts'
import { checkReports as checkReportsJs } from '../../ui/phone/reports.ts'
import type { PanelApi, PanelMeta } from '../types/panel.ts'

/** An app's icon and app bar colour: its own `tint`, else the one for its id. */
export const tintOf = tintOfJs as unknown as (panel: Pick<PanelMeta, 'id' | 'tint'> | null | undefined) => string
export const getWallpaper = getWallpaperJs as unknown as () => string
/** Called when the player opens the phone (never from a timer): reads the reports at most once a minute if this device has filed one. */
export const checkReports = checkReportsJs as unknown as (api: Pick<PanelApi, 'view' | 'fetchJson' | 'refresh'>) => void
