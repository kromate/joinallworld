import * as THREE from 'three';
import { DETAIL, blockText, box, cylinder, geometryTriangles, mergeColored, profilePrism, torus } from './geometry.ts';
import type { ColoredGeometry, VehicleDetail } from './geometry.ts';

export type { ColoredGeometry, VehicleDetail };
export type VehicleTime = 'day' | 'night';
export type VehicleType = 'danfo' | 'keke' | 'okada' | 'cab' | 'sedan' | 'hatchback' | 'suv' | 'pickup' | 'molue' | 'brt' | 'tanker' | 'container' | 'ferry' | 'canoe' | 'airplane';

/** A mesh whose standard material carries the emissive intensity driven by poses. */
export type LightMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

/** An instanced mesh whose standard material carries a pose-driven emissive intensity. */
export type InstancedLight = THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

/** Options shared by every procedural vehicle. */
export interface VehicleOptions {
  detail?: VehicleDetail;
  time?: VehicleTime;
  color?: THREE.ColorRepresentation;
  colour?: THREE.ColorRepresentation;
  stripe?: THREE.ColorRepresentation;
  route?: string;
}

/** Parameters supplied by the host on each animation sample. */
export interface VehiclePose {
  /** Travel distance in world units. */
  distance?: number;
  /** Steering angle in radians. */
  steering?: number;
  /** Suspension or water-motion amplitude in world units. */
  bounce?: number;
  /** Door progress from closed zero to open one. */
  door?: number;
  /** Brake-light intensity. */
  brake?: number | boolean;
  indicator?: 'left' | 'right' | 'hazard' | boolean;
  /** Host time in seconds. */
  time?: number;
}

export interface WheelState {
  handle: THREE.Object3D;
  x: number;
  y: number;
  z: number;
  steered: boolean;
  matrix: THREE.Matrix4;
}

export interface DoorMotion {
  node: THREE.Object3D;
  mode: 'hinge' | 'slide' | 'lift';
  baseX: number;
  baseY: number;
  baseZ: number;
  baseRY: number;
  amount: number;
}

export interface VehicleParts {
  body: THREE.Object3D;
  wheels: THREE.Object3D[];
  wheelInstances: THREE.InstancedMesh[];
  steering: THREE.Object3D[];
  doors: THREE.Object3D[];
  headlights: InstancedLight | null;
  brakeLights: InstancedLight | null;
  indicators: [LightMesh | null, LightMesh | null];
}

export interface VehicleAnchors {
  driver: THREE.Object3D;
  door: THREE.Object3D;
  seats: THREE.Object3D[];
}

/** Public metadata shared by the wrapper and `object3D.userData`. */
export interface VehicleUserData {
  type: VehicleType;
  detail: VehicleDetail;
  triangles: number;
  drawCalls: number;
  dispose: () => void;
  parts: VehicleParts;
  anchors: VehicleAnchors;
}

interface PoseState {
  bodyY: number;
  wheelRadius: number;
  wheelStates: WheelState[];
  wheelInstances: THREE.InstancedMesh[];
  doorMotion: DoorMotion[];
  floatRoll: number;
  floatPitch: number;
  tailBase: number;
  indicatorBase: number;
}

interface VehicleMetadata extends VehicleUserData {
  _pose: PoseState;
}

export interface VehicleModel {
  object3D: THREE.Group;
  userData: VehicleUserData;
}

type Point = readonly [number, number];
type Profile = ReadonlyArray<Point>;
type Vec3 = readonly [number, number, number];

/** Mutable construction state discarded after finalization. */
interface VehicleContext {
  type: VehicleType;
  detail: VehicleDetail;
  time: VehicleTime;
  quality: { radialSegments: number; text: boolean; trim: boolean };
  root: THREE.Group;
  body: THREE.Group;
  staticGeometry: ColoredGeometry[];
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  materialCache: Map<string, THREE.MeshStandardMaterial>;
  wheels: THREE.Object3D[];
  wheelInstances: THREE.InstancedMesh[];
  wheelStates: WheelState[];
  steering: THREE.Object3D[];
  doors: THREE.Object3D[];
  doorMotion: DoorMotion[];
  seats: THREE.Object3D[];
  driver: THREE.Object3D;
  doorAnchor: THREE.Object3D | null;
  headlights: InstancedLight | null;
  brakeLights: InstancedLight | null;
  indicators: [LightMesh | null, LightMesh | null];
  wheelRadius: number;
}

type Builder = (context: VehicleContext, options: VehicleOptions) => void;

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return 'isMesh' in object && object.isMesh === true;
}

