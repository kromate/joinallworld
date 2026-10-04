/**
 * OWNER: world
 * The player's piece on the city map: their own avatar (src/scene/characters.ts, their saved
 * look) standing at the place they are, and — during a trip — walking the route or riding a small
 * procedural vehicle along it.
 *
 *   createActor(kit, { travelVehicle? }) → { group, setPlayer({ look, seed }), setMode(mode), setTime(time),
 *                        place(pose), stand(x, z, ry), dot(on), triangles, dispose() }
 *
 * `travelVehicle(kind, { time })` (optional, src/models/integration/scene-models.ts buildTravelVehicle): the trip is ridden in a
 * model-library vehicle with real seat anchors instead of the batch-drawn one below. Without it — the default — nothing of the
 * model library is loaded or drawn.
 *
 * The avatar module builds static poses, so walking is drawn from two frames: the walk pose and
 * its mirror image, swapped every stride. Which frame shows comes from the pose's `step`, which
 * is a function of the distance covered — the walk never keeps time of its own.
 */
import type * as THREE from 'three';
import type { MapKit } from './city-build.ts';
import type { TripPose } from './trip.ts';
import { createBatch, sceneMaterials } from '../scene/build.ts';
import { buildAvatar } from '../scene/characters.ts';
import type { Pose } from '../scene/characters.ts';
import { VEHICLES } from './vehicles.ts';
import { lookOf } from './trip.ts';

/** The player's saved look (a record from the server, normalised by src/scene/characters.ts) and public id. */
export interface ActorPlayer { look?: unknown; seed?: string }

export const ACTOR_SCALE = 0.86;
const SEAT_HEIGHT = 0.6;
const SEATED_AVATAR_SCALE = 0.62;

/** A model-library trip vehicle (src/models/integration/scene-models.ts buildTravelVehicle): real seat anchors, posed along the route. */
export interface TravelVehicleModel {
  object3D: THREE.Group
  attachPassenger(passenger: THREE.Object3D): void
  detachPassenger(parent: THREE.Object3D): void
  pose(distance: number, heading: number, riding: boolean): void
  dispose(): void
}
export type TravelVehicleBuilder = (kind: string, options: { time: string }) => TravelVehicleModel | null;

