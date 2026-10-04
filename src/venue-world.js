/**
 * Venue scene host (thin). It owns the renderer, camera and lights and asks the scene modules
 * for geometry: src/scene/venue-scenes.js for each venue `scene.kind`, src/scene/home-scene.js
 * for the home interior.
 *
 * BATTERY RULE: scenes are static and drawn on demand only. A frame is rendered when the
 * canvas is resized, the venue changes, a scene's update(state) reports a change, or update()
 * is called — never from a requestAnimationFrame loop or a timer. diagnostics().renderCount
 * proves it: it does not move while nothing changes (asserted in src/venue-world.test.js).
 */
import { createKit } from './scene/kit.js';
import { buildVenueScene, DEFAULT_CAMERA } from './scene/venue-scenes.js';
import { buildHomeScene } from './scene/home-scene.js';
import { VENUES } from './game/content/venues.js';

export function createVenueWorld(container, { location = 'park', renderer: providedRenderer } = {}) {
  const kit = createKit();
  const { THREE } = kit;
  const scene = new THREE.Scene();
  const renderer = providedRenderer || new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 150);
  scene.add(new THREE.HemisphereLight('#bdd4e7', '#273e2b', 1.6));
  const moon = new THREE.DirectionalLight('#c7dbec', 1.4);
  moon.position.set(-12, 25, 8);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  Object.assign(moon.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 70 });
  moon.shadow.normalBias = 0.04;
  scene.add(moon);

  const built = new Map();
  let current = null, currentLocation = null, renderCount = 0, lastState = null;
  function renderScene() { renderer.render(scene, camera); renderCount += 1; }

  /** Build a venue's scene the first time it is shown; later visits reuse it. */
  function sceneFor(id) {
    if (!built.has(id)) {
      const venue = VENUES[id];
      const entry = venue?.scene?.kind === 'home' ? buildHomeScene(kit, venue) : buildVenueScene(kit, venue);
      entry.group.visible = false;
      scene.add(entry.group);
      built.set(id, entry);
    }
    return built.get(id);
  }
  function frame() {
    const { width, height } = container.getBoundingClientRect();
    camera.aspect = width / Math.max(1, height);
    const portrait = camera.aspect < 0.85;
    const view = current?.camera || DEFAULT_CAMERA;
    camera.position.set(...(portrait ? view.portrait : view.landscape));
    camera.fov = portrait ? 48 : 43;
    camera.lookAt(0, 0.7, 0);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }
  function resize() { frame(); renderScene(); }
  /** Show a venue. Draws one frame only if the venue actually changed. */
  function setLocation(id) {
    if (id === currentLocation) return;
    if (current) current.group.visible = false;
    currentLocation = id;
    current = sceneFor(id);
    current.group.visible = true;
    renderer.setClearColor(current.background || '#182a25');
    if (lastState) current.update?.(lastState);
    resize();
  }
  /** Give the current scene the latest game state. Draws one frame only if the scene says it changed. */
  function setState(state) {
    lastState = state;
    if (current?.update?.(state)) renderScene();
  }
  setLocation(location);
  return {
    update() { renderScene(); },
    diagnostics() {
      return {
        renderCount,
        drawCalls: renderer.info?.render.calls,
        triangles: renderer.info?.render.triangles,
        geometries: renderer.info?.memory.geometries,
        textures: renderer.info?.memory.textures,
      };
    },
    resize,
    setLocation,
    setState,
    dispose() {
      kit.dispose();
      renderer.dispose();
      renderer.domElement.remove?.();
    },
  };
}