function isInstancedMesh(object: THREE.Mesh): object is THREE.InstancedMesh {
  return 'isInstancedMesh' in object && object.isInstancedMesh === true;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export const VEHICLE_TYPES: readonly VehicleType[] = Object.freeze([
  'danfo', 'keke', 'okada', 'cab', 'sedan', 'hatchback', 'suv', 'pickup',
  'molue', 'brt', 'tanker', 'container', 'ferry', 'canoe', 'airplane',
] as const);

export const VEHICLE_DETAILS: readonly VehicleDetail[] = Object.freeze(['map', 'street', 'showcase'] as const);

const TYPE_SET: ReadonlySet<string> = new Set(VEHICLE_TYPES);
const DETAIL_SET: ReadonlySet<string> = new Set(VEHICLE_DETAILS);
const PI = Math.PI;
const TYRE = '#191b1e';
const HUB = '#9aa1a7';
const GLASS = '#557889';
const DARK_GLASS = '#294551';
const CHROME = '#c8cdd0';
const BLACK = '#202226';
const LIGHT = '#fff2b0';
const TAIL = '#c9232b';
const AMBER = '#f29322';
const EMPTY_POSE: Readonly<VehiclePose> = Object.freeze({});

/**
 * Build one of the procedural vehicles at the origin, facing positive z.
 */

export function buildVehicle(type: VehicleType, options: VehicleOptions = {}): VehicleModel {
  if (!TYPE_SET.has(type)) throw new RangeError(`Unknown vehicle type: ${String(type)}`);
  const detail = options.detail === undefined ? 'street' : options.detail;
  if (!DETAIL_SET.has(detail)) throw new RangeError(`Unknown vehicle detail: ${String(detail)}`);
  const time = options.time === undefined ? 'day' : options.time;
  if (time !== 'day' && time !== 'night') throw new RangeError(`Unknown vehicle time: ${String(time)}`);
  const context = createContext(type, detail, time);
  BUILDERS[type](context, options);
  return finish(context);
}

/**
 * Apply a deterministic pose without creating geometry, materials, or temporary objects.
 */

export function poseVehicle(model: VehicleModel | THREE.Object3D, pose?: VehiclePose): VehicleModel | THREE.Object3D {
  const object3D = model && 'object3D' in model ? model.object3D : model;
  const data = object3D.userData as VehicleMetadata;
  const state = data._pose;
  const values = pose || EMPTY_POSE;
  const distance = isFiniteNumber(values.distance) ? values.distance : 0;
  const steering = isFiniteNumber(values.steering) ? Math.max(-0.65, Math.min(0.65, values.steering)) : 0;
  const bounce = isFiniteNumber(values.bounce) ? Math.max(-0.25, Math.min(0.25, values.bounce)) : 0;
  const time = isFiniteNumber(values.time) ? values.time : 0;
  const door = isFiniteNumber(values.door) ? Math.max(0, Math.min(1, values.door)) : 0;
  const brake = values.brake === true ? 1 : isFiniteNumber(values.brake) ? Math.max(0, Math.min(1, values.brake)) : 0;
  const wheelAngle = distance / state.wheelRadius;
  for (let i = 0; i < state.wheelStates.length; i += 1) {
    const wheel = state.wheelStates[i];
    if (!wheel) continue; // in range by the loop bound; only satisfies noUncheckedIndexedAccess
    const yaw = wheel.steered ? steering : 0;
    const cosYaw = Math.cos(yaw), sinYaw = Math.sin(yaw);
    const cosRoll = Math.cos(wheelAngle), sinRoll = Math.sin(wheelAngle);
    wheel.handle.rotation.x = wheelAngle;
    wheel.handle.rotation.y = yaw;
    wheel.matrix.set(
      cosYaw, sinYaw * sinRoll, sinYaw * cosRoll, wheel.x,
      0, cosRoll, -sinRoll, wheel.y,
      -sinYaw, cosYaw * sinRoll, cosYaw * cosRoll, wheel.z,
      0, 0, 0, 1,
    );
    for (let meshIndex = 0; meshIndex < state.wheelInstances.length; meshIndex += 1) {
      state.wheelInstances[meshIndex]?.setMatrixAt(i, wheel.matrix);
    }
  }
  for (const instances of state.wheelInstances) instances.instanceMatrix.needsUpdate = true;
  data.parts.body.position.y = state.bodyY + bounce * Math.sin(time * 7.5);
  data.parts.body.rotation.z = state.floatRoll * bounce * Math.sin(time * 1.7);
  data.parts.body.rotation.x = state.floatPitch * bounce * Math.cos(time * 1.3);
  for (let i = 0; i < state.doorMotion.length; i += 1) {
    const motion = state.doorMotion[i];
    if (!motion) continue; // in range by the loop bound
    motion.node.position.set(motion.baseX, motion.baseY, motion.baseZ);
    motion.node.rotation.set(0, motion.baseRY, 0);
    if (motion.mode === 'slide') motion.node.position.z = motion.baseZ - door * motion.amount;
    else if (motion.mode === 'lift') motion.node.rotation.x = -door * motion.amount;
    else motion.node.rotation.y = motion.baseRY + door * motion.amount;
  }
  if (data.parts.brakeLights) data.parts.brakeLights.material.emissiveIntensity = state.tailBase + brake * 3;
  const blink = Math.sin(time * PI * 4) >= 0 ? 1 : 0;
  const leftOn = values.indicator === 'left' || values.indicator === 'hazard' || values.indicator === true;
  const rightOn = values.indicator === 'right' || values.indicator === 'hazard' || values.indicator === true;
  if (data.parts.indicators[0]) data.parts.indicators[0].material.emissiveIntensity = leftOn ? blink * 3 : state.indicatorBase;
  if (data.parts.indicators[1]) data.parts.indicators[1].material.emissiveIntensity = rightOn ? blink * 3 : state.indicatorBase;
  return model;
}

/**
 */

function createContext(type: VehicleType, detail: VehicleDetail, time: VehicleTime): VehicleContext {
  const root = new THREE.Group();
  root.name = `vehicle:${type}`;
  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);
  const driver = anchor('driver', 0, 0, 0, 0);
  body.add(driver);
  return {
    type, detail, time, quality: DETAIL[detail], root, body,
    staticGeometry: [], geometries: [], materials: [], materialCache: new Map(),
    wheels: [], wheelInstances: [], wheelStates: [], steering: [], doors: [], doorMotion: [], seats: [], driver,
    doorAnchor: null, headlights: null, brakeLights: null, indicators: [null, null], wheelRadius: 0.4,
  };
}

/**
 */

function anchor(name: string, x: number, y: number, z: number, ry: number): THREE.Object3D {
  const node = new THREE.Object3D();
  node.name = name;
  node.position.set(x, y, z);
  node.rotation.y = ry;
  return node;
}

/**
 */

function addSeat(context: VehicleContext, x: number, y: number, z: number, ry = 0): THREE.Object3D {
  const seat = anchor(`seat:${context.seats.length}`, x, y, z, ry);
  context.body.add(seat);
  context.seats.push(seat);
  return seat;
}

/**
 */

function placeDriver(context: VehicleContext, x: number, y: number, z: number, ry = 0): void {
  context.driver.position.set(x, y, z);
  context.driver.rotation.y = ry;
}

/**
 */

function material(context: VehicleContext, color: THREE.ColorRepresentation, kind: 'plain' | 'glass' | 'light' = 'plain'): THREE.MeshStandardMaterial {
  const key = `${kind}:${new THREE.Color(color).getHexString()}`;
  const cached = context.materialCache.get(key);
  if (cached) return cached;
  const value = new THREE.Color(color);
  const options = kind === 'glass'
    ? { color: value, roughness: 0.18, metalness: 0.08, transparent: false }
    : kind === 'light'
      ? { color: value, emissive: value, emissiveIntensity: context.time === 'night' ? 2.2 : 0.12, roughness: 0.35 }
      : { color: value, roughness: 0.72, metalness: 0.03 };
  const created = new THREE.MeshStandardMaterial(options);
  context.materialCache.set(key, created);
  context.materials.push(created);
  return created;
}

/**
 */

function mesh(context: VehicleContext, geometry: THREE.BufferGeometry, meshMaterial: THREE.Material, parent: THREE.Object3D, name: string): THREE.Mesh {
  context.geometries.push(geometry);
  const result = new THREE.Mesh(geometry, meshMaterial);
  result.name = name;
  result.castShadow = false;
  result.receiveShadow = false;
  parent.add(result);
  return result;
}

/**
 */

function addWheels(context: VehicleContext, positions: ReadonlyArray<Vec3>, radius: number, width: number, steered: ReadonlySet<number> = new Set()): void {
  const geometry = new THREE.CylinderGeometry(radius, radius, width, context.quality.radialSegments, 1, false);
  geometry.rotateZ(PI / 2);
  context.geometries.push(geometry);
  const wheelMaterial = material(context, TYRE);
  const wheelInstances = new THREE.InstancedMesh(geometry, wheelMaterial, positions.length);
  wheelInstances.name = 'wheel-instances';
  wheelInstances.castShadow = false;
  wheelInstances.receiveShadow = false;
  wheelInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  context.root.add(wheelInstances);
  context.wheelInstances.push(wheelInstances);
  context.wheelRadius = radius;
  for (let i = 0; i < positions.length; i += 1) {
    const position = positions[i];
    if (!position) continue; // in range by the loop bound
    const handle = new THREE.Object3D();
    handle.name = steered.has(i) ? `steering:${i}` : `wheel:${i}`;
    handle.position.set(position[0], position[1], position[2]);
    context.root.add(handle);
    context.wheels.push(handle);
    if (steered.has(i)) context.steering.push(handle);
    context.wheelStates.push({
      handle,
      x: position[0], y: position[1], z: position[2],
      steered: steered.has(i),
      matrix: new THREE.Matrix4(),
    });
  }
  if (context.detail === 'showcase') {
    const hubGeometry = new THREE.CylinderGeometry(radius * 0.42, radius * 0.42, width + 0.015, 8, 1, false);
    hubGeometry.rotateZ(PI / 2);
    context.geometries.push(hubGeometry);
    const hubMaterial = material(context, HUB);
    const hubInstances = new THREE.InstancedMesh(hubGeometry, hubMaterial, positions.length);
    hubInstances.name = 'hub-instances';
    hubInstances.castShadow = false;
    hubInstances.receiveShadow = false;
    hubInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    context.root.add(hubInstances);
    context.wheelInstances.push(hubInstances);
  }
}

