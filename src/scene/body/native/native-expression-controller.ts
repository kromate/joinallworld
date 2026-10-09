import * as THREE from 'three';

const JAW_MESHES = ['Body', 'Teeth', 'Tongue'] as const;
const JAW_MORPH = 'nativeFacialJawOpen';
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
  let active = false;
  let elapsedSeconds = 0;
  let disposed = false;

  function jawAt(seconds: number): number {
    return 0.12 + 0.28 * (0.5 + 0.5 * Math.sin(seconds * Math.PI * 4));
  }

  function writeJaw(value: number): void {
    for (const { mesh, morphIndex } of meshes.values()) mesh.morphTargetInfluences![morphIndex] = value;
  }

  function restore(): void {
    if (!baseline) return;
    for (const [name, value] of baseline) {
      const entry = meshes.get(name)!;
      entry.mesh.morphTargetInfluences![entry.morphIndex] = value;
    }
    baseline = null;
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
      elapsedSeconds = 0;
      writeJaw(jawAt(elapsedSeconds));
    },
    step(deltaSeconds) {
      if (disposed || !active) return;
      const delta = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(MAX_STEP_SECONDS, deltaSeconds)) : 0;
      elapsedSeconds += delta;
      writeJaw(jawAt(elapsedSeconds));
    },
    stop: stopTalk,
    snapshot() {
      const jaw = Object.fromEntries(JAW_MESHES.map((name) => {
        const entry = meshes.get(name)!;
        return [name, entry.mesh.morphTargetInfluences![entry.morphIndex]!];
      })) as Record<(typeof JAW_MESHES)[number], number>;
      return Object.freeze({ active, elapsedSeconds, jaw: Object.freeze(jaw),
        synchronized: JAW_MESHES.every((name) => Math.abs(jaw[name] - jaw.Body) < 1e-6) });
    },
    dispose() {
      if (disposed) return;
      stopTalk();
      disposed = true;
    },
  };
}
