/**
 * OWNER: character
 * The 3D character preview: one high-detail avatar (src/scene/characters.js) on a ground disc,
 * on its own small WebGL canvas. Used wherever a look is edited (character creation, Sim →
 * Profile, the Boutique) through src/ui/panels/look-ui.js, which loads this file — and with it
 * Three.js — only when a preview is first shown.
 *
 *   const preview = createAvatarPreview(host, { look, focus, label, onSpin, onLost });
 *   preview.setLook(look, { react })   rebuild the avatar; one frame (plus a short turn if react)
 *   preview.setFocus('body' | 'head')  full body, or head and shoulders
 *   preview.setLabel(text)             the canvas' text alternative
 *   preview.rotate(radians)            turn the character (arrow keys do this when the canvas has focus)
 *   preview.resize()                   re-measure the host; one frame if the size changed
 *   preview.attach(host)               move the canvas into another host element
 *   preview.diagnostics()              { renderCount, frames, animating, live, lost, disposed, triangles, yaw, focus, lastRenderMs }
 *   preview.dispose()                  free the renderer, geometry, materials and the WebGL context
 *
 * BATTERY RULE: there is no render loop. A frame is drawn when the look, the focus or the size
 * changes and once per pointer or key event while turning. Three things animate, each for a
 * bounded time and then stop by themselves: the ease to rest after a drag is released, the
 * zoom between body and head, and the little turn when an option changes (ANIMATION_LIMIT_MS
 * caps every one of them). They are stepped by one-shot timers, FRAME_MS apart, that are only
 * re-armed while one of them is still running — nothing is ever scheduled while the preview is
 * at rest, and no frame callback or repeating timer is used anywhere. With `reducedMotion` none
 * of them run: the final state is drawn once. diagnostics().renderCount proves it
 * (src/scene/avatar-preview.test.js).
 *
 * ONE CONTEXT: creating a preview disposes the previous one, so at most one preview WebGL
 * context is alive (previewStats.live). A lost context stops drawing and calls onLost, so the
 * caller can show its 2D figure; if no WebGL context can be made at all, createAvatarPreview
 * throws PreviewUnavailable before Three.js is asked for one.
 */
import { createKit } from './kit.ts';
import { buildAvatar } from './characters.js';

export const ANIMATION_LIMIT_MS = 600;
const FRAME_MS = 16;
export const previewStats = { live: 0, created: 0, disposed: 0 };
export class PreviewUnavailable extends Error {}

const FRAMES = {
  body: { y: 1.47, height: 3.22, width: 1.9 },
  head: { y: 2.26, height: 1.62, width: 1.5 }, // head and shoulders, with room for the tallest hair, a gele or a hat // head and shoulders, with room above for the stage's buttons
};
const FOV = 26, START_YAW = -0.42, DRAG_SPEED = 0.011, KEY_STEP = Math.PI / 12, MAX_PIXEL_RATIO = 2.5;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const ease = (t) => 1 - (1 - t) ** 3;
let current = null;

/** Key, fill and rim lights for a character on a pale backdrop. Returns the lights it added. */
export function lightStage(THREE, scene) {
  // Tuned on the whole skin range: enough light from the front that the darkest tones keep their features.
  const hemi = new THREE.HemisphereLight('#ffffff', '#e6d2bb', 1.85);
  const key = new THREE.DirectionalLight('#fff3e2', 2.5); key.position.set(2.4, 3.6, 5);
  const fill = new THREE.DirectionalLight('#d6e4ff', 1.1); fill.position.set(-4, 2.4, 3.4);
  const rim = new THREE.DirectionalLight('#ffffff', 2); rim.position.set(-1.8, 3.8, -4.2);
  const lights = [hemi, key, fill, rim];
  lights.forEach((light) => scene.add(light));
  return lights;
}

/** The ground disc and a soft baked contact shadow (a generated texture; no shadow map). */
export function buildGround(THREE) {
  const group = new THREE.Group();
  const disposables = [];
  const keep = (item) => { disposables.push(item); return item; };
  const disc = new THREE.Mesh(keep(new THREE.CircleGeometry(1.32, 56)), keep(new THREE.MeshStandardMaterial({ color: '#c3c8d2', roughness: 1 })));
  disc.rotation.x = -Math.PI / 2;
  const rim = new THREE.Mesh(keep(new THREE.CircleGeometry(1.4, 56)), keep(new THREE.MeshStandardMaterial({ color: '#aeb4c0', roughness: 1 })));
  rim.rotation.x = -Math.PI / 2; rim.position.y = -0.012;
  // Two soft blobs: a wide faint one for the body and a tight dark one where the feet touch.
  const size = 96, data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const d = Math.hypot((i + 0.5) / size - 0.5, (j + 0.5) / size - 0.5) * 2;
    const wide = clamp(1 - d, 0, 1) ** 1.8 * 95, tight = clamp(1 - d / 0.42, 0, 1) ** 1.3 * 120;
    data.set([18, 22, 32, Math.round(Math.min(190, wide + tight))], (j * size + i) * 4);
  }
  const texture = keep(new THREE.DataTexture(data, size, size, THREE.RGBAFormat));
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
  const shadow = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.7, 1.35)), keep(new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })));
  shadow.rotation.x = -Math.PI / 2; shadow.position.set(0, 0.006, 0.03);
  group.add(rim, disc, shadow);
  return { group, dispose() { group.parent?.remove(group); disposables.forEach((item) => item.dispose()); disposables.length = 0; } };
}