/**
 */

function addDoor(context: VehicleContext, options: {
  x: number; y: number; z: number; width: number; height: number; depth: number;
  color: THREE.ColorRepresentation; mode?: 'hinge' | 'slide' | 'lift'; amount?: number; hinge?: 'front' | 'rear';
}): void {
  const mode = options.mode || 'hinge';
  const amount = options.amount === undefined ? PI * 0.55 : options.amount;
  const hingeOffset = options.hinge === 'rear' ? options.depth / 2 : -options.depth / 2;
  const pivot = new THREE.Object3D();
  pivot.name = 'door-root';
  pivot.position.set(options.x, options.y, options.z + (mode === 'hinge' ? hingeOffset : 0));
  context.body.add(pivot);
  const geometry = new THREE.BoxGeometry(options.width, options.height, options.depth);
  const door = mesh(context, geometry, material(context, options.color), pivot, 'door-panel');
  if (mode === 'hinge') door.position.z = -hingeOffset;
  const doorAnchor = anchor('door', 0, -options.height * 0.36, mode === 'hinge' ? -hingeOffset : 0, 0);
  pivot.add(doorAnchor);
  context.doorAnchor = doorAnchor;
  context.doors.push(pivot);
  context.doorMotion.push({
    node: pivot, mode,
    baseX: pivot.position.x, baseY: pivot.position.y, baseZ: pivot.position.z,
    baseRY: pivot.rotation.y, amount,
  });
}

/**
 */

function addRoadLights(context: VehicleContext, options: { width: number; frontZ: number; rearZ: number; y: number; span?: number }): void {
  const span = options.span === undefined ? options.width * 0.31 : options.span;
  const lampGeometry = new THREE.BoxGeometry(options.width * 0.22, 0.18, 0.055);
  context.geometries.push(lampGeometry);
  context.headlights = new THREE.InstancedMesh(lampGeometry, material(context, LIGHT, 'light'), 2);
  context.headlights.name = 'headlights';
  context.headlights.castShadow = false;
  context.headlights.receiveShadow = false;
  context.headlights.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-span, options.y, options.frontZ));
  context.headlights.setMatrixAt(1, new THREE.Matrix4().makeTranslation(span, options.y, options.frontZ));
  context.headlights.instanceMatrix.needsUpdate = true;
  context.body.add(context.headlights);

  const tailGeometry = new THREE.BoxGeometry(options.width * 0.2, 0.16, 0.055);
  context.geometries.push(tailGeometry);
  context.brakeLights = new THREE.InstancedMesh(tailGeometry, material(context, TAIL, 'light'), 2);
  context.brakeLights.name = 'brake-lights';
  context.brakeLights.castShadow = false;
  context.brakeLights.receiveShadow = false;
  context.brakeLights.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-span, options.y, options.rearZ));
  context.brakeLights.setMatrixAt(1, new THREE.Matrix4().makeTranslation(span, options.y, options.rearZ));
  context.brakeLights.instanceMatrix.needsUpdate = true;
  context.body.add(context.brakeLights);

  const indicatorGeometry = new THREE.BoxGeometry(options.width * 0.11, 0.12, 0.06);
  context.geometries.push(indicatorGeometry);
  for (let side = 0; side < 2; side += 1) {
    const indicatorMaterial = material(context, side === 0 ? '#f29422' : '#f29423', 'light').clone();
    context.materials.push(indicatorMaterial);
    const indicator = new THREE.Mesh(indicatorGeometry, indicatorMaterial);
    indicator.name = side === 0 ? 'indicator:left' : 'indicator:right';
    indicator.castShadow = false;
    indicator.receiveShadow = false;
    context.body.add(indicator);
    indicator.position.set(side === 0 ? -options.width * 0.45 : options.width * 0.45, options.y, options.frontZ + 0.005);
    context.indicators[side] = indicator;
  }
}

/**
 */

function finish(context: VehicleContext): VehicleModel {
  if (!context.doorAnchor) {
    const pivot = new THREE.Object3D();
    pivot.name = 'door-root';
    context.body.add(pivot);
    const doorAnchor = anchor('door', 0, 0, 0, 0);
    pivot.add(doorAnchor);
    context.doorAnchor = doorAnchor;
    context.doors.push(pivot);
    context.doorMotion.push({ node: pivot, mode: 'hinge', baseX: 0, baseY: 0, baseZ: 0, baseRY: 0, amount: PI * 0.25 });
  }
  const staticGeometry = mergeColored(context.staticGeometry);
  const staticMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0.04 });
  context.materials.push(staticMaterial);
  mesh(context, staticGeometry, staticMaterial, context.body, 'static-body');
  let triangles = 0;
  let drawCalls = 0;
  const instancedMeshes: THREE.InstancedMesh[] = [];
  context.root.traverse((object) => {
    if (!isMesh(object)) return;
    if (isInstancedMesh(object)) instancedMeshes.push(object);
    triangles += geometryTriangles(object.geometry) * (isInstancedMesh(object) ? object.count : 1);
    drawCalls += Array.isArray(object.material) ? object.material.length : 1;
  });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const item of instancedMeshes) item.dispose();
    for (const item of context.geometries) item.dispose();
    for (const item of context.materials) item.dispose();
  };
  const parts: VehicleParts = {
    body: context.body,
    wheels: context.wheels,
    wheelInstances: context.wheelInstances,
    steering: context.steering,
    doors: context.doors,
    headlights: context.headlights,
    brakeLights: context.brakeLights,
    indicators: context.indicators,
  };
  const anchors: VehicleAnchors = { driver: context.driver, door: context.doorAnchor, seats: context.seats };
  const metadata: VehicleMetadata = {
    type: context.type,
    detail: context.detail,
    triangles,
    drawCalls,
    dispose,
    parts,
    anchors,
    _pose: {
      bodyY: context.body.position.y,
      wheelRadius: context.wheelRadius,
      wheelStates: context.wheelStates,
      wheelInstances: context.wheelInstances,
      doorMotion: context.doorMotion,
      floatRoll: context.type === 'ferry' || context.type === 'canoe' ? 0.25 : 0,
      floatPitch: context.type === 'ferry' || context.type === 'canoe' || context.type === 'airplane' ? 0.18 : 0,
      tailBase: context.time === 'night' ? 0.75 : 0.08,
      indicatorBase: context.time === 'night' ? 0.16 : 0.03,
    },
  };
  context.root.userData = metadata;
  poseVehicle(context.root, {});
  return { object3D: context.root, userData: metadata };
}

