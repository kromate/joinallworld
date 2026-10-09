import type { BodyKey } from './manifest.ts';

export const FACE_ATLAS = Object.freeze({
  male: Object.freeze({ eyes: [141 / 1024, 240 / 1024] as const }),
  female: Object.freeze({ eyes: [134 / 1024, 239 / 1024] as const }),
} satisfies Record<BodyKey, { eyes: readonly [number, number] }>);

/** UV-space centres and iris drops measured from the retained sockets after KHR_texture_transform.
 * irisDropPixels comes from frontmost-triangle projection with the shipped idle clip at t=0 and the
 * production oval/neutral appearance applied; it aligns the iris to the visible aperture centroid. */
export const EYE_SOCKETS = Object.freeze({
  male: Object.freeze({
    left: [142.0496 / 1024, 182.05032 / 1024] as const,
    right: [239.59525 / 1024, 182.04399 / 1024] as const,
    radius: [16 / 1024, 10 / 1024] as const,
    // Eye-centre corrections in atlas pixels: head pose bends the visible aperture below the UV centroid.
    irisDropPixels: [0.56, 1.06] as const,
  }),
  female: Object.freeze({
    left: [136.01535 / 1024, 182.14996 / 1024] as const,
    right: [238.20406 / 1024, 183.21162 / 1024] as const,
    radius: [16 / 1024, 10 / 1024] as const,
    irisDropPixels: [1.71, 1.11] as const,
  }),
} satisfies Record<BodyKey, { left: readonly [number, number]; right: readonly [number, number]; radius: readonly [number, number]; irisDropPixels: readonly [number, number] }>);

/** CPU-side calibration predicate used by tests and the dev viewer. */
export function inEyeSocket(key: BodyKey, uv: readonly [number, number], eye: 'left' | 'right'): boolean {
  const socket = EYE_SOCKETS[key];
  return Math.abs(uv[0] - socket[eye][0]) <= socket.radius[0]
    && Math.abs(uv[1] - socket[eye][1]) <= socket.radius[1];
}
