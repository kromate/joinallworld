/**
 * Venue scene host (thin). It owns the renderer, the camera, the two lights and the DOM name
 * tags, and asks the scene modules for geometry: src/scene/venue-scenes.js for each venue
 * `scene.kind`, src/scene/home-scene.js for the home interior.
 *
 * WHAT A SCENE ENTRY MAY OFFER (all optional except group/camera/update)
 *   group, camera: { landscape, portrait }, update(state) → boolean
 *   background          clear colour; re-read after every update() that returns true
 *   lighting()          → { hemi: [sky, ground, intensity], sun: [colour, intensity, [x, y, z]] }
 *                       applied to the host's own lights; a scene without it gets HOST_LIGHTING
 *   setPlayer({ look, seed, name, pose }) → boolean   the player's avatar; seed is the public id
 *   setCrowd(people)    other players and NPCs standing in the scene
 *   tags()              → [{ id, kind, text, marker, colour, position }] projected into DOM tags
 *   dispose()           called when the player leaves the venue and when the host is disposed.
 *                       A scene that has it is rebuilt on the next visit; one without is kept.
 *
 * THE SCENE IS THE HERO: setInsets({ top, bottom }) tells the host how much of the canvas the HUD
 * covers at the top and the bottom. The camera's view is shifted (and, on a wide screen, gently
 * zoomed out) so the scene sits in the part that is left free instead of under a panel. Name
 * tags and taps use the same camera, so they stay exact.
 *
 * BATTERY RULE: scenes are static and drawn on demand only. A frame is rendered when the canvas
 * is resized, the venue changes, the insets change, a scene's update(state) / setPlayer /
 * setCrowd reports a change, or update() is called — never from a requestAnimationFrame loop or a timer. Name
 * tags are projected in the same step, so they move only when a frame is drawn.
 * diagnostics().renderCount proves it: it does not move while nothing changes (asserted in
 * src/venue-world.test.js).
 */
import { createKit } from './scene/kit.js';
import { buildVenueScene, DEFAULT_CAMERA, MAX_CROWD } from './scene/venue-scenes.js';
import { buildHomeScene } from './scene/home-scene.js';
import { VENUES } from './game/content/venues.js';
import { spotsOf } from './life.js';

export const HOST_LIGHTING = Object.freeze({ hemi: ['#bdd4e7', '#273e2b', 1.6], sun: ['#c7dbec', 1.4, [-12, 25, 8]] });
const DEFAULT_BACKGROUND = '#182a25';

/** The host's two lights. apply(preset) sets them from a scene's lighting(), or back to the defaults. */
export function createHostLights(THREE, scene) {
  const hemi = new THREE.HemisphereLight(HOST_LIGHTING.hemi[0], HOST_LIGHTING.hemi[1], HOST_LIGHTING.hemi[2]);
  const sun = new THREE.DirectionalLight(HOST_LIGHTING.sun[0], HOST_LIGHTING.sun[1]);
  sun.position.set(...HOST_LIGHTING.sun[2]);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 70 });
  sun.shadow.normalBias = 0.04;
  scene.add(hemi, sun);
  return {
    hemi, sun,
    apply(preset) {
      const use = Array.isArray(preset?.hemi) && Array.isArray(preset?.sun) ? preset : HOST_LIGHTING;
      hemi.color.set(use.hemi[0]); hemi.groundColor.set(use.hemi[1]); hemi.intensity = use.hemi[2];
      sun.color.set(use.sun[0]); sun.intensity = use.sun[1]; sun.position.set(...use.sun[2]);
    },
  };
}

/** The venue as the scene module should see it: every spot players can stand at, including spots other systems added. */
export function sceneVenue(id) {
  const venue = VENUES[id];
  if (!venue) return venue;
  return { ...venue, scene: { ...venue.scene, spots: spotsOf(id).map((spot) => ({ id: spot.id, label: spot.label })) } };
}