/**
 * Add a windscreen that follows a side-profile slope and sits just outside it.
 */

function slopedWindscreen(target: ColoredGeometry[], width: number, lower: Point, upper: Point, color: THREE.ColorRepresentation): void {
  const deltaZ = upper[0] - lower[0];
  const deltaY = upper[1] - lower[1];
  const angle = Math.atan2(deltaZ, deltaY);
  const height = Math.hypot(deltaZ, deltaY);
  const offset = 0.045;
  const centerY = (lower[1] + upper[1]) / 2 - Math.sin(angle) * offset;
  const centerZ = (lower[0] + upper[0]) / 2 + Math.cos(angle) * offset;
  box(target, 0, centerY, centerZ, width, height, 0.045, color, { rx: angle });
}

function buildCar(context: VehicleContext, width: number, length: number, height: number, bodyColor: THREE.ColorRepresentation, style: 'sedan' | 'hatchback' | 'suv' | 'cab'): void {
  const front = length / 2;
  const rear = -length / 2;
  const sill = 0.45;
  const roof = style === 'suv' ? height : height - 0.05;
  const profile: Profile = style === 'hatchback'
    ? [[rear, sill], [front, sill], [front - 0.08, 0.78], [front - 0.38, 0.96], [front - 1.14, 1.08], [front - 1.5, roof], [rear + 0.5, roof], [rear - 0.04, 0.84]]
    : style === 'suv'
      ? [[rear, sill], [front, sill], [front - 0.08, 0.88], [front - 0.48, 1.07], [front - 1.05, 1.14], [front - 1.3, roof], [rear + 0.28, roof], [rear - 0.05, 0.86]]
      : style === 'cab'
        ? [[rear, sill], [front, sill], [front - 0.06, 0.84], [front - 0.62, 1.02], [front - 1.05, roof], [rear + 0.72, roof], [rear + 0.38, 0.96], [rear - 0.04, 0.8]]
        : [[rear, sill], [front, sill], [front - 0.06, 0.78], [front - 0.42, 0.94], [front - 1.12, 1.05], [front - 1.48, roof], [rear + 1.0, roof], [rear + 0.62, 0.96], [rear + 0.34, 0.76]];
  profilePrism(context.staticGeometry, profile, width, bodyColor);
  if (context.detail !== 'map') box(context.staticGeometry, 0, 0.36, 0, width * 0.95, 0.22, length * 0.9, BLACK);
  const cabinFront = style === 'suv' ? front - 1.02 : style === 'hatchback' ? front - 1.14 : style === 'cab' ? front - 1.02 : front - 1.18;
  const cabinRear = style === 'suv' ? rear + 0.3 : style === 'hatchback' ? rear + 0.48 : style === 'cab' ? rear + 0.7 : rear + 0.82;
  const cabinZ = (cabinFront + cabinRear) / 2;
  const cabinLength = cabinFront - cabinRear;
  const windowY = roof - (style === 'suv' ? 0.38 : 0.33);
  const windowHeight = style === 'suv' ? 0.62 : 0.5;
  const sideX = width / 2 + 0.016;
  if (context.detail === 'map') {
    for (const side of [-1, 1]) box(context.staticGeometry, side * sideX, windowY, cabinZ, 0.04, windowHeight, cabinLength * 0.88, GLASS);
  } else {
    const pillarZ = cabinZ + (style === 'hatchback' ? 0.05 : 0.02);
    const frontDepth = cabinFront - pillarZ - 0.07;
    const rearDepth = pillarZ - cabinRear - 0.07;
    for (const side of [-1, 1]) {
      box(context.staticGeometry, side * sideX, windowY, pillarZ + frontDepth / 2 + 0.035, 0.04, windowHeight, frontDepth, DARK_GLASS);
      box(context.staticGeometry, side * sideX, windowY, cabinRear + rearDepth / 2 + 0.035, 0.04, windowHeight, rearDepth, GLASS);
      box(context.staticGeometry, side * (width / 2 + 0.025), windowY, pillarZ, 0.055, windowHeight + 0.08, 0.1, bodyColor);
    }
  }
  const windscreenLower: Point = style === 'suv'
    ? [front - 0.48, 1.07]
    : style === 'hatchback'
      ? [front - 0.38, 0.96]
      : style === 'cab'
        ? [front - 0.62, 1.02]
        : [front - 0.42, 0.94];
  const windscreenUpper: Point = style === 'suv'
    ? [front - 1.3, roof]
    : style === 'hatchback'
      ? [front - 1.5, roof]
      : style === 'cab'
        ? [front - 1.05, roof]
        : [front - 1.48, roof];
  slopedWindscreen(context.staticGeometry, width * 0.86, windscreenLower, windscreenUpper, DARK_GLASS);
  box(context.staticGeometry, 0, 0.48, front + 0.015, width * 0.9, 0.14, 0.08, CHROME);
  box(context.staticGeometry, 0, 0.48, rear - 0.015, width * 0.9, 0.14, 0.08, CHROME);
  if (style === 'cab') {
    box(context.staticGeometry, 0, roof + 0.12, cabinZ, 0.62, 0.2, 0.28, '#f5d022');
    if (context.detail !== 'map') {
      box(context.staticGeometry, -width / 2 - 0.012, 0.72, 0, 0.035, 0.16, length * 0.72, BLACK);
      box(context.staticGeometry, width / 2 + 0.012, 0.72, 0, 0.035, 0.16, length * 0.72, BLACK);
    }
  }
  if (context.quality.trim) {
    const shoulder = new THREE.Color(bodyColor).offsetHSL(0, 0, -0.09);
    box(context.staticGeometry, 0, roof + 0.025, cabinZ, width * 0.88, 0.08, cabinLength * 0.82, bodyColor);
    box(context.staticGeometry, 0, windowY, cabinRear - 0.012, width * 0.84, windowHeight * 0.92, 0.05, GLASS, { rx: 0.22 });
    for (const side of [-1, 1]) {
      box(context.staticGeometry, side * (width / 2 + 0.045), 0.94, 0, 0.06, 0.09, length * 0.76, shoulder);
      box(context.staticGeometry, side * (width / 2 + 0.052), 0.88, cabinZ, 0.065, 0.68, 0.035, BLACK);
      box(context.staticGeometry, side * (width / 2 + 0.058), 0.91, cabinZ + 0.22, 0.075, 0.07, 0.28, CHROME);
      torus(context.staticGeometry, side * (width / 2 + 0.035), 0.39, front - 0.78, style === 'suv' ? 0.49 : 0.43, 0.055, shoulder, { radialSegments: context.detail === 'showcase' ? 4 : 3, tubularSegments: context.detail === 'showcase' ? 12 : 8, arc: PI, ry: PI / 2 });
      torus(context.staticGeometry, side * (width / 2 + 0.035), 0.39, rear + 0.74, style === 'suv' ? 0.49 : 0.43, 0.055, shoulder, { radialSegments: context.detail === 'showcase' ? 4 : 3, tubularSegments: context.detail === 'showcase' ? 12 : 8, arc: PI, ry: PI / 2 });
    }
    box(context.staticGeometry, 0, 0.66, rear - 0.065, 0.5, 0.16, 0.06, '#e8e4d2');
  }
  addWheels(context, [
    [-width * 0.48, 0.39, front - 0.78], [width * 0.48, 0.39, front - 0.78],
    [-width * 0.48, 0.39, rear + 0.74], [width * 0.48, 0.39, rear + 0.74],
  ], style === 'suv' ? 0.43 : 0.37, 0.24, new Set([0, 1]));
  addDoor(context, { x: width / 2 + 0.01, y: 0.93, z: -0.42, width: 0.08, height: 0.88, depth: 0.94, color: bodyColor, amount: -PI * 0.55 });
  addRoadLights(context, { width, frontZ: front + 0.035, rearZ: rear - 0.035, y: 0.7 });
  placeDriver(context, -width * 0.23, 0.74, 0.42);
  addSeat(context, width * 0.23, 0.74, 0.42);
  addSeat(context, -width * 0.23, 0.74, -0.58);
  addSeat(context, width * 0.23, 0.74, -0.58);
}

