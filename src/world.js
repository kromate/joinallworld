import * as THREE from 'three';

export function createWorld(container, { onMove, initialPosition } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e7eee7');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  const camera = new THREE.OrthographicCamera(-60, 60, 45, -45, 0.1, 350);
  camera.position.set(55, 90, 75);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight('#ffffff', '#a5b99f', 2.5));
  const sun = new THREE.DirectionalLight('#fff4de', 3);
  sun.position.set(-35, 65, 35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -75, right: 75, top: 65, bottom: -65, near: 1, far: 160 });
  sun.shadow.normalBias = 0.035;
  sun.shadow.bias = -0.0003;
  scene.add(sun);

  const mats = {};
  const material = (color) => mats[color] || (mats[color] = new THREE.MeshStandardMaterial({ color, roughness: 0.88 }));
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
  function box(x, y, z, w, h, d, color, parent = scene) {
    const mesh = new THREE.Mesh(cube, material(color));
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    mesh.castShadow = h > 0.25;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function round(x, y, z, radius, height, color, parent = scene) {
    const mesh = new THREE.Mesh(cylinder, material(color));
    mesh.position.set(x, y, z);
    mesh.scale.set(radius, height, radius);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }
  let seed = 794;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  box(0, -0.55, 0, 118, 1, 86, '#bdccaf');
  box(0, 0.015, 2, 117, 0.12, 11, '#67c5d1');
  box(0, 0.08, -3.7, 116, 0.2, 1.2, '#d8d8c6');
  box(0, 0.08, 7.7, 116, 0.2, 1.2, '#d8d8c6');

  const roadColor = '#a4ada5';
  function street(x, z, w, d) {
    box(x, 0.065, z, w + 1.4, 0.13, d + 1.4, '#d9decf');
    box(x, 0.14, z, w, 0.08, d, roadColor);
    if (w > d) for (let xx = x - w / 2 + 2; xx < x + w / 2; xx += 5) box(xx, 0.19, z, 1.5, 0.025, 0.12, '#d6ddd1');
    else for (let zz = z - d / 2 + 2; zz < z + d / 2; zz += 5) box(x, 0.19, zz, 0.12, 0.025, 1.5, '#d6ddd1');
  }
  street(0, -12, 115, 4.4);
  street(0, 13, 115, 4.8);
  street(0, -33, 113, 3.5);
  street(0, 33, 113, 3.5);
  for (const x of [-49, -15, 20, 49]) { street(x, -23, 4, 36); street(x, 25, 4, 32); }
  for (const x of [-15, 20]) {
    box(x, 0.38, 2, 5.6, 0.65, 12, '#e4dec8');
    box(x, 0.74, 2, 4.2, 0.05, 12, roadColor);
    for (const side of [-1, 1]) {
      box(x + side * 2.6, 1.05, 2, 0.22, 0.7, 12, '#f0ebd7');
      for (let z = -3; z < 8; z += 2) box(x + side * 2.6, 0.3, z, 0.48, 1.4, 0.48, '#e1dcc9');
    }
  }
  street(34, -22, 3, 18);
  street(34, 25, 3, 18);
  street(34, -22, 27, 2.6);
  street(34, 24, 27, 2.6);

  function building(x, z, w, d, h, wall, roof = '#d2d4c2', type = 'flat') {
    box(x, h / 2 + 0.2, z, w, h, d, wall);
    box(x, h + 0.35, z, w + 0.4, 0.3, d + 0.4, roof);
    if (type === 'gable') {
      const roofMesh = new THREE.Mesh(new THREE.CylinderGeometry(0, 1, 1, 4, 1), material(roof));
      roofMesh.rotation.y = Math.PI / 4;
      roofMesh.scale.set(w * 0.75, 1.8, d * 0.75);
      roofMesh.position.set(x, h + 1.15, z);
      roofMesh.castShadow = true;
      scene.add(roofMesh);
    } else {
      box(x + w * 0.18, h + 0.65, z - d * 0.15, w * 0.35, 0.5, d * 0.35, '#e0e0cd');
    }
    for (let level = 1.3; level < h - 0.2; level += 1.7) {
      for (let xx = x - w / 2 + 0.8; xx < x + w / 2 - 0.3; xx += 1.5) {
        box(xx, level, z + d / 2 + 0.02, 0.62, 0.7, 0.035, '#778d8a');
        box(xx, level, z - d / 2 - 0.02, 0.62, 0.7, 0.035, '#819591');
      }
      for (let zz = z - d / 2 + 0.8; zz < z + d / 2 - 0.3; zz += 1.5) box(x + w / 2 + 0.02, level, zz, 0.035, 0.7, 0.62, '#778d8a');
    }
    box(x, 0.9, z + d / 2 + 0.025, 0.9, 1.45, 0.07, '#687f77');
  }

  function palm(x, z, size = 1) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.scale.setScalar(size);
    scene.add(group);
    round(0, 1.9, 0, 0.15, 3.8, '#9a8f70', group);
    for (let i = 0; i < 7; i++) {
      const angle = i * Math.PI * 2 / 7;
      const leaf = box(Math.sin(angle) * 0.9, 3.8, Math.cos(angle) * 0.9, 0.6, 0.15, 2.7, i % 2 ? '#6c986e' : '#7aa577', group);
      leaf.rotation.y = angle;
      leaf.rotation.x = 0.22;
    }
  }
  function tree(x, z, size = 1) {
    round(x, 0.9, z, 0.15, 1.8, '#978871');
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), material('#90ad7d'));
    mesh.position.set(x, 2.2, z);
    mesh.scale.y = 1.15;
    mesh.castShadow = true;
    scene.add(mesh);
  }

  // The civic quarter opens onto a generous square.
  box(-6, 0.1, 22, 13, 0.2, 15, '#e1dfcd');
  building(-6, 20, 9, 6, 6, '#f0e6cb', '#c7cdb7');
  box(-6, 6.75, 20, 6, 0.5, 3.7, '#e4ddc2');
  box(-6, 7.25, 20, 3, 0.5, 2.4, '#eae1c8');
  for (const x of [-9, -7, -5, -3]) round(x, 2.6, 23.2, 0.22, 4.7, '#faf0d8');
  box(-6, 0.35, 24.3, 10, 0.45, 1.4, '#ede7d2');
  for (const x of [-11, -1]) palm(x, 27, 0.85);
  building(-29, 21, 10, 7, 5.2, '#dfa998', '#d47f67');
  box(-29, 5.8, 21, 6.8, 0.8, 4.2, '#e8b59b');
  box(-29, 0.2, 28, 13, 0.1, 4, '#dcdac4');
  building(-40, 22, 6, 6, 3.6, '#e4c48c', '#bb8669', 'gable');
  building(-38, -22, 12, 9, 4, '#e8c99c', '#cb9c79');
  for (let x = -42; x < -32; x += 2.1) {
    box(x, 1.8, -17.3, 1.7, 0.18, 1.5, '#f0c0a0');
    box(x, 1.7, -16.6, 1.7, 0.35, 0.08, '#f5e5c8');
  }
  building(-25, -23, 6, 7, 5.5, '#e0d5be', '#8faba3');
  building(0, -23, 12, 10, 6, '#dcaf98', '#b87761');
  building(11, -24, 5, 7, 4, '#d8d7bf', '#a1afa0');
  building(36, 19, 7, 5, 3.1, '#f1d3a6', '#c8926c');
  box(36, 0.22, 15, 10, 0.13, 2.5, '#e6dfc9');
  building(11, 23, 6, 6, 4.3, '#dce2cc', '#9bab94');
  building(5, 28, 7, 5, 4.2, '#c7bdcf', '#968baa');
  building(-43, 17, 4.5, 5.5, 5.6, '#e8e0c6', '#a9b6a1', 'gable');
  round(-43, 7.1, 17, 0.55, 2.4, '#e8e0c6');
  box(-43, 8.5, 17, 0.12, 1, 0.12, '#a29b7c');
  box(-43, 8.6, 17, 0.65, 0.12, 0.12, '#a29b7c');
  box(-30, 0.3, -30, 5.8, 0.5, 4.8, '#ddd4ba');
  round(-30, 1.7, -30, 1.1, 2.3, '#bfab83');
  round(-30, 3, -30, 1.8, 0.5, '#94a986');
  box(29, 0.3, 16.5, 5, 0.15, 3.3, '#d3d1ba');
  for (const x of [27, 31]) for (const z of [15.3, 17.7]) round(x, 1.5, z, 0.09, 3, '#9c9070');
  box(29, 3.1, 16.5, 5.5, 0.2, 3.7, '#d8bc91');

  const wallColors = ['#ded7bd', '#e8c4ad', '#ced0b9', '#e5d6ba', '#c9d7cc'];
  const roofColors = ['#b78469', '#b2bba5', '#899d93', '#c19177'];
  for (const z of [-28, -17, 19, 29]) {
    for (const x of [26, 30, 39, 44]) {
      if (z === 19 && x === 39) continue;
      building(x, z, 3.1 + random() * 0.5, 4.1, 2.5 + random() * 2, wallColors[Math.floor(random() * wallColors.length)], roofColors[Math.floor(random() * roofColors.length)], 'gable');
    }
  }
  // A mint clinic marks the northern residential neighborhood.
  building(30, -25, 6, 5, 4, '#e1e7d7', '#a4c7b6');
  box(30, 3, -22.43, 1.35, 0.33, 0.05, '#b3776d');
  box(30, 3, -22.4, 0.33, 1.35, 0.06, '#b3776d');
  box(43, 0.15, 35.5, 8, 0.14, 7, '#e5d7b1');
  for (const x of [41, 45]) {
    round(x, 1.4, 35.5, 0.06, 2.7, '#9b947b');
    const umbrella = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.55, 8), material('#edd1a2'));
    umbrella.position.set(x, 2.9, 35.5);
    scene.add(umbrella);
    box(x, 0.35, 37.1, 0.8, 0.3, 1.8, '#f0e7d2');
  }
  for (const [x, z] of [[-41, 37], [-30, 37], [-21, 37], [2, 35], [11, 35], [-43, -37], [-32, -37], [-22, -37], [-8, -37], [5, -37], [15, -37], [28, -37], [40, -37]]) {
    building(x, z, 5, 3.8, 3 + random() * 3, wallColors[Math.floor(random() * wallColors.length)], roofColors[Math.floor(random() * roofColors.length)]);
  }
  for (let x = -54; x < 56; x += 8) { palm(x, 9.3, 0.7); palm(x, -6.2, 0.78); }
  for (const [x, z] of [[-44, 17], [-20, 17], [7, 18], [13, 28], [-43, 29], [-22, 29], [-45, -27], [-20, -17], [13, -17], [24, 36], [45, 36]]) tree(x, z, 1.3);
  for (let i = 0; i < 20; i++) tree(-55 + random() * 110, random() > 0.5 ? -40 : 40, 0.9 + random() * 0.5);

  // Docked sailboats give the lagoon scale and a quiet sense of life.
  const boats = [];
  for (const [x, z] of [[-34, 1], [-3, 4], [36, 0]]) {
    const group = new THREE.Group();
    group.position.set(x, 0.3, z);
    box(0, 0, 0, 3.1, 0.35, 1.15, '#f0e9d5', group);
    box(0.15, 0.28, 0, 1.3, 0.4, 0.75, '#ddad84', group);
    round(-0.3, 1.6, 0, 0.04, 3, '#a39a86', group);
    const sail = new THREE.Mesh(new THREE.BufferGeometry(), material('#fff4dc'));
    sail.geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.3, 0.6, 0, -0.3, 3.1, 0, 1.15, 0.6, 0], 3));
    sail.geometry.computeVertexNormals();
    sail.material.side = THREE.DoubleSide;
    group.add(sail);
    scene.add(group);
    boats.push(group);
  }
  const cars = [];
  for (let i = 0; i < 7; i++) {
    const group = new THREE.Group();
    box(0, 0.45, 0, 1.9, 0.6, 0.95, ['#e2ac77', '#f0ead8', '#788d86'][i % 3], group);
    box(-0.05, 0.88, 0, 0.95, 0.45, 0.82, '#d4dfd7', group);
    for (const x of [-0.6, 0.6]) for (const z of [-0.48, 0.48]) round(x, 0.26, z, 0.21, 0.22, '#5b6b64', group).rotation.x = Math.PI / 2;
    group.position.set(-48 + i * 15, 0.1, i % 2 ? -11 : 12);
    scene.add(group);
    cars.push({ group, direction: i % 2 ? 1 : -1 });
  }

  const player = new THREE.Group();
  const initialX = Number.isFinite(initialPosition?.x) ? THREE.MathUtils.clamp(initialPosition.x, -55, 55) : 0;
  const initialZ = Number.isFinite(initialPosition?.z) ? THREE.MathUtils.clamp(initialPosition.z, -40, 40) : 16;
  const validInitialPosition = passable(initialX, initialZ);
  player.position.set(validInitialPosition ? initialX : 0, 0.25, validInitialPosition ? initialZ : 16);
  scene.add(player);
  const person = new THREE.Group();
  player.add(person);
  round(0, 0.62, 0, 0.38, 0.95, '#8571d2', person);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), material('#e8cbb1'));
  head.position.y = 1.35;
  head.castShadow = true;
  person.add(head);
  box(0, 1.56, 0, 0.58, 0.13, 0.56, '#7860c1', person);
  const playerCar = new THREE.Group();
  box(0, 0.45, 0, 1.2, 0.7, 2.1, '#8872cf', playerCar);
  box(0, 0.9, -0.1, 1.05, 0.5, 1, '#b9c8d1', playerCar);
  for (const x of [-0.62, 0.62]) for (const z of [-0.65, 0.65]) round(x, 0.2, z, 0.24, 0.22, '#56605d', playerCar).rotation.z = Math.PI / 2;
  playerCar.visible = false;
  player.add(playerCar);
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 32), new THREE.MeshBasicMaterial({ color: '#a087db', transparent: true, opacity: 0.65, side: THREE.DoubleSide }));
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.03;
  player.add(marker);
  const destination = new THREE.Group();
  scene.add(destination);
  const beaconMaterial = new THREE.MeshBasicMaterial({ color: '#ddad42', transparent: true, opacity: 0.7 });
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.65, 6, 16), beaconMaterial);
  beacon.position.y = 3;
  destination.add(beacon);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.1, 32), new THREE.MeshBasicMaterial({ color: '#dcae45', side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.23;
  destination.add(ring);
  destination.visible = false;

  let vehicle = false;
  let elapsed = 0;
  let followPlayer = false;
  const cameraTarget = new THREE.Vector3();
  const cameraOffset = new THREE.Vector3(55, 90, 75);
  const projection = new THREE.Vector3();
  function positionCamera() {
    camera.position.copy(cameraTarget).add(cameraOffset);
    camera.lookAt(cameraTarget);
    camera.updateMatrixWorld();
  }
  function resize() {
    const { width, height } = container.getBoundingClientRect();
    const aspect = width / Math.max(height, 1);
    followPlayer = aspect < 0.8;
    const viewHeight = followPlayer ? 65 : aspect < 1.3 ? 95 : 83;
    cameraTarget.set(followPlayer ? player.position.x : 0, 0, followPlayer ? player.position.z : 0);
    positionCamera();
    camera.left = -viewHeight * aspect / 2;
    camera.right = viewHeight * aspect / 2;
    camera.top = viewHeight / 2;
    camera.bottom = -viewHeight / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    renderer.render(scene, camera);
  }
  function passable(x, z) {
    return z < -3.3 || z > 7.2 || Math.abs(x + 15) < 2.1 || Math.abs(x - 20) < 2.1;
  }
  resize();
  onMove?.({ x: player.position.x, z: player.position.z });
  return {
    update(dt, input = { x: 0, z: 0 }) {
      dt = Math.min(dt, 0.06);
      elapsed += dt;
      const speed = vehicle ? 17 : 8;
      const dx = (input.x || 0) * speed * dt;
      const dz = (input.z || 0) * speed * dt;
      const nx = THREE.MathUtils.clamp(player.position.x + dx, -55, 55);
      const nz = THREE.MathUtils.clamp(player.position.z + dz, -40, 40);
      if (passable(nx, player.position.z)) player.position.x = nx;
      if (passable(player.position.x, nz)) player.position.z = nz;
      if (dx || dz) {
        player.rotation.y = Math.atan2(dx, dz);
        person.position.y = Math.sin(elapsed * 18) * 0.045;
        onMove?.({ x: player.position.x, z: player.position.z });
      }
      for (const car of cars) {
        car.group.position.x += dt * 2.2 * car.direction;
        if (car.group.position.x > 56) car.group.position.x = -56;
        if (car.group.position.x < -56) car.group.position.x = 56;
      }
      boats.forEach((boat, index) => { boat.position.y = 0.3 + Math.sin(elapsed * 1.4 + index) * 0.055; });
      beaconMaterial.opacity = 0.42 + Math.sin(elapsed * 2.5) * 0.13;
      if (followPlayer) {
        const smoothing = 1 - Math.exp(-dt * 6);
        cameraTarget.x += (player.position.x - cameraTarget.x) * smoothing;
        cameraTarget.z += (player.position.z - cameraTarget.z) * smoothing;
        positionCamera();
      }
      renderer.render(scene, camera);
    },
    resize,
    setVehicle(value) { vehicle = Boolean(value); person.visible = !vehicle; playerCar.visible = vehicle; },
    getPosition() { return { x: player.position.x, z: player.position.z }; },
    setDestination(value) { destination.visible = Boolean(value); if (value) destination.position.set(value.x, 0, value.z); },
    project(x, z) {
      projection.set(x, 0.5, z).project(camera);
      const { width, height } = container.getBoundingClientRect();
      return { x: (projection.x + 1) * width / 2, y: (1 - projection.y) * height / 2 };
    },
    dispose() {
      scene.traverse((object) => { if (object.isMesh && object.geometry !== cube && object.geometry !== cylinder) object.geometry.dispose(); });
      cube.dispose(); cylinder.dispose();
      Object.values(mats).forEach((mat) => mat.dispose());
      marker.material.dispose(); beaconMaterial.dispose(); ring.material.dispose();
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
