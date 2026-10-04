/**
 * OWNER: home
 * Houses and cars: which house the player lives in, moving, and owning cars.
 *
 * State keys
 *   homeOwned  legacy boolean carried from existing saves (kept loading, otherwise unused)
 *   property   { house, cars, car }
 *     house  id from content/housing.js — where the player lives. Other systems read
 *            `state.property.house`; the weekly rent is HOUSES[state.property.house].rent
 *     cars   ids from content/cars.js the player owns (each at most once)
 *     car    the owned car currently driven, or null
 *
 * Actions (every refusal carries a code and a reason)
 *   'property.house-move' { id }   pay the landlord and agent (the house's moveIn, 3 × weekly rent) and
 *                         move. Furniture moves with you — systems/home.js re-fits it.
 *   'property.car-buy'    { id }   buy a car at modify('shop.price', price, { item, kind: 'car' })
 *   'property.car-use'    { id }   choose which owned car to drive
 *   'property.car-sell'   { id }   sell an owned car back for CAR_RESALE_RATE of its list price
 *
 * Emits   'house.moved' { id, from, cost }     'car.bought' { id, price }     'car.sold' { id, refund }
 * Listens 'life.started' { house }             sets the starting house at the end of onboarding (free)
 *
 * Modifiers implemented here (the travel system calls them; without an owned car they change nothing)
 *   'travel.modes'     base: the list of offered mode ids (what systems/travel.js passes — 'car' is
 *                      appended), or a list / map of mode objects.
 *                      Adds { id: 'car', label, icon, fare: <fuel>, fuelOnly: true, car: <car id> }.
 *   'travel.fare'      data { mode, destination } — for mode 'car' the fare is the car's fuel cost
 *   'travel.duration'  data { mode, destination } — for mode 'car' the time is multiplied by the car's speed
 * Modifier called here: 'shop.price' with data { item, kind: 'car' }.
 * Moving house is a landlord-and-agent fee, not a shop purchase, so it is not discounted.
 */
import { emit, modify } from '../registry.ts';
import { busy, fail, isRecord, naira, ok } from '../util.ts';
import { canAfford, canCredit, credit, debit } from '../api.ts';
import { HOUSES, HOUSE_ORDER, DEFAULT_HOUSE } from '../content/housing.ts';
import { CARS, CAR_ORDER, CAR_MODE, CAR_RESALE_RATE } from '../content/cars.ts';

const houseOf = (id) => (typeof id === 'string' && Object.hasOwn(HOUSES, id) ? HOUSES[id] : null);
const carOf = (id) => (typeof id === 'string' && Object.hasOwn(CARS, id) ? CARS[id] : null);
const drivenCar = (state) => carOf(state.property?.car);
const whole = (value, fallback) => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback);
const carPrice = (state, car, ctx) => whole(modify(state, 'shop.price', car.price, { item: car, kind: 'car' }, ctx), car.price);
const resale = (car) => Math.floor(car.price * CAR_RESALE_RATE);
const shortBy = (state, cost) => `It costs ${naira(cost)}; you have ${naira(state.cash)} (${naira(cost - state.cash)} short).`;

function moveHouse(state, payload, ctx) {
  const blocked = busy(state, 'Finish or cancel your current action before moving house.');
  if (blocked) return blocked;
  const house = houseOf(payload?.id);
  if (!house) return fail(state, 'invalid_house', 'Choose a house from the Houses list.');
  const from = state.property.house;
  if (from === house.id && state.estate?.living !== 'own') return fail(state, 'already_home', `You already live in the ${house.label} in ${house.district}.`);
  if (!canAfford(state, house.moveIn)) return fail(state, 'insufficient_funds', `Moving to the ${house.label} needs the landlord and agent paid first. ${shortBy(state, house.moveIn)}`);
  debit(state, house.moveIn, `Landlord and agent: ${house.label}, ${house.district}`, ctx);
  state.property.house = house.id;
  state.message = `You moved to the ${house.label} in ${house.district}. ${naira(house.moveIn)} paid to the landlord and agent.`;
  emit(state, 'house.moved', { id: house.id, from, cost: house.moveIn }, ctx);
  return ok(state, 'moved');
}

function buyCar(state, payload, ctx) {
  const blocked = busy(state, 'Finish or cancel your current action before buying a car.');
  if (blocked) return blocked;
  const car = carOf(payload?.id);
  if (!car) return fail(state, 'invalid_car', 'Choose a car from the dealer list.');
  if (state.property.cars.includes(car.id)) return fail(state, 'already_owned', `You already own the ${car.label}.`);
  const price = carPrice(state, car, ctx);
  if (!canAfford(state, price)) return fail(state, 'insufficient_funds', `The ${car.label} is out of reach for now. ${shortBy(state, price)}`);
  debit(state, price, `Bought ${car.label}`, ctx);
  state.property.cars.push(car.id);
  state.property.car = car.id;
  state.message = `The ${car.label} is yours for ${naira(price)}. Driving now costs fuel only.`;
  emit(state, 'car.bought', { id: car.id, price }, ctx);
  return ok(state, 'bought');
}

