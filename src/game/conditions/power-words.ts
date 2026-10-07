// What the home system says about the light and the generator. Pure words; the rules (who may buy, what it costs) stay in src/game/systems/home.ts.
import { formatHour, lagosTime } from '../clock.ts'
import { naira } from '../util.ts'
import { LITRE_PRICE, TANK_LITRES } from './power.ts'

const litresWord = (n: number): string => `${n} ${n === 1 ? 'litre' : 'litres'}`

/** The sentence for a way a refuel ends. `room` is the litres the tank can still take, `price` what `litres` cost. */
export const fuelWords = (code: string, litres: unknown, room: number, price: number, cash: number): string =>
  code === 'invalid_quantity' ? `Buy between 1 and ${TANK_LITRES} litres of petrol at a time.`
  : code === 'no_generator' ? 'There is no generator in your room. Buy a Small Petrol Generator in Buy mode first.'
  : code === 'tank_full' ? (room < 1 ? 'The tank is full.' : `The tank has room for ${room} more ${room === 1 ? 'litre' : 'litres'}.`)
  : code === 'insufficient_funds' ? `${litresWord(Number(litres))} of petrol costs ${naira(price)}; you have ${naira(cash)} (${naira(price - cash)} short).`
  : `${litresWord(Number(litres))} of petrol in the generator. ${naira(price)} paid.`

/** A cut that has begun (with when the light is due back), or the generator running dry in one. */
export const cutWords = (district: string, until: number | null, dry: boolean): string =>
  dry ? `The generator is out of petrol and the light is still off. Petrol is ${naira(LITRE_PRICE)} a litre in Phone → Groceries.`
  : `NEPA has taken light in ${district}.${until === null ? '' : ` Light is due back around ${formatHour(lagosTime(until).minuteOfDay / 60)}.`}`
