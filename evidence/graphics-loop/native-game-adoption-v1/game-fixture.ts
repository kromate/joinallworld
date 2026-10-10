import * as THREE from 'three';
import { createKit, type Kit } from '../../../src/scene/kit.ts';
import { buildVenueScene } from '../../../src/scene/venue-scenes.ts';
import type { SceneEntry, SceneVenue } from '../../../src/scene/types.ts';
import { createStandIn } from '../../../src/scene/body/stand-in.ts';
import type { StandIn, StandInScene } from '../../../src/scene/body/stand-in.ts';
import type { BodyPose, SkinnedBody } from '../../../src/scene/body/skinned.ts';
import { loadGameBody, PLAYER_BODY_POSES } from '../../../src/scene/body/provider.ts';
import { crowdList } from '../../../src/scene/crowd.ts';
import { advanceLife, createLife, dispatch, viewLife } from '../../../src/life.ts';
import { loadCityContent } from '../../../src/game/cities/registry.ts';
import { loadCityScenes } from '../../../src/scene/city-scenes.ts';

interface ActorAudit {
  readonly requestedLook: unknown;
  readonly seed: string;
  readonly context: { readonly scene: 'venue'; readonly role: 'player'; readonly poses: readonly BodyPose[] };
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
  nativeCoverage: { player: boolean; npcs: Record<string, boolean>; allRequestedActorsPrepared: boolean };
  unsupportedProbe: Record<string, unknown> | null;
  interaction: Record<string, unknown> | null;
  nativeNpcRefreshWitness: Record<string, unknown> | null;
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
    nearestOccluder: { name: string; distance: number } | null; bodyCenterLineClear: boolean;
    lowerBodyLineClear: boolean; lowerBodyTargets: { name: string; clearLine: boolean;
      firstActorHit: { name: string; distance: number } | null; nearestOccluder: { name: string; distance: number } | null }[] };
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

const SOLE_TARGET_CLEARANCE_METERS = 0.016;
const SOLE_SUPPORT_BAND_METERS = 0.0025;

