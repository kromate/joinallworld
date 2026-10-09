/** Test data only: pure parcel transitions with fabricated trip/pose proof, never a production authority adapter. */
import assert from 'node:assert/strict'
import { acceptParcel, collectParcel, deliverParcel, emptyParcelState, offerParcel } from '../../src/game/living-world/parcel.ts'
import type { ParcelState, TrustedParcelPose, TrustedParcelRecipient, TrustedParcelTrip } from '../../src/game/living-world/parcel.ts'
import { NPC_RESTOCK_POLICY } from '../../src/game/living-world/restock-policy.ts'

function trip(actor: string, at: number, expiresAt: number): TrustedParcelTrip {
  return { actor, tripId: 'restock-trip', resourceId: 'starter-car', qualificationId: 'district-driving', qualificationVersion: 1,
    qualificationStatus: 'active', cityId: 'lagos', routeId: 'fictional-restock-route', routeVersion: 'v1', active: true, expiresAt, at }
}
function pose(actor: string, at: number, placeId: string): TrustedParcelPose {
  return { actor, tripId: 'restock-trip', placeId, at, stopped: true, verified: true }
}
export function deliveredNpcParcel(actor: string, at: number, parcelId = 'restock-parcel'): ParcelState {
  const initial = emptyParcelState(actor), leaseExpiresAt = at + 100_000
  const terms = { parcelId, expectedRevision: initial.revision, expectedGeneration: initial.generation,
    resourceId: 'starter-car', qualificationId: 'district-driving', qualificationVersion: 1, cityId: 'lagos', routeId: 'fictional-restock-route', routeVersion: 'v1',
    originId: NPC_RESTOCK_POLICY.originId, destinationId: NPC_RESTOCK_POLICY.destinationId,
    product: NPC_RESTOCK_POLICY.product, quantity: NPC_RESTOCK_POLICY.quantity, wage: NPC_RESTOCK_POLICY.wage, expiresAt: at + 50_000 }
  const offered = offerParcel(initial, terms, trip(actor, at - 3_000, leaseExpiresAt))
  assert.equal(offered.code, 'offered')
  const accepted = acceptParcel(offered.state, { parcelId: terms.parcelId, expectedRevision: offered.state.revision, generation: 1 }, trip(actor, at - 2_000, leaseExpiresAt))
  assert.equal(accepted.code, 'accepted')
  const collected = collectParcel(accepted.state, { parcelId: terms.parcelId, expectedRevision: accepted.state.revision, generation: 1 },
    trip(actor, at - 1_000, leaseExpiresAt), pose(actor, at - 1_000, terms.originId))
  assert.equal(collected.code, 'collected')
  const recipient: TrustedParcelRecipient = { shopId: terms.destinationId, product: terms.product, revision: 0,
    availableUnits: NPC_RESTOCK_POLICY.capacity, open: true }
  const delivered = deliverParcel(collected.state, { parcelId: terms.parcelId, expectedRevision: collected.state.revision, generation: 1 },
    trip(actor, at, leaseExpiresAt), pose(actor, at, terms.destinationId), recipient)
  assert.equal(delivered.code, 'delivered')
  return delivered.state
}
