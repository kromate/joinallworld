import type { DetailLevel, DrawOptions, DrawnAvatar, Marker, Pose } from './characters.ts';
import type { Batch } from './types.ts';

/** A point mapping from a Batch's current parent coordinates into world coordinates. */
export interface WorldPointMapper {
  world(x: number, y: number, z: number): { x: number; y: number; z: number };
}

/** Affine parent transform as an origin and three basis vectors; supports nested rotation and scale without Three.js. */
export interface AuthoredFrame {
  readonly origin: readonly [number, number, number];
  readonly xAxis: readonly [number, number, number];
  readonly yAxis: readonly [number, number, number];
  readonly zAxis: readonly [number, number, number];
}

/** Local `drawAvatar` placement, kept separate from the sampled parent frame. */
export interface AuthoredLocalPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly ry: number;
  readonly scale: number;
}

/** Render semantics accepted by drawAvatar, retained so canonical and fallback renderers can share authored intent. */
export interface AuthoredPersonAppearance {
  readonly pose: Pose;
  readonly seat: number;
  readonly stride: number | undefined;
  readonly scale: number;
  readonly appearanceFit: boolean;
  readonly sleeping: boolean;
  readonly marker: Marker | null;
  readonly detail: DetailLevel;
}

/** A static person call captured without drawing or changing the current Batch transform. */
export interface AuthoredPerson {
  /** Stable, source-authored key. It must not be derived from position, array order, or a random value. */
  readonly key: string;
  /** Deterministic renderer/crowd identity derived solely from key. */
  readonly id: string;
  readonly seed: unknown;
  /** Raw authored look, preserving the same input consumed by `extra()` / `drawAvatar()`. */
  readonly look: unknown;
  /** Authored local y before parent transforms, pose seating, and appearance fitting. */
  readonly baseHeight: number;
  readonly parent: AuthoredFrame;
  readonly local: AuthoredLocalPlacement;
  readonly appearance: AuthoredPersonAppearance;
}

/** Fully composed world root frame before the pose-specific seat/body offset is applied. */
export interface AuthoredWorldPlacement {
  readonly position: readonly [number, number, number];
  readonly xAxis: readonly [number, number, number];
  readonly yAxis: readonly [number, number, number];
  readonly zAxis: readonly [number, number, number];
  readonly pose: Pose;
  readonly seat: number;
  readonly baseHeight: number;
  readonly appearanceFit: boolean;
}

/** Mirrors `extra(b, seed, x, z, ry, pose, more)`'s argument merge and drawAvatar defaults. */
export interface ExtraPersonCall {
  key: string;
  seed: unknown;
  x: number;
  z: number;
  ry?: number;
  pose?: Pose;
  more?: DrawOptions & { look?: unknown };
}

/** The original positional call received by props.extra; venue code assigns any stable key separately. */
export type ExtraPersonSourceCall = Omit<ExtraPersonCall, 'key'>;
export type AuthoredExtraHandler = (call: ExtraPersonSourceCall, drawOriginal: () => DrawnAvatar) => DrawnAvatar | undefined;

const extraHandlers = new WeakMap<object, AuthoredExtraHandler>();

/**
 * Scope a synchronous scene draw with a hook for its authored `props.extra()` calls.
 * Nested scopes restore the previous handler, and the finally block also restores it on errors.
 * The handler receives the exact original arguments; calling drawOriginal preserves the normal
 * props.extra -> drawAvatar path. Returning undefined delegates to that original draw.
 */
export function captureAuthoredExtras<T>(batch: Batch, onExtra: AuthoredExtraHandler, drawScene: () => T): T {
  const key = batch as object;
  const previous = extraHandlers.get(key);
  extraHandlers.set(key, onExtra);
  try {
    return drawScene();
  } finally {
    if (previous) extraHandlers.set(key, previous);
    else extraHandlers.delete(key);
  }
}

/** Internal bridge used by props.extra; kept module-private to callers through the typed helper. */
export function authoredExtraHandler(batch: Batch): AuthoredExtraHandler | undefined {
  return extraHandlers.get(batch as object);
}

const point = (p: { x: number; y: number; z: number }): readonly [number, number, number] => [p.x, p.y, p.z];
const subtract = (a: readonly number[], b: readonly number[]): readonly [number, number, number] => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const finite3 = (value: readonly number[]): boolean => value.length === 3 && value.every(Number.isFinite);

