// The panel contract: what every screen that plugs into the shell declares, whether it is an
// existing HTML-string panel (src/ui/panels/*.js, contract at the top of src/ui/shell.js) or a Vue
// component registered with definePanel() (src/app/state/panels.ts). The static part is the same
// for both kinds, so the Phone grid, the Sim tabs and the HUD slots never ask which kind it is.
import type { Component } from 'vue'
import type { LifeState } from '../../types/life.ts'
import type { LifeView } from '../../types/view.ts'
import type { CityId, PublicSession } from '../../types/protocol.ts'
import type { City, Command, FetchJson, LinkState, NetStatus, StorageProblem } from './client.ts'

/**
 *   phone    an app on the Phone's home screen; always opens inside the phone
 *   nav      bound to the bottom-nav button with the same id; renders inline above the nav
 *   hud      a HUD chip (see `slot`); renders nothing to hide itself
 *   sim-tab  a tab of the Sim sheet
 *   modal    listed nowhere; opened only by open(id)
 */
export type PanelPlacement = 'phone' | 'nav' | 'hud' | 'sim-tab' | 'modal'
export const PANEL_PLACEMENTS = ['phone', 'nav', 'hud', 'sim-tab', 'modal'] as const satisfies readonly PanelPlacement[]
/** Ids the shell keeps for its own sheets. */
export const RESERVED_PANEL_IDS = ['phone', 'sim', 'help', 'home', 'venue'] as const
export type PhoneGroup = 'life' | 'money' | 'people' | 'city'
/** 'goal' = the single goal line, 'alert' = always visible above it, 'hud' = in the tray behind More. */
export type HudSlot = 'goal' | 'alert' | 'hud'
export type ToastKind = 'info' | 'good' | 'earn' | 'spend' | 'error'
/** 'venue', or the id of a nav panel ('buy', 'map'). */
export type ShellMode = 'venue' | (string & {})

export interface VenueSummary { id: string; label: string; district: string; icon?: string; description?: string }

/** What a panel is given to draw from: the engine's view plus what the shell knows. */
export interface PanelView extends LifeView {
  cityId: CityId
  city: City
  /** The one flag to test for "can anything change". */
  connected: boolean
  /** Use only to word the reason truthfully. */
  link: LinkState
  session: PublicSession | null
  net: NetStatus
  storage: StorageProblem | null
  name: string
  /** Server time in ms when the view was built. */
  now: number
  /** Lagos wall clock, 'Mon 5 · 9:30 am'. */
  clock: string
  venues: VenueSummary[]
  mode: ShellMode
  /** Whatever was passed to open(id, params). */
  params: unknown
}

/** A line of the Phone's notification list. `app` is the panel a tap opens. */
export interface PhoneNotification {
  id: string
  at: number
  text: string
  fresh: boolean
  app: string
  open?: string
  params?: unknown
}

export interface PanelApi {
  /** One server action. Offline it resolves { ok: false, code: 'offline' } and changes nothing. */
  command: Command
  /** Open a panel, or 'phone', 'sim', 'help'. False when it was refused. */
  open(id: string, params?: unknown): boolean
  /** Close the sheet, or return a nav panel to the venue view. */
  close(): void
  toast(text: string, kind?: ToastKind): void
  fetchJson: FetchJson
  newId(): string
  /** Re-render now, synchronously, including `live: false` panels. */
  refresh(): void
  /** Draw one frame of the 3D scene now. On demand only: never from a timer or a loop. */
  redrawScene(): void
  goTo(venueId: string, spotId?: string): Promise<void> | void
  toggleCommunity(force?: boolean): void
  state(): LifeState
  view(): PanelView
}

/** The static part of a panel: enough to list it before any of its code has loaded. */
export interface PanelMeta {
  id: string
  title: string
  /** Emoji or short text for a Sim tab. The Phone draws its own icon for the id (src/ui/phone/icons.js). */
  icon?: string
  placement: PanelPlacement
  /** Sort key within its placement (default 100). */
  order?: number
  group?: PhoneGroup
  /** A shorter label under the Phone icon. */
  short?: string
  /** A Sim tab that is also listed as a Phone app. */
  phone?: boolean
  /** Icon and app bar colour (default: by id). */
  tint?: string
  /** false = do not re-render on every state update (forms). */
  live?: boolean
  /** 'session-gate' marks the panel that handles "no session / expired session". */
  role?: string
  slot?: HudSlot | ((state: LifeState, view: PanelView) => HudSlot | undefined)
  /** The count for the red badge, from data already in the view. Never a fetch. */
  badge?(state: LifeState, view: PanelView): number | string | false | null | undefined
  notifications?(state: LifeState, view: PanelView): PhoneNotification[]
  /** true, or the reason the entry is disabled. */
  enabled?(state: LifeState, view: PanelView): true | string | undefined
  /** 'modal' panels: the reason while the panel MUST be completed. */
  required?(state: LifeState, view: PanelView): string | null | undefined
}

/** An existing HTML-string panel. */
export interface LegacyPanel extends PanelMeta {
  render(state: LifeState, view: PanelView, api: PanelApi): string | null | undefined
  /** Called after each (re)render with the panel's root element and the params it was opened with. */
  bind?(root: HTMLElement, api: PanelApi, params: unknown): void
  /** 'key:*' shortcuts while showing, and 'cancel' for Esc. Return true to say "handled". */
  keys?(action: string, api: PanelApi): boolean | void
  /** A lazy panel whose group has not arrived. */
  pending?: boolean
  load?(): Promise<void>
  failed?: boolean
}

/** Props every Vue panel component receives. */
export interface PanelProps { params?: unknown }
/** What a Vue panel component may expose for the shell: the same key hook a legacy panel has. */
export interface PanelExposed { keys?(action: string): boolean | void }

/** A panel written as a Vue component. */
export interface VuePanel extends PanelMeta {
  kind: 'vue'
  /** Usually defineAsyncComponent(() => import('…')), so the code is fetched on first open. */
  component: Component
}

export type Panel = LegacyPanel | VuePanel
export const isVuePanel = (panel: Panel): panel is VuePanel => 'kind' in panel && panel.kind === 'vue'

/** Which sheet is open in the dialog. `from: 'phone'` keeps what was opened from the phone inside it. */
export type Sheet =
  | { kind: 'phone' }
  | { kind: 'help'; from: 'phone' | null }
  | { kind: 'sim'; tab: string; params?: unknown }
  | { kind: 'panel'; id: string; params?: unknown; from: 'phone' | null }
