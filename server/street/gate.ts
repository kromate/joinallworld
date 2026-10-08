import { rowX, STREET_NETWORK_SCALE } from '../../src/game/neighbourhood-space.ts'
import type { PlotAddress } from '../../src/types/life.ts'

export interface NormalizedGatePoint { x: number; z: number }
export const ESTATE_GATE_POINT: NormalizedGatePoint = { x: 81 * STREET_NETWORK_SCALE, z: 0 }
export interface StreetGateProof { room: string; point: NormalizedGatePoint; at: number; credit: number }
/** Evidence only: a failed proof never vetoes legacy visual movement. All times are supplied by the host. */
export function createStreetGateProof() {
  const proofs = new Map<string, StreetGateProof>(), speed = 4.2, maximumCredit = speed * 2
  return {
    seed(id: string, room: string, plot: PlotAddress, now: number, trustedReturn?: NormalizedGatePoint): void {
      if (!trustedReturn && proofs.get(id)?.room === room) return
      if (proofs.size >= 4096 && !proofs.has(id)) { const oldest = proofs.keys().next().value; if (oldest) proofs.delete(oldest) }
      proofs.set(id, { room, point: trustedReturn ? { ...trustedReturn } : { x: rowX(plot.plot) * STREET_NETWORK_SCALE, z: -3.25 * STREET_NETWORK_SCALE }, at: now, credit: maximumCredit })
    },
    move(id: string, room: string, point: NormalizedGatePoint, now: number): boolean {
      const proof = proofs.get(id)
      if (!proof || proof.room !== room || !Number.isFinite(point.x) || !Number.isFinite(point.z) || Math.abs(point.x) > 20 || point.z < -18 * STREET_NETWORK_SCALE || point.z > 11 * STREET_NETWORK_SCALE || now < proof.at) return false
      const credit = Math.min(maximumCredit, proof.credit + speed * (now - proof.at) / 1000), distance = Math.hypot(point.x - proof.point.x, point.z - proof.point.z) / STREET_NETWORK_SCALE
      if (distance > credit + 1e-9) return false
      proof.point = { ...point }; proof.at = now; proof.credit = Math.max(0, credit - distance); return true
    },
    reached(id: string, room: string, now: number): boolean { const proof = proofs.get(id); return Boolean(proof && proof.room === room && now >= proof.at && Math.hypot(proof.point.x - ESTATE_GATE_POINT.x, proof.point.z - ESTATE_GATE_POINT.z) <= 1.5 * STREET_NETWORK_SCALE) },
    snapshot(id: string): StreetGateProof | undefined { const proof = proofs.get(id); return proof ? { ...proof, point: { ...proof.point } } : undefined },
    restore(id: string, value: unknown, now: number): void {
      if (!value || typeof value !== 'object' || !('room' in value) || typeof value.room !== 'string' || value.room.length > 160 || !value.room.includes(':neighbourhood:')
        || !('point' in value) || !value.point || typeof value.point !== 'object' || !('x' in value.point) || !('z' in value.point)
        || typeof value.point.x !== 'number' || !Number.isFinite(value.point.x) || Math.abs(value.point.x) > 20 || typeof value.point.z !== 'number' || !Number.isFinite(value.point.z) || value.point.z < -18 * STREET_NETWORK_SCALE || value.point.z > 11 * STREET_NETWORK_SCALE
        || !('at' in value) || typeof value.at !== 'number' || !Number.isFinite(value.at) || value.at > now
        || !('credit' in value) || typeof value.credit !== 'number' || !Number.isFinite(value.credit) || value.credit < 0 || value.credit > maximumCredit) return
      if ((proofs.get(id)?.at ?? -Infinity) > value.at) return
      if (proofs.size >= 4096 && !proofs.has(id)) { const oldest = proofs.keys().next().value; if (oldest) proofs.delete(oldest) }
      proofs.set(id, { room: value.room, point: { x: value.point.x, z: value.point.z }, at: value.at, credit: value.credit })
    },
    clear(id: string): void { proofs.delete(id) },
  }
}
