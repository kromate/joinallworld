/**
 * OWNER: home
 * Houses and rents.
 *
 * HOUSES[id] = { id, label, district, grid, rent, moveIn, tag?, description, beta? }
 *   grid    the room is grid × grid floor tiles
 *   rent    naira per week (the career system charges it; read it from here)
 *   moveIn  what the Houses app charges to move in: landlord + agent = MOVE_IN_WEEKS × rent
 *
 * Provenance: ids, grid sizes, weekly rents and move-in costs follow what was observed in the
 * reference game, except where an entry lists a field under `betaFields` — those were not
 * shown and are original beta values. Labels use everyday Nigerian housing terms; the
 * descriptions are original copy.
 *
 * Other systems read the player's current house id from `state.property.house` and its rent
 * from `HOUSES[state.property.house].rent`.
 */
export const MOVE_IN_WEEKS = 3;

export const HOUSES = {
  mushin: {
    id: 'mushin', label: 'Face-me-I-face-you', district: 'Mushin', grid: 6, rent: 2400, moveIn: 7200, tag: 'Hard start',
    description: 'One room off a shared corridor. The neighbours are loud, the rent is kind.',
  },
  yaba: {
    id: 'yaba', label: 'Self-contain', district: 'Yaba', grid: 8, rent: 6000, moveIn: 18000, tag: 'Balanced',
    description: 'A room with its own toilet and a cooking corner, a short hop from the tech hubs.',
    // The reference game never showed this room's grid size or its move-in price (the tester
    // already lived there). 8 × 8 is an estimate; the move-in cost follows the 3 × rent pattern.
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
};

/** Kept for the placeholder's export name. */
export const HOUSING = HOUSES;

/** Order shown in the Houses app (cheapest first). */
export const HOUSE_ORDER = ['mushin', 'yaba', 'lekki', 'ikoyi', 'banana'];

/** Where a life lives until onboarding says otherwise (the balanced start). */
export const DEFAULT_HOUSE = 'yaba';
