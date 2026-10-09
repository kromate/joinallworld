import * as THREE from 'three';
import { createKit, type Kit } from '../../../src/scene/kit.ts';
import { buildVenueScene } from '../../../src/scene/venue-scenes.ts';
import type { SceneEntry, SceneVenue } from '../../../src/scene/types.ts';
import { createStandIn } from '../../../src/scene/body/stand-in.ts';
import type { StandIn, StandInScene } from '../../../src/scene/body/stand-in.ts';
import type { BodyPose, SkinnedBody } from '../../../src/scene/body/skinned.ts';
import { loadGameBody, NATIVE_GAME_BODY_CAPABILITIES } from '../../../src/scene/body/provider.ts';
import { crowdList } from '../../../src/scene/crowd.ts';
import { advanceLife, createLife, dispatch, viewLife } from '../../../src/life.ts';
import { loadCityContent } from '../../../src/game/cities/registry.ts';
import { loadCityScenes } from '../../../src/scene/city-scenes.ts';

interface ActorAudit {
  readonly requestedLook: unknown;
  readonly seed: string;
  readonly context: { readonly scene: 'venue'; readonly poses: readonly BodyPose[] };
  body: SkinnedBody;
  lastSolve: ReturnType<SkinnedBody['solveFeet']> | null;
  contacts: number;
}
interface FixtureSnapshot {
  readyState: 'loading' | 'ready' | 'failed';
  errors: string[];
  stage: string;
  life: { location: string; now: number };
  crowd: { desired: number; canonical: number; procedural: number; loading: number };
  player: Record<string, unknown>;
  npcs: Record<string, Record<string, unknown>>;
  unsupportedProbe: Record<string, unknown> | null;
  interaction: Record<string, unknown> | null;
  currentCamera: string;
  cameraActorFrame: CameraActorFrame | null;
  viewport: { width: number; height: number; scrollWidth: number; layoutColumns: number; mobileBreakpoint: boolean };
}
interface CameraActorFrame {
  actorOrigin: [number, number, number];
  headPosition: [number, number, number] | null;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  cameraPosition: [number, number, number];
  ndc: { minX: number; maxX: number; minY: number; maxY: number };
  allCornersInFrustum: boolean;
  wholeActorVisible: boolean;
  cameraAxisDot: number;
  selectedCameraSide: 'face-candidate' | 'back-control' | 'profile-control';
  visibilityRay: { clearLine: boolean; firstActorHit: { name: string; distance: number } | null;
    nearestOccluder: { name: string; distance: number } | null };
}

declare global {
  interface Window { nativeGameFixture: ReturnType<typeof createFixture> }
}

const NOW = Date.UTC(2026, 9, 9, 10, 30);
const PLAYER_SEED = 'creator-fixture-same-seed-v1';
const PLAYER_LOOK = Object.freeze({
  body: 'man', hair: 'lowcut', outfit: 'casual', fabric: 'plain', skin: 'skin5', hairColor: 'darkbrown',
  outfitColor: 'navy', bottomsColor: 'blue', accessories: [], face: 'oval', expression: 'smile',
  appearance: { height: 'average', build: 'average', ageAppearance: 'adult' },
});
const PLAYER_POSES: readonly BodyPose[] = Object.freeze(['idle', 'walk', 'interact', 'cook', 'eat', 'drink']);
const NPC_POSES: readonly BodyPose[] = Object.freeze(['idle', 'walk', 'interact']);

