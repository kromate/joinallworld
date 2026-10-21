/**
 * Small ownership adapters between the standalone model library and the game's scene hosts.
 * The hosts keep their own placement and animation loops; this module owns model resources.
 */
import type * as THREE from 'three';
import { Vector3 } from 'three';
import { buildVehicle, poseVehicle } from '../vehicles/index.ts';
import type { VehicleDetail, VehiclePose, VehicleTime, VehicleType } from '../vehicles/index.ts';
import { buildEnvironment } from '../environment/index.ts';
import type { GlbKind, GlbLod, GlbTemplate, GlbVehicle } from '../vehicles/glb-parts.ts';
import type { GlbRequest } from '../vehicles/glb-parts.ts';
import type { EnvironmentTime } from '../environment/index.ts';

/** A lookup keyed by host time or mode name; unknown keys give undefined. */
type Table<T> = Record<string, T | undefined>;

const TRIP_VEHICLES: Readonly<Table<VehicleType>> = Object.freeze({ danfo: 'danfo', keke: 'keke', okada: 'okada', cab: 'cab', car: 'sedan', bus: 'danfo' });
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
  /** Lamps on (dusk, night) or off, for an authored model; false when this vehicle has none or nothing changed. */
  setLights: (on: boolean) => boolean;
  /** The near model for a close view, the far one otherwise; true when the drawing changed at once. */
  setLod: (lod: 'near' | 'far') => boolean;
  /** True once the authored model has replaced the procedural drawing. */
  readonly authored: boolean;
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

const ZERO = new Vector3();
const angleDelta = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/** Who sits where in each trip vehicle's authored model: the player takes `player`, figures fill `crew`. */
interface GlbTrip { kind: GlbKind; variant?: string; player: string; crew: readonly CrewSeat[] }
interface CrewSeat { seat: string; shirt: string; helmet?: string }
const GLB_TRIPS: Readonly<Table<GlbTrip>> = Object.freeze({
  // Closed bodies (their windows are painted): a figure inside could not be seen, so none is drawn.
  danfo: { kind: 'danfo', player: 'seat_3', crew: [] },
  bus: { kind: 'bus', player: 'seat_3', crew: [] },
  keke: { kind: 'keke', player: 'seat_1', crew: [{ seat: 'seat_driver', shirt: '#d9d4c4' }] },
  okada: { kind: 'okada', player: 'seat_1', crew: [{ seat: 'seat_driver', shirt: '#2b5fa8', helmet: '#e8a643' }] },
  cab: { kind: 'saloon', variant: 'green', player: 'seat_1', crew: [] },
  car: { kind: 'saloon', variant: 'red', player: 'seat_driver', crew: [] },
});
/** The model each owned car (a CarId) is drawn with when the player drives it: the player is at the wheel. */
const CAR_TRIPS: Readonly<Table<GlbTrip>> = Object.freeze({
  'agama-150': { kind: 'okada', player: 'seat_driver', crew: [] },
  'tokunbo-saloon': { kind: 'saloon', player: 'seat_driver', crew: [] },
  'oga-sedan': { kind: 'saloon', variant: 'black', player: 'seat_driver', crew: [] },
  'marina-v6': { kind: 'saloon', variant: 'blue', player: 'seat_driver', crew: [] },
  'boardroom-330': { kind: 'saloon', variant: 'red', player: 'seat_driver', crew: [] },
  'chief-suv': { kind: 'suv', variant: 'black', player: 'seat_driver', crew: [] },
  'harmattan-cruiser': { kind: 'suv', variant: 'white', player: 'seat_driver', crew: [] },
  'atlantic-x': { kind: 'suv', variant: 'red', player: 'seat_driver', crew: [] },
  'atlantic-grand': { kind: 'suv', player: 'seat_driver', crew: [] },
});
const SKINS = ['#845236', '#6b4128', '#a06a45'];
/** Where the seated avatar's origin sits above the seat empty, in metres, per model. */
const PASSENGER_LIFT: Readonly<Partial<Record<GlbKind, Vector3>>> = Object.freeze({ danfo: new Vector3(0, -0.15, 0), bus: new Vector3(0, -0.15, 0) });
/** The seated avatar's size in each model's cabin, where the roof is low. */
const PASSENGER_SCALE: Readonly<Partial<Record<GlbKind, number>>> = Object.freeze({ saloon: 0.62, suv: 0.75 });

