import * as THREE from 'three';
import { createKit } from '../../../../src/scene/kit.ts';
import type { Look } from '../../../../src/scene/avatar-look.ts';
import { prepareNativeSkinnedBody, NATIVE_PREPARED_POSE_COVERAGE } from './native-prepared-factory.ts';

type PreparedActor = Awaited<ReturnType<typeof prepareNativeSkinnedBody>>;
type ReviewActor = 'player' | 'npc';

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Prepared viewer HTML is missing ${selector}`);
  return element;
}

const canvas = requiredElement<HTMLCanvasElement>('#stage');
const statusNode = requiredElement<HTMLElement>('#status');
const resultNode = requiredElement<HTMLElement>('#metrics');
const eventsNode = requiredElement<HTMLElement>('#events');
const limitationsNode = requiredElement<HTMLElement>('#limitations');

const scene = new THREE.Scene();
scene.background = new THREE.Color('#d7e2e6');
scene.fog = new THREE.Fog('#d7e2e6', 8, 18);
const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 80);
camera.position.set(0, 1.65, 5.9);
camera.lookAt(0, 0.94, 0);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
scene.add(new THREE.HemisphereLight('#f5f4ea', '#837c71', 2.0));
const keyLight = new THREE.DirectionalLight('#fff2dc', 3.2);
keyLight.position.set(-3.5, 6.5, 4.0);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -4;
keyLight.shadow.camera.right = 4;
keyLight.shadow.camera.top = 5;
keyLight.shadow.camera.bottom = -3;
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight('#d5e6ff', 1.1);
fillLight.position.set(4, 3.5, -3);
scene.add(fillLight);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: '#dedbd3', roughness: 0.94 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.012;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(18, 36, '#aeb6b5', '#c4c8c5');
grid.position.y = -0.006;
scene.add(grid);
const marker = new THREE.Mesh(new THREE.CircleGeometry(0.63, 48), new THREE.MeshStandardMaterial({ color: '#c9c3b7', roughness: 0.98 }));
marker.rotation.x = -Math.PI / 2;
marker.position.set(0.78, 0.002, 0);
marker.receiveShadow = true;
scene.add(marker);

const playerLook: Look = {
  body: 'man', hair: 'lowcut', outfit: 'casual', fabric: 'plain', skin: 'skin5', hairColor: 'darkbrown',
  outfitColor: 'navy', bottomsColor: 'cream', accessories: [], face: 'oval', expression: 'neutral',
  appearance: { height: 'average', build: 'average', ageAppearance: 'adult' },
};
const npcLook: Look = {
  body: 'woman', hair: 'afro', outfit: 'office', fabric: 'plain', skin: 'skin2', hairColor: 'darkbrown',
  outfitColor: 'blue', bottomsColor: 'navy', accessories: [], face: 'oval', expression: 'neutral',
  appearance: { height: 'average', build: 'average', ageAppearance: 'adult' },
};
const seeds: Record<ReviewActor, string> = { player: 'prepared-player-v1', npc: 'prepared-npc-v1' };
const kit = createKit();
const actors = new Map<ReviewActor, PreparedActor>();
const errors: string[] = [];
const events: string[] = [];
let currentPlayerLook = playerLook;
let currentNpcLook = npcLook;
let playerWalking = true;
let expressionCycling = true;
let interactUntil = 0;
let expressionAt = 0;
let expressionIndex = 0;
let phase = 0;
let disposed = false;
let frameFault: string | null = null;
const contactDiagnostics: Record<ReviewActor, { samples: number; maxError: number; limitedSamples: number; lastError: number }> = {
  player: { samples: 0, maxError: 0, limitedSamples: 0, lastError: 0 },
  npc: { samples: 0, maxError: 0, limitedSamples: 0, lastError: 0 },
};
const observedContactLimits = new Set<string>();
const contactLimitEvents: { actor: ReviewActor; pose: string; maxError: number; limited: boolean }[] = [];

function addEvent(message: string, kind: 'info' | 'error' = 'info') {
  events.unshift(`${kind === 'error' ? 'ERROR ' : ''}${message}`);
  events.splice(8);
  eventsNode.textContent = events.join('\n');
  eventsNode.dataset.kind = kind;
}

function setStatus(message: string, kind: 'ready' | 'error' | 'loading' = 'ready') {
  statusNode.textContent = message;
  statusNode.dataset.state = kind;
}

function lookFor(actorKey: ReviewActor): Look { return actorKey === 'player' ? currentPlayerLook : currentNpcLook; }

function reportError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  errors.push(message);
  addEvent(message, 'error');
  setStatus(`Factory action failed: ${message}`, 'error');
  return message;
}

function setPose(actorKey: ReviewActor, pose: string) {
  const actor = actors.get(actorKey);
  if (!actor) throw new Error(`${actorKey} is not prepared yet`);
  if (!(NATIVE_PREPARED_POSE_COVERAGE as readonly string[]).includes(pose)) {
    throw new Error(`Unsupported pose ${pose}; factory coverage is ${NATIVE_PREPARED_POSE_COVERAGE.join(', ')}`);
  }
  try {
    actor.show(pose as Parameters<PreparedActor['show']>[0], true);
    addEvent(`${actorKey} sampled ${pose}`);
    return { accepted: true, pose, error: null };
  } catch (error) {
    return { accepted: false, pose, error: reportError(error) };
  }
}

function changeNpcIdentityAndPalette() {
  const npc = actors.get('npc');
  if (!npc) throw new Error('NPC is not prepared yet');
  const changed: Look = {
    ...currentNpcLook,
    face: currentNpcLook.face === 'oval' ? 'round' : 'oval',
    skin: currentNpcLook.skin === 'skin2' ? 'skin3' : 'skin2',
    outfitColor: currentNpcLook.outfitColor === 'blue' ? 'red' : 'blue',
    bottomsColor: currentNpcLook.bottomsColor === 'navy' ? 'cream' : 'navy',
    hairColor: currentNpcLook.hairColor === 'darkbrown' ? 'black' : 'darkbrown',
    expression: 'smile',
  };
  try {
    const accepted = npc.wear(changed, seeds.npc);
    if (!accepted) throw new Error('Same-family NPC face/color update was rejected without changing the actor');
    currentNpcLook = changed;
    addEvent(`NPC same-family identity/color update: face=${changed.face}, skin=${changed.skin}, top=${changed.outfitColor}, trousers=${changed.bottomsColor}`);
    setStatus('NPC appearance updated within the same prepared family');
    return { accepted: true, body: 'woman', face: changed.face, skin: changed.skin, outfitColor: changed.outfitColor, bottomsColor: changed.bottomsColor };
  } catch (error) {
    return { accepted: false, error: reportError(error) };
  }
}

function interact() {
  const player = actors.get('player');
  const npc = actors.get('npc');
  if (!player || !npc) throw new Error('Actors are not prepared yet');
  try {
    playerWalking = false;
    player.show('interact', true);
    npc.show('interact', true);
    currentNpcLook = { ...currentNpcLook, expression: 'grin' };
    if (!npc.wear(currentNpcLook, seeds.npc)) throw new Error('NPC rejected same-family interaction expression');
    interactUntil = performance.now() + 2800;
    addEvent('Player and NPC sampled their interaction animations; no prop contact is asserted');
    setStatus('Interaction animation sampled on both prepared actors');
    return { accepted: true, playerPose: player.pose, npcPose: npc.pose, expression: currentNpcLook.expression };
  } catch (error) {
    return { accepted: false, error: reportError(error) };
  }
}

function toggleWalking() {
  playerWalking = !playerWalking;
  const player = actors.get('player');
  if (player) player.show(playerWalking ? 'walk' : 'idle', true);
  addEvent(`Player ${playerWalking ? 'walk cycle started' : 'idle cycle started'}`);
  return { playerWalking };
}

function toggleExpressionCycle() {
  expressionCycling = !expressionCycling;
  expressionAt = performance.now();
  addEvent(`NPC expression animation ${expressionCycling ? 'enabled' : 'paused'}`);
  return { expressionCycling };
}

function probeUnsupportedPose() {
  const npc = actors.get('npc');
  if (!npc) return { accepted: false, error: reportError('NPC is not prepared yet') };
  let result: Record<string, unknown>;
  try {
    const poseResult = setPose('npc', 'lie');
    const support = npc.solveFeet(() => 0);
    result = { ...poseResult, contact: support, declaredLimitations: npc.preparedMetrics.contactLimitations };
    if (support.limited || support.maxError > 0.004) addEvent(`Lie pose contact is limited: ${support.maxError.toFixed(3)} m residual`);
    else addEvent('Lie clip sampled; contact is only a feet-on-floor diagnostic');
  } catch (error) {
    result = { accepted: false, error: reportError(error), declaredLimitations: npc.preparedMetrics.contactLimitations };
  } finally {
    try {
      npc.show('idle', false);
      npc.solveFeet(() => 0);
      interactUntil = 0;
      addEvent('NPC restored to idle after lie/contact probe');
    } catch (error) {
      reportError(`Failed to restore NPC idle after lie/contact probe: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

