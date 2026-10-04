/**
 * Small ownership adapters between the standalone model library and the game's scene hosts.
 * The hosts keep their own placement and animation loops; this module owns model resources.
 */
import type * as THREE from 'three';
import { buildVehicle, poseVehicle } from '../vehicles/index.ts';
import type { VehicleDetail, VehiclePose, VehicleTime, VehicleType } from '../vehicles/index.ts';
import { buildEnvironment } from '../environment/index.ts';
import type { EnvironmentTime } from '../environment/index.ts';

/** A lookup keyed by host time or mode name; unknown keys give undefined. */
type Table<T> = Record<string, T | undefined>;

const TRIP_VEHICLES: Readonly<Table<VehicleType>> = Object.freeze({ danfo: 'danfo', keke: 'keke', okada: 'okada', cab: 'cab', car: 'sedan' });
const ENVIRONMENT_TINT: Readonly<{ day: string } & Table<string>> = Object.freeze({ day: '#ffffff', dusk: '#e7b08d', night: '#8293aa' });

/** The per-time colours stored on the water material by createCityWaterMaterial. */
interface WaterPalette extends Table<THREE.Color> { day: THREE.Color }

/** What the scene hosts need of a model the adapters build. */
export interface TravelVehicle {
  object3D: THREE.Object3D;
  userData: ReturnType<typeof buildVehicle>['userData'];
  seatAnchor: THREE.Object3D;
  attachPassenger: (next: THREE.Object3D | null) => boolean;
  detachPassenger: (parent?: THREE.Object3D | null) => THREE.Object3D | null;
  pose: (distance?: number, heading?: number, riding?: boolean) => boolean;
  dispose: () => void;
  readonly disposed: boolean;
}

/** Switch off shadows on every mesh: the hosts draw their own. */
function flattenShadows(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });
}

const angleDelta = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/**
 * Build the one detailed vehicle used by the travelling player.
 * The returned adapter owns the vehicle, never its attached passenger.
 */
export function buildTravelVehicle(kind: string, { detail = 'street', time = 'day' }: { detail?: VehicleDetail; time?: VehicleTime } = {}): TravelVehicle | null {
  const type = TRIP_VEHICLES[kind];
  if (!type) return null;
  const model = buildVehicle(type, { detail, time, route: type === 'danfo' ? 'LAGOS' : undefined });
  const { object3D, userData } = model;
  const seatAnchor = userData.anchors.seats.at(-1) || userData.anchors.driver;
  const poseState = { distance: 0, steering: 0, bounce: 0, time: 0 } satisfies VehiclePose;
  const scenePose = { distance: 0, steering: 0, riding: false };
  let passenger: THREE.Object3D | null = null;
  let lastDistance: number | null = null;
  let lastHeading: number | null = null;
  let lastRiding: boolean | null = null;
  let disposed = false;
  object3D.userData.scenePose = scenePose;

  flattenShadows(object3D);

  function attachPassenger(next: THREE.Object3D | null): boolean {
    if (!next || disposed) return false;
    if (passenger === next && next.parent === seatAnchor) return false;
    passenger?.removeFromParent();
    passenger = next;
    seatAnchor.add(next);
    next.position.set(0, 0, 0);
    next.rotation.set(0, 0, 0);
    return true;
  }

  function detachPassenger(parent: THREE.Object3D | null = null): THREE.Object3D | null {
    if (!passenger) return null;
    const detached = passenger;
    passenger = null;
    detached.removeFromParent();
    parent?.add(detached);
    return detached;
  }

  /**
   * Steering compares each distinct route sample with the previous distinct sample. Replaying an
   * identical sample keeps its steering, so duplicate host frames are exactly idempotent.
   */
  function pose(distance = 0, heading = 0, riding = false): boolean {
    if (disposed) return false;
    const nextDistance = Number.isFinite(distance) ? distance : 0;
    const nextHeading = Number.isFinite(heading) ? heading : 0;
    const nextRiding = Boolean(riding);
    if (nextDistance !== lastDistance || nextHeading !== lastHeading || nextRiding !== lastRiding) {
      poseState.distance = nextDistance;
      poseState.steering = lastHeading === null ? 0 : Math.max(-0.5, Math.min(0.5, angleDelta(lastHeading, nextHeading) * 2.4));
      poseState.bounce = nextRiding ? 0.08 : 0;
      poseState.time = nextDistance * 0.7;
      scenePose.distance = nextDistance;
      scenePose.steering = poseState.steering;
      scenePose.riding = nextRiding;
      lastDistance = nextDistance;
      lastHeading = nextHeading;
      lastRiding = nextRiding;
    }
    poseVehicle(model, poseState);
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    detachPassenger();
    object3D.removeFromParent();
    userData.dispose();
  }

  return {
    object3D,
    userData,
    seatAnchor,
    attachPassenger,
    detachPassenger,
    pose,
    dispose,
    get disposed() { return disposed; },
  };
}