/**
 * The authored models (src/models/vehicles/glb.ts) are fetched by the host and handed to the adapter through this seam, so the adapter works
 * (with the procedural vehicles alone) where no loader exists: node tests and a build that failed to fetch the models.
 */
export interface GlbSource {
  /** The model's one mesh with its transform baked in, for instancing. */
  instancing(template: GlbTemplate): { geometry: THREE.BufferGeometry; material: THREE.Material } | null;
  peek(request: GlbRequest): GlbTemplate | null;
  load(request: GlbRequest): Promise<GlbTemplate | null>;
  instantiate(template: GlbTemplate, options: { night: boolean }): GlbVehicle;
}
let source: GlbSource | null = null;
/** Called once by the host after it has fetched the lazy vehicle module (see loadGlbSource). */
export function useGlbSource(next: GlbSource | null): void { source = next; }
/** Fetch the lazy module that draws the authored models and register it. Resolves false (and the procedural vehicles stay) if it cannot be had. */
export async function loadGlbSource(): Promise<boolean> {
  if (source) return true;
  try {
    const glb = await import('../vehicles/glb.ts');
    source ??= { peek: glb.peekGlbVehicle, load: glb.loadGlbVehicle, instantiate: glb.instantiate, instancing: glb.instancingParts };
    return true;
  } catch {
    return false;
  }
}

/** The saloon paint for each of the street traffic's six colours (src/map3d/city-build.ts TRAFFIC_PAINTS order). */
const TRAFFIC_CAR_PAINTS = ['', 'red', 'blue', 'black', '', 'green'] as const;
/** Scene units per metre for the traffic's models: the same size as the vehicle the player rides on a trip. */
const TRAFFIC_SCALE = 0.86;

/** The street traffic's danfo and cars as instanceable far models, or null when any of them could not be had. Never throws. */
export async function loadTrafficModels(): Promise<{ danfo: TrafficPart; cars: readonly TrafficPart[]; scale: number } | null> {
  if (!source) return null;
  try {
    const wanted: GlbRequest[] = [{ kind: 'danfo', lod: 'far' }, ...[...new Set(TRAFFIC_CAR_PAINTS)].map((variant): GlbRequest => ({ kind: 'saloon', ...(variant ? { variant } : {}), lod: 'far' }))];
    const templates = await Promise.all(wanted.map((request) => source!.load(request)));
    const parts = templates.map((template) => (template ? source!.instancing(template) : null));
    if (parts.some((part) => !part)) return null;
    const [danfo, ...cars] = parts as TrafficPart[];
    const byVariant = new Map([...new Set(TRAFFIC_CAR_PAINTS)].map((variant, i) => [variant, cars[i]!]));
    return { danfo: danfo!, cars: TRAFFIC_CAR_PAINTS.map((variant) => byVariant.get(variant)!), scale: TRAFFIC_SCALE };
  } catch {
    return null;
  }
}
type TrafficPart = { geometry: THREE.BufferGeometry; material: THREE.Material };

/**
 * The venues' own LOD2 map icons (src/scene/places/icons.ts), planned for a city. It is reached from here, in the model library's lazy chunk, so the map's
 * entry carries no import of it (the first download does not grow). Resolves null when the city has no place models. Never throws.
 */
export function planPlaceIcons(city: string): Promise<Awaited<ReturnType<typeof import('../../scene/places/icons.ts').planPlaceIcons>>> {
  return import('../../scene/places/icons.ts').then(({ planPlaceIcons: plan }) => plan(city), () => null).catch(() => null);
}

/** Start fetching the trip vehicles' authored models (each file once), so a trip finds them already cached. Never throws. */
export async function warmGlbVehicles(): Promise<void> {
  if (!source) return;
  for (const spec of Object.values(GLB_TRIPS)) {
    if (spec) await source.load({ kind: spec.kind, ...(spec.variant ? { variant: spec.variant } : {}), lod: 'far' });
  }
}

/**
 * Build the one detailed vehicle used by the travelling player.
 * The returned adapter owns the vehicle, never its attached passenger.
 */
