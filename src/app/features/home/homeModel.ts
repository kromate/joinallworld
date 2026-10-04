// What the Houses and Cars apps say, worked out from view.property. Pure, so it is tested without a
// browser. The prices, rents and rules are the engine's (systems/property.js).
import type { CarCard, HouseCard, PropertyView } from '../../../types/view.ts'

/** Why Move in is unavailable on a house card, or ''. `offline` is already worded for this app. */
export const moveReason = (house: Pick<HouseCard, 'current' | 'blocked'>, offline: string): string => (house.current ? '' : offline || house.blocked || '')

/** The house the player is saving for, or undefined at the top of the ladder. */
export const nextHouse = (property: Pick<PropertyView, 'houses' | 'nextHouse'>): HouseCard | undefined => property.houses.find((house) => house.id === property.nextHouse)

/** Whole percent of the move-in cost the player holds. */
export const savedPercent = (cash: number, moveIn: number): number => Math.max(0, Math.min(100, Math.round((cash / moveIn) * 100)))

export const housesRules = (weeks: number): string[] => [
  `The move-in cost pays the landlord and the agent: ${weeks} weeks of rent, up front.`,
  'Your furniture moves with you. Anything that does not fit the new room waits in Buy → Storage.',
  'From then on the new rent is collected every Saturday (see Bank).',
  'Rents and move-in costs are set per area. The Yaba room size and move-in cost are provisional and may change.',
]

/** Why a car's Drive and Sell are unavailable, or ''. */
export const ownedReason = (offline: string, activeAction: unknown): string => offline || (activeAction ? 'Finish your current action first' : '')
/** Why Buy is unavailable on a car card, or ''. */
export const buyReason = (car: Pick<CarCard, 'blocked'>, offline: string): string => offline || car.blocked || ''

/** "27% quicker". */
export const quicker = (speed: number): number => Math.round((1 - speed) * 100)

export const carsRules = (resaleRate: number): string[] => [
  'An owned car adds Drive to every trip: you pay its fuel instead of a fare, and it gets you there quicker.',
  'You can own several vehicles and choose which one you drive.',
  `Selling returns ${Math.round(resaleRate * 100)}% of the list price — the amount is on each Sell button.`,
  'Prices are set per vehicle. Vehicle names, fuel costs and speeds are provisional and may change.',
]
