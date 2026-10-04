/**
 * OWNER: scenes
 * Procedural characters. `person` builds one low-poly figure; `appearanceToLook` maps a
 * player's saved appearance (character owner's data) to the colours person() takes.
 *
 * Rules for everything under src/scene/: build geometry only through the kit (src/scene/kit.js),
 * no downloaded models or textures, and no animation loops — scenes are static and are drawn
 * only when the host (src/venue-world.js) is asked to render.
 */

/** person(kit, parent, x, z, shirtColour, trouserColour, { seated, rotation, skin, hair, y, gesture }) → THREE.Group */
export function person(kit, parent, x, z, shirt, pants, { seated = false, rotation = 0, skin = '#986345', hair = '#211d1c', y = 0, gesture = false } = {}) {
  const { THREE, box, round, sphere, mesh, sphereGeometry } = kit;
  const person = new THREE.Group();
  person.position.set(x, y, z);
  person.rotation.y = rotation;
  parent.add(person);
  const body = new THREE.Group();
  person.add(body);
  box(0, 1.47, 0, 0.6, 0.72, 0.34, shirt, body);
  round(0, 1.94, 0, 0.1, 0.2, skin, body);
  sphere(0, 2.2, 0, 0.26, skin, body);
  mesh(sphereGeometry, 0, 2.34, -0.025, 0.28, 0.19, 0.27, hair, body);
  box(0, 1.04, 0, 0.5, 0.24, 0.3, pants, body);
  const limbs = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.38, 1.78, 0);
    arm.rotation.z = side * -0.12;
    body.add(arm);
    round(0, -0.21, 0, 0.105, 0.43, shirt, arm);
    const forearm = new THREE.Group();
    forearm.position.y = -0.43;
    forearm.rotation.x = seated ? -0.9 : gesture && side === 1 ? -1.2 : -0.14;
    arm.add(forearm);
    round(0, -0.19, 0, 0.078, 0.38, skin, forearm);
    sphere(0, -0.4, 0, 0.085, skin, forearm);
    const leg = new THREE.Group();
    leg.position.set(side * 0.17, 1.02, 0);
    leg.rotation.x = seated ? -Math.PI / 2 : side * 0.035;
    body.add(leg);
    round(0, -0.24, 0, 0.115, 0.49, pants, leg);
    const calf = new THREE.Group();
    calf.position.y = -0.49;
    calf.rotation.x = seated ? Math.PI / 2 : 0;
    leg.add(calf);
    round(0, -0.23, 0, 0.095, 0.46, pants, calf);
    box(0, -0.47, 0.08, 0.24, 0.14, 0.43, '#252c32', calf);
    limbs.push(arm);
  }
  if (seated) body.position.y = -0.85;
  return person;
}

/** Map a saved appearance to person() options. Placeholder: every appearance looks the same for now. */
export function appearanceToLook(appearance) {
  return { shirt: '#4778c7', pants: '#263f70', skin: '#986345', hair: '#211d1c' };
}