function useCar(state, payload) {
  const blocked = busy(state, 'Finish or cancel your current action before switching cars.');
  if (blocked) return blocked;
  const car = carOf(payload?.id);
  if (!car || !state.property.cars.includes(car.id)) return fail(state, 'not_owned', 'You do not own that car. Buy it in Phone → Cars first.');
  state.property.car = car.id;
  state.message = `You now drive the ${car.label}.`;
  return ok(state, 'selected');
}

function sellCar(state, payload, ctx) {
  const blocked = busy(state, 'Finish or cancel your current action before selling a car.');
  if (blocked) return blocked;
  const car = carOf(payload?.id);
  if (!car || !state.property.cars.includes(car.id)) return fail(state, 'not_owned', 'You do not own that car, so there is nothing to sell.');
  const refund = resale(car);
  if (!canCredit(state, refund)) return fail(state, 'balance_limit', 'Your saved balance has reached its supported limit.');
  credit(state, refund, `Sold ${car.label}`, ctx);
  state.property.cars = state.property.cars.filter((id) => id !== car.id);
  if (state.property.car === car.id) state.property.car = state.property.cars.at(-1) ?? null;
  state.message = `Sold the ${car.label} for ${naira(refund)}.`;
  emit(state, 'car.sold', { id: car.id, refund }, ctx);
  return ok(state, 'sold');
}

function carMode(car) {
  return { ...CAR_MODE, label: `Drive · ${car.label}`, icon: car.icon, fare: car.fuel, fuelOnly: true, car: car.id };
}

export default {
  id: 'property',
  stateKeys: ['homeOwned', 'property'],
  sanitize(input, state) {
    state.homeOwned = input.homeOwned === true;
    const saved = isRecord(input.property) ? input.property : {};
    const cars = [...new Set((Array.isArray(saved.cars) ? saved.cars : []).filter((id) => carOf(id)))];
    state.property = {
      house: houseOf(saved.house)?.id ?? DEFAULT_HOUSE,
      cars,
      car: cars.includes(saved.car) ? saved.car : cars.at(-1) ?? null,
    };
  },
  actions: { 'property.house-move': moveHouse, 'property.car-buy': buyCar, 'property.car-use': useCar, 'property.car-sell': sellCar },
  on: {
    /** End of onboarding: live in the chosen house. Free — the move-in fee is for later moves. */
    'life.started'(state, data) {
      // The house arrives as an id string; an object carrying `id` is accepted too.
      const house = houseOf(typeof data?.house === 'string' ? data.house : data?.house?.id);
      if (house) state.property.house = house.id;
    },
    /** Arriving in another city (systems/estate.js): the rented home there becomes the current one. */
    'house.moved'(state, data) {
      const house = data?.from === 'away' ? houseOf(data.house) : null;
      if (house) state.property.house = house.id;
    },
  },
  modifiers: {
    'travel.modes'(value, state) {
      const car = drivenCar(state);
      if (!car) return value;
      // The travel system asks with a list of mode ids; adding 'car' offers the own-car mode.
      if (Array.isArray(value) && value.every((mode) => typeof mode === 'string')) return [...value.filter((mode) => mode !== CAR_MODE.id), CAR_MODE.id];
      if (Array.isArray(value)) return [...value.filter((mode) => mode?.id !== CAR_MODE.id), carMode(car)];
      if (isRecord(value)) return { ...value, [CAR_MODE.id]: carMode(car) };
      return value;
    },
    'travel.fare'(value, state, data) {
      const car = drivenCar(state);
      return car && data?.mode === CAR_MODE.id ? car.fuel : value;
    },
    'travel.duration'(value, state, data) {
      const car = drivenCar(state);
      return car && data?.mode === CAR_MODE.id && Number.isFinite(value) ? Math.max(1, Math.round(value * car.speed)) : value;
    },
  },
  advance() {},
  view(state, ctx) {
    const current = HOUSES[state.property.house];
    const index = HOUSE_ORDER.indexOf(current.id);
    return {
      house: current,
      rent: current.rent,
      houses: HOUSE_ORDER.map((id) => {
        const house = HOUSES[id];
        const here = id === current.id && state.estate?.living !== 'own';
        return { ...house, current: here, affordable: state.cash >= house.moveIn,
          blocked: here ? 'You live here' : state.activeAction ? 'Finish your current action first' : state.cash < house.moveIn ? `Need ${naira(house.moveIn - state.cash)} more` : null };
      }),
      nextHouse: HOUSE_ORDER[index + 1] ?? null,
      car: drivenCar(state),
      cars: CAR_ORDER.map((id) => {
        const car = CARS[id], price = carPrice(state, car, ctx), owned = state.property.cars.includes(id);
        return { ...car, price, listPrice: car.price, owned, driving: state.property.car === id, resale: resale(car), affordable: state.cash >= price,
          blocked: owned ? null : state.activeAction ? 'Finish your current action first' : state.cash < price ? `Need ${naira(price - state.cash)} more` : null };
      }),
    };
  },
};