function sample() {
  const describe = (key: ReviewActor) => {
    const actor = actors.get(key);
    if (!actor) return null;
    const body = actor.object.getObjectByName('Body') as THREE.SkinnedMesh | null;
    const contacts = actor.sampleFootContacts();
    const bounds = new THREE.Box3().setFromObject(actor.object);
    return {
      family: actor.preparedMetrics.bodyKey,
      pose: actor.pose,
      standingHeightMetres: actor.preparedMetrics.standingHeightMetres,
      preparedMetrics: actor.preparedMetrics,
      wardrobe: actor.wardrobe,
      wardrobeError: actor.wardrobeError,
      footContacts: contacts.map(({ side, x, y, z, points }) => ({ side, x, y, z, pointCount: points?.length ?? 0 })),
      contactDiagnostics: { ...contactDiagnostics[key] },
      worldBounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
      bodyMorphs: body?.morphTargetDictionary ? Object.fromEntries(Object.entries(body.morphTargetDictionary).map(([name, index]) => [name, body.morphTargetInfluences?.[index] ?? 0]).filter(([name]) => String(name).startsWith('nativeFacial'))) : {},
      position: actor.object.position.toArray(),
      look: lookFor(key),
    };
  };
  return {
    state: actors.size === 2 ? 'ready' : 'loading',
    actors: { player: describe('player'), npc: describe('npc') },
    poseCoverage: NATIVE_PREPARED_POSE_COVERAGE,
    contactLimitEvents: contactLimitEvents.map((event) => ({ ...event })),
    errors: [...errors],
    events: [...events],
  };
}

