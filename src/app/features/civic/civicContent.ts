// The typed boundary to the civic content tables (src/game/content/civic.ts): plain data, no
// functions. They are imported as they are; only their types are declared here. When the table is
// converted these lines are deleted and the importers point at the real file.
import { BILLBOARDS as BILLBOARDS_JS, ELECTION as ELECTION_JS, RADIO as RADIO_JS, SEA_PLOTS as SEA_PLOTS_JS } from '../../../game/content/civic.ts'
import { AD_COLOURS as AD_COLOURS_JS, AD_ICONS as AD_ICONS_JS, AD_TEXT as AD_TEXT_JS, STATE_HOUSE_TEXT as STATE_HOUSE_TEXT_JS } from '../../../game/content/civic-ads.ts'
import type { AdColour } from '../../../types/civic.ts'

export const ELECTION = ELECTION_JS as unknown as Readonly<{
  sloganMin: number
  sloganMax: number
  minWorkDays: number
  announcement: Readonly<{ max: number; min: number }>
}>
export const STATE_HOUSE_TEXT = STATE_HOUSE_TEXT_JS as unknown as Readonly<{ title: string; empty: string }>
export const AD_COLOURS = AD_COLOURS_JS as unknown as readonly AdColour[]
/** `icon` is an emoji kept only as the plain-text fallback key of the icon set. */
export const AD_ICONS = AD_ICONS_JS as unknown as readonly { id: string; icon: string }[]
export const AD_TEXT = AD_TEXT_JS as unknown as Readonly<{ min: number; max: number }>
export const BILLBOARDS = BILLBOARDS_JS as unknown as Readonly<{ slots: readonly { id: string; near: string; road: string }[] }>
export const SEA_PLOTS = SEA_PLOTS_JS as unknown as Readonly<{ rows: number; cols: number }>
export const RADIO = RADIO_JS as unknown as Readonly<{
  venues: readonly string[]
  price: number
  slotSeconds: number
  perPlayerPerDay: number
  titleMax: number
  artistMax: number
  label: string
  cta: string
}>
