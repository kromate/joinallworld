import { createKit } from '../../../src/scene/kit.ts';
import type { SkinnedBody } from '../../../src/scene/body/skinned.ts';
import { completeCharacterKit } from '../../../src/scene/body/native/assets.ts';
import { createNativeSourceLandmarkSampler, type NativeWristSourceFrame } from '../../../src/scene/body/native/native-source-sampler.ts';
import { prepareNativeSkinnedBody, type NativeIdleDiagnosticSample } from '../../../src/scene/body/native/native-full-runtime-v1/native-prepared-factory.ts';
import { GAME_PLAYER_LOOK, GAME_PLAYER_SEED } from './idle-pose-input.ts';

interface SourceIdleSample {
  seconds: number;
  duration: number;
  axes: Record<'left' | 'right', { thighToCalf: number[]; calfToFoot: number[]; footToToe: number[] }>;
}
interface ModeSample {
  retargetMode: 'directions' | 'landmarks';
  poseAfterShow: string;
  hostSolve: unknown;
  stages: NativeIdleDiagnosticSample[];
  effects: { internalContactSolveAxisDelta: Record<string, number>; internalContactSolveMaxSolePointShift: Record<string, number>;
    hostContactSolveAxisDelta: Record<string, number>; hostContactSolveMaxSolePointShift: Record<string, number>;
    sourceIdleZeroToRetargetAxisDelta: Record<string, number> };
  finalContacts: unknown;
  lastDirectionContactSolve: unknown;
  preparedMetrics: unknown;
  error?: string;
}
interface IdleReport {
  status: 'loading' | 'ready' | 'failed';
  errors: string[];
  source: { clip: string; atZero: SourceIdleSample | null; midpoint: SourceIdleSample | null; axisChange: Record<string, number> | null };
  modes: Partial<Record<'directions' | 'landmarks', ModeSample>>;
  checks: Record<string, boolean>;
}
declare global { interface Window { nativeIdleDiagnostic: { sample(): IdleReport } } }

function vector(a: readonly number[], b: readonly number[]): number[] {
  const value = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
  const length = Math.hypot(...value) || 1;
  return value.map((item) => item / length);
}
function sourceSample(frame: NativeWristSourceFrame, seconds: number): SourceIdleSample {
  const points = frame.landmarks;
  const leg = (side: 'Left' | 'Right') => {
    const thigh = points[`${side}UpLeg`], calf = points[`${side}Leg`], foot = points[`${side}Foot`], toe = points[`${side}ToeBase`];
    return { thighToCalf: vector(thigh, calf), calfToFoot: vector(calf, foot), footToToe: vector(foot, toe) };
  };
  const left = leg('Left'), right = leg('Right');
  return { seconds, duration: frame.duration,
    axes: { left: { thighToCalf: left.thighToCalf, calfToFoot: left.calfToFoot, footToToe: left.footToToe },
      right: { thighToCalf: right.thighToCalf, calfToFoot: right.calfToFoot, footToToe: right.footToToe } } };
}
function axisChange(a: SourceIdleSample, b: SourceIdleSample): Record<string, number> {
  const result: Record<string, number> = {};
  for (const side of ['left', 'right'] as const) for (const axis of ['thighToCalf', 'calfToFoot', 'footToToe'] as const) {
    const first = a.axes[side][axis], second = b.axes[side][axis];
    result[`${side}.${axis}`] = Math.hypot(first[0]! - second[0]!, first[1]! - second[1]!, first[2]! - second[2]!);
  }
  return result;
}
function measuredEffects(stages: readonly NativeIdleDiagnosticSample[], source: SourceIdleSample): ModeSample['effects'] {
  const at = (name: NativeIdleDiagnosticSample['stage']) => stages.find((sample) => sample.stage === name);
  const axisDelta = (a: NativeIdleDiagnosticSample | undefined, b: NativeIdleDiagnosticSample | undefined) => {
    const result: Record<string, number> = {};
    if (!a || !b) return result;
    for (const side of ['left', 'right'] as const) for (const axis of ['thighToCalf', 'calfToFoot', 'footToToe'] as const) {
      const first = a.legs[side][axis], second = b.legs[side][axis];
      result[`${side}.${axis}`] = Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
    }
    return result;
  };
  const soleShift = (a: NativeIdleDiagnosticSample | undefined, b: NativeIdleDiagnosticSample | undefined) => {
    const result: Record<string, number> = {};
    if (!a || !b) return result;
    for (const side of ['left', 'right'] as const) {
      const first = a.shoeContacts.find((contact) => contact.side === side)?.points ?? [];
      const second = b.shoeContacts.find((contact) => contact.side === side)?.points ?? [];
      const count = Math.min(first.length, second.length);
      result[side] = count ? Math.max(...Array.from({ length: count }, (_, i) => Math.hypot(
        first[i]!.x - second[i]!.x, first[i]!.y - second[i]!.y, first[i]!.z - second[i]!.z))) : Number.NaN;
    }
    return result;
  };
  const beforeInternal = at('before-internal-foot-solve'), afterInternal = at('after-internal-foot-solve');
  const beforeHost = at('before-host-foot-solve'), afterHost = at('after-host-foot-solve');
  const sourceDelta: Record<string, number> = {};
  if (beforeInternal) for (const side of ['left', 'right'] as const) for (const axis of ['thighToCalf', 'calfToFoot', 'footToToe'] as const) {
    const target = beforeInternal.legs[side][axis], reference = source.axes[side][axis];
    sourceDelta[`${side}.${axis}`] = Math.hypot(target[0] - reference[0]!, target[1] - reference[1]!, target[2] - reference[2]!);
  }
  return { internalContactSolveAxisDelta: axisDelta(beforeInternal, afterInternal),
    internalContactSolveMaxSolePointShift: soleShift(beforeInternal, afterInternal),
    hostContactSolveAxisDelta: axisDelta(beforeHost, afterHost), hostContactSolveMaxSolePointShift: soleShift(beforeHost, afterHost),
    sourceIdleZeroToRetargetAxisDelta: sourceDelta };
}
function required<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing diagnostic element #${id}`);
  return node as T;
}