function danfo(context: VehicleContext, options: VehicleOptions): void {
  const yellow = options.color || options.colour || '#f2be18';
  const stripe = options.stripe || BLACK;
  profilePrism(context.staticGeometry, [[-2.35, 0.5], [2.35, 0.5], [2.3, 2.28], [1.98, 2.55], [-2.22, 2.55], [-2.4, 2.28]], 2.08, yellow);
  box(context.staticGeometry, 0, 1.1, 0, 2.12, 0.18, 4.68, stripe);
  box(context.staticGeometry, 0, 1.85, 2.34, 1.82, 0.78, 0.06, DARK_GLASS, { rx: -0.12 });
  for (const side of [-1, 1]) box(context.staticGeometry, side * 1.055, 1.88, -0.2, 0.045, 0.73, 3.42, GLASS);
  box(context.staticGeometry, 0, 0.57, 2.4, 2.16, 0.2, 0.12, BLACK);
  box(context.staticGeometry, 0, 0.57, -2.4, 2.16, 0.2, 0.12, BLACK);
  if (context.quality.trim) {
    box(context.staticGeometry, 0, 1.86, 2.382, 0.1, 0.82, 0.055, yellow, { rx: -0.12 });
    box(context.staticGeometry, 0, 0.78, 2.425, 1.15, 0.23, 0.055, BLACK);
    for (const y of [0.71, 0.78, 0.85]) box(context.staticGeometry, 0, y, 2.458, 0.82, 0.025, 0.025, CHROME);
    cylinder(context.staticGeometry, 0, 0.98, 2.46, 0.12, 0.035, CHROME, { segments: 8, rx: PI / 2 });
    for (const side of [-1, 1]) {
      for (const z of [-1.45, -0.45, 0.55, 1.45]) box(context.staticGeometry, side * 1.078, 1.88, z, 0.06, 0.79, 0.08, yellow);
      box(context.staticGeometry, side * 1.086, 1.43, 0.16, 0.055, 1.48, 1.13, yellow);
      torus(context.staticGeometry, side * 1.09, 0.44, 1.48, 0.49, 0.055, stripe, { radialSegments: context.detail === 'showcase' ? 4 : 3, tubularSegments: context.detail === 'showcase' ? 12 : 8, arc: PI, ry: PI / 2 });
      torus(context.staticGeometry, side * 1.09, 0.44, -1.55, 0.49, 0.055, stripe, { radialSegments: context.detail === 'showcase' ? 4 : 3, tubularSegments: context.detail === 'showcase' ? 12 : 8, arc: PI, ry: PI / 2 });
      box(context.staticGeometry, side * 0.82, 2.78, -0.15, 0.06, 0.28, 3.35, CHROME);
    }
    for (const z of [-1.52, 0, 1.52]) box(context.staticGeometry, 0, 2.78, z, 1.7, 0.06, 0.06, CHROME);
    box(context.staticGeometry, 0, 2.72, -0.55, 0.9, 0.32, 1.05, '#a54539');
    box(context.staticGeometry, -0.55, 2.69, 0.18, 0.48, 0.26, 0.65, '#315f9f');
    box(context.staticGeometry, 0, 0.8, -2.425, 0.54, 0.18, 0.055, '#eae6d5');
  }
  if (context.quality.text) {
    const route = options.route || 'OSHODI';
    box(context.staticGeometry, 0, 2.22, 2.39, 1.62, 0.3, 0.05, '#22272a');
    blockText(context.staticGeometry, route, { x: 0, y: 2.22, z: 2.425, height: 0.2, color: '#f3ead3' });
  }
  addWheels(context, [[-1.02, 0.44, 1.48], [1.02, 0.44, 1.48], [-1.02, 0.44, -1.55], [1.02, 0.44, -1.55]], 0.43, 0.25, new Set([0, 1]));
  addDoor(context, { x: 1.075, y: 1.48, z: 0.2, width: 0.07, height: 1.45, depth: 1.08, color: yellow, mode: 'slide', amount: 1.12 });
  addRoadLights(context, { width: 2.08, frontZ: 2.435, rearZ: -2.435, y: 0.86 });
  placeDriver(context, -0.48, 1.22, 1.47);
  for (const z of [0.58, -0.3, -1.18]) {
    addSeat(context, -0.48, 1.14, z);
    addSeat(context, 0.48, 1.14, z);
  }
}

function keke(context: VehicleContext, options: VehicleOptions): void {
  const yellow = options.color || options.colour || '#efbd18';
  profilePrism(context.staticGeometry, [[-1.45, 0.38], [1.36, 0.38], [1.28, 0.82], [0.7, 1.03], [0.45, 2.06], [-1.35, 2.06]], 1.52, yellow);
  box(context.staticGeometry, 0, 1.45, 0.82, 1.18, 0.75, 0.05, DARK_GLASS, { rx: -0.18 });
  box(context.staticGeometry, 0, 0.75, -0.78, 1.46, 0.62, 1.15, BLACK);
  box(context.staticGeometry, 0, 2.1, -0.12, 1.62, 0.11, 2.78, options.stripe || '#258b57');
  for (const side of [-1, 1]) box(context.staticGeometry, side * 0.74, 1.48, -0.55, 0.05, 1.15, 1.7, BLACK);
  if (context.quality.trim) {
    box(context.staticGeometry, 0, 0.74, 1.36, 0.42, 0.24, 0.08, LIGHT);
    box(context.staticGeometry, 0, 1.76, -1.43, 1.12, 0.22, 0.06, '#e6e2d6');
    for (const side of [-1, 1]) box(context.staticGeometry, side * 0.87, 1.54, 0.7, 0.16, 0.1, 0.24, BLACK);
  }
  addWheels(context, [[0, 0.38, 1.28], [-0.76, 0.38, -1.02], [0.76, 0.38, -1.02]], 0.37, 0.22, new Set([0]));
  addDoor(context, { x: 0.785, y: 1.24, z: -0.65, width: 0.055, height: 1.15, depth: 1.05, color: yellow, mode: 'hinge', amount: -PI * 0.62 });
  addRoadLights(context, { width: 1.12, frontZ: 1.39, rearZ: -1.47, y: 0.75, span: 0.22 });
  placeDriver(context, 0, 0.96, 0.48);
  addSeat(context, -0.38, 0.92, -0.75);
  addSeat(context, 0.38, 0.92, -0.75);
}