/** Sample the Batch's current affine parent transform. Batch.world already includes every nested `at()` transform. */
export function captureAuthoredFrame(parent: WorldPointMapper): AuthoredFrame {
  const origin = point(parent.world(0, 0, 0));
  const x = point(parent.world(1, 0, 0));
  const y = point(parent.world(0, 1, 0));
  const z = point(parent.world(0, 0, 1));
  const frame = { origin, xAxis: subtract(x, origin), yAxis: subtract(y, origin), zAxis: subtract(z, origin) } as const;
  if (![frame.origin, frame.xAxis, frame.yAxis, frame.zAxis].every(finite3)) throw new RangeError('authored parent transform must be finite');
  return frame;
}

/** Apply an affine frame to a local point, retaining parent rotation, scale, and translation. */
export function transformAuthoredPoint(frame: AuthoredFrame, local: readonly [number, number, number]): readonly [number, number, number] {
  if (!finite3(local)) throw new RangeError('authored point must have three finite coordinates');
  const [x, y, z] = local;
  return [
    frame.origin[0] + frame.xAxis[0] * x + frame.yAxis[0] * y + frame.zAxis[0] * z,
    frame.origin[1] + frame.xAxis[1] * x + frame.yAxis[1] * y + frame.zAxis[1] * z,
    frame.origin[2] + frame.xAxis[2] * x + frame.yAxis[2] * y + frame.zAxis[2] * z,
  ];
}

/** Compose the authored local yaw/scale with the sampled parent frame; pose and seat remain explicit metadata. */
export function resolveAuthoredPlacement(person: AuthoredPerson): AuthoredWorldPlacement {
  const { parent, local, appearance } = person;
  const c = Math.cos(local.ry) * local.scale, s = Math.sin(local.ry) * local.scale;
  const combine = (a: readonly number[], am: number, b: readonly number[], bm: number): readonly [number, number, number] => [
    a[0]! * am + b[0]! * bm, a[1]! * am + b[1]! * bm, a[2]! * am + b[2]! * bm,
  ];
  return {
    position: transformAuthoredPoint(parent, [local.x, local.y, local.z]),
    // Three's positive Y rotation sends local +X toward -Z and local +Z toward +X.
    xAxis: combine(parent.xAxis, c, parent.zAxis, -s),
    yAxis: [parent.yAxis[0] * local.scale, parent.yAxis[1] * local.scale, parent.yAxis[2] * local.scale],
    zAxis: combine(parent.xAxis, s, parent.zAxis, c),
    pose: appearance.pose, seat: appearance.seat, baseHeight: person.baseHeight, appearanceFit: appearance.appearanceFit,
  };
}

/** Capture the stable semantics and current parent frame of a call equivalent to `props.extra()`. */
export function captureExtraPerson(parent: WorldPointMapper, call: ExtraPersonCall): AuthoredPerson {
  const key = call.key.trim();
  if (!key) throw new TypeError('authored people need a non-empty stable key');
  // Keep the same override order as props.extra(): positional defaults first, then `more`.
  const draw: DrawOptions & { look?: unknown } = {
    seed: call.seed, x: call.x, y: 0, z: call.z, ry: call.ry ?? 0, pose: call.pose ?? 'stand', ...call.more,
  };
  const local = {
    x: draw.x ?? 0, y: draw.y ?? 0, z: draw.z ?? 0, ry: draw.ry ?? 0, scale: draw.scale ?? 1,
  };
  const appearance = {
    pose: draw.pose ?? 'stand', seat: draw.seat ?? 0.6, stride: draw.stride,
    scale: draw.scale ?? 1, appearanceFit: draw.appearanceFit ?? true, sleeping: draw.sleeping ?? false,
    marker: draw.marker ?? null, detail: draw.detail ?? 'low',
  };
  if (![local.x, local.y, local.z, local.ry, local.scale, appearance.seat].every(Number.isFinite)) {
    throw new RangeError('authored person placement, scale, and seat must be finite');
  }
  return Object.freeze({
    key, id: `authored:${key}`, seed: draw.seed, look: call.more?.look ?? null, baseHeight: local.y,
    parent: captureAuthoredFrame(parent), local: Object.freeze(local), appearance: Object.freeze(appearance),
  });
}
