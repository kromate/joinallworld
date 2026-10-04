import { homeOf } from '../../../game/content/housing.ts'
import type { HomeInfo } from '../../../game/content/housing.ts'
import { HOUSE_TIERS } from '../../../game/content/world.ts'
import type { LifeState } from '../../../types/life.ts'

/** The room the player's furniture is laid out in: the rented tier, or their own house while they live in it. */
export const houseOf = (state: LifeState): HomeInfo => homeOf(state, HOUSE_TIERS)