export function buildTravelVehicle(kind: string, { detail = 'street', time = 'day', car = null, onChange }: { detail?: VehicleDetail; time?: VehicleTime; car?: string | null; onChange?: () => void } = {}): TravelVehicle | null {
  const type = TRIP_VEHICLES[kind];
  if (!type) return null;
  const model = buildVehicle(type, { detail, time, route: type === 'danfo' ? 'LAGOS' : undefined });
  const { object3D, userData } = model;
  const own = (table: Readonly<Table<GlbTrip>>, key: string | null): GlbTrip | undefined => (key !== null && Object.hasOwn(table, key) ? table[key] : undefined);
  const spec = (kind === 'car' ? own(CAR_TRIPS, car) : undefined) ?? own(GLB_TRIPS, kind) ?? null;
  const request: GlbRequest | null = spec ? { kind: spec.kind, ...(spec.variant ? { variant: spec.variant } : {}), lod: 'far' } : null;
  const seatAnchor = userData.anchors.seats.at(-1) || userData.anchors.driver;
  const poseState = { distance: 0, steering: 0, bounce: 0, time: 0 } satisfies VehiclePose;
  const scenePose = { distance: 0, steering: 0, riding: false };
  let passenger: THREE.Object3D | null = null;
  let authored: GlbVehicle | null = null;
  let lastDistance: number | null = null;
  let lastHeading: number | null = null;
  let lastRiding: boolean | null = null;
  let disposed = false;
  let lit = time === 'night';
  object3D.userData.scenePose = scenePose;

  flattenShadows(object3D);

  let wantLod: GlbLod = 'far';
  const requestFor = (lod: GlbLod): GlbRequest | null => (spec ? { kind: spec.kind, ...(spec.variant ? { variant: spec.variant } : {}), lod } : null);

  /**
   * Show the authored model, in place of the procedural drawing (or of the other level of detail): same root, same seat anchor (so the
   * passenger stays seated), the procedural parts hidden. Riders that the model's open sides show are placed at its seats.
   */
  function useAuthored(template: GlbTemplate): boolean {
    if (disposed || !spec || !source || template.lod !== wantLod || authored?.lod === template.lod) return false;
    const previous = authored;
    authored = source.instantiate(template, { night: lit });
    if (spec.crew.length) authored.seat(spec.crew.map((crew, i) => ({ seat: crew.seat, shirt: crew.shirt, skin: SKINS[i % SKINS.length]!, ...(crew.helmet ? { helmet: crew.helmet } : {}), straddle: spec.kind === 'okada' })));
    if (!previous) for (const part of [...object3D.children]) part.visible = false;
    previous?.dispose();
    object3D.add(authored.object3D);
    // The seat anchor leaves the hidden procedural body for the root, and goes to the player's seat in the model.
    object3D.add(seatAnchor);
    const at = authored.seatPosition(spec.player);
    if (at) seatAnchor.position.copy(at).add(PASSENGER_LIFT[spec.kind] ?? ZERO);
    seatAnchor.rotation.set(0, 0, 0);
    seatAnchor.scale.setScalar(PASSENGER_SCALE[spec.kind] ?? 1);
    seatAnchor.visible = true;
    authored.spin(poseState.distance);
    return true;
  }
  function want(lod: GlbLod): void {
    const request = requestFor(lod);
    if (!request || !source) return;
    const ready = source.peek(request);
    if (ready) useAuthored(ready);
    else void source.load(request).then((template) => { if (template && useAuthored(template)) onChange?.(); });
  }
  want('far');

  /** The near model (turning wheels, more detail) for a close view; the far one otherwise. True when the drawing changed at once. */
  function setLod(lod: GlbLod): boolean {
    if (lod === wantLod) return false;
    wantLod = lod;
    const request = requestFor(lod), ready = request && source ? source.peek(request) : null;
    want(lod);
    return Boolean(ready);
  }

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
    if (authored) authored.spin(poseState.distance);
    else poseVehicle(model, poseState);
    return true;
  }

  /** Light or put out the lamps of the authored model (dusk and night); the procedural vehicle has its own phase, set when it is built. */
  function setLights(on: boolean): boolean {
    lit = Boolean(on);
    return authored ? authored.setNight(lit) : false;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    detachPassenger();
    object3D.removeFromParent();
    authored?.dispose(); authored = null;
    userData.dispose();
  }

  return {
    object3D,
    userData,
    seatAnchor,
    attachPassenger,
    detachPassenger,
    pose,
    setLights,
    setLod,
    get authored() { return authored !== null; },
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