export function createActor(kit: MapKit, { travelVehicle = null }: { travelVehicle?: TravelVehicleBuilder | null } = {}) {
  const { THREE } = kit;
  // The model library's trip vehicles (src/models): OFF unless the host passes its builder (see src/models/integration/flags.ts).
  const useModels = typeof travelVehicle === 'function';
  const group = new THREE.Group();
  group.name = 'actor';
  const walker = new THREE.Group(), ride = new THREE.Group();
  walker.name = 'actor-walker'; ride.name = 'actor-ride';
  walker.scale.setScalar(ACTOR_SCALE); ride.scale.setScalar(ACTOR_SCALE);
  group.add(walker, ride);
  // Reduced motion: the traveller is a plain dot on the route line.
  const dot = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffb224' }));
  dot.name = 'actor-dot'; dot.visible = false; group.add(dot);
  // "You are here": a ring on the ground under the piece.
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.75, 24), new THREE.MeshBasicMaterial({ color: '#ffb224', transparent: true, opacity: 0.9, depthWrite: false }));
  ring.name = 'actor-ring'; ring.rotation.x = -Math.PI / 2; ring.renderOrder = 3; group.add(ring);

  let player: { look: unknown; seed: string } = { look: null, seed: 'you' }, playerKey = '', mode: string | null = null, asDot = false, size = 1;
  let frames: { stand: THREE.Group; stride: THREE.Group; mirror: THREE.Group } | null = null, seated: THREE.Group | null = null, vehicle: THREE.Group | null = null, vehicleModel: TravelVehicleModel | null = null, seat = { x: 0, y: 0, z: 0 };
  let vehicleTime = 'day', disposed = false;
  const plain = (mesh: THREE.Object3D) => { mesh.castShadow = false; mesh.receiveShadow = false; };

  function buildPeople() {
    for (const built of [frames?.stand, frames?.stride, seated]) built?.userData.dispose();
    if (frames?.mirror) walker.remove(frames.mirror);
    const make = (pose: Pose, riding = false): THREE.Group => {
      const avatar = buildAvatar(kit, player.look, {
        seed: player.seed,
        pose,
        seat: riding && useModels ? 0 : SEAT_HEIGHT,
        scale: riding && useModels ? SEATED_AVATAR_SCALE : 1,
        marker: 'crown',
      });
      avatar.traverse(plain);
      return avatar;
    };
    const stand = make('stand'), stride = make('walk');
    // The second walk frame is the first one mirrored: the same geometry, the other foot forward.
    const mirror = new THREE.Group();
    stride.children.forEach((child) => { const mesh = child as THREE.Mesh; mirror.add(new THREE.Mesh(mesh.geometry, mesh.material)); });
    mirror.scale.x = -1;
    walker.add(stand, stride, mirror);
    frames = { stand, stride, mirror };
    seated = make('sit', true);
    seated.name = 'actor-passenger';
    if (vehicleModel) vehicleModel.attachPassenger(seated);
    else {
      seated.position.set(seat.x, seat.y - SEAT_HEIGHT - 0.13, seat.z);
      ride.add(seated);
    }
  }
  function releaseVehicle() {
    if (vehicleModel) {
      vehicleModel.detachPassenger(ride);
      vehicleModel.dispose();
      vehicleModel = null;
    } else if (vehicle) {
      vehicle.traverse((mesh) => (mesh as THREE.Mesh).geometry?.dispose());
      ride.remove(vehicle);
    }
    vehicle = null;
  }
  function buildVehicle() {
    releaseVehicle();
    const kind = lookOf(mode!).vehicle;
    if (!kind) return;
    if (useModels && travelVehicle) {
      vehicleModel = travelVehicle(kind, { time: vehicleTime });
      if (!vehicleModel) return;
      vehicle = vehicleModel.object3D;
      ride.add(vehicle);
      if (seated) vehicleModel.attachPassenger(seated);
      return;
    }
    const batch = createBatch(THREE);
    seat = VEHICLES[kind](batch).seat;
    vehicle = new THREE.Group();
    vehicle.name = `legacy-vehicle:${kind}`;
    batch.build(sceneMaterials(kit)).meshes.forEach((mesh) => { plain(mesh); vehicle!.add(mesh); });
    ride.add(vehicle);
    if (seated) seated.position.set(seat.x, seat.y - SEAT_HEIGHT - 0.13, seat.z);
  }
  function show(part: string) {
    frames!.stand.visible = part === 'stand'; frames!.stride.visible = part === 'a'; frames!.mirror.visible = part === 'b';
  }

  const actor = {
    group,
    get mode() { return mode; },
    /** The player's look and public id. Returns true when the avatar was rebuilt. */
    setPlayer(next?: ActorPlayer | null) {
      const key = JSON.stringify([next?.look ?? null, next?.seed ?? 'you']);
      if (key === playerKey && frames) return false;
      playerKey = key; player = { look: next?.look ?? null, seed: next?.seed ?? 'you' };
      buildPeople();
      return true;
    },
    /** The travel mode whose vehicle to show (null = none). */
    setMode(next: string | null) {
      if (next === mode) return false;
      mode = next;
      buildVehicle();
      return true;
    },
    /** Vehicle lights have day/night phases; dusk uses the day phase. */
    setTime(next: string) {
      const phase = next === 'night' ? 'night' : 'day';
      if (phase === vehicleTime) return false;
      vehicleTime = phase;
      if (useModels && vehicleModel) buildVehicle();
      return true;
    },
    /**
     * The piece is the player's marker as well as their avatar: seen from far away it is drawn larger
     * (like a counter on a board), so the trip can be followed on a view of the whole city.
     */
    setSize(next: number) {
      if (Math.abs(next - size) < 0.01) return;
      size = next;
      walker.scale.setScalar(ACTOR_SCALE * size); ride.scale.setScalar(ACTOR_SCALE * size); ring.scale.setScalar(size); dot.scale.setScalar(size);
    },
    get size() { return size; },
    /** Reduced motion: show the dot instead of the avatar and vehicle. */
    dot(on: boolean) { asDot = Boolean(on); dot.visible = asDot; },
    /** Stand at a place, facing ry. */
    stand(x: number, z: number, ry: number) {
      if (!frames) actor.setPlayer(player);
      walker.visible = !asDot; ride.visible = false; ring.visible = true; dot.visible = false;
      show('stand');
      walker.position.set(x, 0, z); walker.rotation.y = ry;
      ring.position.set(x, 0.09, z);
    },
    /** Take a trip pose (src/map3d/trip.ts tripPose). */
    place(pose: TripPose) {
      if (!frames) actor.setPlayer(player);
      ring.visible = false;
      if (asDot) { walker.visible = false; ride.visible = false; dot.visible = true; dot.position.set(pose.x, pose.y + 1.4, pose.z); return; }
      dot.visible = false;
      const riding = pose.phase === 'ride';
      walker.visible = !riding;
      if (!riding) {
        show(pose.walking ? (pose.step % 2 ? 'b' : 'a') : 'stand');
        const bob = pose.walking ? Math.abs(Math.sin((pose.distance / 0.85) * Math.PI)) * 0.14 : 0;
        walker.position.set(pose.x, pose.y + 0.08 + bob, pose.z); walker.rotation.y = pose.ry;
      }
      ride.visible = Boolean(pose.vehicle && vehicle);
      if (ride.visible) {
        ride.position.set(pose.vehicle!.x, pose.vehicle!.y + 0.1 + (!useModels && riding ? Math.sin(pose.distance * 2.4) * 0.03 : 0), pose.vehicle!.z);
        ride.rotation.y = pose.vehicle!.ry;
        vehicleModel?.pose(pose.distance, pose.vehicle!.ry, riding);
        seated!.visible = riding;
      }
    },
    get triangles() {
      let total = 0;
      group.traverseVisible((object) => { const mesh = object as THREE.Mesh | THREE.InstancedMesh; if (mesh.isMesh) total += (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position!.count) / 3 * ((mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1); });
      return total;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseVehicle();
      for (const built of [frames?.stand, frames?.stride, seated]) built?.userData.dispose();
      for (const mesh of [dot, ring]) { mesh.geometry.dispose(); mesh.material.dispose(); }
      group.parent?.remove(group);
      frames = null; seated = null; vehicle = null;
    },
  };
  return actor;
}
