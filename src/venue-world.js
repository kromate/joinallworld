import * as THREE from 'three';

export function createVenueWorld(container, { location = 'park' } = {}) {
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor('#182a25');
  container.appendChild(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 150);
  camera.position.set(16, 21, 27);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight('#bdd4e7', '#273e2b', 1.6));
  const moon = new THREE.DirectionalLight('#c7dbec', 1.4);
  moon.position.set(-12, 25, 8);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  Object.assign(moon.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 70 });
  moon.shadow.normalBias = 0.04;
  scene.add(moon);
  const park = new THREE.Group();
  const library = new THREE.Group();
  scene.add(park, library);
  const materials = new Map();
  const geometries = new Set();
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const sphereGeometry = new THREE.SphereGeometry(1, 9, 7);
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 9);
  const crownGeometry = new THREE.IcosahedronGeometry(1, 0);
  [boxGeometry, sphereGeometry, cylinderGeometry, crownGeometry].forEach(g => geometries.add(g));
  function material(color, glow = false) {
    const key = `${color}:${glow}`;
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.92, ...(glow ? { emissive: color, emissiveIntensity: 1.3 } : {}) }));
    return materials.get(key);
  }
  function mesh(geometry, x, y, z, sx, sy, sz, color, parent, glow = false) {
    const object = new THREE.Mesh(geometry, material(color, glow));
    object.position.set(x, y, z);
    object.scale.set(sx, sy, sz);
    object.castShadow = !glow;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  const box = (x, y, z, w, h, d, c, p, glow) => mesh(boxGeometry, x, y, z, w, h, d, c, p, glow);
  const round = (x, y, z, r, h, c, p, glow) => mesh(cylinderGeometry, x, y, z, r, h, r, c, p, glow);
  const sphere = (x, y, z, r, c, p) => mesh(sphereGeometry, x, y, z, r, r, r, c, p);
  const animated = [];
  function person(x, z, shirt, pants, { seated = false, rotation = 0, skin = '#986345', hair = '#211d1c', parent = park, y = 0, gesture = false } = {}) {
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
    animated.push({ body, limbs, phase: animated.length * 1.3, seated });
    return person;
  }
  function tree(x, z, size = 1) {
    round(x, 1.45 * size, z, 0.25 * size, 2.9 * size, '#635141', park);
    mesh(crownGeometry, x, 3.6 * size, z, 1.8 * size, 2.3 * size, 1.7 * size, '#2b6957', park);
    mesh(crownGeometry, x + 0.8 * size, 4.1 * size, z - 0.3, 1.35 * size, 1.5 * size, 1.3 * size, '#39775b', park);
  }
  function lamp(x, z, parent = park) {
    round(x, 2, z, 0.065, 4, '#344441', parent);
    box(x, 4.1, z, 0.44, 0.65, 0.44, '#ffe2a2', parent, true);
    box(x, 4.48, z, 0.65, 0.12, 0.65, '#394a43', parent);
    const light = new THREE.PointLight('#ffc878', 23, 12, 1.5);
    light.position.set(x, 3.8, z);
    parent.add(light);
  }

  box(0, -0.28, 0, 42, 0.5, 38, '#3e5141', park);
  box(1, 0.015, 2, 14, 0.05, 24, '#56624a', park);
  round(5, 0.35, -6, 4.5, 0.7, '#796a5a', park);
  round(5, 0.75, -6, 4.25, 0.15, '#917c64', park);
  for (const x of [1.5, 8.5]) {
    round(x, 2.6, -9, 0.07, 5.2, '#293e36', park);
    box(x, 5.15, -9, 0.55, 0.18, 0.6, '#ffd79a', park, true);
  }
  box(5, 4.4, -9, 7.2, 0.85, 0.14, '#32483e', park);
  for (const [x, z, w] of [[3.8, -0.8, 7.8], [3.8, 2.4, 7.8], [-4.7, 4.2, 4]]) {
    box(x, 0.65, z, w, 0.5, 0.9, '#8c9080', park);
    box(x, 1, z - 0.45, w, 0.85, 0.2, '#999a8b', park);
    for (const dx of [-w * 0.32, w * 0.32]) box(x + dx, 0.3, z, 0.5, 0.6, 0.65, '#747e72', park);
  }
  for (const [x, z, scale] of [[-9, -7, 1.15], [-11, 0, 1.2], [-9, 8, 1.35], [-4, -10, 0.95], [-13, 7, 0.9], [-5, 11, 1.05], [11, -11, 0.85]]) tree(x, z, scale);
  for (const [x, z] of [[-8, -3], [-7, 6], [11, 2]]) lamp(x, z);
  box(9, 0.14, 8, 5.2, 0.28, 4.2, '#898a78', park);
  box(9, 1.5, 8, 4.3, 2.8, 2.5, '#aa8642', park);
  box(9, 2.2, 6.72, 3.45, 1.2, 0.08, '#2c3631', park);
  box(9, 1.6, 6.45, 4.6, 0.18, 0.7, '#ddba75', park);
  box(9, 3.1, 7.6, 5.3, 0.23, 4, '#a54741', park);
  box(9, 2.82, 5.7, 5.3, 0.38, 0.08, '#d6ad4f', park);
  for (const x of [7.8, 8.6, 9.4, 10.2]) round(x, 1.94, 6.44, 0.075, 0.45, ['#8aab68', '#d4ad60'][Math.round(x) % 2], park);
  const kioskLight = new THREE.PointLight('#ffd080', 20, 10, 1.4);
  kioskLight.position.set(9, 2.4, 5.8);
  park.add(kioskLight);
  person(4, -6, '#d0a244', '#355eac', { y: 0.84, rotation: -0.4, gesture: true });
  person(1.5, -0.65, '#4778c7', '#263f70', { seated: true, y: 0.91, rotation: 0.3 });
  person(6, 2.55, '#d4a34a', '#3970ba', { seated: true, y: 0.91, rotation: -0.2, skin: '#6f4533' });
  person(-1, 5.8, '#c77594', '#d0c2ae', { rotation: -0.7, skin: '#83543b', gesture: true });
  person(-2.5, 7, '#496db5', '#806a4c', { rotation: 1.4 });
  person(-6.2, 3.2, '#9eaeb4', '#333740', { rotation: 0.7, skin: '#674631' });
  person(6.8, 5.2, '#619489', '#293e54', { rotation: 2.2 });
  person(10.2, 5, '#d2b976', '#589093', { rotation: -1.6, skin: '#68422f' });

  // A second venue is built from the same original shapes and characters.
  box(0, -0.2, 0, 28, 0.4, 26, '#333544', library);
  box(0, 3, -10, 24, 6, 0.35, '#42445d', library);
  box(-11.5, 3, -2, 0.35, 6, 16, '#3e4259', library);
  for (const x of [-7, 0, 7]) {
    box(x, 2.25, -9.5, 5.5, 4.5, 0.75, '#615354', library);
    for (const y of [0.9, 2.1, 3.3]) {
      box(x, y, -8.9, 5.3, 0.12, 0.8, '#a18c79', library);
      for (let i = 0; i < 7; i++) box(x - 2.3 + i * 0.7, y + 0.44, -9, 0.4, 0.76, 0.43, ['#768f91', '#b6867c', '#9c986c', '#7b7394'][i % 4], library);
    }
  }
  for (const x of [-5.5, 5.5]) {
    box(x, 0.7, 2, 5, 0.9, 2, '#776789', library);
    box(x, 1.35, 1.2, 5, 1.3, 0.4, '#8d7ca0', library);
    for (const side of [-1, 1]) box(x + side * 2.3, 1, 2, 0.4, 1.1, 2.1, '#665b7b', library);
    round(x, 0.8, 5, 1.2, 0.15, '#a59b89', library);
    round(x, 0.38, 5, 0.15, 0.7, '#665f6c', library);
  }
  round(0, 0.035, 0, 3.8, 0.06, '#4f6173', library);
  sphere(0, 5.6, -1, 0.62, '#a5acbf', library);
  const violet = new THREE.PointLight('#c794fa', 55, 22, 1.3);
  violet.position.set(0, 5, 0);
  library.add(violet);
  lamp(-9, 5, library);
  person(-5.6, 2.2, '#dfb665', '#475e7b', { parent: library, seated: true, y: 0.93 });
  person(5.5, 2.2, '#bd7e9b', '#454452', { parent: library, seated: true, y: 0.93, rotation: -0.2 });
  person(0, -3, '#657fb2', '#35445b', { parent: library, rotation: 0.6, gesture: true });
  let elapsed = 0;
  function setLocation(id) {
    const indoors = ['library', 'club'].includes(id);
    park.visible = !indoors;
    library.visible = indoors;
    renderer.setClearColor(indoors ? '#252b3b' : '#182a25');
  }
  function resize() {
    const { width, height } = container.getBoundingClientRect();
    camera.aspect = width / Math.max(1, height);
    const portrait = camera.aspect < 0.85;
    camera.position.set(portrait ? 13 : 16, portrait ? 24 : 21, portrait ? 31 : 27);
    camera.fov = portrait ? 48 : 43;
    camera.lookAt(0, 0.7, 0);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    renderer.render(scene, camera);
  }
  setLocation(location);
  resize();
  return {
    update(dt) {
      elapsed += Math.min(dt, 0.06);
      for (const { body, limbs, phase, seated } of animated) {
        body.rotation.y = Math.sin(elapsed * 0.65 + phase) * 0.045;
        if (!seated) body.position.y = Math.sin(elapsed * 1.4 + phase) * 0.025;
        limbs[0].rotation.x = Math.sin(elapsed * 0.8 + phase) * 0.08;
        limbs[1].rotation.x = Math.cos(elapsed * 0.9 + phase) * 0.055;
      }
      renderer.render(scene, camera);
    },
    resize,
    setLocation,
    dispose() {
      geometries.forEach(g => g.dispose());
      materials.forEach(m => m.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