const report: IdleReport = { status: 'loading', errors: [], source: { clip: 'idle', atZero: null, midpoint: null, axisChange: null }, modes: {}, checks: {} };
const reportNode = required<HTMLElement>('report');
function publish(): void { reportNode.textContent = JSON.stringify(report, null, 2); }

async function run(): Promise<void> {
  const kit = createKit();
  let sourceSampler: ReturnType<typeof createNativeSourceLandmarkSampler> | null = null;
  const bodies: SkinnedBody[] = [];
  try {
    const authoredAssets = completeCharacterKit(kit).authoredCharacterAssets;
    const motion = await authoredAssets.loadMotionRig();
    sourceSampler = createNativeSourceLandmarkSampler(motion.root.clone(true), motion.clips);
    const duration = sourceSampler.durations.get('idle');
    if (!duration || !Number.isFinite(duration)) throw new Error('Pinned source clip pack has no measurable idle clip');
    const sourceAtZero = sourceSample(sourceSampler.sampleClip('idle', 0, 'clamp'), 0);
    const sourceMidpoint = sourceSample(sourceSampler.sampleClip('idle', duration / 2, 'clamp'), duration / 2);
    report.source.atZero = sourceAtZero;
    report.source.midpoint = sourceMidpoint;
    report.source.axisChange = axisChange(sourceAtZero, sourceMidpoint);

    for (const retargetMode of ['directions', 'landmarks'] as const) {
      const stages: NativeIdleDiagnosticSample[] = [];
      const body = await prepareNativeSkinnedBody({ kit, look: GAME_PLAYER_LOOK, seed: GAME_PLAYER_SEED, sceneScale: 1,
        retargetMode, onIdleDiagnosticStage: (sample) => stages.push(sample) });
      bodies.push(body);
      stages.length = 0;
      let poseAfterShow = 'unobserved', hostSolve: unknown = null, finalContacts: unknown = null, error: string | undefined;
      try {
        body.show('idle', false);
        poseAfterShow = body.pose;
        hostSolve = body.solveFeet(() => 0);
        finalContacts = body.sampleFootContacts();
      } catch (cause) {
        error = cause instanceof Error ? cause.stack ?? cause.message : String(cause);
        report.errors.push(`${retargetMode}: ${error}`);
        try { finalContacts = body.sampleFootContacts(); } catch { /* preserve the stage samples collected before the failure */ }
      }
      report.modes[retargetMode] = { retargetMode, poseAfterShow, hostSolve, stages: [...stages],
        effects: measuredEffects(stages, sourceAtZero),
        finalContacts, lastDirectionContactSolve: body.lastDirectionContactSolve,
        preparedMetrics: body.preparedMetrics, ...(error ? { error } : {}) };
      body.dispose();
      bodies.pop();
    }
    const completeStages = (mode: ModeSample | undefined) => ['before-internal-foot-solve', 'after-internal-foot-solve',
      'before-host-foot-solve', 'after-host-foot-solve'].every((stage) => mode?.stages.some((item) => item.stage === stage));
    report.checks = {
      exactSavedGameLookAndSeedUsed: GAME_PLAYER_LOOK.body === 'man' && GAME_PLAYER_LOOK.outfit === 'casual'
        && GAME_PLAYER_LOOK.hair === 'lowcut' && GAME_PLAYER_SEED.length > 0,
      sourceIdleSamplesAtZeroAndMidpoint: report.source.atZero !== null && report.source.midpoint !== null,
      directionIdlePoseAndSolveStages: report.modes.directions?.poseAfterShow === 'idle' && completeStages(report.modes.directions),
      landmarkIdlePoseAndSolveStages: report.modes.landmarks?.poseAfterShow === 'idle' && completeStages(report.modes.landmarks),
      bothLegsAndSolesSampledAtEveryStage: (['directions', 'landmarks'] as const).every((name) => report.modes[name]?.stages.every((stage) =>
        Boolean(stage.legs.left && stage.legs.right && stage.shoeContacts.some((contact) => contact.side === 'left')
          && stage.shoeContacts.some((contact) => contact.side === 'right'))),
      finiteStageMeasurements: (['directions', 'landmarks'] as const).every((name) => report.modes[name]?.stages.every((stage) =>
        [...Object.values(stage.legs).flatMap((leg) => [...leg.thighToCalf, ...leg.calfToFoot, ...leg.footToToe]),
          ...stage.shoeContacts.flatMap((contact) => [contact.x, contact.y, contact.z,
            ...contact.points.flatMap((point) => [point.x, point.y, point.z])]),
          ...(stage.solve ? [stage.solve.maxError, stage.solve.corrected] : [])].every(Number.isFinite))),
    };
    report.status = Object.values(report.checks).every(Boolean) && report.errors.length === 0 ? 'ready' : 'failed';
  } catch (error) {
    report.status = 'failed';
    report.errors.push(error instanceof Error ? error.stack ?? error.message : String(error));
  } finally {
    if (report.status === 'loading') report.status = 'failed';
    bodies.forEach((body) => body.dispose());
    sourceSampler?.dispose();
    kit.dispose();
    publish();
  }
}

void run();
window.nativeIdleDiagnostic = { sample: () => ({ ...report, errors: [...report.errors], modes: { ...report.modes }, checks: { ...report.checks } }) };
