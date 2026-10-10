import * as THREE from 'three';

const JAW_MESHES = ['Body', 'Teeth', 'Tongue'] as const;
const JAW_MORPH = 'nativeFacialJawOpen';
const BLINK_MORPHS = ['nativeFacialBlinkLeft', 'nativeFacialBlinkRight'] as const;
const MAX_STEP_SECONDS = 1 / 30;

type JawMesh = THREE.Mesh & {
  morphTargetDictionary?: Record<string, number>;
  morphTargetInfluences?: number[];
};

export interface NativeExpressionSnapshot {
  readonly active: boolean;
  readonly elapsedSeconds: number;
  readonly jaw: Readonly<Record<(typeof JAW_MESHES)[number], number>>;
  readonly synchronized: boolean;
  readonly blink: readonly [number, number];
}

export interface NativeExpressionController {
  startTalk(): void;
  /** Host-driven sample; input is clamped to 1/30 second. This controller never owns a timer or RAF. */
  step(deltaSeconds: number): void;
  stop(): void;
  snapshot(): NativeExpressionSnapshot;
  dispose(): void;
}

/**
 * Bounded, actor-local mouth motion for the existing authored jaw morph. The rig's prepared
 * expression bridge is private to the factory, so this adapter writes only the matching Body,
 * Teeth and Tongue jaw weights and restores their exact pre-talk values afterward.
 */
export function createNativeExpressionController(root: THREE.Object3D): NativeExpressionController {
  const meshes = new Map<(typeof JAW_MESHES)[number], { mesh: JawMesh; morphIndex: number }>();
  for (const name of JAW_MESHES) {
    const node = root.getObjectByName(name) as JawMesh | null;
    if (!node?.isMesh) throw new Error(`Native talk controller requires actor mesh ${name}`);
    const morphIndex = node.morphTargetDictionary?.[JAW_MORPH];
    if (!Number.isInteger(morphIndex) || morphIndex! < 0 || !node.morphTargetInfluences || morphIndex! >= node.morphTargetInfluences.length) {
      throw new Error(`${name} is missing ${JAW_MORPH}`);
    }
    meshes.set(name, { mesh: node, morphIndex: morphIndex! });
  }

  let baseline: Map<(typeof JAW_MESHES)[number], number> | null = null;
  const body = meshes.get('Body');
  if (!body) throw new Error('Native talk controller requires Body');
  const blinkIndices = BLINK_MORPHS.map((name) => {
    const index = body.mesh.morphTargetDictionary?.[name];
    if (index === undefined || !Number.isInteger(index) || index < 0
      || !body.mesh.morphTargetInfluences || index >= body.mesh.morphTargetInfluences.length) {
      throw new Error(`Body is missing ${name}`);
    }
    return index;
  });
  let blinkBaseline: number[] | null = null;
  let active = false;
  let elapsedSeconds = 0;
  let disposed = false;

  function jawAt(seconds: number): number {
    return 0.12 + 0.28 * (0.5 + 0.5 * Math.sin(seconds * Math.PI * 4));
  }

  function writeJaw(value: number): void {
    for (const { mesh, morphIndex } of meshes.values()) mesh.morphTargetInfluences![morphIndex] = value;
  }

  function writeBlink(seconds: number): void {
    if (!blinkBaseline || !body?.mesh.morphTargetInfluences) return;
    // A brief closure on the existing active conversation clock, then exact restoration.
    const phase = (seconds + 2.4) % 3.2;
    const pulse = Math.max(0, 1 - Math.abs(phase - 3.2 + 0.08) / 0.08);
    blinkIndices.forEach((index, side) => {
      const saved = blinkBaseline?.[side];
      if (saved === undefined || !body.mesh.morphTargetInfluences) throw new Error('Missing captured native blink weight');
      body.mesh.morphTargetInfluences[index] = saved + (1 - saved) * pulse;
    });
  }

  function restore(): void {
    if (!baseline) return;
    for (const [name, value] of baseline) {
      const entry = meshes.get(name)!;
      entry.mesh.morphTargetInfluences![entry.morphIndex] = value;
    }
    baseline = null;
    if (blinkBaseline && body?.mesh.morphTargetInfluences) {
      blinkIndices.forEach((index, side) => {
        const saved = blinkBaseline?.[side];
        if (saved !== undefined && body.mesh.morphTargetInfluences) body.mesh.morphTargetInfluences[index] = saved;
      });
    }
    blinkBaseline = null;
  }

  function stopTalk(): void {
    if (!active) return;
    restore();
    active = false;
    elapsedSeconds = 0;
  }

  return {
    startTalk() {
      if (disposed) throw new Error('Native talk controller is disposed');
      if (!active) baseline = new Map(JAW_MESHES.map((name) => {
        const entry = meshes.get(name)!;
        return [name, entry.mesh.morphTargetInfluences![entry.morphIndex]!];
      }));
      active = true;
      if (!blinkBaseline) blinkBaseline = blinkIndices.map((index) => body.mesh.morphTargetInfluences?.[index] ?? 0);
      elapsedSeconds = 0;
      writeJaw(jawAt(elapsedSeconds));
      writeBlink(elapsedSeconds);
    },
    step(deltaSeconds) {
      if (disposed || !active) return;
      const delta = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(MAX_STEP_SECONDS, deltaSeconds)) : 0;
      elapsedSeconds += delta;
      writeJaw(jawAt(elapsedSeconds));
      writeBlink(elapsedSeconds);
    },
    stop: stopTalk,
    snapshot() {
      const jaw = Object.fromEntries(JAW_MESHES.map((name) => {
        const entry = meshes.get(name)!;
        return [name, entry.mesh.morphTargetInfluences![entry.morphIndex]!];
      })) as Record<(typeof JAW_MESHES)[number], number>;
      return Object.freeze({ active, elapsedSeconds, jaw: Object.freeze(jaw),
        blink: Object.freeze([body.mesh.morphTargetInfluences?.[blinkIndices[0]!] ?? 0,
          body.mesh.morphTargetInfluences?.[blinkIndices[1]!] ?? 0] as const),
        synchronized: JAW_MESHES.every((name) => Math.abs(jaw[name] - jaw.Body) < 1e-6) });
    },
    dispose() {
      if (disposed) return;
      stopTalk();
      disposed = true;
    },
  };
}
