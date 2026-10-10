/**
 * Temporary routing: the native rig does not yet pass the strict foot-contact gate when it lies, soaks or washes on
 * real furniture (bed entry lifts the root and leaves a foot error over the limit). Until that repair is accepted,
 * those three poses use the previous body; standing, walking, sitting and every other pose keep the native rig.
 * To switch the native rig back on for them, empty REST_POSES_ON_PREVIOUS_BODY.
 */
import type { BodyPose } from './poses.ts';

export const REST_POSES_ON_PREVIOUS_BODY: ReadonlySet<BodyPose> = new Set<BodyPose>(['lie', 'soak', 'wash']);

export function usesPreviousBody(pose: BodyPose): boolean {
  return REST_POSES_ON_PREVIOUS_BODY.has(pose);
}

/** What to do about the body that is loaded when the pose asks for `wantsPrevious`. */
export type BodySwap = 'keep' | 'hide-then-load' | 'load';

/**
 * keep: the right kind is in, or the previous body is still getting up (its exit clip finishes first).
 * hide-then-load: the native rig must not be seen in a rest pose, so it is hidden while the previous body loads.
 * load: leave the previous body in view until the native rig is ready to replace it.
 */
export function bodySwap(loadedPrevious: boolean, wantsPrevious: boolean, settled: boolean): BodySwap {
  if (loadedPrevious === wantsPrevious) return 'keep';
  if (wantsPrevious) return 'hide-then-load';
  return settled ? 'load' : 'keep';
}