/** Place a camera so a frame (FRAMES entry, or a blend of two) fits the given aspect ratio. */
export function frameCamera(camera, frame, aspect) {
  const half = Math.tan(camera.fov * Math.PI / 360);
  const distance = Math.max(frame.height / 2 / half, frame.width / 2 / (half * aspect));
  camera.aspect = aspect;
  camera.position.set(0, frame.y + distance * 0.1, distance);
  camera.lookAt(0, frame.y, 0);
  camera.updateProjectionMatrix();
}

function makeRenderer(THREE) {
  const canvas = document.createElement('canvas');
  const options = { alpha: true, antialias: true, powerPreference: 'low-power' };
  let context = null;
  try { context = canvas.getContext('webgl2', options); } catch { context = null; }
  if (!context) throw new PreviewUnavailable('WebGL is not available');
  return new THREE.WebGLRenderer({ canvas, context, ...options });
}

/**
 * options: { look, focus, label, reducedMotion, onSpin(), onLost(),
 *            renderer, raf, caf, now (injected by tests) }
 */
export function createAvatarPreview(host, options = {}) {
  current?.dispose();
  const kit = createKit();
  const { THREE } = kit;
  let renderer;
  try { renderer = options.renderer || makeRenderer(THREE); } catch (error) { kit.dispose(); throw error; }
  // The next step of a running animation: a one-shot timer (tests inject a hand-cranked one).
  const raf = options.raf || ((fn) => globalThis.setTimeout(fn, FRAME_MS));
  const caf = options.caf || ((id) => globalThis.clearTimeout(id));
  const now = options.now || (() => globalThis.performance.now());
  const reduced = options.reducedMotion ?? !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  previewStats.live += 1; previewStats.created += 1;

  const canvas = renderer.domElement;
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // The same tone mapping as the scenes (src/scene/look.js), so the figure made here is the figure seen there.
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1;
  if (canvas.style) Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'pan-y', cursor: 'grab', outline: 'none' });
  canvas.setAttribute?.('tabindex', '0');
  canvas.setAttribute?.('role', 'img');
  canvas.setAttribute?.('aria-roledescription', '3D preview; use the left and right arrow keys to turn it');
  canvas.classList?.add('look-canvas');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
  lightStage(THREE, scene);
  const ground = buildGround(THREE);
  const turntable = new THREE.Group();
  scene.add(ground.group, turntable);

  let avatar = null, lookKey = '', renderCount = 0, frames = 0, disposed = false, lost = false, lastMs = 0;
  let yaw = START_YAW, zoom = options.focus === 'head' ? 1 : 0, focus = options.focus === 'head' ? 'head' : 'body';
  let size = { width: 0, height: 0 }, frameId = 0;
  const tweens = new Map(); // name → { start, duration, step(t, dt) → false to stop early, last }

  function frame() {
    const a = FRAMES.body, b = FRAMES.head, t = zoom;
    frameCamera(camera, { y: a.y + (b.y - a.y) * t, height: a.height + (b.height - a.height) * t, width: a.width + (b.width - a.width) * t }, size.width / Math.max(1, size.height) || 1);
  }
  function render() {
    if (disposed || lost || !size.width || !size.height) return;
    turntable.rotation.y = yaw + (turntable.userData.swing || 0);
    frame();
    const started = now();
    renderer.render(scene, camera);
    lastMs = now() - started;
    renderCount += 1;
    if (canvas.dataset) canvas.dataset.renders = String(renderCount);
  }
  function tick() {
    frameId = 0;
    if (disposed) return;
    const time = now();
    for (const [name, tween] of tweens) {
      const t = clamp((time - tween.start) / tween.duration, 0, 1);
      const more = tween.step(t, Math.min(48, time - tween.last));
      tween.last = time;
      if (t >= 1 || more === false) tweens.delete(name);
    }
    frames += 1;
    render();
    if (tweens.size) frameId = raf(tick);
  }
  /** Run `step` for at most `duration` ms (never more than ANIMATION_LIMIT_MS), then stop. */
  function animate(name, duration, step) {
    if (reduced) { step(1, 0); tweens.delete(name); render(); return; }
    const start = now();
    tweens.set(name, { start, last: start, duration: Math.min(duration, ANIMATION_LIMIT_MS), step });
    if (!frameId) frameId = raf(tick);
  }
  function stop(name) {
    tweens.delete(name);
    if (!tweens.size && frameId) { caf(frameId); frameId = 0; }
  }

  function resize() {
    if (disposed) return false;
    const box = canvas.parentElement || host;
    const width = Math.round(box?.clientWidth || 0), height = Math.round(box?.clientHeight || 0);
    if (!width || !height || (width === size.width && height === size.height)) return false;
    size = { width, height };
    renderer.setSize(width, height, false);
    render();
    return true;
  }
  function setLook(look, { react = false } = {}) {
    if (disposed) return false;
    const key = JSON.stringify(look ?? null);
    if (key === lookKey) return false;
    lookKey = key;
    avatar?.userData.dispose();
    avatar = buildAvatar(kit, look, { detail: 'high', pose: 'relax', seed: 'preview' });
    turntable.add(avatar);
    if (react && !reduced) {
      // A small turn and settle, so a change is felt as well as seen.
      animate('react', 420, (t) => { turntable.userData.swing = Math.sin(t * Math.PI) * (1 - t) * 0.55; turntable.position.y = Math.sin(t * Math.PI) * 0.035; });
    } else render();
    return true;
  }
  function setFocus(next) {
    const wanted = next === 'head' ? 'head' : 'body';
    if (disposed || wanted === focus) return false;
    focus = wanted;
    const from = zoom, to = wanted === 'head' ? 1 : 0;
    animate('zoom', 340, (t) => { zoom = from + (to - from) * ease(t); });
    return true;
  }
  function rotate(delta) {
    if (disposed || !delta) return;
    stop('inertia');
    yaw += delta;
    render();
  }

  // Drag to spin: one frame per pointer event, then a short ease to rest.
  let drag = null;
  const listeners = [];
  const on = (type, fn, opts) => { canvas.addEventListener?.(type, fn, opts); listeners.push([type, fn, opts]); };
  on('pointerdown', (event) => {
    if (event.button > 0 || drag) return;
    stop('inertia');
    drag = { id: event.pointerId, x: event.clientX, time: now(), speed: 0 };
    try { canvas.setPointerCapture?.(event.pointerId); } catch { /* not capturable */ }
    if (canvas.style) canvas.style.cursor = 'grabbing';
  });
  on('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, time = now(), dt = Math.max(1, time - drag.time);
    if (!dx) return;
    drag.speed = drag.speed * 0.4 + (dx * DRAG_SPEED / dt) * 0.6;
    drag.x = event.clientX; drag.time = time;
    if (!drag.moved) { drag.moved = true; options.onSpin?.(); }
    yaw += dx * DRAG_SPEED;
    render();
  });
  const release = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    try { canvas.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
    if (canvas.style) canvas.style.cursor = 'grab';
    let speed = now() - drag.time > 90 ? 0 : clamp(drag.speed, -0.02, 0.02); // radians per ms
    drag = null;
    if (reduced || event.type === 'pointercancel' || Math.abs(speed) < 0.0012) return;
    animate('inertia', 520, (t, dt) => {
      yaw += speed * dt;
      speed *= Math.exp(-dt / 130);
      return Math.abs(speed) > 0.0002;
    });
  };
  on('pointerup', release); on('pointercancel', release);
  on('keydown', (event) => {
    const turn = event.key === 'ArrowLeft' ? -KEY_STEP : event.key === 'ArrowRight' ? KEY_STEP : 0;
    if (turn) { event.preventDefault(); options.onSpin?.(); rotate(turn); }
    else if (event.key === 'Home') { event.preventDefault(); stop('inertia'); yaw = START_YAW; render(); }
  });
  on('webglcontextlost', (event) => {
    event.preventDefault?.();
    lost = true; tweens.clear();
    if (frameId) { caf(frameId); frameId = 0; }
    options.onLost?.();
  });
  on('webglcontextrestored', () => { lost = false; render(); });

  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => resize()) : null;
  function attach(target) {
    if (disposed || !target) return;
    if (canvas.parentElement !== target) target.appendChild(canvas);
    observer?.disconnect();
    observer?.observe(target);
    resize();
  }

  const api = {
    canvas, setLook, setFocus, rotate, resize, attach,
    setLabel(text) { canvas.setAttribute?.('aria-label', String(text ?? '')); },
    diagnostics: () => ({ renderCount, frames, animating: tweens.size > 0 || frameId !== 0, live: previewStats.live, lost, disposed, triangles: avatar?.userData.triangles ?? 0, yaw, focus, lastRenderMs: Math.round(lastMs * 10) / 10 }),
    dispose() {
      if (disposed) return;
      disposed = true;
      if (current === api) current = null;
      tweens.clear();
      if (frameId) { caf(frameId); frameId = 0; }
      observer?.disconnect();
      for (const [type, fn, opts] of listeners) canvas.removeEventListener?.(type, fn, opts);
      listeners.length = 0;
      avatar = null;
      ground.dispose();
      kit.dispose(); // the avatar's geometry and the shared materials
      renderer.dispose();
      try { renderer.forceContextLoss?.(); } catch { /* the context is already gone */ }
      canvas.remove?.();
      previewStats.live -= 1; previewStats.disposed += 1;
    },
  };
  current = api;
  api.setLabel(options.label ?? 'Preview of your Sim');
  setLook(options.look);
  if (host) attach(host);
  return api;
}
