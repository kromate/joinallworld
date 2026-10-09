import * as THREE from 'three';
import { createKit, type Kit } from '../../../src/scene/kit.ts';
import { buildHomeScene, type HomeScene } from '../../../src/scene/home-scene.ts';
import { advanceLife, createLife, dispatch, makeContext } from '../../../src/life.ts';
import type { ActionBody } from '../../../src/types/actions.ts';
import type { LifeState } from '../../../src/types/life.ts';

type StageName = 'standing' | 'bed-sleep' | 'bed-sleep-completed' | 'chair-rest' | 'chair-rest-completed'
  | 'tub-soak' | 'tub-soak-completed' | 'shower-bath' | 'shower-bath-completed' | 'male-casual-standing' | 'female-office-standing';
interface JourneySample {
  readonly name: StageName;
  readonly requestedPose: string;
  readonly actionId: string | null;
  readonly spot: string | null;
  readonly bodyShown: boolean;
  readonly actorMeshes: readonly string[];
  readonly boneCount: number;
  readonly bodyPoseSignature: string | null;
  readonly bodyPosition: [number, number, number] | null;
  readonly visibleFurniture: readonly { id: string; itemId: string; x: number; y: number; z: number }[];
  readonly render: { calls: number; triangles: number };
}
interface JourneySnapshot {
  ready: boolean;
  errors: string[];
  webgl2: boolean;
  room: { furnitureCount: number };
  life: { location: string; spot: string | null; cash: number; action: string | null };
  buys: Record<string, { ok: boolean; code: string; reason?: string }>;
  actions: Record<string, { started: string; completed: string | null; requestedPose: string; completedPose?: string }>;
  captureRequest: string | null;
  samples: Partial<Record<StageName, JourneySample>>;
  limitations: string[];
}

declare global {
  interface Window { nativeHomeJourney: ReturnType<typeof createJourney> }
}

const NOW = Date.UTC(2026, 9, 9, 11, 0);
const SEED = 'saved-home-journey-player-v1';
const SAVED_LOOKS = Object.freeze({
  maleCasual: Object.freeze({ body: 'man', hair: 'lowcut', outfit: 'casual', fabric: 'plain', skin: 'skin5', hairColor: 'darkbrown', outfitColor: 'navy', bottomsColor: 'blue', accessories: [], face: 'oval', expression: 'smile', appearance: { height: 'average', build: 'average', ageAppearance: 'adult' } }),
  femaleOffice: Object.freeze({ body: 'woman', hair: 'afro', outfit: 'office', fabric: 'plain', skin: 'skin-4', hairColor: 'dark-brown', outfitColor: 'blue', bottomsColor: 'navy', accessories: [], face: 'round', expression: 'neutral', appearance: { height: 'average', build: 'average', ageAppearance: 'adult' } }),
});