function okada(context: VehicleContext, options: VehicleOptions): void {
  const color = options.color || options.colour || '#bd302d';
  cylinder(context.staticGeometry, 0, 0.74, 0, 0.09, 1.72, CHROME, { segments: context.quality.radialSegments, rx: PI / 2, topScale: 0.8 });
  box(context.staticGeometry, 0, 0.82, -0.18, 0.3, 0.28, 1.32, color, { rx: -0.05 });
  profilePrism(context.staticGeometry, [[-0.25, 0.74], [0.68, 0.74], [0.48, 1.2], [-0.12, 1.13]], 0.36, color);
  box(context.staticGeometry, 0, 1.02, -0.52, 0.42, 0.13, 1.02, BLACK);
  box(context.staticGeometry, 0, 1.28, 0.77, 0.9, 0.07, 0.07, CHROME);
  box(context.staticGeometry, 0, 0.98, 1.02, 0.28, 0.22, 0.08, LIGHT);
  if (context.quality.trim) {
    for (const side of [-1, 1]) box(context.staticGeometry, side * 0.19, 0.52, -0.45, 0.08, 0.08, 0.82, CHROME);
    box(context.staticGeometry, 0, 0.62, -1.0, 0.52, 0.07, 0.16, CHROME);
    box(context.staticGeometry, 0, 0.63, 1.02, 0.2, 0.08, 0.12, AMBER);
  }
  addWheels(context, [[0, 0.43, 1.03], [0, 0.43, -1.02]], 0.43, 0.17, new Set([0]));
  addDoor(context, { x: 0, y: 0.83, z: -0.05, width: 0.32, height: 0.08, depth: 0.55, color: color, mode: 'lift', amount: 0.35 });
  placeDriver(context, 0, 1.05, 0.18);
  addSeat(context, 0, 1.08, -0.62);
}

function cab(context: VehicleContext, options: VehicleOptions): void { buildCar(context, 1.88, 4.18, 1.62, options.color || options.colour || '#f0c51d', 'cab'); }
function sedan(context: VehicleContext, options: VehicleOptions): void { buildCar(context, 1.9, 4.35, 1.58, options.color || options.colour || '#8f2f32', 'sedan'); }
function hatchback(context: VehicleContext, options: VehicleOptions): void { buildCar(context, 1.82, 3.75, 1.62, options.color || options.colour || '#2e6f8f', 'hatchback'); }
function suv(context: VehicleContext, options: VehicleOptions): void { buildCar(context, 2.03, 4.45, 1.92, options.color || options.colour || '#385d4d', 'suv'); }

function pickup(context: VehicleContext, options: VehicleOptions): void {
  const color = options.color || options.colour || '#d2d0c8';
  profilePrism(context.staticGeometry, [[-2.35, 0.48], [2.35, 0.48], [2.25, 1.02], [1.2, 1.08], [0.7, 1.86], [-0.3, 1.86], [-0.72, 1.02], [-2.35, 1.02]], 2.0, color);
  for (const side of [-1, 1]) box(context.staticGeometry, side * 1.012, 1.48, 0.3, 0.04, 0.6, 1.02, GLASS);
  slopedWindscreen(context.staticGeometry, 1.78, [1.2, 1.08], [0.7, 1.86], DARK_GLASS);
  box(context.staticGeometry, 0, 0.8, -1.52, 1.83, 0.55, 1.5, '#363a3c');
  for (const side of [-1, 1]) box(context.staticGeometry, side * 0.94, 1.28, -1.5, 0.11, 0.55, 1.58, color);
  if (context.detail !== 'map') box(context.staticGeometry, 0, 0.48, -2.4, 2.05, 0.2, 0.1, CHROME);
  if (context.quality.trim) {
    const shoulder = new THREE.Color(color).offsetHSL(0, 0, -0.09);
    box(context.staticGeometry, 0, 1.9, 0.18, 1.82, 0.08, 1.12, color);
    box(context.staticGeometry, 0, 1.46, -0.34, 1.75, 0.56, 0.05, GLASS, { rx: 0.12 });
    box(context.staticGeometry, 0, 1.13, -2.26, 1.74, 0.08, 0.1, color);
    box(context.staticGeometry, 0, 0.69, -2.43, 0.54, 0.16, 0.055, '#e7e4d8');
    for (const side of [-1, 1]) {
      box(context.staticGeometry, side * 1.025, 1.48, 0.28, 0.055, 0.68, 0.09, color);
      box(context.staticGeometry, side * 1.045, 0.96, 0, 0.06, 0.08, 3.8, shoulder);
      box(context.staticGeometry, side * 1.055, 1.4, 0.88, 0.13, 0.1, 0.25, BLACK);
      torus(context.staticGeometry, side * 1.035, 0.45, 1.48, 0.52, 0.06, shoulder, { radialSegments: context.detail === 'showcase' ? 4 : 3, tubularSegments: context.detail === 'showcase' ? 12 : 8, arc: PI, ry: PI / 2 });
      torus(context.staticGeometry, side * 1.035, 0.45, -1.56, 0.52, 0.06, shoulder, { radialSegments: context.detail === 'showcase' ? 4 : 3, tubularSegments: context.detail === 'showcase' ? 12 : 8, arc: PI, ry: PI / 2 });
    }
  }
  addWheels(context, [[-0.99, 0.45, 1.48], [0.99, 0.45, 1.48], [-0.99, 0.45, -1.56], [0.99, 0.45, -1.56]], 0.46, 0.26, new Set([0, 1]));
  addDoor(context, { x: 1.015, y: 1.12, z: 0.08, width: 0.08, height: 1.08, depth: 0.98, color, amount: -PI * 0.55 });
  addRoadLights(context, { width: 2, frontZ: 2.41, rearZ: -2.42, y: 0.77 });
  placeDriver(context, -0.46, 0.84, 0.42);
  addSeat(context, 0.46, 0.84, 0.42);
  addSeat(context, 0, 0.96, -1.58);
}