function sampleNativeNpcSoles(root: THREE.Object3D, entry: SceneEntry, phase: string) {
  const contactHeightAt = entry.walk.contactHeightAt;
  if (typeof contactHeightAt !== 'function') throw new Error('Venue entry lacks the actual contactHeightAt surface query');
  const shoes = root.getObjectByName('Authored footwear shoes01');
  if (!(shoes instanceof THREE.SkinnedMesh)) throw new Error(`NPC ${root.name} lacks the authored skinned shoe mesh`);
  const geometry = shoes.geometry;
  const positions = geometry.getAttribute('position'), indices = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
  if (!positions || !indices || !weights || positions.count !== indices.count || positions.count !== weights.count) {
    throw new Error(`NPC ${root.name} has incomplete authored shoe skin attributes`);
  }
  root.updateWorldMatrix(true, true);
  shoes.updateMatrixWorld(true);
  shoes.skeleton.update();
  const parent = root.parent;
  if (parent) parent.updateWorldMatrix(true, false);
  const parentInverse = parent ? parent.matrixWorld.clone().invert() : new THREE.Matrix4();
  const vertexLocal = new THREE.Vector3(), vertexParent = new THREE.Vector3();
  const sideDefinitions = [
    { side: 'left' as const, joints: ['mixamorigLeftFoot', 'mixamorigLeftToeBase'] },
    { side: 'right' as const, joints: ['mixamorigRightFoot', 'mixamorigRightToeBase'] },
  ];
  const sides = sideDefinitions.map(({ side, joints }) => {
    const footJointIndices = new Set<number>();
    shoes.skeleton.bones.forEach((bone, index) => { if (joints.includes(bone.name)) footJointIndices.add(index); });
    if (footJointIndices.size !== joints.length) throw new Error(`NPC ${root.name} shoe rig lacks ${side} foot/toe joints`);
    const candidates: number[] = [];
    let authoredFootVertexMinY = Infinity;
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      let footWeight = 0;
      for (let lane = 0; lane < 4; lane += 1) {
        if (footJointIndices.has(Math.round(indices.getComponent(vertex, lane)))) footWeight += weights.getComponent(vertex, lane);
      }
      if (footWeight < 0.55) continue;
      candidates.push(vertex);
      authoredFootVertexMinY = Math.min(authoredFootVertexMinY, positions.getY(vertex));
    }
    if (!candidates.length || !Number.isFinite(authoredFootVertexMinY)) throw new Error(`NPC ${root.name} has no ${side} footwear vertices weighted to foot joints`);
    // Match the native factory's authored-footwear selection: rest-geometry foot-weighted
    // vertices within 18 mm of that shoe-side's minimum are the shoe-sole candidate set.
    const soleVertices = candidates.filter((vertex) => positions.getY(vertex) <= authoredFootVertexMinY + 0.018);
    if (!soleVertices.length) throw new Error(`NPC ${root.name} has an empty ${side} authored sole candidate set`);
    const deformed = soleVertices.map((vertex) => {
      shoes.getVertexPosition(vertex, vertexLocal);
      vertexParent.copy(vertexLocal).applyMatrix4(shoes.matrixWorld).applyMatrix4(parentInverse);
      return { vertex, x: vertexParent.x, y: vertexParent.y, z: vertexParent.z };
    });
    const actualLowestSoleY = Math.min(...deformed.map((point) => point.y));
    const evaluated = deformed.map((point) => {
      const callbackTargetY = contactHeightAt(point.x, point.z, point.y);
      const sceneFloorY = callbackTargetY === null ? null : callbackTargetY - SOLE_TARGET_CLEARANCE_METERS;
      return { ...point, callbackTargetY, sceneFloorY,
        errorToCallbackTarget: callbackTargetY === null ? null : point.y - callbackTargetY,
        gapToSceneFloor: sceneFloorY === null ? null : point.y - sceneFloorY };
    });
    const supported = evaluated.filter((point) => point.callbackTargetY !== null);
    const nonFiniteSamples = evaluated.filter((point) => ![point.x, point.y, point.z].every(Number.isFinite));
    const callbackNonFiniteSamples = evaluated.filter((point) => point.callbackTargetY !== null && !Number.isFinite(point.callbackTargetY));
    const maxAbsoluteGapToSceneFloor = supported.length
      ? Math.max(...supported.map((point) => Math.abs(point.gapToSceneFloor!))) : null;
    const nearestAbsoluteGapToSceneFloor = supported.length
      ? Math.min(...supported.map((point) => Math.abs(point.gapToSceneFloor!))) : null;
    const minimumSignedGapToSceneFloor = supported.length
      ? Math.min(...supported.map((point) => point.gapToSceneFloor!)) : null;
    const lowSoleSupportBand = evaluated.filter((point) => point.y <= actualLowestSoleY + SOLE_SUPPORT_BAND_METERS);
    const suffix = side === 'left' ? 'Left' : 'Right';
    const thigh = shoes.skeleton.bones.find((bone) => bone.name === `mixamorig${suffix}UpLeg`);
    const calf = shoes.skeleton.bones.find((bone) => bone.name === `mixamorig${suffix}Leg`);
    const ankle = shoes.skeleton.bones.find((bone) => bone.name === `mixamorig${suffix}Foot`);
    if (!thigh || !calf || !ankle) throw new Error(`NPC ${root.name} shoe rig lacks ${side} native leg chain`);
    const bonePosition = (bone: THREE.Bone) => bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(parentInverse);
    const hipPosition = bonePosition(thigh), kneePosition = bonePosition(calf), anklePosition = bonePosition(ankle);
    const upperLength = hipPosition.distanceTo(kneePosition), lowerLength = kneePosition.distanceTo(anklePosition);
    const floorCorrections = evaluated.filter((point) => point.sceneFloorY !== null
      && Number.isFinite(point.sceneFloorY) && Number.isFinite(point.y))
      .map((point) => point.sceneFloorY! - point.y);
    const physicalVerticalCorrection = floorCorrections.length ? Math.max(...floorCorrections) : null;
    const callbackCorrections = evaluated.filter((point) => point.callbackTargetY !== null
      && Number.isFinite(point.callbackTargetY) && Number.isFinite(point.y))
      .map((point) => point.callbackTargetY! - point.y);
    const callbackVerticalCorrection = callbackCorrections.length ? Math.max(...callbackCorrections) : null;
    const physicalTargetAnklePosition = physicalVerticalCorrection === null ? null
      : anklePosition.clone().add(new THREE.Vector3(0, physicalVerticalCorrection, 0));
    const callbackTargetAnklePosition = callbackVerticalCorrection === null ? null
      : anklePosition.clone().add(new THREE.Vector3(0, callbackVerticalCorrection, 0));
    const physicalRequestedAnkleReach = physicalTargetAnklePosition ? hipPosition.distanceTo(physicalTargetAnklePosition) : null;
    const callbackRequestedAnkleReach = callbackTargetAnklePosition ? hipPosition.distanceTo(callbackTargetAnklePosition) : null;
    const maximumLegReach = upperLength + lowerLength;
    return { side, authoredFootVertexMinY, soleCandidateCount: soleVertices.length,
      actualLowestSoleY, supportBandMeters: SOLE_SUPPORT_BAND_METERS,
      deformedSoleCandidateCount: evaluated.length,
      lowSoleSupportBandCount: lowSoleSupportBand.length,
      lowSoleSupportBand,
      deformedSoleSamples: evaluated,
      callbackSupportCoverage: `${supported.length}/${evaluated.length}`,
      callbackSupportCoverageComplete: supported.length === evaluated.length,
      nonFiniteSampleCount: nonFiniteSamples.length,
      callbackNonFiniteSampleCount: callbackNonFiniteSamples.length,
      maxAbsoluteGapToSceneFloor,
      nearestAbsoluteGapToSceneFloor,
      minimumSignedGapToSceneFloor,
      withinFourMillimetersOfSceneFloor: supported.length === evaluated.length
        && nonFiniteSamples.length === 0 && callbackNonFiniteSamples.length === 0
        && nearestAbsoluteGapToSceneFloor !== null && nearestAbsoluteGapToSceneFloor <= 0.004
        && minimumSignedGapToSceneFloor !== null && minimumSignedGapToSceneFloor >= -0.004,
      nativeLegReach: { upperLength, lowerLength, actualAnkleReach: hipPosition.distanceTo(anklePosition),
        physicalVerticalCorrection, physicalRequestedAnkleReach, callbackVerticalCorrection,
        callbackRequestedAnkleReach, maximumLegReach,
        withinReach: physicalRequestedAnkleReach !== null && physicalRequestedAnkleReach <= maximumLegReach + 0.002 } };
  });
  return { npcId: root.name.replace(/^canonical-crowd:npc:/, ''), phase,
    sampleFrame: 'post-placement current native skinned-shoe geometry and actor matrices',
    nativeVenueFootContactSolve: root.userData.nativeVenueFootContactSolve ?? null,
    contactCallback: 'SceneEntry.walk.contactHeightAt', contactTargetClearanceMeters: SOLE_TARGET_CLEARANCE_METERS,
    sides, bothFeetWithinFourMillimetersOfSceneFloor: sides.length === 2
      && sides.every((side) => side.withinFourMillimetersOfSceneFloor) };
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
  let closeCameraPlacementSignature = '';
  let closeCameraRay: CameraActorFrame['visibilityRay'] = { clearLine: false, firstActorHit: null, nearestOccluder: null,
    bodyCenterLineClear: false, lowerBodyLineClear: false, lowerBodyTargets: [] };
  let unsupportedProbe: Record<string, unknown> | null = null;
  let interaction: Record<string, unknown> | null = null;
  let activeNpcAction: { npcId: string; promise: Promise<Record<string, unknown> | null> } | null = null;
  let nativeNpcRefreshWitness: Record<string, unknown> | null = null;
  let nativeNpcRefreshAttempted = false;
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
    const signature = `${actor.uuid}:${currentCamera}:${origin.toArray().map((part) => part.toFixed(3)).join(',')}`;
    if (signature === closeCameraPlacementSignature) return;
    camera.fov = 48;
    camera.updateProjectionMatrix();
    const offsets = side === 'face-candidate' ? [0, Math.PI / 12, -Math.PI / 12, Math.PI / 6, -Math.PI / 6,
      Math.PI / 4, -Math.PI / 4, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2]
      : side === 'back-control' ? [0, Math.PI / 12, -Math.PI / 12, Math.PI / 6, -Math.PI / 6,
        Math.PI / 4, -Math.PI / 4, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2]
        : [0, Math.PI / 12, -Math.PI / 12, Math.PI / 6, -Math.PI / 6];
    const heights = side === 'face-candidate' ? [1.4, 2.1, 2.8] : [1.4, 2.2, 3.0, 3.8];
    const radii = side === 'face-candidate' ? [3.8] : [3.8, 5.4];
    const lowerBodyTargets = lowerBodyRayTargets(actor);
    // Keep the complete actor in view and ray-test the head, torso, knees and feet.
    // Candidate order is deterministic; furniture stays in the scene and blocks views
    // truthfully when no camera position can see the lower body.
    for (const height of heights) {
      for (const offset of offsets) {
        const candidate = viewAxis.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), offset);
        for (const radius of radii) {
          camera.position.copy(origin).addScaledVector(candidate, radius);
          camera.position.y = bounds.min.y + height;
          camera.lookAt(target);
          const facingDot = faceCandidate.dot(candidate);
          if (side === 'back-control' ? facingDot > -0.65
            : side === 'profile-control' ? Math.abs(facingDot) > 0.45 : facingDot < 0.65) continue;
          const visibility = measureCloseCameraRay(actor, lowerBodyTargets);
          closeCameraRay = visibility;
          camera.updateMatrixWorld(true);
          const corners = [
            new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z), new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
            new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.min.z), new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
            new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.min.z), new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
            new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.min.z), new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
          ].map((point) => point.project(camera));
          const framed = corners.every((point) => point.z > -1 && point.z < 1
            && point.x > -0.96 && point.x < 0.96 && point.y > -0.96 && point.y < 0.96);
          if (framed && visibility.clearLine && visibility.bodyCenterLineClear && visibility.lowerBodyLineClear) {
            closeCameraPlacementSignature = signature;
            return;
          }
        }
      }
    }
    closeCameraPlacementSignature = signature;
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
    const selectedSide = currentCamera.endsWith('-back') ? 'back-control'
      : currentCamera.endsWith('-profile') ? 'profile-control' : 'face-candidate';
    const cameraAxisDot = actorAxis.dot(toCamera);
    const cameraSideMatches = selectedSide === 'back-control' ? cameraAxisDot <= -0.65
      : selectedSide === 'profile-control' ? Math.abs(cameraAxisDot) <= 0.45 : cameraAxisDot >= 0.65;
    return { actorOrigin: actor.getWorldPosition(new THREE.Vector3()).toArray() as [number, number, number],
      headPosition: headPosition ?? null,
      bounds: { min: bounds.min.toArray() as [number, number, number], max: bounds.max.toArray() as [number, number, number] },
      cameraPosition: camera.position.toArray() as [number, number, number],
      ndc: { minX, maxX, minY, maxY }, allCornersInFrustum,
      wholeActorVisible: cameraSideMatches && allCornersInFrustum && minX > -0.96 && maxX < 0.96 && minY > -0.96 && maxY < 0.96
        && closeCameraRay.clearLine && closeCameraRay.bodyCenterLineClear && closeCameraRay.lowerBodyLineClear,
      cameraAxisDot, selectedCameraSide: selectedSide, visibilityRay: closeCameraRay };
  }

  function lowerBodyRayTargets(actor: THREE.Object3D): Map<string, THREE.Vector3 | null> {
    const shoeMesh = actor.getObjectByName('Authored footwear shoes01');
    const skinnedShoes = shoeMesh instanceof THREE.SkinnedMesh ? shoeMesh : null;
    const positions = skinnedShoes?.geometry.getAttribute('position');
    if (skinnedShoes) {
      skinnedShoes.updateMatrixWorld(true);
      skinnedShoes.skeleton.update();
    }
    const targets = new Map<string, THREE.Vector3 | null>();
    for (const name of ['mixamorigLeftLeg', 'mixamorigRightLeg', 'mixamorigLeftFoot', 'mixamorigRightFoot']) {
      const bone = actor.getObjectByName(name);
      if (!bone) { targets.set(name, null); continue; }
      const bonePosition = bone.getWorldPosition(new THREE.Vector3());
      if (!name.endsWith('Foot') || !skinnedShoes || !positions) { targets.set(name, bonePosition); continue; }
      let nearest: THREE.Vector3 | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      const vertex = new THREE.Vector3();
      for (let index = 0; index < positions.count; index += 1) {
        vertex.fromBufferAttribute(positions, index);
        skinnedShoes.applyBoneTransform(index, vertex);
        skinnedShoes.localToWorld(vertex);
        const distance = vertex.distanceToSquared(bonePosition);
        if (distance < nearestDistance) { nearestDistance = distance; nearest = vertex.clone(); }
      }
      targets.set(name, nearest ?? bonePosition);
    }
    return targets;
  }

  function measureCloseCameraRay(actor: THREE.Object3D, lowerTargets = lowerBodyRayTargets(actor)): CameraActorFrame['visibilityRay'] {
    world.updateMatrixWorld(true);
    actor.updateWorldMatrix(true, true);
    camera.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(actor);
    const bodyCenter = bounds.getCenter(new THREE.Vector3());
    const head = actor.getObjectByName('Head');
    const faceTarget = head?.getWorldPosition(new THREE.Vector3()) ?? bodyCenter.clone().setY(bounds.min.y + bounds.getSize(new THREE.Vector3()).y * 0.88);
    const belongsToActor = (object: THREE.Object3D) => {
      for (let current: THREE.Object3D | null = object; current; current = current.parent) if (current === actor) return true;
      return false;
    };
    const trace = (target: THREE.Vector3) => {
      const direction = target.clone().sub(camera.position);
      const length = direction.length();
      if (length <= 0) return { clearLine: false, firstActorHit: null, nearestOccluder: null };
      const raycaster = new THREE.Raycaster(camera.position, direction.normalize(), 0, length + 0.05);
      const hits = raycaster.intersectObject(world, true);
      const actorHit = hits.find((hit) => belongsToActor(hit.object));
      const obstruction = hits.find((hit) => !belongsToActor(hit.object));
      const firstActorHit = actorHit ? { name: actorHit.object.name || '(unnamed actor mesh)', distance: actorHit.distance } : null;
      const nearestOccluder = obstruction ? { name: obstruction.object.name || '(unnamed scene mesh)', distance: obstruction.distance } : null;
      return { firstActorHit, nearestOccluder,
        clearLine: Boolean(actorHit && (!obstruction || obstruction.distance >= actorHit.distance - 0.02)) };
    };
    const faceRay = trace(faceTarget), bodyRay = trace(bodyCenter);
    const lowerBodyTargets = ['mixamorigLeftLeg', 'mixamorigRightLeg', 'mixamorigLeftFoot', 'mixamorigRightFoot']
      .map((name) => {
        const target = lowerTargets.get(name);
        if (!target) return { name, clearLine: false, firstActorHit: null, nearestOccluder: null };
        const result = trace(target);
        return { name, ...result };
      });
    return { ...faceRay, bodyCenterLineClear: bodyRay.clearLine,
      lowerBodyLineClear: lowerBodyTargets.length === 4 && lowerBodyTargets.every((target) => target.clearLine),
      lowerBodyTargets };
  }

  const playerLoader = async (owner: Kit, look: unknown, seed: unknown, scale: number): Promise<SkinnedBody> => {
    const identitySeed = String(seed ?? PLAYER_SEED);
    const context = { scene: 'venue' as const, role: 'player' as const, poses: PLAYER_BODY_POSES };
    const body = await loadGameBody(owner, look, identitySeed, scale, context);
    const audit: ActorAudit = { requestedLook: look, seed: identitySeed, context, body, lastSolve: null, contacts: 0 };
    const solve = body.solveFeet.bind(body), sample = body.sampleFootContacts.bind(body);
    body.solveFeet = (heightAt) => { const result = solve(heightAt); audit.lastSolve = result; lastContact = result; return result; };
    body.sampleFootContacts = () => { const points = sample(); audit.contacts = points.reduce((count, item) => count + (item.points?.length ?? 1), 0); return points; };
    const preparedNative = 'preparedMetrics' in body;
    body.object.userData.nativeGameFixture = { seed: identitySeed, context: audit.context, preparedNative,
      representation: preparedNative ? 'native-prepared' : 'legacy-fallback', requestedLifecyclePoses: [...PLAYER_BODY_POSES] };
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
          // The player joins the NPC action for its duration. Keep the public
          // mode and the sampled body pose in sync, then restore the mode that
          // was active when the user started the action.
          const resumeMode = mode;
          setMode('interact');
          const actionPromise = performNpcAction(npc.id, action.activity);
          activeNpcAction = { npcId: npc.id, promise: actionPromise };
          void actionPromise.catch((error: unknown) => {
            errors.push(error instanceof Error ? error.message : String(error));
            stage = errors.at(-1)!;
            updateDom(); draw();
          }).finally(() => {
            if (disposed || !standIn) return;
            setMode(resumeMode);
            if (interaction) {
              interaction.playerModeRestored = mode === resumeMode;
              interaction.playerPoseAfterRestore = actors.get('player')?.body.pose ?? null;
              updateDom(); draw();
            }
          });
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
    if (!entry) throw new Error('Office venue entry is unavailable during NPC contact audit');
    const npcRoot = entry.group.getObjectByName(`canonical-crowd:npc:${npcId}`);
    if (!npcRoot) throw new Error(`Canonical NPC ${npcId} is not mounted during contact audit`);
    const placementIdleSoles = sampleNativeNpcSoles(npcRoot, entry, 'canonical-placement-idle');
    const jawBefore = nativeJawWeights(npcRoot);
    const started = dispatch(lifeState, { type: 'activity', id: activityId }, ctx);
    if (!started.ok || started.code !== 'started') {
      interaction = { npcId, activityId, started: { ok: started.ok, code: started.code, reason: started.reason ?? null }, completed: false };
      stage = `Game refused ${offered.label}: ${started.reason ?? started.code}`;
      updateDom(); draw();
      return interaction;
    }
    entry?.update(lifeState);
    const npcPoseDuringInteraction = inspectNpc(npcId).gamePose;
    const interactionSoles = sampleNativeNpcSoles(npcRoot, entry, 'during-interaction');
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
      const weights = nativeJawWeights(entry.group.getObjectByName(`canonical-crowd:npc:${npcId}`) ?? null);
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
    const returnedIdleSoles = sampleNativeNpcSoles(npcRoot, entry, 'returned-idle-after-interaction');
    const jawAfter = nativeJawWeights(entry?.group.getObjectByName(`canonical-crowd:npc:${npcId}`) ?? null);
    const jawRestored = ['Body', 'Teeth', 'Tongue'].every((name) => typeof jawBefore[name] === 'number'
      && Math.abs(jawAfter[name]! - jawBefore[name]!) < 1e-6);
    const afterView = viewLife(lifeState, { cityId: 'lagos', now: lifeState.t, seed: `office-fixture-view:${npcId}:${now}` }).social;
    regulars = afterView.here;
    const afterNpc = afterView.here.find((person) => person.id === npcId);
    const afterRelationship = afterView.relationships.find((person) => person.id === npcId);
    const response = lifeState.message ?? '';
    const nativeShoeContactEvidence = [placementIdleSoles, interactionSoles, returnedIdleSoles];
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
      nativeShoeContactEvidence,
      nativeShoeContactDiagnosticPass: nativeShoeContactEvidence.every((sample) => sample.bothFeetWithinFourMillimetersOfSceneFloor
        && sample.sides.every((side) => side.nativeLegReach.withinReach)),
      talkLoopStarted, talkLoopFrames, jawBefore, jawPeak, jawAfter, talkLoopSynchronized, jawRestored,
    };
    stage = `${offered.label} completed with ${npc.name}`;
    renderNpcCards(afterView.here.filter((person) => person.id === 'mrs-okafor' || person.id === 'dapo'));
    updateDom(); draw();
    return interaction;
  }

  async function awaitNpcAction(npcId: string, timeoutMs = 8000) {
    const action = activeNpcAction;
    if (!action || action.npcId !== npcId) throw new Error(`No active NPC action belongs to ${npcId}`);
    let timeout: number | undefined;
    let result: Record<string, unknown> | null;
    try {
      result = await Promise.race([
        action.promise,
        new Promise<null>((resolve) => { timeout = window.setTimeout(() => resolve(null), timeoutMs); }),
      ]);
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout);
    }
    if (activeNpcAction !== action) throw new Error(`NPC action identity changed while waiting for ${npcId}`);
    if (!result || result.npcId !== npcId || result.completed !== true) {
      throw new Error(`NPC action for ${npcId} did not complete within ${timeoutMs}ms`);
    }
    return result;
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
      // Clear a prior bounded transition/interaction before recording an idle
      // frame. The body pose and requested fixture mode must agree.
      standIn.settle();
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
    if (actor && isCloseCamera()) closeCameraRay = measureCloseCameraRay(actor);
    let actorPixel: number[] | null = null;
    let backgroundPixel: number[] | null = null;
    let actorPixelContrast = 0;
    let actorRegionPixels: Record<string, number[] | null> | null = null;
    let actorRegionContrast: Record<string, number> | null = null;
    let actorRegionBackgroundPixels: Record<string, number[] | null> | null = null;
    if (actor) {
      const bounds = new THREE.Box3().setFromObject(actor);
      const gl = renderer.getContext();
      const readPixel = (ndcX: number, ndcY: number) => {
        const x = Math.max(0, Math.min(renderer.domElement.width - 1, Math.round((ndcX + 1) * 0.5 * renderer.domElement.width)));
        const y = Math.max(0, Math.min(renderer.domElement.height - 1, Math.round((ndcY + 1) * 0.5 * renderer.domElement.height)));
        const pixel = new Uint8Array(4);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return [...pixel];
      };
      const readWorld = (worldPoint: THREE.Vector3) => {
        const point = worldPoint.clone().project(camera);
        return readPixel(point.x, point.y);
      };
      const belongsToActor = (object: THREE.Object3D) => {
        for (let current: THREE.Object3D | null = object; current; current = current.parent) if (current === actor) return true;
        return false;
      };
      const nearbyBackground = (worldPoint: THREE.Vector3) => {
        const point = worldPoint.clone().project(camera);
        const offsets = [0.06, 0.1, 0.15, 0.22, 0.3];
        for (const offset of offsets) {
          const directions: Array<[number, number]> = [[offset, 0], [-offset, 0], [0, offset], [0, -offset]];
          for (const [dx, dy] of directions) {
            const x = point.x + dx, y = point.y + dy;
            if (x <= -0.98 || x >= 0.98 || y <= -0.98 || y >= 0.98) continue;
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
            const firstHit = raycaster.intersectObject(world, true)[0];
            if (!firstHit || !belongsToActor(firstHit.object)) return readPixel(x, y);
          }
        }
        return backgroundPixel;
      };
      backgroundPixel = readPixel(0.94, 0.94);
      const head = actor.getObjectByName('Head');
      const headPoint = head?.getWorldPosition(new THREE.Vector3()) ?? bounds.getCenter(new THREE.Vector3()).setY(bounds.min.y + bounds.getSize(new THREE.Vector3()).y * 0.88);
      const torsoPoint = bounds.getCenter(new THREE.Vector3());
      const footPoint = bounds.getCenter(new THREE.Vector3()).setY(bounds.min.y + Math.min(0.12, bounds.getSize(new THREE.Vector3()).y * 0.06));
      const regions = { head: readWorld(headPoint), torso: readWorld(torsoPoint), feet: readWorld(footPoint) };
      const regionBackgrounds = { head: nearbyBackground(headPoint), torso: nearbyBackground(torsoPoint), feet: nearbyBackground(footPoint) };
      actorRegionPixels = regions;
      actorRegionBackgroundPixels = regionBackgrounds;
      actorPixel = regions.torso;
      const contrast = (pixel: number[] | null | undefined, background: number[] | null | undefined) => pixel && background
        ? Math.max(...pixel.slice(0, 3).map((channel, index) => Math.abs(channel - background[index]!))) : 0;
      actorRegionContrast = {
        head: contrast(regions.head, regionBackgrounds.head), torso: contrast(regions.torso, regionBackgrounds.torso),
        feet: contrast(regions.feet, regionBackgrounds.feet),
      };
      actorPixelContrast = contrast(actorPixel, regionBackgrounds.torso);
    }
    let canvasPng = '';
    let canvasPngError = '';
    if (actor && isCloseCamera()) {
      try { canvasPng = renderer.domElement.toDataURL('image/png').split(',')[1] ?? ''; }
      catch (error) { canvasPngError = error instanceof Error ? error.message : String(error); }
    }
    return { drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      actorPixel, backgroundPixel, actorPixelContrast, actorRegionPixels, actorRegionContrast, actorRegionBackgroundPixels,
      canvasPng, canvasPngError, actorFrame: actorFrame(actor) };
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
    if (readyState === 'ready' && !nativeNpcRefreshAttempted) {
      nativeNpcRefreshAttempted = true;
      try {
        nativeNpcRefreshWitness = refreshNativeNpcCrowd();
        draw(); updateDom();
      } catch (error) {
        errors.push(`Native NPC same-identity refresh failed: ${error instanceof Error ? error.message : String(error)}`);
        stage = errors.at(-1)!;
        updateDom();
      }
    }
    animationHandle = requestAnimationFrame(poll);
  }

  function inspectNpc(npcId: string) {
    const canonicalName = `canonical-crowd:npc:${npcId}`;
    const root = entry?.group.getObjectByName(canonicalName) ?? null;
    const provider = root?.userData.nativeGameProviderEvidence as { preparedNative?: unknown; representation?: unknown; requestedLifecyclePoses?: unknown } | undefined;
    return { ...nativeMeshEvidence(root), mounted: Boolean(root), preparedNative: provider?.preparedNative === true,
      representation: provider?.representation ?? 'provider-evidence-missing', requestedLifecyclePoses: provider?.requestedLifecyclePoses ?? null,
      gamePose: root?.userData.nativeGameNpcPose ?? null,
      jaw: nativeJawWeights(root) };
  }

  function refreshNativeNpcCrowd(): Record<string, unknown> {
    if (!entry || npcCrowd.length !== 2) throw new Error('Office NPC crowd is unavailable for refresh witness');
    const before = npcCrowd.map((person, index) => {
      const id = String(person.id ?? '');
      const root = entry!.group.getObjectByName(`canonical-crowd:${id}`);
      if (!root) throw new Error(`Canonical NPC ${id} is not mounted for refresh witness`);
      const solve = root.userData.nativeVenueFootContactSolve as { attempts?: unknown } | undefined;
      return { person, id, npcId: id.replace(/^npc:/, ''), index, position: root.position.clone(), attempts: solve?.attempts ?? null };
    });
    const refreshed = before.map(({ person, index, position }) => ({ ...person,
      x: position.x + (index === 0 ? 0.12 : -0.12),
      z: position.z + (index === 0 ? -0.08 : 0.08),
    }));
    const identityPreserved = before.every((entryBefore, index) => {
      const after = refreshed[index]!;
      return after.id === entryBefore.person.id && after.seed === entryBefore.person.seed;
    });
    if (!identityPreserved) throw new Error('Refresh changed canonical NPC identity or seed');
    entry.setCrowd(refreshed);
    npcCrowd = refreshed;
    const actors = before.map(({ id, npcId, person, position, attempts }) => {
      const root = entry!.group.getObjectByName(`canonical-crowd:${id}`);
      if (!root) throw new Error(`Canonical NPC ${id} was unmounted during refresh`);
      const afterPosition = root.position.clone();
      const solve = root.userData.nativeVenueFootContactSolve as { attempts?: unknown; status?: unknown } | undefined;
      const soles = sampleNativeNpcSoles(root, entry!, 'same-identity-refresh-idle');
      const postSolveContactPass = soles.sides.length === 2 && soles.sides.every((side) =>
        side.callbackSupportCoverageComplete && side.nonFiniteSampleCount === 0 && side.callbackNonFiniteSampleCount === 0
        && side.nearestAbsoluteGapToSceneFloor !== null && side.nearestAbsoluteGapToSceneFloor <= 0.004
        && side.minimumSignedGapToSceneFloor !== null && side.minimumSignedGapToSceneFloor >= -0.004
        && side.nativeLegReach.withinReach);
      const repositionMeters = afterPosition.distanceTo(position);
      const repeatedSolve = typeof attempts === 'number' && typeof solve?.attempts === 'number' && solve.attempts > attempts;
      return { id: npcId, seedBefore: person.seed, seedAfter: refreshed.find((candidate) => candidate.id === person.id)?.seed ?? null,
        identityPreserved: true, positionBefore: position.toArray(), positionAfter: afterPosition.toArray(), repositionMeters,
        solveAttemptsBefore: attempts, solveAttemptsAfter: solve?.attempts ?? null, repeatedSolve,
        solverStatus: solve?.status ?? null, postSolveContactPass, soleEvidence: soles };
    });
    return { status: identityPreserved && actors.length === 2 && actors.every((actor) => actor.repositionMeters > 0.05
      && actor.repeatedSolve && actor.solverStatus === 'pass' && actor.postSolveContactPass) ? 'pass' : 'fail',
      identityPreserved, actors };
  }

  function snapshot(): FixtureSnapshot {
    // The frozen SceneEntry type has no diagnostic property; the staged venue candidate exposes
    // the canonical crowd's live counts on its owned group userData.
    const crowd = crowdCounts();
    const playerAudit = actors.get('player');
    const playerEvidence = nativeMeshEvidence(playerAudit?.body.object ?? null);
    const playerPrepared = Boolean(playerAudit && 'preparedMetrics' in playerAudit.body);
    const playerPose = playerAudit?.body.pose ?? 'missing';
    const expectedPlayerPose = mode === 'idle' ? 'idle' : mode === 'walk' ? 'walk' : 'interact';
    const npcAudits = Object.fromEntries(['mrs-okafor', 'dapo'].map((id) => [id, inspectNpc(id)]));
    const npcNativeCoverage = Object.fromEntries(Object.entries(npcAudits).map(([id, audit]) => [id, audit.preparedNative]));
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
        representation: playerPrepared ? 'native-prepared' : 'legacy-fallback',
        requestedLifecyclePoses: [...PLAYER_BODY_POSES],
        authoredRig: playerEvidence.authoredRig,
        meshes: playerEvidence.meshes,
        morphs: playerEvidence.morphs,
        pose: playerPose,
        requestedMode: mode,
        poseMatchesRequestedMode: playerPose === expectedPlayerPose,
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
      nativeCoverage: { player: playerPrepared, npcs: npcNativeCoverage,
        allRequestedActorsPrepared: playerPrepared && Object.values(npcNativeCoverage).every(Boolean) },
      unsupportedProbe: unsupported,
      interaction,
      nativeNpcRefreshWitness,
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
      const unsupportedLook = { ...PLAYER_LOOK, appearance: { height: 'tall' as const, build: 'average' as const, ageAppearance: 'adult' as const } };
      const fallback = await loadGameBody(kit, unsupportedLook, `${PLAYER_SEED}:unsupported-probe`, 1,
        { scene: 'venue', role: 'player', poses: PLAYER_BODY_POSES });
      const acceptedAsNative = 'preparedMetrics' in fallback;
      fallback.dispose();
      unsupportedProbe = { acceptedAsNative, expectedNativeRefusal: !acceptedAsNative, requested: ['tall adult appearance with full player lifecycle'], fallbackDisposed: true };
      if (acceptedAsNative) errors.push('unsupported tall appearance probe was incorrectly accepted by native provider');
    } catch (error) {
      unsupportedProbe = { acceptedAsNative: false, expectedNativeRefusal: true, requested: ['tall adult appearance with full player lifecycle'], error: error instanceof Error ? error.message : String(error) };
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
    awaitNpcAction,
    scenePoses: PLAYER_BODY_POSES,
    dispose,
  };
  window.addEventListener('resize', resize);
  window.addEventListener('beforeunload', dispose, { once: true });
  text(status, stage);
  return fixture;
}

window.nativeGameFixture = createFixture();
void window.nativeGameFixture.start();