const reviewApi = {
  readyState: 'loading',
  ready: Promise.resolve(null as unknown),
  setPose,
  interact,
  toggleWalking,
  toggleExpressionCycle,
  changeNpcIdentityAndPalette,
  probeUnsupportedPose,
  sample,
};
(window as Window & { nativePreparedReview?: typeof reviewApi }).nativePreparedReview = reviewApi;

async function prepareActors() {
  try {
    const player = await prepareNativeSkinnedBody({ kit, seed: seeds.player, look: playerLook, sceneScale: 1 });
    actors.set('player', player);
    player.object.name = 'Prepared male player';
    player.place(-0.78, 0, 0, 0);
    player.object.traverse((node) => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
    scene.add(player.object);

    const npc = await prepareNativeSkinnedBody({ kit, seed: seeds.npc, look: npcLook, sceneScale: 1 });
    actors.set('npc', npc);
    npc.object.name = 'Prepared female NPC';
    npc.place(0.78, 0, 0, 0);
    npc.object.traverse((node) => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
    scene.add(npc.object);
    player.show('walk', false);
    npc.show('idle', false);
    limitationsNode.textContent = [
      ...new Set([...player.preparedMetrics.contactLimitations, ...npc.preparedMetrics.contactLimitations]),
      ...player.preparedMetrics.wardrobeWarnings.map((warning) => `Player wardrobe: ${warning}`),
      ...npc.preparedMetrics.wardrobeWarnings.map((warning) => `NPC wardrobe: ${warning}`),
    ].join('\n');
    reviewApi.readyState = 'ready';
    setStatus('Both prepared actors loaded from one shared Kit');
    addEvent('Male player: casual outfit, low cut hair, walk cycle. Female NPC: office outfit, afro, idle cycle.');
    resultNode.textContent = JSON.stringify(sample(), null, 2);
    return sample();
  } catch (error) {
    reviewApi.readyState = 'failed';
    const message = reportError(error);
    throw new Error(`Prepared actor setup failed: ${message}`);
  }
}
reviewApi.ready = prepareActors();

function sizeRenderer() {
  const rect = canvas!.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(sizeRenderer).observe(canvas);
sizeRenderer();

function onClick(id: string, action: () => unknown) {
  document.querySelector<HTMLButtonElement>(`#${id}`)?.addEventListener('click', () => {
    try {
      frameFault = null;
      const result = action();
      resultNode.textContent = JSON.stringify({ lastAction: id, result, sample: sample() }, null, 2);
    } catch (error) {
      resultNode.textContent = JSON.stringify({ lastAction: id, error: reportError(error), sample: sample() }, null, 2);
    }
  });
}
onClick('walk-toggle', toggleWalking);
onClick('interact', interact);
onClick('npc-change', changeNpcIdentityAndPalette);
onClick('expression-toggle', toggleExpressionCycle);
onClick('lie-probe', probeUnsupportedPose);
onClick('sample-now', () => sample());

let previousTime = performance.now();
function frame(now: number) {
  if (disposed) return;
  const dt = Math.min(0.05, Math.max(0, (now - previousTime) / 1000));
  previousTime = now;
  if (!frameFault) {
    try {
      const player = actors.get('player');
      const npc = actors.get('npc');
      if (player && npc) {
        phase = (phase + dt * 0.56) % 1;
        if (now > interactUntil && expressionCycling && now >= expressionAt) {
          expressionAt = now + 2800;
          const cycle = ['neutral', 'smile', 'grin'] as const;
          const expression = cycle[expressionIndex++ % cycle.length]!;
          const next = { ...currentNpcLook, expression };
          const accepted = npc.wear(next, seeds.npc);
          if (!accepted) throw new Error(`Expression cycle rejected NPC ${expression} update`);
          currentNpcLook = next;
        }
        if (playerWalking && now > interactUntil) {
          player.stride(phase * Math.PI * 2, false);
          player.place(-0.78 + Math.sin(phase * Math.PI * 2) * 0.18, 0, 0, 0);
        }
        player.step(dt);
        npc.step(dt);
        for (const [key, actor] of [['player', player], ['npc', npc]] as const) {
          const solved = actor.solveFeet(() => 0);
          const diagnostic = contactDiagnostics[key];
          diagnostic.samples++;
          diagnostic.lastError = solved.maxError;
          diagnostic.maxError = Math.max(diagnostic.maxError, solved.maxError);
          if (solved.limited || solved.maxError > 0.004) {
            diagnostic.limitedSamples++;
            const signature = `${key}:${solved.limited}:${solved.maxError.toFixed(4)}`;
            if (!observedContactLimits.has(signature)) {
              observedContactLimits.add(signature);
              if (contactLimitEvents.length < 64) contactLimitEvents.push({ actor: key, pose: actor.pose, maxError: solved.maxError, limited: solved.limited });
              addEvent(`${actor.preparedMetrics.bodyKey} contact limited; pose=${actor.pose}; maxError=${solved.maxError.toFixed(4)} m; limited=${solved.limited}`, 'error');
            }
          }
          actor.object.updateMatrixWorld(true);
        }
        if (now % 800 < dt * 1000) resultNode.textContent = JSON.stringify(sample(), null, 2);
      }
    } catch (error) {
      frameFault = reportError(error);
    }
  }
  try { renderer.render(scene, camera); }
  catch (error) { reportError(error); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('beforeunload', () => {
  if (disposed) return;
  disposed = true;
  for (const actor of actors.values()) {
    actor.object.parent?.remove(actor.object);
    actor.dispose();
  }
  kit.dispose();
  for (const object of [ground, grid, marker]) {
    scene.remove(object);
    object.geometry.dispose();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
    else object.material.dispose();
  }
  renderer.dispose();
});
