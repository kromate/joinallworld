import * as THREE from 'three';

export interface WristOrientationFrames {
  /** Rest and sampled source forearm orientations expressed relative to their source actor root. */
  readonly sourceRestForearmRoot: THREE.Quaternion;
  readonly sourcePoseForearmRoot: THREE.Quaternion;
  /** Rest and sampled source hand orientations expressed relative to their source actor root. */
  readonly sourceRestHandRoot: THREE.Quaternion;
  readonly sourcePoseHandRoot: THREE.Quaternion;
  /** Rest target forearm orientation in target actor-root space. */
  readonly targetRestForearmRoot: THREE.Quaternion;
  /** Rest hand local quaternion below its forearm parent. */
  readonly targetRestHandLocal: THREE.Quaternion;
}

export interface WristOrientationResult {
  readonly local: THREE.Quaternion;
  /** Source wrist articulation angle, after removing source forearm motion. */
  readonly sourceDeltaRadians: number;
  /** Same wrist delta expressed in the target forearm's authored rest axes. */
  readonly targetDeltaRadians: number;
}

function unit(value: THREE.Quaternion, name: string): THREE.Quaternion {
  const length = Math.hypot(value.x, value.y, value.z, value.w);
  if (!Number.isFinite(length) || length < 1e-8) throw new Error(`${name} must be a finite nonzero quaternion`);
  return value.clone().normalize();
}

/**
 * Map only the source wrist's local articulation onto a native hand after positional arm IK.
 * Both source world rotations are first expressed relative to the source actor root. The source
 * lower-arm rotation is factored out. The pose delta is formed on the left, so it is expressed in
 * the source forearm-parent frame; that frame is then aligned to the native forearm rest frame.
 * This transfers measured clip motion without assuming either rig's Euler axes match.
 *
 * The returned quaternion is local to the native lower-arm. Assigning it changes hand orientation
 * but not the hand bone origin, so a prop attached at the hand alias keeps its wrist position.
 */
export function mapSourceWristOrientation(frames: WristOrientationFrames): WristOrientationResult {
  const sourceRestForearm = unit(frames.sourceRestForearmRoot, 'source rest forearm');
  const sourcePoseForearm = unit(frames.sourcePoseForearmRoot, 'source pose forearm');
  const sourceRestHand = unit(frames.sourceRestHandRoot, 'source rest hand');
  const sourcePoseHand = unit(frames.sourcePoseHandRoot, 'source pose hand');
  const targetRestForearm = unit(frames.targetRestForearmRoot, 'target rest forearm');
  const targetRestHand = unit(frames.targetRestHandLocal, 'target rest hand');

  const sourceRestRelative = sourceRestForearm.clone().invert().multiply(sourceRestHand).normalize();
  const sourcePoseRelative = sourcePoseForearm.clone().invert().multiply(sourcePoseHand).normalize();
  const sourceDelta = sourcePoseRelative.clone().multiply(sourceRestRelative.clone().invert()).normalize();

  // C maps source-lowerarm rest coordinates into target-lowerarm rest coordinates.
  const sourceToTargetBasis = targetRestForearm.clone().invert().multiply(sourceRestForearm).normalize();
  const targetDelta = sourceToTargetBasis.clone().multiply(sourceDelta)
    .multiply(sourceToTargetBasis.clone().invert()).normalize();
  const local = targetDelta.multiply(targetRestHand).normalize();
  const angle = (value: THREE.Quaternion) => 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(value.w), -1, 1));
  return Object.freeze({ local, sourceDeltaRadians: angle(sourceDelta), targetDeltaRadians: angle(targetDelta) });
}
