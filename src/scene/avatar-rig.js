/**
 * OWNER: scenes
 * The scene side of the player's avatar: which detail level a scene asks for, and how a walk cycle
 * is driven. Everything here FEATURE-DETECTS what src/scene/characters.js offers, so that file can
 * gain a level or a rig without any change here or in the scenes (this module only reads it).
 *
 * WHAT IS ASSUMED ABOUT characters.js (and what happens when it is not there)
 *   DETAILS            the exported list of detail levels buildAvatar accepts. If it contains
 *                      'medium' the local player's figure is built with `detail: 'medium'`;
 *                      otherwise with 'low', exactly as before. ('high' is the creator's preview
 *                      model — several thousand triangles per pose — and is not used in a scene.)
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
import * as characters from './characters.js';

/** The detail level a scene builds the local player's figure with. */
export function pickDetail(details) { return Array.isArray(details) && details.includes('medium') ? 'medium' : 'low'; }
export const PLAYER_DETAIL = pickDetail(characters.DETAILS);

const LEG_SWING = 0.62, ARM_SWING = 0.42;
const turnable = (part) => (part && typeof part === 'object' && part.rotation && typeof part.rotation === 'object' ? part : null);
function limb(parts, names, pair, index) {
  for (const name of names) { const found = turnable(parts[name]); if (found) return found; }
  return turnable(Array.isArray(parts[pair]) ? parts[pair][index] : null);
}

/**
 * The walk-cycle driver for a built figure, or null when it has none (the caller then flips poses).
 * → { stride(phase, amount = 1), rest() }
 */
export function rigOf(figure) {
  const data = figure?.userData;
  if (!data || typeof data !== 'object') return null;
  if (data.jawRig !== undefined) return data.jawRig;
  let rig = null;
  if (typeof data.stride === 'function') rig = { stride: (phase, amount = 1) => { data.stride(phase, amount); }, rest: () => { data.stride(0, 0); } };
  else if (data.parts && typeof data.parts === 'object') {
    const parts = data.parts;
    const legL = limb(parts, ['legL', 'leftLeg', 'legLeft'], 'legs', 0), legR = limb(parts, ['legR', 'rightLeg', 'legRight'], 'legs', 1);
    const armL = limb(parts, ['armL', 'leftArm', 'armLeft'], 'arms', 0), armR = limb(parts, ['armR', 'rightArm', 'armRight'], 'arms', 1);
    if (legL && legR) {
      // The built pose is where each limb rests; the cycle swings around it.
      const base = [legL, legR, armL, armR].map((part) => (part ? Number(part.rotation.x) || 0 : 0));
      const stride = (phase, amount = 1) => {
        const swing = Math.sin(phase) * amount;
        legL.rotation.x = base[0] + swing * LEG_SWING; legR.rotation.x = base[1] - swing * LEG_SWING;
        if (armL) armL.rotation.x = base[2] - swing * ARM_SWING;
        if (armR) armR.rotation.x = base[3] + swing * ARM_SWING;
      };
      rig = { stride, rest: () => stride(0, 0) };
    }
  }
  data.jawRig = rig;
  return rig;
}
