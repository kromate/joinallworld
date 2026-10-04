// What Buy mode and the home chip decide, worked out from the life: the placement ghost, why a
// piece cannot be placed or bought, what the room's status line says. Pure, so it is tested
// without a browser. The server validates every placement again; the ghost's green/red state uses
// the same pure rules (src/game/home-layout.js) so the player sees the answer before pressing Place.
import type { FurnitureDefinition } from '../../../types/content.ts'
import type { LifeState, PlacedItem } from '../../../types/life.ts'
import type { PanelView } from '../../types/panel.ts'
import { FURNITURE, SELL_REFUND_RATE, checkPlacement, findFreeSpot, houseOf, nudge } from '../../legacy/content.ts'
import type { Refusal, Spot } from '../../legacy/content.ts'

export type GhostSource = 'buy' | 'move' | 'storage'
/** The piece being placed: where it came from and where it is now. */
export interface Ghost extends Spot { source: GhostSource; itemId: string; objectId?: string }

export const MOVES: Readonly<Record<string, readonly [number, number]>> = { 'move-up': [0, -1], 'move-down': [0, 1], 'move-left': [-1, 0], 'move-right': [1, 0] }
export const HINT = 'Arrow keys move · R rotates · Enter places · Esc cancels'

export const itemsOf = (state: Pick<LifeState, 'home'>): PlacedItem[] => (Array.isArray(state.home?.items) ? state.home.items : [])
export const objectOf = (state: Pick<LifeState, 'home'>, id: string | null): PlacedItem | undefined => (id ? itemsOf(state).find((item) => item.id === id) : undefined)
export const defOf = (itemId: string | undefined): FurnitureDefinition | undefined => (itemId ? FURNITURE[itemId] : undefined)

/** Why the ghost cannot be placed where it is, or null. */
export const whyNot = (state: LifeState, ghost: Ghost): Refusal | null => {
  const def = defOf(ghost.itemId)
  return def ? checkPlacement(houseOf(state).grid, itemsOf(state), def, ghost.x, ghost.y, ghost.rot, ghost.objectId ?? null) : null
}

/** The ghost for a piece: where the object already stands (a move), else the first free spot, else the middle of the room. */
export function startGhost(state: LifeState, source: GhostSource, itemId: string, objectId?: string): Ghost | null {
  const def = defOf(itemId)
  if (!def) return null
  const grid = houseOf(state).grid
  const placed = objectId ? objectOf(state, objectId) : undefined
  const at: Spot = placed ? { x: placed.x, y: placed.y, rot: placed.rot }
    : findFreeSpot(grid, itemsOf(state), def) ?? nudge(grid, def, { x: Math.floor(grid / 2), y: Math.floor(grid / 2), rot: 0 }, 0, 0)
  return { source, itemId, ...(objectId ? { objectId } : {}), ...at }
}

export const size = (def: Pick<FurnitureDefinition, 'wall' | 'w' | 'h'>): string => (def.wall ? 'wall' : `${def.w}×${def.h}`)
export const refund = (def: Pick<FurnitureDefinition, 'price'>): number => Math.floor(def.price * SELL_REFUND_RATE)
/** "No internet — cannot buy": the truthful reason nothing can change, or '' when connected. */
export const offWhy = (connected: boolean, short: string | null | undefined, what: string): string => (connected ? '' : `${short ?? ''} — cannot ${what} right now`)

/** Why a catalogue card cannot be bought, or ''. */
export function blockedReason(input: { connected: boolean; short: string | null | undefined; busy: boolean; cash: number; price: number }, money: (value: number) => string): string {
  if (!input.connected) return offWhy(false, input.short, 'buy')
  if (input.busy) return 'Finish your current action first'
  if (input.price > input.cash) return `Need ${money(input.price - input.cash)} more`
  return ''
}

/** Why a stored piece cannot be placed or sold, or ''. */
export const storedReason = (connected: boolean, short: string | null | undefined, busy: boolean): string => offWhy(connected, short, 'place it') || (busy ? 'Finish your current action first' : '')

/** The one line under the ghost: why it cannot be placed, else '' (the panel then says it fits). */
export function placementReason(input: { refusal: Refusal | null; connected: boolean; short: string | null | undefined; busy: boolean; paying: boolean; price: number; cash: number }, money: (value: number) => string): string {
  if (input.refusal?.reason) return input.refusal.reason
  if (!input.connected) return `${offWhy(false, input.short, 'place furniture')}.`
  if (input.busy) return 'Finish your current action first.'
  return input.paying && input.price > input.cash ? `Need ${money(input.price - input.cash)} more.` : ''
}

/** Why a selected piece cannot be moved, stored or sold, or ''. */
export const selectedReason = (connected: boolean, short: string | null | undefined, busy: boolean): string => (!connected ? `${offWhy(false, short, 'change your room')}.` : busy ? 'Finish your current action first.' : '')

/** Storage as [furnitureId, count] for pieces the catalogue knows, and how many in all. */
export function storageOf(state: Pick<LifeState, 'home'>): { entries: [string, number][]; stored: number } {
  const entries = Object.entries(state.home?.storage ?? {}).filter(([id]) => FURNITURE[id])
  return { entries, stored: entries.reduce((sum, [, count]) => sum + count, 0) }
}

/** The room's status line on the home chip. */
export function roomStatus(input: { sceneStatus: string; connected: boolean; short: string | null | undefined; placed: number; grid: number }): { text: string; retry?: true } {
  if (input.sceneStatus === 'error') return { text: 'Your room could not be drawn.', retry: true }
  if (!input.connected) return { text: `${input.short ?? ''} — showing the last copy of your room kept on this device.` }
  if (input.sceneStatus === 'loading') return { text: 'Loading your room…' }
  if (!input.placed) return { text: 'Your room is empty. Open Buy to furnish it.' }
  return { text: `${input.grid} × ${input.grid} room · ${input.placed} objects · tap one to use it` }
}

/** Where a stored piece or the stars note comes from: '0.8, 1 …' as the catalogue footnote says. */
export const starsNote = (multipliers: readonly number[]): string => multipliers.map((value, count) => `${count ? `${count} star${count === 1 ? '' : 's'}` : 'no stars'} ×${value}`).join(' · ')

/** A star rating's text alternative. */
export const starsLabel = (count: number): string => `${count} star${count === 1 ? '' : 's'}`

/** The state the scene is told about (window event 'jaw:home-ui'). */
export interface HomeUi { selected: string | null; buy: boolean; ghost: { itemId: string; x: number; y: number; rot: number; valid: boolean } | null; retry?: true }
export function homeUi(state: LifeState, home: { selected: string | null; inBuy: boolean; ghost: Ghost | null }): HomeUi {
  const { ghost } = home
  return { selected: home.selected, buy: home.inBuy, ghost: ghost ? { itemId: ghost.itemId, x: ghost.x, y: ghost.y, rot: ghost.rot, valid: !whyNot(state, ghost) } : null }
}

/** The view says whether the room is Buy mode's. */
export const isBuying = (view: Pick<PanelView, 'mode'>): boolean => view.mode === 'buy'
