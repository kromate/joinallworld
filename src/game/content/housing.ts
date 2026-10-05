/**
 * OWNER: home
 * Houses and rents.
 *
 * HOUSES[id] = { id, label, district, grid, rent, moveIn, tag?, description, beta? }
 *   grid    the room is grid × grid floor tiles
 *   rent    naira per week (the career system charges it; read it from here)
 *   moveIn  what the Houses app charges to move in: landlord + agent = MOVE_IN_WEEKS × rent
 *
 * Provenance: ids, grid sizes, weekly rents and move-in costs are fixed, except where an entry
 * lists a field under `betaFields` — those are provisional beta values. Labels use everyday Nigerian housing terms; the
 * descriptions are original copy.
 *
 * Other systems read the player's current house id from `state.property.house` and its rent
 * from `HOUSES[state.property.house].rent`.
 */
import type { EstateState, HouseId, HouseTierId, PropertyState } from '../../types/life.ts'
import type { HouseDefinition, HouseTierDefinition } from '../../types/content.ts'

export const MOVE_IN_WEEKS = 3;

const HOUSES_DATA = {
  mushin: {
    id: 'mushin', label: 'Face-me-I-face-you', district: 'Mushin', grid: 6, rent: 2400, moveIn: 7200, tag: 'Hard start',
    description: 'One room off a shared corridor. The neighbours are loud, the rent is kind.',
  },
  yaba: {
    id: 'yaba', label: 'Self-contain', district: 'Yaba', grid: 8, rent: 6000, moveIn: 18000, tag: 'Balanced',
    description: 'A room with its own toilet and a cooking corner, a short hop from the tech hubs.',
    // 8 × 8 is an estimate; the move-in cost follows the 3 × rent pattern.
    betaFields: ['grid', 'moveIn'],
  },
  lekki: {
    id: 'lekki', label: 'Mini-flat', district: 'Lekki Phase 1', grid: 10, rent: 17000, moveIn: 51000, tag: 'Big spender',
    description: 'Bedroom, sitting room, kitchen and a private bathroom. Smooth ceilings, serious rent.',
  },
  ikoyi: {
    id: 'ikoyi', label: 'Duplex', district: 'Ikoyi', grid: 12, rent: 250000, moveIn: 750000,
    description: 'Two floors behind a quiet gate. Room for every sofa you have been eyeing.',
  },
  banana: {
    id: 'banana', label: 'Mansion', district: 'Banana Island', grid: 14, rent: 1500000, moveIn: 4500000,
    description: 'The island address. Marble floors, sea breeze and more space than furniture.',
  },
} satisfies Record<string, HouseDefinition>;
export const HOUSES: Record<string, HouseDefinition> & Record<keyof typeof HOUSES_DATA, HouseDefinition> = HOUSES_DATA;

/** Kept for the placeholder's export name. */
export const HOUSING = HOUSES;

/** Order shown in the Houses app (cheapest first). */
export const HOUSE_ORDER: HouseId[] = ['mushin', 'yaba', 'lekki', 'ikoyi', 'banana'];

/** The parts of the life state `homeOf` reads. */
export interface HomeOfState {
  estate?: Pick<EstateState, 'living' | 'tier'> | undefined
  property?: Pick<PropertyState, 'house'> | undefined
}
/** House tiers by id (content/world.ts HOUSE_TIERS): only `grid` and `label` are read. */
export type HomeDesigns = Record<HouseTierId, Pick<HouseTierDefinition, 'grid' | 'label'>>
/** What `homeOf` answers: the player's own house, or the rented tier. */
export type HomeInfo =
  | { id: 'own'; grid: number; label: string; district: string; owned: true }
  | (HouseDefinition & { owned: false })

/**
 * The house the room is laid out for: the tier of the player's own house while they live in it
 * (state.estate, systems/estate.ts — pass HOUSE_TIERS of content/world.ts), otherwise the rented tier.
 * → { grid, label, district, owned }
 */
export function homeOf(state: HomeOfState | null | undefined, designs: HomeDesigns | null = null,
  houses: readonly HouseDefinition[] = Object.values(HOUSES)): HomeInfo {
  const design = state?.estate?.living === 'own' && designs ? designs[state.estate.tier] : null;
  if (design) return { id: 'own', grid: design.grid, label: design.label, district: 'Your own house', owned: true };
  const houseId = state?.property?.house;
  const house = houses.find((item) => item.id === houseId) ?? houses.find((item) => item.id === DEFAULT_HOUSE) ?? houses[0];
  if (!house) throw new TypeError('A city requires at least one rented home');
  return { ...house, owned: false };
}

/** Where a life lives until onboarding says otherwise (the balanced start). */
export const DEFAULT_HOUSE = 'yaba';

/** Resolve a validated house id, failing if the catalogue and saved state disagree. */
export function requireHouse(id: HouseId, houses: readonly HouseDefinition[] = Object.values(HOUSES)): HouseDefinition {
  const house = houses.find((item) => item.id === id)
  if (!house) throw new TypeError(`Unknown house ${id}`)
  return house
}
