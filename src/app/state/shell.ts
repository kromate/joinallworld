// What the shell is showing: which view is in front (the venue, or a nav panel such as Buy or the
// Map), which sheet is open in the dialog, and the small HUD switches. The rules are the existing
// shell's (src/ui/shell.js): a Phone app always opens inside the phone, anything opened while the
// phone is up stays in it, a panel that must be completed (`required`) cannot be closed or
// covered, and a disabled entry says why instead of opening.
import { computed, reactive, ref, shallowRef } from 'vue'
import type { LifeState } from '../../types/life.ts'
import type { LegacyPanel, Panel, PanelView, ShellMode, Sheet } from '../types/panel.ts'
import { isVuePanel } from '../types/panel.ts'
import type { Game } from './game.ts'

export interface ShellHooks {
  /** A nav panel was entered or left. */
  onMode?: (mode: ShellMode, params: unknown) => void
}

export function createShell(game: Game, panels: readonly Panel[], hooks: ShellHooks = {}) {
  const byId = new Map(panels.map((panel) => [panel.id, panel]))
  const sheet = shallowRef<Sheet | null>(null)
  const modeParams = shallowRef<unknown>(null)
  const ui = reactive({ expanded: false, trayOpen: false, clean: false })
  /**
   * Bumped by refresh(): existing panels keep UI state in module variables that Vue cannot see, so
   * anything computed from them (badges, notification lines) reads this to be recomputed.
   */
  const legacyTick = ref(0)
  /** The key hook of each panel on screen, by id (set by PanelHost). */
  const keyHandlers = new Map<string, (action: string) => boolean>()
  /** What Esc does while a sheet is open (set by SheetHost): one place decides what Esc closes. */
  const escape: { run: (() => void) | null } = { run: null }
  const state = (): LifeState => game.state.value
  const viewFor = (params: unknown = null): PanelView => ({ ...game.view.value, mode: game.mode.value, params: params ?? null })

  const placed = (placement: Panel['placement']): Panel[] => panels.filter((panel) => panel.placement === placement)
  /**
   * The panel that handles "no session": the landing screen of a new device (the 'quick-start' panel,
   * role 'session-gate'). A saved life the server no longer knows ('expired') has its own sheet, the
   * foundation's 'session' panel, which is also the fallback when no other gate is registered.
   */
  const sessionGate = (reason?: string): Panel | undefined => (reason === 'expired' ? undefined : panels.find((panel) => panel.role === 'session-gate' && panel.id !== 'session')) ?? byId.get('session')
  /** The reason an entry is disabled, or null. */
  function gateOf(panel: Panel): string | null {
    const value = panel.enabled?.(state(), viewFor())
    return value === undefined || value === true ? null : String(value || 'Unavailable right now')
  }
  /** The reason the open sheet may not be closed yet, or null. */
  function lockOf(): { panel: Panel; reason: string } | null {
    const open = sheet.value
    if (open?.kind !== 'panel') return null
    const panel = byId.get(open.id)
    const reason = panel?.required?.(state(), viewFor(open.params))
    return panel && typeof reason === 'string' && reason ? { panel, reason } : null
  }
  /** Is this sheet drawn inside the phone? */
  function phoneHosts(target: Sheet | null): boolean {
    if (!target) return false
    if (target.kind === 'phone') return true
    if (target.kind === 'help') return target.from === 'phone'
    if (target.kind !== 'panel') return false
    const panel = byId.get(target.id)
    if (!panel || panel.role === 'session-gate' || typeof panel.required === 'function') return false
    return panel.placement === 'phone' || target.from === 'phone'
  }
  const inPhone = computed(() => phoneHosts(sheet.value))

  function setMode(next: ShellMode, params: unknown = null): void {
    const mode = next === 'venue' || byId.get(next)?.placement === 'nav' ? next : 'venue'
    game.mode.value = mode
    modeParams.value = params ?? null
    // The scene host walks the avatar on a tap only in the venue view (Buy mode and the map keep their own taps).
    globalThis.window?.dispatchEvent(new CustomEvent('jaw:mode', { detail: { mode } }))
    hooks.onMode?.(mode, params)
  }

  function open(id: string, params?: unknown): boolean {
    const lock = lockOf()
    if (lock && id !== lock.panel.id && byId.get(id)?.role !== 'session-gate') { game.toast(lock.reason); return false }
    // Anything opened while the phone is up stays in the phone.
    const from = phoneHosts(sheet.value) ? 'phone' as const : null
    if (id === 'phone') sheet.value = { kind: 'phone' }
    else if (id === 'help') sheet.value = { kind: 'help', from }
    else if (id === 'sim') {
      const current = sheet.value
      const tab = (params as { tab?: string } | undefined)?.tab ?? (current?.kind === 'sim' ? current.tab : undefined) ?? placed('sim-tab')[0]?.id ?? ''
      sheet.value = { kind: 'sim', tab }
    } else {
      const panel = byId.get(id)
      if (!panel) return false
      const reason = gateOf(panel)
      if (reason) { game.toast(reason, 'error'); return false }
      if (panel.placement === 'nav') { sheet.value = null; ui.trayOpen = false; setMode(id, params); return true }
      if (panel.placement === 'hud') return false
      if (panel.placement === 'sim-tab' && !from) sheet.value = { kind: 'sim', tab: id, params }
      else sheet.value = { kind: 'panel', id, params, from }
    }
    ui.trayOpen = false
    return true
  }
  function closeSheet(): void { sheet.value = null }
  function close(): void {
    const lock = lockOf()
    if (lock) { game.toast(lock.reason); return }
    if (sheet.value) closeSheet()
    else if (game.mode.value !== 'venue') setMode('venue')
  }
  /** Esc / the back gesture inside the phone: app → home screen → closed. */
  function phoneBack(): void {
    const open = sheet.value
    if (open && open.kind !== 'phone' && phoneHosts(open)) sheet.value = { kind: 'phone' }
    else close()
  }

  /** A panel that must be completed opens by itself, and comes back if anything replaced it. */
  function enforceRequired(): void {
    if (!game.connected.value) return
    const must = panels.find((panel) => panel.placement === 'modal' && typeof panel.required?.(state(), viewFor()) === 'string')
    if (!must) return
    const open = sheet.value
    if (open?.kind === 'panel' && (open.id === must.id || byId.get(open.id)?.role === 'session-gate')) return
    sheet.value = null
    open_(must.id)
  }
  const open_ = open

  /** The panel that currently receives keys: the open sheet's, else the nav panel in front. */
  function showing(): Panel | null {
    const open = sheet.value
    if (open?.kind === 'panel') return byId.get(open.id) ?? null
    if (open?.kind === 'sim') return byId.get(open.tab) ?? null
    return game.mode.value !== 'venue' ? byId.get(game.mode.value) ?? null : null
  }

  return {
    panels, byId, sheet, modeParams, ui, legacyTick, inPhone, keyHandlers, escape,
    /** Offer a key to the panel in front. True when it handled it. */
    panelKeys(action: string): boolean {
      const panel = showing()
      try { return panel ? keyHandlers.get(panel.id)?.(action) === true : false } catch (error) { console.error('Panel failed to handle a key:', error); return false }
    },
    placed, sessionGate, gateOf, lockOf, phoneHosts, viewFor,
    open, close, closeSheet, phoneBack, setMode, enforceRequired, showing,
    /** Existing panels re-render synchronously on this (see legacy/api.ts); Vue reads the tick. */
    bump(): void { legacyTick.value += 1 },
  }
}
export type Shell = ReturnType<typeof createShell>
export type { LegacyPanel }
export { isVuePanel }
