/**
 * Gentle relief: a hill is a low mound drawn under the fabric. Pure maths, shared by the builder
 * (the mound and what stands on it) and the road network (so a trip follows the ground).
 */
import type { PackHill } from './types.ts';

/** Height of the ground at (x, z): the highest hill's smooth cosine profile. 0 where no hill reaches. */
export function reliefAt(hills: readonly PackHill[] | undefined, x: number, z: number): number {
  if (!hills?.length) return 0;
  let height = 0;
  for (const hill of hills) {
    const d = Math.hypot(x - hill.x, z - hill.z);
    if (d >= hill.r) continue;
    const h = hill.h * (0.5 + 0.5 * Math.cos((Math.PI * d) / hill.r));
    if (h > height) height = h;
  }
  return height;
}

/** The slope of the ground at (x, z) as a surface normal [nx, ny, nz]. */
export function reliefNormal(hills: readonly PackHill[] | undefined, x: number, z: number): [number, number, number] {
  const e = 0.4, dx = (reliefAt(hills, x + e, z) - reliefAt(hills, x - e, z)) / (2 * e), dz = (reliefAt(hills, x, z + e) - reliefAt(hills, x, z - e)) / (2 * e);
  const length = Math.hypot(dx, 1, dz);
  return [-dx / length, 1 / length, -dz / length];
}
