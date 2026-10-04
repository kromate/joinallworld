/**
 * OWNER: scenes
 * The scene side of the player's avatar: which detail level a scene asks for, and how a walk cycle
 * is driven. Everything here FEATURE-DETECTS what src/scene/characters.ts offers, so that file can
 * gain a level or a rig without any change here or in the scenes (this module only reads it).
 *
 * WHAT IS ASSUMED ABOUT characters.ts (and what happens when it is not there)
 *   DETAILS            the exported list of detail levels buildAvatar accepts. If it contains
 *                      'medium' the local player's figure is built with `detail: 'medium'`;
 *                      otherwise with 'low', exactly as before. ('high' is the creator's preview
 *                      model — several thousand triangles per pose — and is not used in a scene.)
 *   poseAvatar         the exported poseAvatar(avatar, { pose, stride }). When it exists (with a
 *                      'medium' level) the standing figure is built ONCE as a rig — buildAvatar(kit,
 *                      look, { rig: true, detail: 'medium', marker: 'crown' }) — and a step calls
 *                      poseAvatar(figure, { pose: 'walk' | 'jog', stride: 0…1 }), which only turns
 *                      its parts; no second walking figure is built. Resting poses other than
 *                      'stand' (sit, work, dance …) are still built as plain figures when needed.
 *   userData.stride    optional: a function (phase, amount) on the group buildAvatar returns that
 *                      poses the limbs for a walk cycle. phase is in radians (2π = two steps),
 *                      amount is 0…1 (0 = the built pose). If present it is simply called.
 *   userData.parts     optional: the limbs as separate transforms pivoted at the hip / shoulder:
 *                      { legL, legR, armL, armR } — also read as leftLeg / rightLeg / leftArm /
 *                      rightArm, or { legs: [left, right], arms: [left, right] }. Each must be an
 *                      object with a `rotation` whose x swings the limb forward and back. If both
 *                      legs are there the walk cycle rotates them (arms opposite, when present).
 *   Neither            the two-pose flip the scenes have always used: the standing and the walking
 *                      figure alternate, one visible at a time.
 * Nothing here builds geometry or keeps time: stride() only writes rotations, on a frame the host
 * is drawing anyway.
 */
import * as characters from './characters.ts';
import type { DetailLevel, Pose } from './characters.ts';

/** The walk-cycle driver of a built figure: `stride` poses the limbs (phase in radians, amount 0 … 1), `rest` returns them to the built pose. */
export interface AvatarRig {
  stride(phase: number, amount?: number, jog?: boolean): void;
  rest(): void;
}
/** Anything with a rotation whose x swings it forward and back. */
interface Turnable { rotation: { x: number } }
/** What a figure's userData may hold (all feature-detected). */
interface RigData {
  jawRig?: AvatarRig | null;
  parts?: Record<string, unknown> & { body?: { position?: unknown }; torso?: { rotation?: unknown } };
  stride?: (phase: number, amount: number) => void;
}

/** The detail level a scene builds the local player's figure with. */
export function pickDetail(details: unknown): DetailLevel { return Array.isArray(details) && details.includes('medium') ? 'medium' : 'low'; }
export const PLAYER_DETAIL = pickDetail(characters.DETAILS);
/** True when characters.ts can build and pose a rig: the scene then keeps one rigged figure instead of two poses. */
export const PLAYER_RIG = typeof characters.poseAvatar === 'function' && PLAYER_DETAIL !== 'low';
/** The detail options a scene passes to buildAvatar for the player's figure in `pose`. */
export const playerOptions = (pose: Pose = 'stand'): { detail: DetailLevel; rig?: boolean } => (PLAYER_RIG && pose === 'stand' ? { detail: PLAYER_DETAIL, rig: true } : { detail: PLAYER_DETAIL });
const TURN = Math.PI * 2;

const LEG_SWING = 0.62, ARM_SWING = 0.42;
const turnable = (part: unknown): Turnable | null => (part && typeof part === 'object' && 'rotation' in part && part.rotation && typeof part.rotation === 'object' ? part as Turnable : null);
function limb(parts: Record<string, unknown>, names: string[], pair: string, index: number): Turnable | null {
  for (const name of names) { const found = turnable(parts[name]); if (found) return found; }
  const list = parts[pair];
  return turnable(Array.isArray(list) ? list[index] : null);
}

/**
 * The walk-cycle driver for a built figure, or null when it has none (the caller then flips poses).
 * → { stride(phase, amount = 1), rest() }
 */
export function rigOf(figure: { userData?: unknown } | null | undefined): AvatarRig | null {
  const found = figure?.userData;
  if (!found || typeof found !== 'object') return null;
  const data = found as RigData;
  if (data.jawRig !== undefined) return data.jawRig;
  let rig: AvatarRig | null = null;
  if (PLAYER_RIG && data.parts?.body?.position && data.parts.torso?.rotation && data.parts.legL && data.parts.legR && data.parts.armL && data.parts.armR) {
    // characters.ts poses its own rig: one full cycle is stride 0 … 1 (phase 2π).
    rig = {
      stride: (phase: number, amount = 1, jog = false) => { if (amount > 0) characters.poseAvatar(figure, { pose: jog ? 'jog' : 'walk', stride: (((phase / TURN) % 1) + 1) % 1 }); else characters.poseAvatar(figure, { pose: 'stand' }); },
      rest: () => { characters.poseAvatar(figure, { pose: 'stand' }); },
    };
  } else if (typeof data.stride === 'function') rig = { stride: (phase: number, amount = 1) => { data.stride!(phase, amount); }, rest: () => { data.stride!(0, 0); } };
  else if (data.parts && typeof data.parts === 'object') {
    const parts = data.parts;
    const legL = limb(parts, ['legL', 'leftLeg', 'legLeft'], 'legs', 0), legR = limb(parts, ['legR', 'rightLeg', 'legRight'], 'legs', 1);
    const armL = limb(parts, ['armL', 'leftArm', 'armLeft'], 'arms', 0), armR = limb(parts, ['armR', 'rightArm', 'armRight'], 'arms', 1);
    if (legL && legR) {
      // The built pose is where each limb rests; the cycle swings around it.
      const base = [legL, legR, armL, armR].map((part) => (part ? Number(part.rotation.x) || 0 : 0));
      const stride = (phase: number, amount = 1) => {
        const swing = Math.sin(phase) * amount;
        legL.rotation.x = base[0]! + swing * LEG_SWING; legR.rotation.x = base[1]! - swing * LEG_SWING;
        if (armL) armL.rotation.x = base[2]! - swing * ARM_SWING;
        if (armR) armR.rotation.x = base[3]! + swing * ARM_SWING;
      };
      rig = { stride, rest: () => stride(0, 0) };
    }
  }
  data.jawRig = rig;
  return rig;
}
