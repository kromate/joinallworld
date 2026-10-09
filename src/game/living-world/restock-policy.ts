/** Fixed authored terms for the fictional Lagos NPC restock outlet. */
export const NPC_RESTOCK_POLICY = Object.freeze({
  cityId: 'lagos',
  destinationId: 'lagos-fictional-restock-outlet',
  outletId: 'lagos-fictional-restock-outlet',
  originId: 'marina-fictional-depot',
  product: 'water',
  quantity: 3,
  wage: 120,
  capacity: 60,
} as const)

/** This is simulated LifeState cash, never a real-value or payment-rail currency. */
export const NPC_RESTOCK_CURRENCY = 'simulated-life-cash' as const
