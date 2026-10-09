import type { DrivingRoute } from './driving.ts'

/** Authored closed training circuit, never claimed to be a mapped public road. */
export const PRACTICE_COURSE: DrivingRoute = {
  id: 'district-practice', version: '1', roadWidth: 10, speedLimit: 7,
  roads: [[{ x: 0, z: 0 }, { x: 0, z: 30 }, { x: 25, z: 30 }, { x: 25, z: 55 }]],
  checkpoints: [
    { id: 'braking', center: { x: 0, z: 18 }, radius: 3, stopRequired: true },
    { id: 'turning', center: { x: 18, z: 30 }, radius: 3, stopRequired: false },
    { id: 'parking', center: { x: 25, z: 52 }, radius: 3, stopRequired: true },
  ],
}
