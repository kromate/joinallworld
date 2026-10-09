/** Routing boundary for native actors; upstream gate.ts still owns device/WebGL eligibility. */
import type { Kit } from '../kit.ts';
import type { BodyPose } from './poses.ts';
import type { SkinnedBody } from './skinned.ts';
import { normalizeLook } from '../characters.ts';
import { loadBody } from './skinned.ts';

export const NATIVE_GAME_BODY_CAPABILITIES = Object.freeze({
  supportedPoses: Object.freeze(['idle', 'walk', 'interact', 'cook', 'eat', 'drink'] as const),
  unsupportedContact: Object.freeze(['sit', 'lie', 'soak', 'wash'] as const),
  unsupportedSurface: Object.freeze(['stairs'] as const),
  ownsAnimationLoop: false,
});

export interface GameBodyLoadContext {
  /** Existing scene category; actor ownership and scene attachment remain with the caller. */
  readonly scene: 'venue' | 'creator' | 'home';
  /** Poses this actor may be asked to perform in its current lifecycle. */
  readonly poses: readonly BodyPose[];
}

export async function loadGameBody(
  kit: Kit, look: unknown, seed: string, scale: number, context: GameBodyLoadContext,
): Promise<SkinnedBody> {
  if (context.scene !== 'venue' && context.scene !== 'creator' && context.scene !== 'home') throw new Error('Unknown body scene context');
  const fields = ['body', 'hair', 'outfit', 'fabric', 'skin', 'hairColor', 'outfitColor', 'bottomsColor', 'accessories', 'face', 'expression'];
  const hasCompleteIdentity = Boolean(look && typeof look === 'object' && !Array.isArray(look)
    && fields.every((field) => Object.hasOwn(look as object, field)));
  const required = NATIVE_GAME_BODY_CAPABILITIES.supportedPoses as readonly BodyPose[];
  const allRequestedPosesSupported = context.poses.length > 0 && context.poses.every((pose) => required.includes(pose));
  if (hasCompleteIdentity && allRequestedPosesSupported) {
    const native = await import('./native/native-full-runtime-v1/native-prepared-factory.ts');
    if (native.supportsNativeLook(look, seed) && native.supportsNativePoses(required)) {
      const normalized = normalizeLook(look, seed);
      return native.prepareNativeSkinnedBody({ kit, look: normalized, seed, sceneScale: scale, retargetMode: 'directions' });
    }
  }
  return loadBody(kit, look, seed, scale);
}
