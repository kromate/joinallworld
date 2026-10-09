import type { NativeClipApplyResult, NativeClipSolver, NativeSourceFrame } from './native-clip-solver.ts';
import type { Landmark } from './native-clip-solver.ts';
import { solveNativeSeatSurface, type NativeSeatSurfacePass, type NativeSeatSurfaceProbe } from './native-seat-surface.ts';

export interface NativeSeatPoseAdapterResult {
  /** Last exact world-space pelvis anchor actually applied by the clip solver. */
  readonly hipWorld: Landmark;
  readonly seatTopWorld: Landmark;
  readonly floorY: number;
  /** The solver continues to label seat contact unverified; surface alignment is reported separately. */
  readonly supportStatus: 'seat-anchored-contact-unverified';
  readonly surfaceAligned: true;
  readonly residualY: number;
  readonly passes: readonly NativeSeatSurfacePass[];
  readonly applyResults: readonly NativeClipApplyResult[];
}

export class NativeSeatPoseError extends Error {
  readonly passes: readonly NativeSeatSurfacePass[];
  readonly applyResults: readonly NativeClipApplyResult[];
  constructor(message: string, passes: readonly NativeSeatSurfacePass[], applyResults: readonly NativeClipApplyResult[]) {
    super(message);
    this.name = 'NativeSeatPoseError';
    this.passes = passes;
    this.applyResults = applyResults;
  }
}

/**
 * Apply one exact source sit frame at a fixed world seat point, re-solving soles after every pelvis
 * correction. This is a bounded adapter over the existing clip solver and cached seat surface; it
 * never moves the actor root or changes the solver's seat-support classification. It is a pose
 * diagnostic until the host's real chair geometry and transition interval are independently tested.
 */
export function solveNativeSeatPose(options: Readonly<{
  frame: NativeSourceFrame;
  seatTopWorld: Landmark;
  floorY: number;
  solver: Pick<NativeClipSolver, 'applyFrame'>;
  surface: Pick<NativeSeatSurfaceProbe, 'sample'>;
}>): NativeSeatPoseAdapterResult {
  const { frame, seatTopWorld, floorY, solver, surface } = options;
  if (!frame || !Number.isFinite(frame.duration) || frame.duration <= 0 || !frame.clipName) {
    throw new TypeError('Native seat pose requires an exact valid source frame');
  }
  if (seatTopWorld.length !== 3 || ![...seatTopWorld, floorY].every(Number.isFinite)) {
    throw new TypeError('Native seat and floor coordinates must be finite world-space values');
  }
  const fixedSeatTop = Object.freeze([seatTopWorld[0], seatTopWorld[1], seatTopWorld[2]]) as Landmark;
  const applyResults: NativeClipApplyResult[] = [];
  const solved = solveNativeSeatSurface({
    seatTopY: fixedSeatTop[1],
    initialHipWorldY: fixedSeatTop[1],
    maximumPasses: 3,
    toleranceY: 0.001,
    applyAtHipWorldY(hipWorldY) {
      const result = solver.applyFrame(frame, {
        kind: 'seat-anchor',
        hipWorld: [fixedSeatTop[0], hipWorldY, fixedSeatTop[2]],
        floorY,
      });
      applyResults.push(result);
      return { supportStatus: result.supportStatus, feetStatus: result.seatFeetStatus ?? null };
    },
    sample: () => surface.sample(),
  });
  const finalApply = applyResults[applyResults.length - 1];
  if (!solved.converged || !finalApply || finalApply.supportStatus !== 'seat-anchored-contact-unverified'
    || finalApply.seatFeetStatus !== 'supported' || Math.abs(solved.residualY) > 0.001) {
    throw new NativeSeatPoseError(
      `Native seat pose rejected: converged=${solved.converged}, residual=${solved.residualY}, feet=${finalApply?.seatFeetStatus ?? 'missing'}`,
      solved.passes, applyResults);
  }
  return Object.freeze({
    hipWorld: Object.freeze([fixedSeatTop[0], solved.hipWorldY, fixedSeatTop[2]]) as Landmark,
    seatTopWorld: fixedSeatTop,
    floorY,
    supportStatus: 'seat-anchored-contact-unverified',
    surfaceAligned: true,
    residualY: solved.residualY,
    passes: solved.passes,
    applyResults: Object.freeze(applyResults),
  });
}
