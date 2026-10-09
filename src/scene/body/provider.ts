import type { Kit } from '../kit.ts';
import type { BodyPose } from './poses.ts';
import type { SkinnedBody } from './skinned.ts';
import type { NativeSceneBodySupport } from './native-scene-support.ts';
import { normalizeLook } from '../characters.ts';
import { loadBody } from './skinned.ts';
export { loadBody } from './skinned.ts';
export { createStandInNativeSupport, hostSurfaceYAt } from './native-scene-support.ts';

import { requestedBodyLifecycle } from './body-lifecycle.ts';
export { requestedBodyLifecycle, PLAYER_BODY_POSES } from './body-lifecycle.ts';

export interface GameBodyLoadContext {
  readonly scene: 'venue' | 'creator' | 'home';
  readonly role?: 'player' | 'npc';
  readonly poses: readonly BodyPose[];
  readonly nativeSupport?: NativeSceneBodySupport;
}

export async function loadGameBody(
  kit: Kit, look: unknown, seed: unknown, scale: number, context: GameBodyLoadContext,
): Promise<SkinnedBody> {
  const required = requestedBodyLifecycle(context);
  const fields = ['body', 'hair', 'outfit', 'fabric', 'skin', 'hairColor', 'outfitColor', 'bottomsColor', 'accessories', 'face', 'expression'];
  const complete = look !== null && typeof look === 'object' && !Array.isArray(look)
    && fields.every((field) => Object.hasOwn(look, field));
  if (complete && typeof seed === 'string' && required.length) {
    const native = await import('./native/native-full-runtime-v1/native-prepared-factory.ts');
    if (native.supportsNativeLook(look, seed) && native.supportsNativePoses(required)) {
      return native.prepareNativeSkinnedBody({ ...context.nativeSupport, kit, look: normalizeLook(look, seed),
        seed, sceneScale: scale, retargetMode: 'directions' });
    }
  }
  return loadBody(kit, look, seed, scale);
}
