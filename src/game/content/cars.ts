/**
 * OWNER: home
 * Cars.
 *
 * CARS[id] = { id, label, nickname, icon, price, fuel, speed, beta: true }
 *   price  naira, as listed in the car dealer
 *   fuel   naira of fuel per trip when you drive it — original beta value
 *   speed  multiplier on travel time when you drive it (lower is faster) — original beta value
 *
 * Provenance: `priceReported` marks a price that may still be retuned. Vehicle names and
 * nicknames are original; every entry carries `beta: true` because fuel cost and speed are
 * provisional values.
 */
import type { CarId } from '../../types/life.ts'
import type { CarDefinition, TravelModeDefinition } from '../../types/content.ts'

export const CARS: Record<CarId, CarDefinition> = {
  'agama-150': { id: 'agama-150', label: 'Agama 150 Motorbike', nickname: 'Your own okada', icon: '🏍️', price: 350000, fuel: 30, speed: 0.75, beta: true },
  'tokunbo-saloon': { id: 'tokunbo-saloon', label: 'Tokunbo Saloon ’08', nickname: 'First-car feeling', icon: '🚗', price: 900000, fuel: 60, speed: 0.7, beta: true },
  'oga-sedan': { id: 'oga-sedan', label: 'Oga Sedan', nickname: 'Smooth operator', icon: '🚗', price: 1800000, fuel: 80, speed: 0.65, beta: true },
  'marina-v6': { id: 'marina-v6', label: 'Marina V6', nickname: 'Third Mainland flex', icon: '🚙', price: 3000000, fuel: 100, speed: 0.6, beta: true },
  'chief-suv': { id: 'chief-suv', label: 'Big Chief SUV', nickname: 'Chairman has arrived', icon: '🚙', price: 7500000, fuel: 140, speed: 0.55, beta: true },
  'boardroom-330': { id: 'boardroom-330', label: 'Boardroom 330', nickname: 'Monday-morning sharp', icon: '🏎️', price: 9500000, fuel: 120, speed: 0.5, beta: true },
  'harmattan-cruiser': { id: 'harmattan-cruiser', label: 'Harmattan Cruiser', nickname: 'Village-ready, city-proud', icon: '🚙', price: 15000000, fuel: 180, speed: 0.5, beta: true },
  'atlantic-x': { id: 'atlantic-x', label: 'Atlantic X', nickname: 'Island weekend special', icon: '🚙', price: 28000000, fuel: 220, speed: 0.45, beta: true },
  'atlantic-grand': { id: 'atlantic-grand', label: 'Atlantic Grand', nickname: 'Convoy of one', icon: '🚙', price: 95000000, fuel: 300, speed: 0.4, beta: true, priceReported: true },
};

/** Dealer order (cheapest first). */
// Object.keys is string[]; the keys of CARS are exactly the CarId union.
export const CAR_ORDER = Object.keys(CARS) as CarId[];

/** Share of the price returned when a car is sold back to the dealer (original beta value). */
export const CAR_RESALE_RATE = 0.6;

/** The travel mode an owned car adds (via the 'travel.modes' modifier). */
export const CAR_MODE = { id: 'car', label: 'Drive', icon: '🚗' } satisfies Pick<TravelModeDefinition, 'id' | 'label' | 'icon'>;