function required<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing fixture element ${selector}`);
  return node;
}

function createJourney() {
  const canvas = required<HTMLCanvasElement>('#home-stage');
  const status = required<HTMLElement>('#status');
  const audit = required<HTMLElement>('#audit');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const kit: Kit = createKit();
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
  const errors: string[] = [];
  const limitations: string[] = [
    'This is an isolated browser diagnostic, not production adoption or full lifecycle acceptance.',
    'The complete-look provider preflight and each furniture/contact pose are recorded separately; no unsupported pose is counted as passing.',
    'The final acceptance of authored body pixels and furniture contacts requires human review of the captured images and solver evidence.',
  ];
  const buys: JourneySnapshot['buys'] = {};
  const actions: JourneySnapshot['actions'] = {};
  const samples: JourneySnapshot['samples'] = {};
  let state: LifeState | null = null;
  let entry: HomeScene | null = null;
  let disposed = false;
  let ready = false;
  let resizeObserver: ResizeObserver | null = null;
  let captureRequest: string | null = null;
  let resolveCaptureRequest: (() => void) | null = null;

  const ctx = (now = state?.t ?? NOW, seed = SEED) => makeContext({ cityId: 'lagos', now, seed });
  function draw(): void {
    if (disposed || !entry) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    renderer.setSize(Math.round(rect.width), Math.round(rect.height), false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    entry.look(camera.position.x, camera.position.z);
    renderer.render(world, camera);
  }
  function sample(name: StageName, requestedPose: string): JourneySample {
    if (!entry || !state) throw new Error('Home scene is not ready');
    entry.group.updateWorldMatrix(true, true);
    const names = new Set<string>();
    let boneCount = 0;
    const skinnedActors: THREE.Object3D[] = [];
    entry.group.traverse((node) => {
      const mesh = node as THREE.SkinnedMesh;
      if (mesh.isMesh) names.add(mesh.name || '(unnamed)');
      if (mesh.isSkinnedMesh && mesh.skeleton) {
        boneCount = Math.max(boneCount, mesh.skeleton.bones.length);
        skinnedActors.push(mesh.parent ?? mesh);
      }
    });
    let signature: string | null = null;
    let position: [number, number, number] | null = null;
    const actor = skinnedActors[0];
    if (actor) {
      const sampled: number[] = [];
      actor.traverse((node) => {
        if (/mixamorig(Hips|Spine|LeftUpLeg|RightUpLeg|LeftFoot|RightFoot|Head)$/.test(node.name)) {
          sampled.push(node.position.x, node.position.y, node.position.z, node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w);
        }
      });
      signature = sampled.map((value) => Number(value.toFixed(5))).join(',');
      position = actor.getWorldPosition(new THREE.Vector3()).toArray() as [number, number, number];
    }
    const actionId = state.activeAction?.kind === 'activity' ? state.activeAction.id : null;
    const snapshot: JourneySample = {
      name, requestedPose, actionId, spot: state.spot, bodyShown: entry.bodyShown,
      actorMeshes: [...names].sort(), boneCount, bodyPoseSignature: signature, bodyPosition: position,
      visibleFurniture: entry.objects(), render: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
    };
    samples[name] = snapshot;
    return snapshot;
  }
  function setStatus(message: string): void {
    status.textContent = message;
    audit.textContent = JSON.stringify(window.nativeHomeJourney?.sample() ?? snapshot(), null, 2);
  }
  function snapshot(): JourneySnapshot {
    return {
      ready, errors: [...errors], webgl2: renderer.capabilities.isWebGL2,
      room: { furnitureCount: entry?.objects().length ?? 0 },
      life: { location: state?.location ?? 'unknown', spot: state?.spot ?? null, cash: state?.cash ?? 0,
        action: state?.activeAction?.kind === 'activity' ? state.activeAction.id : null },
      buys: { ...buys }, actions: { ...actions }, captureRequest, samples: { ...samples }, limitations: [...limitations],
    };
  }
  function act(type: string, payload: unknown = {}): { ok: boolean; code: string; reason?: string } {
    if (!state) throw new Error('Life is not initialized');
    const outcome = dispatch(state, { type, payload } as ActionBody, ctx());
    state = outcome.state;
    return { ok: outcome.ok, code: outcome.code, ...(outcome.reason ? { reason: outcome.reason } : {}) };
  }
  function updateScene(): void {
    if (!state || !entry) throw new Error('Home scene is not initialized');
    entry.update(state);
    draw();
  }
  async function requestCapture(name: string): Promise<void> {
    captureRequest = name;
    const request = new Promise<void>((resolve) => { resolveCaptureRequest = resolve; });
    let timeoutId = 0;
    const timeout = new Promise<void>((resolve) => { timeoutId = window.setTimeout(resolve, 7_500); });
    await Promise.race([request, timeout]);
    window.clearTimeout(timeoutId);
    if (captureRequest === name) errors.push(`Browser harness did not capture requested stage ${name}`);
    captureRequest = null;
    resolveCaptureRequest = null;
  }
  async function awaitBody(timeoutMs = 60_000): Promise<void> {
    const until = performance.now() + timeoutMs;
    while (performance.now() < until) {
      draw();
      if (entry?.bodyShown) {
        const probe = sample('standing', 'idle');
        if (probe.boneCount > 0) return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Home body did not load: ${JSON.stringify(entry ? sample('standing', 'idle') : null)}`);
  }
  async function captureAction(name: 'bed-sleep' | 'chair-rest' | 'tub-soak' | 'shower-bath', spot: string, actionId: string, seconds: number, requestedPose: string): Promise<void> {
    if (!state || !entry) throw new Error('Home scene is not ready');
    const selected = act('spot', { id: spot });
    if (!selected.ok) throw new Error(`Could not select ${spot}: ${selected.reason ?? selected.code}`);
    const started = act('activity', { id: actionId });
    if (!started.ok || started.code !== 'started') throw new Error(`Could not start ${actionId}: ${started.reason ?? started.code}`);
    actions[actionId] = { started: started.code, completed: null, requestedPose };
    updateScene();
    // The scene owns entry/exit animation time; keep this animation stepping bounded and separate from rule time.
    for (let frame = 0; frame < 18; frame += 1) {
      entry.stepCrowd(1 / 30);
      draw();
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    sample(name, requestedPose);
    await requestCapture(`${name}-active`);
    const completed = advanceLife(state, seconds, { cityId: 'lagos', now: state.t + seconds * 1000, seed: `${SEED}:${actionId}:finish` });
    if (!completed.ok) throw new Error(`Could not finish ${actionId}: ${completed.code}`);
    state = completed.state;
    actions[actionId] = { started: started.code, completed: completed.code, requestedPose, completedPose: 'standing' };
    updateScene();
    for (let frame = 0; frame < 30 && entry.easing; frame += 1) {
      entry.stepCrowd(1 / 30); draw();
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    entry.settleCrowd();
    draw();
    sample(`${name}-completed` as StageName, 'idle');
    await requestCapture(`${name}-completed`);
  }

  async function initialize(): Promise<void> {
    try {
      const load = await import('../../../src/game/cities/registry.ts');
      await load.loadCityContent('lagos');
      state = createLife({ location: 'home', spot: 'bedroom', name: 'Home journey', cash: 1_000_000,
        onboarding: { look: SAVED_LOOKS.maleCasual } }, ctx(NOW));
      entry = buildHomeScene(kit);
      entry.update(state);
      entry.setPlayer({ look: SAVED_LOOKS.maleCasual, seed: SEED, name: 'Player' });
      world.add(entry.group);
      const lighting = entry.lighting();
      world.add(new THREE.HemisphereLight(lighting.hemi[0], lighting.hemi[1], lighting.hemi[2]));
      const sun = new THREE.DirectionalLight(lighting.sun[0], lighting.sun[1]);
      sun.position.set(...lighting.sun[2]); world.add(sun);
      world.background = new THREE.Color(entry.background);

      for (const [item, x, y] of [['bathtub', 0, 4], ['shower-cubicle', 3, 5]] as const) {
        const result = act('home.furniture-buy', { item, x, y, rot: 0 });
        buys[item] = result;
        if (!result.ok || result.code !== 'bought') throw new Error(`Saved home could not buy ${item}: ${result.reason ?? result.code}`);
      }
      updateScene();
      const view = entry.camera.landscape;
      const centre = entry.walk.centre;
      camera.position.set(centre[0] + view[0], centre[1] + view[1], centre[2] + view[2]);
      camera.lookAt(centre[0], centre[1], centre[2]);
      draw(); // Triggers the scene-owned first-render body-loading gate.
      if (!renderer.capabilities.isWebGL2) throw new Error('Remote fixture renderer did not provide WebGL2');
      await awaitBody();
      ready = true;
      sample('male-casual-standing', 'idle');
      await requestCapture('male-casual-standing');
      setStatus('Saved male casual look loaded in the actual Yaba home scene.');
    } catch (error) {
      ready = false;
      errors.push(error instanceof Error ? error.message : String(error));
      setStatus(`Fixture failed: ${errors.at(-1)}`);
    }
  }

  async function runJourney(): Promise<JourneySnapshot> {
    if (!ready || !state || !entry) throw new Error('Journey is unavailable before the prepared home scene is ready');
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')];
    buttons.forEach((button) => { button.disabled = true; });
    try {
      await captureAction('bed-sleep', 'bedroom', 'home-sleep', 36, 'lie');
      await captureAction('chair-rest', 'living', 'home-sit-down', 8, 'sit');
      await captureAction('tub-soak', 'bathroom', 'home-long-soak', 12, 'soak');
      await captureAction('shower-bath', 'bathroom', 'bath', 6, 'wash');
      await returnStanding();
      entry.setPlayer({ look: SAVED_LOOKS.femaleOffice, seed: `${SEED}:female`, name: 'Player' });
      updateScene();
      await awaitBody();
      sample('female-office-standing', 'idle');
      await requestCapture('female-office-standing');
      setStatus('Finite home journey complete. Review the action samples and limitations.');
      return snapshot();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      setStatus(`Journey stopped at a real action/support limit: ${errors.at(-1)}`);
      return snapshot();
    } finally { buttons.forEach((button) => { button.disabled = false; }); }
  }
  async function returnStanding(): Promise<JourneySnapshot> {
    if (!state || !entry) throw new Error('Home scene is not initialized');
    if (state.activeAction) {
      const seconds = (state.activeAction as { remaining?: number }).remaining ?? 1;
      const outcome = advanceLife(state, seconds, { cityId: 'lagos', now: state.t + seconds * 1000, seed: `${SEED}:complete` });
      state = outcome.state;
    }
    updateScene();
    for (let frame = 0; frame < 60 && entry.easing; frame += 1) {
      entry.stepCrowd(1 / 30); draw();
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    entry.settleCrowd();
    entry.walk.pose('stand');
    draw();
    sample('standing', 'idle');
    setStatus('The same home actor returned to standing.');
    return snapshot();
  }
  async function swapLook(): Promise<JourneySnapshot> {
    if (!ready || !state || !entry) throw new Error('Home actor is not ready');
    const current = samples['female-office-standing'] ? 'maleCasual' : 'femaleOffice';
    const next = current === 'maleCasual' ? SAVED_LOOKS.femaleOffice : SAVED_LOOKS.maleCasual;
    const seed = current === 'maleCasual' ? `${SEED}:female` : SEED;
    entry.setPlayer({ look: next, seed, name: 'Player' });
    updateScene();
    await awaitBody();
    const label = current === 'maleCasual' ? 'female-office-standing' : 'standing';
    sample(label, 'idle');
    setStatus(`Same scene/player slot now uses the saved ${next.body} ${next.outfit} look.`);
    return snapshot();
  }

  resizeObserver = new ResizeObserver(draw);
  resizeObserver.observe(canvas);
  window.addEventListener('jaw:home-frame', draw);
  window.addEventListener('error', (event) => errors.push(event.message));
  void initialize();

  return {
    sample: snapshot,
    runJourney,
    returnStanding,
    swapLook,
    acknowledgeCapture(name: string) {
      if (name !== captureRequest || !resolveCaptureRequest) return false;
      resolveCaptureRequest();
      return true;
    },
    async renderForCapture() {
      draw();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      let canvasPng: string | null = null, canvasPngError: string | null = null;
      try { canvasPng = canvas.toDataURL('image/png').split(',')[1] ?? null; }
      catch (error) { canvasPngError = error instanceof Error ? error.message : String(error); }
      return { canvasPng, canvasPngError, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    },
    dispose() {
      if (disposed) return { disposed: true, repeated: false };
      disposed = true;
      resizeObserver?.disconnect(); resizeObserver = null;
      window.removeEventListener('jaw:home-frame', draw);
      entry?.dispose(); entry = null;
      kit.dispose();
      renderer.dispose();
      return { disposed: true, repeated: true };
    },
  };
}

window.nativeHomeJourney = createJourney();