export function createVenueWorld(container, { location = 'park', renderer: providedRenderer, onTag } = {}) {
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
  const lights = createHostLights(THREE, scene);

  // Name tags live in the DOM, above the canvas. There is none under `node --test`.
  const tagLayer = globalThis.document?.createElement ? globalThis.document.createElement('div') : null;
  if (tagLayer) {
    tagLayer.className = 'scene-tags';
    container.appendChild(tagLayer);
    tagLayer.addEventListener('click', (event) => {
      const node = event.target.closest?.('[data-tag]');
      if (node) onTag?.({ id: node.dataset.tag, kind: node.dataset.kind });
    });
  }

  const built = new Map();
  let current = null, currentLocation = null, renderCount = 0, lastState = null, size = { width: 0, height: 0 };
  let player = {}, crowd = [], crowdKey = '[]', shownTags = [], tagKey = '', background = DEFAULT_BACKGROUND, insets = { top: 0, bottom: 0 };
  const point = new THREE.Vector3();
  const orbit = { yaw: 0, tilt: 0, zoom: 1 };
  const pointers = new Map();
  let suppressClick = false;
  const canvas = renderer.domElement;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const previousTouchAction = canvas.style?.touchAction;
  const previousCursor = canvas.style?.cursor;
  if (canvas.style) { canvas.style.touchAction = 'none'; canvas.style.cursor = 'grab'; }
  function releasePointers() {
    for (const id of pointers.keys()) { try { canvas.releasePointerCapture?.(id); } catch {} }
    pointers.clear();
    if (canvas.style) canvas.style.cursor = 'grab';
  }
  function resetView() {
    releasePointers();
    suppressClick = false;
    orbit.yaw = 0; orbit.tilt = 0; orbit.zoom = 1;
  }
  function redrawView() { frame(); renderScene(); }
  function pointerDown(event) {
    if (event.button !== 0 || pointers.size >= 2) return;
    if (!pointers.size) suppressClick = false;
    else suppressClick = true;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
    try { canvas.setPointerCapture?.(event.pointerId); } catch {}
    if (canvas.style) canvas.style.cursor = 'grabbing';
  }
  function pointerMove(event) {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const next = { ...previous, x: event.clientX, y: event.clientY };
    if (!suppressClick && pointers.size === 1) {
      if (Math.hypot(next.x - previous.startX, next.y - previous.startY) < 6) return;
      suppressClick = true;
    }
    if (next.x === previous.x && next.y === previous.y) return;
    if (pointers.size === 2) {
      const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)[1];
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(next.x - other.x, next.y - other.y);
      if (before > 4 && after > 4) orbit.zoom = clamp(orbit.zoom * after / before, 0.65, 2);
    } else {
      orbit.yaw -= (next.x - previous.x) * 0.006;
      orbit.tilt = clamp(orbit.tilt + (next.y - previous.y) * 0.004, -0.5, 0.5);
    }
    pointers.set(event.pointerId, next);
    event.preventDefault();
    redrawView();
  }
  function pointerEnd(event) {
    pointers.delete(event.pointerId);
    try { canvas.releasePointerCapture?.(event.pointerId); } catch {}
    if (!pointers.size && canvas.style) canvas.style.cursor = 'grab';
  }
  function wheel(event) {
    if (!Number.isFinite(event.deltaY)) return;
    event.preventDefault();
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
    const zoom = clamp(orbit.zoom * Math.exp(clamp(-event.deltaY * units * 0.001, -1, 1)), 0.65, 2);
    if (zoom === orbit.zoom) return;
    orbit.zoom = zoom;
    redrawView();
  }
  const controls = { pointerdown: pointerDown, pointermove: pointerMove, pointerup: pointerEnd,
    pointercancel: pointerEnd, lostpointercapture: pointerEnd, wheel,
    click(event) {
      if (!suppressClick || event.detail === 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    dblclick(event) {
      if (suppressClick && event.detail > 0) return;
      resetView(); redrawView();
    } };
  for (const [type, listener] of Object.entries(controls)) canvas.addEventListener?.(type, listener, { passive: false, capture: type === 'click' });

  /** Project the current scene's tags through the camera. Runs with every frame the host draws — never on its own. */
  function projectTags() {
    const tags = current?.tags?.() || [];
    camera.updateMatrixWorld(true);
    current?.group.updateMatrixWorld(true);
    shownTags = tags.map((tag) => {
      point.set(tag.position.x, tag.position.y, tag.position.z);
      if (current?.group) point.applyMatrix4(current.group.matrixWorld);
      point.project(camera);
      return { id: tag.id, kind: tag.kind, text: tag.text, name: tag.name, marker: tag.marker, colour: tag.colour,
        x: Math.round(((point.x + 1) / 2) * size.width), y: Math.round(((1 - point.y) / 2) * size.height), visible: point.z > -1 && point.z < 1 && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 };
    });
    if (!tagLayer) return;
    const next = JSON.stringify(shownTags);
    if (next === tagKey) return;
    tagKey = next;
    tagLayer.replaceChildren(...shownTags.filter((tag) => tag.visible).map((tag) => {
      // Built with textContent only: a player's name can never become markup.
      const node = globalThis.document.createElement(tag.kind === 'self' ? 'span' : 'button');
      node.className = `scene-tag is-${tag.kind}`;
      node.dataset.tag = tag.id; node.dataset.kind = tag.kind;
      node.textContent = tag.marker === 'crown' ? '♛' : tag.marker === 'dot' ? '●' : tag.text;
      node.title = tag.kind === 'self' ? 'You' : tag.name;
      node.setAttribute('aria-label', tag.kind === 'self' ? 'You' : tag.kind === 'npc' ? `${tag.name}, a local` : `${tag.name}, a player`);
      node.style.left = `${tag.x}px`; node.style.top = `${tag.y}px`;
      return node;
    }));
  }
  function renderScene() { renderer.render(scene, camera); renderCount += 1; projectTags(); }

  /** Build a venue's scene when it is shown. A scene with dispose() is freed on leaving and rebuilt next time. */
  function sceneFor(id) {
    if (!built.has(id)) {
      const venue = VENUES[id];
      const entry = venue?.scene?.kind === 'home' ? buildHomeScene(kit, venue) : buildVenueScene(kit, sceneVenue(id));
      entry.group.visible = false;
      scene.add(entry.group);
      built.set(id, entry);
    }
    return built.get(id);
  }
  /** Take the lighting and clear colour the current scene asks for. */
  function applyLook() {
    lights.apply(current?.lighting?.());
    background = current?.background || DEFAULT_BACKGROUND;
    renderer.setClearColor(background);
  }
  function frame() {
    const { width, height } = container.getBoundingClientRect();
    size = { width, height };
    camera.aspect = width / Math.max(1, height);
    const portrait = camera.aspect < 0.85;
    const view = current?.camera || DEFAULT_CAMERA;
    camera.position.set(...(portrait ? view.portrait : view.landscape));
    if (orbit.yaw || orbit.tilt) {
      const offset = new THREE.Spherical().setFromVector3(camera.position.clone().sub(new THREE.Vector3(0, 0.7, 0)));
      offset.theta += orbit.yaw;
      offset.phi = clamp(offset.phi + orbit.tilt, 0.25, Math.PI / 2 - 0.1);
      camera.position.setFromSpherical(offset).add(new THREE.Vector3(0, 0.7, 0));
    }
    camera.fov = portrait ? 48 : 43;
    camera.lookAt(0, 0.7, 0);
    // Centre the scene in what the HUD leaves free; on a wide screen also step back a little when little is left.
    const free = Math.max(160, height - insets.top - insets.bottom);
    camera.zoom = portrait ? 1 : Math.max(0.74, Math.min(1, free / (height * 0.6)));
    camera.zoom *= orbit.zoom;
    // Scenes are composed a little above the point the camera looks at (walls and props rise from the floor).
    const shift = insets.top || insets.bottom ? Math.round((insets.bottom - insets.top) / 2 - height * 0.06 * camera.zoom) : 0;
    if (shift && width > 0 && height > 0) camera.setViewOffset(width, height, 0, shift, width, height); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }
  function resize() { frame(); renderScene(); }
  /** Show a venue. Draws one frame only if the venue actually changed. */
  function setLocation(id) {
    if (id === currentLocation) return;
    if (current) {
      current.group.visible = false;
      if (typeof current.dispose === 'function') { current.dispose(); scene.remove(current.group); built.delete(currentLocation); }
    }
    resetView();
    currentLocation = id;
    current = sceneFor(id);
    current.group.visible = true;
    current.setPlayer?.(player);
    current.setCrowd?.(crowd);
    if (lastState) current.update?.(lastState);
    applyLook();
    resize();
  }
  /** Give the current scene the latest game state. Draws one frame only if the scene says it changed. */
  function setState(state) {
    lastState = state;
    if (current?.update?.(state)) { applyLook(); renderScene(); }
  }
  /** The player's avatar: { look, seed (the session's public id), name, pose? }. One frame if it changed. */
  function setPlayer(next = {}) {
    player = { ...next };
    if (current?.setPlayer?.(player)) renderScene();
  }
  /** Other players and NPCs standing here (capped at MAX_CROWD). One frame, and only if the list changed. */
  function setCrowd(people) {
    const list = (Array.isArray(people) ? people : []).filter((person) => person && typeof person === 'object').slice(0, MAX_CROWD);
    const key = JSON.stringify(list);
    if (key === crowdKey) return false;
    crowdKey = key; crowd = list;
    if (!current?.setCrowd) return false;
    current.setCrowd(crowd);
    renderScene();
    return true;
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
        location: currentLocation, background, scenes: built.size, crowd: crowd.length,
        lighting: { hemi: lights.hemi.intensity, sun: lights.sun.intensity, sky: `#${lights.hemi.color.getHexString()}` },
        tags: shownTags.map((tag) => ({ ...tag })),
      };
    },
    resize,
    /** How many CSS pixels of the canvas the HUD covers at the top and bottom. One frame, and only if it changed. */
    setInsets(next = {}) {
      const snap = (value) => Math.max(0, Math.round((Number(value) || 0) / 12) * 12);
      const top = snap(next.top), bottom = snap(next.bottom);
      if (top === insets.top && bottom === insets.bottom) return false;
      insets = { top, bottom };
      resize();
      return true;
    },
    setLocation,
    setState,
    setPlayer,
    setCrowd,
    dispose() {
      releasePointers();
      for (const [type, listener] of Object.entries(controls)) canvas.removeEventListener?.(type, listener, { capture: type === 'click' });
      if (canvas.style) { canvas.style.touchAction = previousTouchAction || ''; canvas.style.cursor = previousCursor || ''; }
      for (const entry of built.values()) entry.dispose?.();
      built.clear();
      kit.dispose();
      renderer.dispose();
      renderer.domElement.remove?.();
      tagLayer?.remove();
    },
  };
}
