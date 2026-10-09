import type { BodyPose } from './poses.ts';

export const PLAYER_BODY_POSES: readonly BodyPose[] = Object.freeze([
  'idle', 'walk', 'jog', 'sit', 'interact', 'dance', 'lie', 'soak', 'wash',
  'bucket', 'cook', 'cookLow', 'eat', 'drink', 'homeDoor',
]);

export interface BodyLifecycleRequest {
  readonly scene: 'venue' | 'creator' | 'home';
  readonly role?: 'player' | 'npc';
  readonly poses: readonly BodyPose[];
}

export function requestedBodyLifecycle(context: BodyLifecycleRequest): readonly BodyPose[] {
  return context.role === 'npc' ? context.poses : PLAYER_BODY_POSES;
}