function bus(context: VehicleContext, options: VehicleOptions, modern: boolean): void {
  const color = options.color || options.colour || (modern ? '#2372ad' : '#e2b51b');
  const stripe = options.stripe || (modern ? '#d6e8ee' : '#292a2c');
  const length = modern ? 9.2 : 8.4;
  const half = length / 2;
  profilePrism(context.staticGeometry, [[-half, 0.55], [half, 0.55], [half - 0.08, 2.82], [half - 0.42, 3.15], [-half + 0.18, 3.15], [-half - 0.05, 2.92]], 2.5, color);
  box(context.staticGeometry, 0, 1.18, 0, 2.53, 0.24, length, stripe);
  box(context.staticGeometry, 0, 2.3, half + 0.02, 2.18, 0.9, 0.06, DARK_GLASS, { rx: -0.08 });
  for (const side of [-1, 1]) box(context.staticGeometry, side * 1.267, 2.3, -0.25, 0.045, 0.9, length - 0.95, GLASS);
  box(context.staticGeometry, 0, 0.64, half + 0.08, 2.58, 0.24, 0.12, BLACK);
  box(context.staticGeometry, 0, 0.64, -half - 0.08, 2.58, 0.24, 0.12, BLACK);
  if (context.quality.trim) {
    for (const side of [-1, 1]) {
      for (let z = -half + 0.8; z < half - 0.3; z += 1.15) box(context.staticGeometry, side * 1.285, 2.3, z, 0.055, 0.95, 0.08, color);
      box(context.staticGeometry, side * 1.34, 1.42, half - 0.35, 0.14, 0.1, 0.28, BLACK);
    }
    if (!modern) {
      box(context.staticGeometry, -0.72, 3.34, -0.55, 0.68, 0.32, 1.1, '#9f4538');
      box(context.staticGeometry, 0.1, 3.3, 0.1, 0.58, 0.25, 0.78, '#315c96');
    }
  }
  if (context.quality.text) {
    const route = options.route || (modern ? 'BRT LAGOS' : 'MOLUE');
    box(context.staticGeometry, 0, 2.95, half + 0.08, 1.9, 0.32, 0.06, '#20252a');
    blockText(context.staticGeometry, route, { x: 0, y: 2.95, z: half + 0.12, height: 0.2, color: '#f4ead0' });
  }
  addWheels(context, [[-1.22, 0.52, half - 1.35], [1.22, 0.52, half - 1.35], [-1.22, 0.52, -half + 1.45], [1.22, 0.52, -half + 1.45]], 0.52, 0.29, new Set([0, 1]));
  addDoor(context, { x: 1.29, y: 1.55, z: half - 2.08, width: 0.07, height: 1.78, depth: 1.2, color, mode: 'slide', amount: 1.32 });
  addRoadLights(context, { width: 2.5, frontZ: half + 0.145, rearZ: -half - 0.145, y: 0.94 });
  placeDriver(context, -0.65, 1.25, half - 0.95);
  const rows = modern ? 7 : 6;
  for (let row = 0; row < rows; row += 1) {
    const z = half - 2.45 - row * 0.92;
    addSeat(context, -0.72, 1.1, z);
    addSeat(context, 0.72, 1.1, z);
  }
}

function molue(context: VehicleContext, options: VehicleOptions): void { bus(context, options, false); }
function brt(context: VehicleContext, options: VehicleOptions): void { bus(context, options, true); }

function truck(context: VehicleContext, options: VehicleOptions, cargo: 'tanker' | 'container'): void {
  const cabColor = options.color || options.colour || (cargo === 'tanker' ? '#d9d5c8' : '#245f8d');
  const half = 4.75;
  profilePrism(context.staticGeometry, [[0.3, 0.58], [half, 0.58], [half, 2.28], [4.42, 2.72], [2.75, 2.72], [2.35, 1.18], [0.3, 1.18]], 2.35, cabColor);
  if (context.detail !== 'map') box(context.staticGeometry, 0, 0.78, -1.05, 2.25, 0.28, 6.5, BLACK);
  slopedWindscreen(context.staticGeometry, 2.15, [4.75, 2.28], [4.42, 2.72], DARK_GLASS);
  if (cargo === 'tanker') {
    cylinder(context.staticGeometry, 0, 2.05, -1.6, 1.18, 5.7, options.stripe || '#b9bec1', { segments: context.quality.radialSegments, rx: PI / 2 });
    box(context.staticGeometry, 0, 1.13, -1.6, 1.72, 0.13, 5.7, CHROME);
    if (context.quality.trim) {
      for (const z of [-3.7, -2.3, -0.9, 0.5]) cylinder(context.staticGeometry, 0, 2.05, z, 1.205, 0.08, '#575d61', { segments: context.quality.radialSegments, rx: PI / 2 });
      box(context.staticGeometry, 0, 3.25, -1.7, 0.5, 0.12, 4.8, CHROME);
    }
  } else {
    const containerColor = options.stripe || '#a34432';
    box(context.staticGeometry, 0, 2.05, -1.72, 2.38, 2.55, 5.78, containerColor);
    if (context.quality.trim) {
      for (let z = -4.3; z <= 0.82; z += 0.48) box(context.staticGeometry, 0, 2.05, z, 2.43, 2.42, 0.055, '#7f3329');
      box(context.staticGeometry, 0, 2.05, -4.64, 2.18, 2.3, 0.06, '#743128');
    }
  }
  if (context.quality.trim) {
    for (const side of [-1, 1]) box(context.staticGeometry, side * 1.25, 2.12, 4.2, 0.13, 0.1, 0.3, BLACK);
    box(context.staticGeometry, 0, 0.88, 4.78, 0.62, 0.18, 0.06, '#e7e3d7');
  }
  addWheels(context, [
    [-1.16, 0.52, 3.05], [1.16, 0.52, 3.05],
    [-1.16, 0.52, -2.5], [1.16, 0.52, -2.5],
    [-1.16, 0.52, -3.65], [1.16, 0.52, -3.65],
  ], 0.53, 0.3, new Set([0, 1]));
  addDoor(context, { x: 1.2, y: 1.72, z: 3.15, width: 0.08, height: 1.46, depth: 1.18, color: cabColor, amount: -PI * 0.55 });
  addRoadLights(context, { width: 2.35, frontZ: 4.79, rearZ: -4.68, y: 0.9 });
  placeDriver(context, -0.53, 1.4, 3.55);
  addSeat(context, 0.53, 1.4, 3.55);
}

function tanker(context: VehicleContext, options: VehicleOptions): void { truck(context, options, 'tanker'); }
function container(context: VehicleContext, options: VehicleOptions): void { truck(context, options, 'container'); }

function ferry(context: VehicleContext, options: VehicleOptions): void {
  const color = options.color || options.colour || '#e7e2d4';
  profilePrism(context.staticGeometry, [[-4.3, 0], [4.25, 0], [3.65, 0.75], [-3.85, 0.75]], 3.0, options.stripe || '#246b89', { y: 0.05 });
  box(context.staticGeometry, 0, 0.8, -0.2, 2.75, 0.22, 6.9, color);
  box(context.staticGeometry, 0, 1.38, -0.35, 2.45, 0.9, 3.25, color);
  box(context.staticGeometry, 0, 1.52, 1.38, 2.2, 0.58, 0.06, DARK_GLASS);
  box(context.staticGeometry, 0, 1.52, -2.02, 2.2, 0.58, 0.06, GLASS);
  if (context.quality.trim) {
    box(context.staticGeometry, 0, 2.02, -0.4, 2.8, 0.1, 3.8, options.stripe || '#d28a24');
    for (const side of [-1, 1]) for (const z of [-2.8, -1.6, -0.4, 0.8, 2.0]) box(context.staticGeometry, side * 1.35, 1.12, z, 0.06, 0.62, 0.06, CHROME);
    cylinder(context.staticGeometry, 0, 2.55, -1.05, 0.12, 1.1, '#4d5559', { segments: 6 });
    box(context.staticGeometry, 0, 3.03, -1.05, 1.25, 0.07, 0.07, '#4d5559');
  }
  addDoor(context, { x: 0, y: 0.68, z: 3.6, width: 1.8, height: 0.12, depth: 1.3, color, mode: 'lift', amount: PI * 0.55 });
  placeDriver(context, -0.52, 1.25, 0.6);
  for (const z of [-1.2, -0.2, 0.8, 1.8]) {
    addSeat(context, -0.62, 0.92, z, PI / 2);
    addSeat(context, 0.62, 0.92, z, -PI / 2);
  }
}

