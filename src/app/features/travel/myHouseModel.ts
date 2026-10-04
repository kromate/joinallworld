// "Your own house" without a DOM: which look options and upgrades can be pressed now, and the
// words beside the ones that cannot. The section is the typed port of renderMyHouse() in
// src/ui/panels/world-panels.js.
import type { HouseStyleField } from '../../../types/life.ts'
import type { HouseStyleCard, HouseTierCard } from '../../../types/view.ts'
import { money } from '../../ui/format.ts'

export const FIELD_NAMES: Readonly<Record<HouseStyleField, string>> = {
  shape: 'Roof shape', wall: 'Walls', roof: 'Roof colour', door: 'Door', windows: 'Windows', fence: 'Fence', yard: 'Yard', sign: 'Name sign',
}

/** Why nothing here can be changed while the game is not connected; '' when connected. */
export const offlineWhy = (connected: boolean, short: string | undefined): string => (connected ? '' : `${short ?? ''} — this needs the server`)

/** A look option is off when offline, already chosen, or dearer than the cash in hand. */
export const swatchOff = (option: Pick<HouseStyleCard, 'chosen' | 'price'>, cash: number, offline: string): boolean => Boolean(offline) || option.chosen || option.price > cash
export const swatchTitle = (option: Pick<HouseStyleCard, 'chosen' | 'price'>, cash: number): string => (option.price > cash && !option.chosen ? `Costs ${money(option.price)}` : '')
export const swatchLabel = (option: Pick<HouseStyleCard, 'label' | 'price'>): string => `${option.label}${option.price ? ` · ${money(option.price)}` : ''}`

/** The tiers on offer: the starter house only as the current one. */
export const offeredTiers = (tiers: readonly HouseTierCard[]): HouseTierCard[] => tiers.filter((tier) => tier.id !== 'starter' || tier.current)
/** An upgrade is off when offline or blocked; the same words say why. */
export const tierWhy = (tier: Pick<HouseTierCard, 'blocked'>, offline: string): string => offline || tier.blocked || ''

/** "about 3 minutes to go" for an upgrade under way. */
export function minutesToGo(remainingSeconds: number): string {
  const minutes = Math.ceil(remainingSeconds / 60)
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}

/** A house style is announced (maps redraw, analytics) only when the server accepted it. */
export function afterStyle(accepted: boolean, announce: () => void): void { if (accepted) announce() }
