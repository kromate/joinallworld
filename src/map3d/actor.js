/**
 * OWNER: world
 * The player's piece on the city map: their own avatar (src/scene/characters.js, their saved
 * look) standing at the place they are, and — during a trip — walking the route or riding a small
 * procedural vehicle along it.
 *
 *   createActor(kit) → { group, setPlayer({ look, seed }), setMode(mode), place(pose), stand(x, z, ry), dot(on), triangles, dispose() }
 *
 * The avatar module builds static poses, so walking is drawn from two frames: the walk pose and
 * its mirror image, swapped every stride. Which frame shows comes from the pose's `step`, which
 * is a function of the distance covered — the walk never keeps time of its own.
 */
import { createBatch, sceneMaterials } from '../scene/build.ts';
import { buildAvatar } from '../scene/characters.ts';
import { VEHICLES } from './vehicles.js';
import { lookOf } from './trip.js';

export const ACTOR_SCALE = 0.86;
const SEAT_HEIGHT = 0.6;

export function createActor(kit) {
  const { THREE } = kit;
  const group = new THREE.Group();
  group.name = 'actor';
  const walker = new THREE.Group(), ride = new THREE.Group();
  walker.scale.setScalar(ACTOR_SCALE); ride.scale.setScalar(ACTOR_SCALE);
  group.add(walker, ride);
  // Reduced motion: the traveller is a plain dot on the route line.
  const dot = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffb224' }));
  dot.visible = false; group.add(dot);
  // "You are here": a ring on the ground under the piece.
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.75, 24), new THREE.MeshBasicMaterial({ color: '#ffb224', transparent: true, opacity: 0.9, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.renderOrder = 3; group.add(ring);

  let player = { look: null, seed: 'you' }, playerKey = '', mode = null, asDot = false, size = 1;
  let frames = null, seated = null, vehicle = null, seat = { x: 0, y: 0, z: 0 };
  const plain = (mesh) => { mesh.castShadow = false; mesh.receiveShadow = false; };

  function buildPeople() {
    for (const built of [frames?.stand, frames?.stride, seated]) built?.userData.dispose();
    if (frames?.mirror) walker.remove(frames.mirror);
    const make = (pose) => { const avatar = buildAvatar(kit, player.look, { seed: player.seed, pose, seat: SEAT_HEIGHT, marker: 'crown' }); avatar.traverse(plain); return avatar; };
    const stand = make('stand'), stride = make('walk');
    // The second walk frame is the first one mirrored: the same geometry, the other foot forward.
    const mirror = new THREE.Group();
    stride.children.forEach((mesh) => mirror.add(new THREE.Mesh(mesh.geometry, mesh.material)));
    mirror.scale.x = -1;
    walker.add(stand, stride, mirror);
    frames = { stand, stride, mirror };
    seated = make('sit');
    seated.position.set(seat.x, seat.y - SEAT_HEIGHT - 0.13, seat.z);
    ride.add(seated);
  }
  function buildVehicle() {
    if (vehicle) { vehicle.traverse((mesh) => mesh.geometry?.dispose()); ride.remove(vehicle); vehicle = null; }
    const kind = lookOf(mode).vehicle;
    if (!kind) return;
    const batch = createBatch(THREE);
    seat = VEHICLES[kind](batch).seat;
    vehicle = new THREE.Group();
    batch.build(sceneMaterials(kit)).meshes.forEach((mesh) => { plain(mesh); vehicle.add(mesh); });
    ride.add(vehicle);
    if (seated) seated.position.set(seat.x, seat.y - SEAT_HEIGHT - 0.13, seat.z);
  }
  function show(part) {
    frames.stand.visible = part === 'stand'; frames.stride.visible = part === 'a'; frames.mirror.visible = part === 'b';
  }

  const actor = {
    group,
    get mode() { return mode; },
    /** The player's look and public id. Returns true when the avatar was rebuilt. */
    setPlayer(next) {
      const key = JSON.stringify([next?.look ?? null, next?.seed ?? 'you']);
      if (key === playerKey && frames) return false;
      playerKey = key; player = { look: next?.look ?? null, seed: next?.seed ?? 'you' };
      buildPeople();
      return true;
    },
    /** The travel mode whose vehicle to show (null = none). */
    setMode(next) {
      if (next === mode) return false;
      mode = next;
      buildVehicle();
      return true;
    },
    /**
     * The piece is the player's marker as well as their avatar: seen from far away it is drawn larger
     * (like a counter on a board), so the trip can be followed on a view of the whole city.
     */
    setSize(next) {
      if (Math.abs(next - size) < 0.01) return;
      size = next;
      walker.scale.setScalar(ACTOR_SCALE * size); ride.scale.setScalar(ACTOR_SCALE * size); ring.scale.setScalar(size); dot.scale.setScalar(size);
    },
    get size() { return size; },
    /** Reduced motion: show the dot instead of the avatar and vehicle. */
    dot(on) { asDot = Boolean(on); dot.visible = asDot; },
    /** Stand at a place, facing ry. */
    stand(x, z, ry) {
      if (!frames) actor.setPlayer(player);
      walker.visible = !asDot; ride.visible = false; ring.visible = true; dot.visible = false;
      show('stand');
      walker.position.set(x, 0, z); walker.rotation.y = ry;
      ring.position.set(x, 0.09, z);
    },
    /** Take a trip pose (src/map3d/trip.js tripPose). */
    place(pose) {
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
        ride.position.set(pose.vehicle.x, pose.vehicle.y + 0.1 + (riding ? Math.sin(pose.distance * 2.4) * 0.03 : 0), pose.vehicle.z);
        ride.rotation.y = pose.vehicle.ry;
        seated.visible = riding;
      }
    },
    get triangles() {
      let total = 0;
      group.traverse((mesh) => { if (mesh.isMesh && mesh.visible && mesh.parent?.visible !== false) total += (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3; });
      return total;
    },
    dispose() {
      for (const built of [frames?.stand, frames?.stride, seated]) built?.userData.dispose();
      vehicle?.traverse((mesh) => mesh.geometry?.dispose());
      for (const mesh of [dot, ring]) { mesh.geometry.dispose(); mesh.material.dispose(); }
      group.parent?.remove(group);
      frames = null; seated = null; vehicle = null;
    },
  };
  return actor;
}
