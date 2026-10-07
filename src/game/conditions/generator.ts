// The generator in the player's room, as the home system lends it out: buying petrol, and settling the grid against the seconds just passed. Lives in the lazy
// conditions pack (./pack.ts), so the first page does not carry it. Only a host that plays a life runs either, and every such host installs the pack.
import type { LifeContext, LifeState } from '../../types/life.ts'
import type { canAfford, debit } from '../api.ts'
import type { emit } from '../registry.ts'
import { fail, ok } from '../util.ts'
import { gridAt, outageSeconds } from './grid.ts'
import { LITRE_PRICE, LITRE_SECONDS, TANK_LITRES, TANK_SECONDS } from './power.ts'
import { cutWords, fuelWords } from './power-words.ts'

/** What the home system lends: this file may not import them, because the pack is loaded from inside the engine's own import cycles (src/game/profile.ts). */
export interface Lent { canAfford: typeof canAfford; debit: typeof debit; emit: typeof emit }

const hasPlaced = (state: LifeState, itemId: string): boolean => state.home.items.some((item) => item.itemId === itemId)

/** 'home.refuel': delivered at once, anywhere, charged through the wallet ledger. */
export function refuel(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext, lent: Lent) {
  const litres = payload?.litres, room = Math.floor((TANK_SECONDS - state.home.fuel) / LITRE_SECONDS), price = Number(litres) * LITRE_PRICE
  const say = (code: string): string => fuelWords(code, litres, room, price, state.cash)
  if (typeof litres !== 'number' || !Number.isInteger(litres) || litres < 1 || litres > TANK_LITRES) return fail(state, 'invalid_quantity', say('invalid_quantity'))
  if (!hasPlaced(state, 'generator')) return fail(state, 'no_generator', say('no_generator'))
  if (litres > room) return fail(state, 'tank_full', say('tank_full'))
  if (!lent.canAfford(state, price)) return fail(state, 'insufficient_funds', say('insufficient_funds'))
  lent.debit(state, price, 'Generator fuel', ctx)
  state.home.fuel += litres * LITRE_SECONDS
  state.message = say('fuelled')
  return ok(state, 'fuelled')
}

/** The cut that began, and the petrol the generator burned while the light was off and the player was at home (in `district`). */
export function settlePower(state: LifeState, dt: number, ctx: LifeContext, district: string, lent: Lent): void {
  const city = state.estate.city, from = ctx.now - dt * 1000
  const before = gridAt(city, district, from).on, after = gridAt(city, district, ctx.now)
  const cut = (dry: boolean) => lent.emit(state, 'notice.posted', { kind: 'power', text: cutWords(district, after.until, dry) }, ctx)
  if (before && !after.on) cut(false)
  if (state.home.fuel <= 0 || !hasPlaced(state, 'generator') || hasPlaced(state, 'inverter')) return
  const burned = outageSeconds(city, district, from, ctx.now)
  if (burned <= 0) return
  state.home.fuel = Math.max(0, state.home.fuel - burned)
  if (state.home.fuel === 0 && !after.on) cut(true)
}