/** Build one signature watercraft for the city's existing boat layer. */
export function buildCityWaterVehicle(type = 'canoe', { scale = 1, time = 'day' }: { scale?: number; time?: VehicleTime } = {}) {
  if (type !== 'canoe' && type !== 'ferry') throw new RangeError(`Unknown city water vehicle: ${String(type)}`);
  const model = buildVehicle(type, { detail: 'map', time });
  const { object3D, userData } = model;
  const poseState = { bounce: 0.08, time: 0 };
  let disposed = false;
  object3D.scale.setScalar(scale);
  flattenShadows(object3D);

  function animate(seconds: number): void {
    if (disposed) return;
    poseState.time = Number.isFinite(seconds) ? seconds : 0;
    poseVehicle(model, poseState);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    object3D.removeFromParent();
    userData.dispose();
  }

  return {
    object3D,
    userData,
    triangles: userData.triangles,
    drawCalls: userData.drawCalls,
    animate,
    setTime() {},
    dispose,
    get disposed() { return disposed; },
  };
}

/** Build one bounded landmark model for a real city place. */
export function buildCityEnvironment(type: string, { scale = 1, time = 'day', color }: { scale?: number; time?: EnvironmentTime; color?: THREE.ColorRepresentation } = {}) {
  const model = buildEnvironment(type, { detail: 'map', time, color });
  const { object3D, userData } = model;
  let disposed = false;
  object3D.scale.setScalar(scale);
  flattenShadows(object3D);

  function setTime(next: string): void {
    const tint = ENVIRONMENT_TINT[next] || ENVIRONMENT_TINT.day;
    const material = (userData.parts.structure as THREE.Mesh | undefined)?.material as { color?: THREE.Color } | undefined; // an array material has no colour, as before
    if (material?.color) material.color.set(tint);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    object3D.removeFromParent();
    userData.dispose();
    object3D.clear();
  }

  return {
    object3D,
    userData,
    triangles: userData.triangles,
    drawCalls: userData.drawCalls,
    top: userData.dimensions.height * scale,
    setTime,
    dispose,
    get disposed() { return disposed; },
  };
}

/**
 * Clone the library lagoon's palette and physical material settings for the city's full-city
 * water surface and existing shoreline overlays. The rectangular source geometry is
 * disposed before this function returns.
 */
export function createCityWaterMaterial(texture: THREE.Texture): THREE.MeshStandardMaterial {
  const lagoon = buildEnvironment('lagoon', { detail: 'map' });
  const source = lagoon.userData.parts.water as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const color = source.geometry.getAttribute('color');
  const material = source.material.clone();
  material.vertexColors = false;
  material.color.setRGB(color.getX(0), color.getY(0), color.getZ(0));
  material.map = texture;
  material.needsUpdate = true;
  const base = material.color.clone();
  material.userData.sceneModel = 'lagoon';
  const palette: WaterPalette = {
    day: base.clone().offsetHSL(0, -0.03, 0.08),
    dusk: base.clone().offsetHSL(0.01, -0.04, 0.035),
    night: base.clone().multiplyScalar(0.55),
  };
  material.userData.palette = palette;
  lagoon.userData.dispose();
  return material;
}

/** Apply host time without replacing the host's water geometry or texture. */
export function setCityWaterTime(material: THREE.MeshStandardMaterial | null | undefined, time: string): boolean {
  const palette = material?.userData?.palette as WaterPalette | undefined;
  if (!material || !palette) return false;
  material.color.copy(palette[time] || palette.day);
  return true;
}