function required<T extends Element>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing fixture element ${selector}`);
  return value;
}

function text(node: Element, value: unknown): void {
  node.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function makeRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  return renderer;
}

function nativeMeshEvidence(root: THREE.Object3D | null): { meshes: string[]; morphs: string[]; authoredRig: boolean } {
  const meshNames: string[] = [], morphNames = new Set<string>();
  root?.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshNames.push(mesh.name || '(unnamed)');
    const dictionary = (mesh as THREE.Mesh & { morphTargetDictionary?: Record<string, number> }).morphTargetDictionary;
    if (dictionary) Object.keys(dictionary).forEach((name) => morphNames.add(name));
  });
  const names = new Set(meshNames);
  const morphs = [...morphNames].sort();
  return {
    meshes: meshNames,
    morphs,
    authoredRig: names.has('Body') && names.has('Eyes') && names.has('Teeth') && names.has('Tongue')
      && morphs.includes('nativeFacialBlinkLeft') && morphs.includes('nativeFacialJawOpen'),
  };
}

function nativeJawWeights(root: THREE.Object3D | null): Record<string, number | null> {
  const weights: Record<string, number | null> = {};
  for (const name of ['Body', 'Teeth', 'Tongue']) {
    const mesh = root?.getObjectByName(name) as (THREE.Mesh & { morphTargetDictionary?: Record<string, number>; morphTargetInfluences?: number[] }) | undefined;
    const index = mesh?.morphTargetDictionary?.nativeFacialJawOpen;
    weights[name] = Number.isInteger(index) && index! >= 0 ? mesh?.morphTargetInfluences?.[index!] ?? null : null;
  }
  return weights;
}

function jawSynchronized(weights: Record<string, number | null>): boolean {
  return ['Body', 'Teeth', 'Tongue'].every((name) => typeof weights[name] === 'number'
    && Math.abs(weights[name]! - (weights.Body ?? 0)) < 1e-6);
}

function createFixture() {
  const canvas = required<HTMLCanvasElement>('#game-stage');
  const status = required<HTMLElement>('#status');
  const auditNode = required<HTMLElement>('#audit');
  const npcNode = required<HTMLElement>('#npc-cards');
  const renderer = makeRenderer(canvas);
  const kit: Kit = createKit();
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 160);
  const errors: string[] = [];
  const actors = new Map<string, ActorAudit>();
  const actions = new Set<() => void>();
  let entry: SceneEntry | null = null;
  let standIn: StandIn | null = null;
  let lifeState: ReturnType<typeof createLife> | null = null;
  let regulars: ReturnType<typeof viewLife>['social']['here'] = [];
  let npcCrowd: ReturnType<typeof crowdList> = [];
  let readyState: FixtureSnapshot['readyState'] = 'loading';
  let stage = 'Loading Lagos office game slice';
  let currentCamera = 'scene';
  function isCloseCamera(name = currentCamera) { return /-(?:close)(?:-(?:back|profile))?$/.test(name); }
  let closeCameraActor: THREE.Object3D | null = null;
  let closeCameraRay: CameraActorFrame['visibilityRay'] = { clearLine: false, firstActorHit: null, nearestOccluder: null };
  let unsupportedProbe: Record<string, unknown> | null = null;
  let interaction: Record<string, unknown> | null = null;
  let lastContact: ReturnType<SkinnedBody['solveFeet']> | null = null;
  let frame = 0;
  let walkPhase = 0;
  let walkFrames = 0;
  let walkPhaseFrozen = false;
  let startedAt = 0;
  let mode: 'idle' | 'walk' | 'interact' = 'idle';
  let animationHandle = 0;
  let lastRenderedState = '';
  let disposed = false;
  let disposalEvidence: Record<string, unknown> | null = null;

  const sceneLights: THREE.Object3D[] = [];
  type CrowdCounts = { desired: number; canonical: number; procedural: number; loading: number };
  function crowdCounts(): CrowdCounts {
    const read = entry?.group.userData.canonicalCrowdCounts;
    if (typeof read !== 'function') return { desired: 0, canonical: 0, procedural: 0, loading: 0 };
    const counts = (read as () => Partial<CrowdCounts>)();
    return {
      desired: Number(counts.desired ?? 0), canonical: Number(counts.canonical ?? 0),
      procedural: Number(counts.procedural ?? 0), loading: Number(counts.loading ?? 0),
    };
  }
  const sceneVenue: SceneVenue = {
    id: 'office', label: 'Lagoon Towers office', district: 'lagos-island',
    scene: { kind: 'office', time: 'day', spots: [
      { id: 'reception', label: 'Reception' },
      { id: 'lounge', label: 'Tea lounge' },
      { id: 'desks', label: 'Office desks' },
    ] },
  };

  const updateLights = () => {
    if (!entry) return;
    const preset = entry.lighting();
    const hemi = new THREE.HemisphereLight(preset.hemi[0], preset.hemi[1], preset.hemi[2]);
    const sun = new THREE.DirectionalLight(preset.sun[0], preset.sun[1]);
    sun.position.set(...preset.sun[2]);
    sun.castShadow = true;
    world.add(hemi, sun);
    sceneLights.push(hemi, sun);
    world.background = new THREE.Color(entry.background);
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    renderer.setSize(Math.round(rect.width), Math.round(rect.height), false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  };

  function draw() {
    if (disposed || !entry) return;
    resize();
    if (closeCameraActor && isCloseCamera()) placeCloseCamera(closeCameraActor);
    entry.look(camera.position.x, camera.position.z);
    renderer.render(world, camera);
    if (closeCameraActor && currentCamera.endsWith('-close')) closeCameraRay = measureCloseCameraRay(closeCameraActor);
  }

  function placeCloseCamera(actor: THREE.Object3D) {
    actor.updateWorldMatrix(true, true);
    const origin = actor.getWorldPosition(new THREE.Vector3());
    // V6 pixels showed that the previous -getWorldDirection candidate captured the actors' backs.
    // Use the opposite azimuth as the face candidate, while retaining explicit back/profile controls.
    const faceCandidate = actor.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    const side = currentCamera.endsWith('-back') ? 'back-control'
      : currentCamera.endsWith('-profile') ? 'profile-control' : 'face-candidate';
    const viewAxis = side === 'back-control' ? faceCandidate.clone().negate()
      : side === 'profile-control' ? new THREE.Vector3(-faceCandidate.z, 0, faceCandidate.x)
        : faceCandidate;
    const bounds = new THREE.Box3().setFromObject(actor);
    const target = bounds.getCenter(new THREE.Vector3());
    target.y = bounds.min.y + Math.min(1.2, bounds.getSize(new THREE.Vector3()).y * 0.5);
    camera.fov = 48;
    camera.updateProjectionMatrix();
    camera.position.copy(origin).addScaledVector(viewAxis, 3.8);
    camera.position.y = bounds.min.y + 1.4;
    camera.lookAt(target);
  }

  function actorFrame(actor: THREE.Object3D | null): CameraActorFrame | null {
    if (!actor) return null;
    actor.updateWorldMatrix(true, true);
    camera.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(actor);
    const head = actor.getObjectByName('Head');
    const headPosition = head?.getWorldPosition(new THREE.Vector3()).toArray() as [number, number, number] | undefined;
    const corners = [
      new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z), new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
      new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.min.z), new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
      new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.min.z), new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
      new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.min.z), new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
    ].map((point) => point.project(camera));
    const minX = Math.min(...corners.map((point) => point.x)), maxX = Math.max(...corners.map((point) => point.x));
    const minY = Math.min(...corners.map((point) => point.y)), maxY = Math.max(...corners.map((point) => point.y));
    const allCornersInFrustum = corners.every((point) => point.z > -1 && point.z < 1);
    const actorAxis = actor.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    const toCamera = camera.position.clone().sub(actor.getWorldPosition(new THREE.Vector3())).setY(0).normalize();
    return { actorOrigin: actor.getWorldPosition(new THREE.Vector3()).toArray() as [number, number, number],
      headPosition: headPosition ?? null,
      bounds: { min: bounds.min.toArray() as [number, number, number], max: bounds.max.toArray() as [number, number, number] },
      cameraPosition: camera.position.toArray() as [number, number, number],
      ndc: { minX, maxX, minY, maxY }, allCornersInFrustum,
      wholeActorVisible: allCornersInFrustum && minX > -0.96 && maxX < 0.96 && minY > -0.96 && maxY < 0.96
        && closeCameraRay.clearLine,
      cameraAxisDot: actorAxis.dot(toCamera),
      selectedCameraSide: currentCamera.endsWith('-back') ? 'back-control'
        : currentCamera.endsWith('-profile') ? 'profile-control' : 'face-candidate', visibilityRay: closeCameraRay };
  }

  function measureCloseCameraRay(actor: THREE.Object3D): CameraActorFrame['visibilityRay'] {
    world.updateMatrixWorld(true);
    actor.updateWorldMatrix(true, true);
    camera.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(actor);
    const target = bounds.getCenter(new THREE.Vector3());
    const direction = target.clone().sub(camera.position);
    const length = direction.length();
    if (length <= 0) return { clearLine: false, firstActorHit: null, nearestOccluder: null };
    const raycaster = new THREE.Raycaster(camera.position, direction.normalize(), 0, length + 0.05);
    const hits = raycaster.intersectObject(world, true);
    const belongsToActor = (object: THREE.Object3D) => {
      for (let current: THREE.Object3D | null = object; current; current = current.parent) if (current === actor) return true;
      return false;
    };
    const actorHit = hits.find((hit) => belongsToActor(hit.object));
    const obstruction = hits.find((hit) => !belongsToActor(hit.object));
    const firstActorHit = actorHit ? { name: actorHit.object.name || '(unnamed actor mesh)', distance: actorHit.distance } : null;
    const nearestOccluder = obstruction ? { name: obstruction.object.name || '(unnamed scene mesh)', distance: obstruction.distance } : null;
    return { firstActorHit, nearestOccluder,
      clearLine: Boolean(actorHit && (!obstruction || obstruction.distance >= actorHit.distance - 0.02)) };
  }

  const playerLoader = async (owner: Kit, look: unknown, seed: unknown, scale: number): Promise<SkinnedBody> => {
    const identitySeed = String(seed ?? PLAYER_SEED);
    const body = await loadGameBody(owner, look, identitySeed, scale, { scene: 'venue', poses: PLAYER_POSES });
    const audit: ActorAudit = { requestedLook: look, seed: identitySeed, context: { scene: 'venue', poses: PLAYER_POSES }, body, lastSolve: null, contacts: 0 };
    const solve = body.solveFeet.bind(body), sample = body.sampleFootContacts.bind(body);
    body.solveFeet = (heightAt) => { const result = solve(heightAt); audit.lastSolve = result; lastContact = result; return result; };
    body.sampleFootContacts = () => { const points = sample(); audit.contacts = points.reduce((count, item) => count + (item.points?.length ?? 1), 0); return points; };
    body.object.userData.nativeGameFixture = { seed: identitySeed, context: audit.context, hasPreparedMetrics: 'preparedMetrics' in body };
    actors.set('player', audit);
    return body;
  };

  async function initialize() {
    try {
      await loadCityContent('lagos');
      await loadCityScenes('lagos');
      lifeState = createLife({ location: 'office', spot: 'people', name: 'Office game fixture' }, { cityId: 'lagos', now: NOW, seed: 'lagos-office-game-slice' });
      const view = viewLife(lifeState, { cityId: 'lagos', now: NOW, seed: 'lagos-office-game-slice' });
      regulars = view.social.here;
      const targeted = regulars.filter((npc) => npc.id === 'mrs-okafor' || npc.id === 'dapo');
      if (targeted.length !== 2) throw new Error(`Real office regulars missing from viewLife: ${targeted.map((npc) => npc.id).join(',')}`);
      npcCrowd = crowdList({ npcs: targeted });
      if (npcCrowd.length !== 2 || npcCrowd.some((person) => person.kind !== 'npc' || !person.seed)) {
        throw new Error('crowdList did not preserve the two real regular identities');
      }
      entry = buildVenueScene(kit, sceneVenue, 'lagos');
      entry.setTime('day');
      entry.update({ t: NOW, location: 'office', name: 'Player', onboarding: { look: PLAYER_LOOK } });
      entry.setPlayer({ look: PLAYER_LOOK, seed: PLAYER_SEED, name: 'Player' });
      entry.setCrowd(npcCrowd);
      world.add(entry.group);
      updateLights();

      standIn = createStandIn(kit, () => { stage = 'Player stand-in ready'; draw(); }, true, playerLoader);
      standIn.attach({
        group: entry.group,
        avatar: entry.walk.avatar,
        scale: entry.walk.scale,
        contactHeightAt: entry.walk.contactHeightAt,
      } satisfies StandInScene);
      standIn.wear(PLAYER_LOOK, PLAYER_SEED);
      const start = entry.walk.entrance ?? { x: 0, y: 0, z: 7.8, ry: Math.PI };
      standIn.move(start.x, start.y, start.z, start.ry);

      // Render the actual scene once before either native queue starts, matching venue-world's first-frame gate.
      camera.position.set(13.5, 10.2, 17.2);
      camera.lookAt(0, 1.15, 0);
      draw();
      if (!renderer.capabilities.isWebGL2) throw new Error('Remote renderer did not provide WebGL2');
      standIn.start(renderer);
      const startCrowd = Reflect.get(entry, 'startCrowd');
      if (typeof startCrowd !== 'function') throw new Error('Staged venue scene does not expose the post-first-frame canonical crowd seam');
      startCrowd.call(entry, renderer, () => { stage = 'Canonical NPC queue changed'; draw(); });
      stage = 'Loading prepared player and real office regulars';
      readyState = 'loading';
      startedAt = performance.now();
      animationHandle = requestAnimationFrame(poll);
      renderNpcCards(targeted);
    } catch (error) {
      readyState = 'failed';
      errors.push(error instanceof Error ? error.message : String(error));
      stage = errors.at(-1)!;
      updateDom();
    }
  }

  function renderNpcCards(npcs: typeof regulars) {
    npcNode.replaceChildren();
    for (const npc of npcs) {
      const card = document.createElement('article');
      card.className = 'npc-card';
      const header = document.createElement('header');
      const title = document.createElement('strong');
      title.textContent = npc.name;
      const role = document.createElement('span');
      role.textContent = npc.role;
      header.append(title, role);
      const spot = document.createElement('p');
      spot.textContent = `At ${npc.at ?? 'unplaced'} · ${npc.emoji} · ${npc.look ? JSON.stringify(npc.look) : 'stable seed appearance'}`;
      const actionList = document.createElement('div');
      actionList.className = 'action-list';
      for (const action of npc.actions) {
        const button = document.createElement('button');
        button.id = `npc-action-${npc.id}-${action.id}`;
        button.type = 'button';
        button.textContent = `${action.icon} ${action.label}`;
        button.title = `Run game activity ${action.activity}`;
        button.addEventListener('click', () => {
          if (!standIn) return;
          standIn.pose('wave', undefined, false);
          void performNpcAction(npc.id, action.activity);
        });
        actionList.append(button);
      }
      card.append(header, spot, actionList);
      npcNode.append(card);
    }
  }

  async function performNpcAction(npcId: string, activityId: string) {
    if (!lifeState) throw new Error('Life state is unavailable');
    const now = lifeState.t;
    const ctx = { cityId: 'lagos', now, seed: `office-fixture:${npcId}:${activityId}:${now}` };
    const beforeView = viewLife(lifeState, ctx).social;
    const npc = beforeView.here.find((person) => person.id === npcId);
    const offered = npc?.actions.find((action) => action.activity === activityId);
    if (!npc || !offered) throw new Error(`The current life view does not offer ${activityId} for ${npcId}`);
    const beforeRelationship = beforeView.relationships.find((person) => person.id === npcId);
    const jawBefore = nativeJawWeights(entry?.group.getObjectByName(`canonical-crowd:npc:${npcId}`) ?? null);
    const started = dispatch(lifeState, { type: 'activity', id: activityId }, ctx);
    if (!started.ok || started.code !== 'started') {
      interaction = { npcId, activityId, started: { ok: started.ok, code: started.code, reason: started.reason ?? null }, completed: false };
      stage = `Game refused ${offered.label}: ${started.reason ?? started.code}`;
      updateDom(); draw();
      return interaction;
    }
    entry?.update(lifeState);
    const npcPoseDuringInteraction = inspectNpc(npcId).gamePose;
    const talkLoopStarted = Boolean(entry?.easing);
    interaction = { npcId, activityId, label: offered.label, started: { ok: started.ok, code: started.code }, completed: false,
      npcPoseDuringInteraction, npcPoseAfterCompletion: null, npcPoseLifecyclePass: false, talkLoopStarted };
    stage = `${offered.label} with ${npc.name}`;
    updateDom(); draw();
    const jawPeak = { Body: 0, Teeth: 0, Tongue: 0 };
    let talkLoopFrames = 0, talkLoopSynchronized = true;
    for (let frame = 0; frame < 34 && entry?.easing; frame += 1) {
      if (!entry) break;
      entry.stepCrowd(1 / 30);
      const weights = nativeJawWeights(entry.group.getObjectByName(`canonical-crowd:npc:${npcId}`));
      talkLoopSynchronized &&= jawSynchronized(weights);
      for (const name of ['Body', 'Teeth', 'Tongue'] as const) jawPeak[name] = Math.max(jawPeak[name], weights[name] ?? 0);
      talkLoopFrames += 1;
      draw();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 33));
    }
    draw();
    const completed = advanceLife(lifeState, offered.duration, {
      cityId: 'lagos', now: lifeState.t + offered.duration * 1000,
      seed: `office-fixture-complete:${npcId}:${activityId}:${now}`,
    });
    entry?.update(lifeState);
    const npcPoseAfterCompletion = inspectNpc(npcId).gamePose;
    const jawAfter = nativeJawWeights(entry?.group.getObjectByName(`canonical-crowd:npc:${npcId}`) ?? null);
    const jawRestored = ['Body', 'Teeth', 'Tongue'].every((name) => typeof jawBefore[name] === 'number'
      && Math.abs(jawAfter[name]! - jawBefore[name]!) < 1e-6);
    const afterView = viewLife(lifeState, { cityId: 'lagos', now: lifeState.t, seed: `office-fixture-view:${npcId}:${now}` }).social;
    regulars = afterView.here;
    const afterNpc = afterView.here.find((person) => person.id === npcId);
    const afterRelationship = afterView.relationships.find((person) => person.id === npcId);
    const response = lifeState.message ?? '';
    const familiarityChanged = afterRelationship !== undefined
      && (afterRelationship.points > (beforeRelationship?.points ?? -1)
        || afterRelationship.left < (beforeRelationship?.left ?? Number.POSITIVE_INFINITY));
    interaction = {
      npcId, activityId, label: offered.label,
      started: { ok: started.ok, code: started.code },
      completed: completed.ok && completed.code === 'completed',
      response,
      responseNamesNpc: response.includes(npc.name),
      beforeRelationship: beforeRelationship ? { points: beforeRelationship.points, left: beforeRelationship.left } : null,
      afterRelationship: afterRelationship ? { points: afterRelationship.points, left: afterRelationship.left } : null,
      familiarityChanged,
      viewUpdated: Boolean(afterNpc),
      npcPoseDuringInteraction,
      npcPoseAfterCompletion,
      npcPoseLifecyclePass: npcPoseDuringInteraction === 'interact' && npcPoseAfterCompletion === 'idle',
      talkLoopStarted, talkLoopFrames, jawBefore, jawPeak, jawAfter, talkLoopSynchronized, jawRestored,
    };
    stage = `${offered.label} completed with ${npc.name}`;
    renderNpcCards(afterView.here.filter((person) => person.id === 'mrs-okafor' || person.id === 'dapo'));
    updateDom(); draw();
    return interaction;
  }

  function setCamera(name: string) {
    currentCamera = name;
    closeCameraActor = name.startsWith('player-close') ? actors.get('player')?.body.object ?? null
      : name.startsWith('mrs-okafor-close') ? entry?.group.getObjectByName('canonical-crowd:npc:mrs-okafor') ?? null
        : name.startsWith('dapo-close') ? entry?.group.getObjectByName('canonical-crowd:npc:dapo') ?? null : null;
    if (closeCameraActor) placeCloseCamera(closeCameraActor);
    else {
      camera.fov = 39;
      camera.updateProjectionMatrix();
      if (name === 'scene') camera.position.set(13.5, 10.2, 17.2);
      else if (name === 'front') camera.position.set(7.8, 5.4, 13.2);
      else camera.position.set(-6.8, 5.2, 12.8);
      camera.lookAt(0, 1.05, 0);
    }
    draw(); updateDom();
  }

  function setMode(next: 'idle' | 'walk' | 'interact') {
    mode = next;
    walkPhaseFrozen = false;
    if (!standIn || !entry) return;
    if (next === 'idle') {
      const start = entry.walk.entrance ?? { x: 0, y: 0, z: 7.8, ry: Math.PI };
      standIn.move(start.x, start.y, start.z, start.ry);
      standIn.pose('stand', undefined, false);
    } else if (next === 'interact') {
      standIn.pose('wave', undefined, false);
    } else if (next === 'walk') {
      walkPhase = Math.PI / 2;
      const start = entry.walk.entrance ?? { x: 0, y: 0, z: 7.8, ry: Math.PI };
      const x = start.x + 0.62, z = start.z - 0.62, y = entry.walk.heightAt(x, z);
      standIn.move(x, y, z, 0);
      standIn.gait(walkPhase, false, y);
      walkFrames += 1;
    }
    frame = 0;
    draw(); updateDom();
  }

  function setWalkPhase(phase: number) {
    if (!standIn || !entry || !Number.isFinite(phase)) throw new Error('Cannot sample requested walk phase');
    mode = 'walk';
    walkPhaseFrozen = true;
    walkPhase = phase;
    const start = entry.walk.entrance ?? { x: 0, y: 0, z: 7.8, ry: Math.PI };
    const x = start.x + Math.sin(phase) * 0.62;
    const z = start.z - (1 - Math.cos(phase)) * 0.62;
    const y = entry.walk.heightAt(x, z);
    standIn.move(x, y, z, Math.atan2(Math.cos(phase), Math.sin(phase)));
    standIn.gait(phase, false, y);
    walkFrames += 1;
    draw(); updateDom();
    return { phase, frames: walkFrames, pose: actors.get('player')?.body.pose ?? null,
      root: actors.get('player')?.body.object.position.toArray() ?? null };
  }

  function renderForCapture() {
    draw();
    const actor = closeCameraActor;
    let actorPixel: number[] | null = null;
    let backgroundPixel: number[] | null = null;
    let actorPixelContrast = 0;
    if (actor) {
      const bounds = new THREE.Box3().setFromObject(actor);
      const point = bounds.getCenter(new THREE.Vector3()).project(camera);
      const gl = renderer.getContext();
      const readPixel = (ndcX: number, ndcY: number) => {
        const x = Math.max(0, Math.min(renderer.domElement.width - 1, Math.round((ndcX + 1) * 0.5 * renderer.domElement.width)));
        const y = Math.max(0, Math.min(renderer.domElement.height - 1, Math.round((ndcY + 1) * 0.5 * renderer.domElement.height)));
        const pixel = new Uint8Array(4);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return [...pixel];
      };
      actorPixel = readPixel(point.x, point.y);
      backgroundPixel = readPixel(0.94, 0.94);
      actorPixelContrast = Math.max(...actorPixel.slice(0, 3).map((channel, index) => Math.abs(channel - backgroundPixel![index]!)));
    }
    let canvasPng = '';
    let canvasPngError = '';
    if (actor && isCloseCamera()) {
      try { canvasPng = renderer.domElement.toDataURL('image/png').split(',')[1] ?? ''; }
      catch (error) { canvasPngError = error instanceof Error ? error.message : String(error); }
    }
    return { drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      actorPixel, backgroundPixel, actorPixelContrast, canvasPng, canvasPngError, actorFrame: actorFrame(actor) };
  }

  function poll() {
    if (disposed) return;
    if (readyState === 'loading' && startedAt > 0 && performance.now() - startedAt > 100_000) {
      readyState = 'failed';
      errors.push(`Readiness timeout: player prepared=${Boolean(actors.get('player') && 'preparedMetrics' in actors.get('player')!.body)}, crowd=${JSON.stringify(crowdCounts())}`);
      stage = errors.at(-1)!;
    }
    if (mode === 'walk' && !walkPhaseFrozen && standIn && entry) {
      frame += 1;
      const start = entry.walk.entrance ?? { x: 0, y: 0, z: 7.8, ry: Math.PI };
      const phase = ++walkPhase;
      const x = start.x + Math.sin(phase) * 0.62;
      const z = start.z - (1 - Math.cos(phase)) * 0.62;
      standIn.move(x, entry.walk.heightAt(x, z), z, Math.atan2(Math.cos(phase), Math.sin(phase)));
      standIn.gait(phase, false, entry.walk.heightAt(x, z));
      if (frame % 6 === 0 || currentCamera.endsWith('-close')) draw();
    }
    updateDom();
    animationHandle = requestAnimationFrame(poll);
  }

  function inspectNpc(npcId: string) {
    const canonicalName = `canonical-crowd:npc:${npcId}`;
    const root = entry?.group.getObjectByName(canonicalName) ?? null;
    return { ...nativeMeshEvidence(root), mounted: Boolean(root), gamePose: root?.userData.nativeGameNpcPose ?? null,
      jaw: nativeJawWeights(root) };
  }

  function snapshot(): FixtureSnapshot {
    // The frozen SceneEntry type has no diagnostic property; the staged venue candidate exposes
    // the canonical crowd's live counts on its owned group userData.
    const crowd = crowdCounts();
    const playerAudit = actors.get('player');
    const playerEvidence = nativeMeshEvidence(playerAudit?.body.object ?? null);
    const playerPrepared = Boolean(playerAudit && 'preparedMetrics' in playerAudit.body);
    const npcAudits = Object.fromEntries(['mrs-okafor', 'dapo'].map((id) => [id, inspectNpc(id)]));
    const npcPreparedCount = Object.values(npcAudits).filter((person) => person.authoredRig && person.mounted).length;
    const contact = playerAudit?.lastSolve ?? lastContact;
    const unsupported = unsupportedProbe;
    const errorsNow = [...errors];
    if (readyState === 'loading' && playerPrepared && npcPreparedCount === 2) {
      readyState = 'ready'; stage = 'Prepared game actors ready';
    }
    if (readyState === 'ready' && crowd.procedural > 0 && crowd.desired > 0) {
      errorsNow.push(`procedural fallback error: ${crowd.procedural} of ${crowd.desired} crowd actors remain procedural`);
    }
    return {
      readyState, errors: errorsNow, stage,
      life: { location: lifeState?.location ?? '(missing)', now: NOW },
      crowd,
      player: {
        seed: playerAudit?.seed ?? PLAYER_SEED,
        look: PLAYER_LOOK,
        prepared: playerPrepared,
        authoredRig: playerEvidence.authoredRig,
        meshes: playerEvidence.meshes,
        morphs: playerEvidence.morphs,
        pose: playerAudit?.body.pose ?? 'missing',
        requestedMode: mode,
        walkFrames,
        rootPosition: playerAudit?.body.object.position.toArray() ?? null,
        standInShown: standIn?.shown ?? false,
        sampleCount: playerAudit?.contacts ?? 0,
        contact: contact ? { limited: contact.limited, maxError: contact.maxError } : null,
      },
      npcs: Object.fromEntries(Object.entries(npcAudits).map(([id, audit]) => [id, {
        ...audit,
        source: regulars.find((npc) => npc.id === id) ? 'viewLife(createLife(...)).social.here' : 'missing',
        actions: regulars.find((npc) => npc.id === id)?.actions ?? [],
      }])),
      unsupportedProbe: unsupported,
      interaction,
      currentCamera,
      cameraActorFrame: actorFrame(closeCameraActor),
      viewport: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
        scrollWidth: document.documentElement.scrollWidth,
        layoutColumns: new Set(Array.from(required<HTMLElement>('.layout').children,
          (child) => Math.round(child.getBoundingClientRect().top))).size === 1
          ? required<HTMLElement>('.layout').children.length : 1,
        mobileBreakpoint: window.matchMedia('(max-width: 430px)').matches,
      },
    };
  }

  function updateDom() {
    const current = snapshot();
    const serialized = JSON.stringify(current);
    if (serialized === lastRenderedState) return;
    lastRenderedState = serialized;
    status.dataset.state = current.readyState;
    text(status, current.stage);
    text(auditNode, current);
    for (const error of current.errors) if (!errors.includes(error)) errors.push(error);
  }

  async function probeUnsupportedPose() {
    try {
      const fallback = await loadGameBody(kit, PLAYER_LOOK, `${PLAYER_SEED}:unsupported-probe`, 1,
        { scene: 'venue', poses: ['sit'] });
      const acceptedAsNative = 'preparedMetrics' in fallback;
      fallback.dispose();
      unsupportedProbe = { acceptedAsNative, expectedNativeRefusal: !acceptedAsNative, requested: ['sit'], fallbackDisposed: true };
      if (acceptedAsNative) errors.push('unsupported sit probe was incorrectly accepted by native provider');
    } catch (error) {
      unsupportedProbe = { acceptedAsNative: false, expectedNativeRefusal: true, requested: ['sit'], error: error instanceof Error ? error.message : String(error) };
    }
    stage = 'Unsupported-pose refusal sampled';
    updateDom(); draw();
    return unsupportedProbe;
  }

  function sample() { updateDom(); return snapshot(); }

  async function start() { await initialize(); }

  function dispose() {
    if (disposalEvidence) return disposalEvidence;
    const crowdBefore = crowdCounts();
    disposed = true;
    cancelAnimationFrame(animationHandle);
    for (const off of actions) off();
    standIn?.dispose();
    entry?.dispose();
    const crowdAfter = crowdCounts();
    const playerUnmounted = standIn?.shown === false;
    const rendererContextLost = renderer.getContext().isContextLost();
    for (const light of sceneLights) world.remove(light);
    world.clear();
    kit.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    disposalEvidence = {
      idempotent: true,
      playerUnmounted,
      crowdBefore,
      crowdAfter,
      noCanonicalActorsRemain: crowdAfter.canonical === 0 && crowdAfter.desired === 0,
      rendererContextLost: rendererContextLost || renderer.getContext().isContextLost(),
      kitDisposed: true,
    };
    return disposalEvidence;
  }

  const fixture = {
    get readyState() { return readyState; },
    start,
    sample,
    setMode,
    setCamera,
    setWalkPhase,
    renderForCapture,
    probeUnsupportedPose,
    performNpcAction,
    scenePoses: NATIVE_GAME_BODY_CAPABILITIES,
    dispose,
  };
  window.addEventListener('resize', resize);
  window.addEventListener('beforeunload', dispose, { once: true });
  text(status, stage);
  return fixture;
}

window.nativeGameFixture = createFixture();
void window.nativeGameFixture.start();