/**
 * Add an open, pointed V-hull whose plan narrows toward both ends.
 */

function canoeHull(target: ColoredGeometry[], color: THREE.ColorRepresentation): void {
  const stations: [Vec3, Vec3, Vec3, Vec3, Vec3] = [
    [-2.8, 0.04, 0.36], [-2.15, 0.43, 0.63], [0, 0.55, 0.72],
    [2.15, 0.43, 0.63], [2.8, 0.04, 0.36],
  ];
  const positions: number[] = [];
  const triangle = (a: Vec3, b: Vec3, c: Vec3): number => positions.push(...a, ...b, ...c);
  for (let index = 0; index < stations.length - 1; index += 1) {
    const current = stations[index], next = stations[index + 1];
    if (!current || !next) continue; // in range by the loop bound
    const leftA: Vec3 = [-current[1], current[2], current[0]];
    const leftB: Vec3 = [-next[1], next[2], next[0]];
    const rightA: Vec3 = [current[1], current[2], current[0]];
    const rightB: Vec3 = [next[1], next[2], next[0]];
    const keelA: Vec3 = [0, -0.12, current[0]];
    const keelB: Vec3 = [0, -0.12, next[0]];
    triangle(leftA, keelA, keelB);
    triangle(leftA, keelB, leftB);
    triangle(rightA, rightB, keelB);
    triangle(rightA, keelB, keelA);
    const innerLeftA: Vec3 = [-current[1] * .92, current[2] - .025, current[0]];
    const innerLeftB: Vec3 = [-next[1] * .92, next[2] - .025, next[0]];
    const innerRightA: Vec3 = [current[1] * .92, current[2] - .025, current[0]];
    const innerRightB: Vec3 = [next[1] * .92, next[2] - .025, next[0]];
    const innerKeelA: Vec3 = [0, -.075, current[0]], innerKeelB: Vec3 = [0, -.075, next[0]];
    triangle(innerLeftA, innerKeelB, innerKeelA);
    triangle(innerLeftA, innerLeftB, innerKeelB);
    triangle(innerRightA, innerKeelB, innerRightB);
    triangle(innerRightA, innerKeelA, innerKeelB);
    triangle(leftA, leftB, innerLeftA); triangle(leftB, innerLeftB, innerLeftA);
    triangle(rightA, innerRightA, rightB); triangle(rightB, innerRightA, innerRightB);
  }
  const rear = stations[0], front = stations[4];
  triangle([-rear[1], rear[2], rear[0]], [rear[1], rear[2], rear[0]], [0, -0.12, rear[0]]);
  triangle([front[1], front[2], front[0]], [-front[1], front[2], front[0]], [0, -0.12, front[0]]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  target.push({ geometry, color: new THREE.Color(color) });
}

function canoe(context: VehicleContext, options: VehicleOptions): void {
  const color = options.color || options.colour || '#8f542e';
  canoeHull(context.staticGeometry, color);
  box(context.staticGeometry, 0, 0.3, 0, 0.68, 0.05, 3.8, '#392b24');
  for (const side of [-1, 1]) box(context.staticGeometry, side * 0.5, 0.68, 0, 0.09, 0.13, 4.05, '#684126');
  for (const z of [-1.12, 0, 1.12]) box(context.staticGeometry, 0, 0.67, z, 0.86, 0.08, 0.2, '#d8b777');
  if (context.quality.trim) {
    box(context.staticGeometry, 0, 0.92, -0.2, 0.08, 0.08, 3.05, '#63432b', { rz: 0.38 });
    box(context.staticGeometry, 0.66, 0.44, 1.25, 0.13, 0.05, 0.62, '#b47a3f', { rz: 0.22 });
  }
  addDoor(context, { x: 0, y: 0.47, z: 0, width: 0.62, height: 0.06, depth: 0.52, color: '#d8b777', mode: 'lift', amount: 0.35 });
  placeDriver(context, 0, 0.52, 0.82, PI);
  addSeat(context, 0, 0.52, -0.05, PI);
  addSeat(context, 0, 0.52, -0.92, PI);
}

function airplane(context: VehicleContext, options: VehicleOptions): void {
  const color = options.color || options.colour || '#e5e7e5';
  const stripe = options.stripe || '#2a6c9c';
  cylinder(context.staticGeometry, 0, 1.65, 0, 0.72, 8.8, color, { segments: context.quality.radialSegments, rx: PI / 2, topScale: 0.74 });
  profilePrism(context.staticGeometry, [[-0.1, 1.35], [0.2, 1.35], [3.35, 1.25], [3.65, 1.42], [0.22, 1.82]], 9.1, color);
  profilePrism(context.staticGeometry, [[-4.35, 1.4], [-3.42, 1.42], [-3.82, 3.25], [-4.25, 3.25]], 0.18, stripe);
  profilePrism(context.staticGeometry, [[-4.12, 1.52], [-2.95, 1.52], [-3.65, 1.86]], 3.55, color);
  box(context.staticGeometry, 0, 1.65, 0.42, 0.78, 0.16, 7.4, stripe);
  box(context.staticGeometry, 0, 1.82, 4.18, 0.78, 0.34, 0.13, DARK_GLASS);
  if (context.quality.trim) {
    for (const side of [-1, 1]) for (let z = -2.65; z <= 2.55; z += 0.56) box(context.staticGeometry, side * 0.69, 1.92, z, 0.04, 0.13, 0.22, DARK_GLASS);
    for (const side of [-1, 1]) cylinder(context.staticGeometry, side * 2.12, 1.18, 0.35, 0.48, 1.4, stripe, { segments: context.quality.radialSegments, rx: PI / 2, topScale: 0.72 });
  }
  addWheels(context, [[-0.82, 0.5, -0.75], [0.82, 0.5, -0.75], [0, 0.48, 3.05]], 0.28, 0.16, new Set([2]));
  addDoor(context, { x: 0.72, y: 1.72, z: 2.45, width: 0.07, height: 0.82, depth: 0.66, color, amount: -PI * 0.72 });
  placeDriver(context, -0.22, 1.62, 3.55);
  addSeat(context, 0.22, 1.62, 3.55);
  for (const z of [2.35, 1.55, 0.75, -0.05, -0.85, -1.65]) {
    addSeat(context, -0.25, 1.58, z);
    addSeat(context, 0.25, 1.58, z);
  }
}

const BUILDERS: Readonly<Record<VehicleType, Builder>> = Object.freeze({
  danfo, keke, okada, cab, sedan, hatchback, suv, pickup, molue, brt,
  tanker, container, ferry, canoe, airplane,
});
