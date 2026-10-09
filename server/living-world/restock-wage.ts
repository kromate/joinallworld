/** Adapter from a validated NPC stock effect to the canonical simulated-life wallet action. */
import { NPC_RESTOCK_POLICY } from '../../src/game/living-world/restock-policy.ts'
import type { RouteContext, Db, SessionRecord } from '../types.ts'
import type { ApplyNpcRestockWage } from './restock-service.ts'
import type { NpcRestockEffect } from './npc-inventory.ts'

const safe = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

function fixedEffect(effect: NpcRestockEffect, publicId: string): boolean {
  return effect !== null && typeof effect === 'object'
    && effect.actorId === publicId && typeof effect.parcelId === 'string' && effect.parcelId.length > 0
    && safe(effect.generation) && effect.generation > 0 && effect.wage === NPC_RESTOCK_POLICY.wage
    && effect.stock !== null && typeof effect.stock === 'object'
    && effect.stock.outletId === NPC_RESTOCK_POLICY.outletId
    && effect.stock.product === NPC_RESTOCK_POLICY.product
    && effect.stock.quantity === NPC_RESTOCK_POLICY.quantity
    && safe(effect.stock.expectedRevision)
    && safe(effect.stock.revision) && effect.stock.revision === effect.stock.expectedRevision + 1
}

/**
 * Must be called synchronously inside the restock service's active ctx.once transaction. The
 * payload carries no amount, actor, or inventory data; the system action owns the fixed wage.
 */
export function createNpcRestockWageAdapter(ctx: RouteContext): ApplyNpcRestockWage {
  return (_db: Db, session: SessionRecord, effect: NpcRestockEffect, at: number, requestId: string) => {
    if (!fixedEffect(effect, session.publicId) || !safe(at) || typeof requestId !== 'string' || requestId.length === 0)
      throw new Error('Invalid fixed NPC restock wage effect')
    const life = ctx.settle(session, NPC_RESTOCK_POLICY.cityId)
    const result = ctx.act(life, {
      type: 'living-world.server',
      cityId: NPC_RESTOCK_POLICY.cityId,
      actionId: requestId,
      payload: { op: 'npc-restock-wage' },
      stateGuard: 'The delivered NPC restock and fixed wage share the same ctx.once transaction.',
    })
    if (!result.ok || result.code !== 'npc_restock_wage_paid')
      throw new Error(`Fixed NPC restock wage refused: ${result.code}`)
    return 'credited'
  }
}
