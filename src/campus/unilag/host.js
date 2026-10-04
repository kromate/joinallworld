import './host.css';
import { createKit } from '../../scene/kit.js';
import { createMotionLoop } from '../../scene/motion-loop.js';
import { createPositionReporter, createWalker } from '../../scene/movement.js';
import { buildUnilag } from './scene.js';
import { buildShuttle, shuttlePose } from './shuttle.js';
import { ANCHORS, BUILDINGS, ENTRANCE } from './layout.js';

const WALK_KEYS = new Map([
  ['w', 'up'], ['arrowup', 'up'], ['s', 'down'], ['arrowdown', 'down'],
  ['a', 'left'], ['arrowleft', 'left'], ['d', 'right'], ['arrowright', 'right'],
]);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const rounded = (value, places = 2) => Math.round(value * (10 ** places)) / (10 ** places);
const isField = (target) => target?.matches?.('input,textarea,select,[contenteditable]');

/**
 * Live host for the UNILAG campus. The scene owns geometry; this host owns rendering, input and
 * presence-only movement. Game state remains server-owned.
 */
export function createCampusHost(container, {
  onTag = () => {}, onSpot = () => {}, onMove = () => {}, now = Date.now, renderer: providedRenderer,
} = {}) {
  const kit = createKit();
  const { THREE } = kit;
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1800);
  const renderer = providedRenderer || new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;
  container.classList.add('campus-host');
  container.appendChild(renderer.domElement);

  const campus = buildUnilag(kit);
  const shuttle = buildShuttle(kit);
  shuttle.group.visible = false;
  world.add(campus.group, shuttle.group);
  const hemi = new THREE.HemisphereLight('#c6e0e6', '#68765a', 2);
  const sun = new THREE.DirectionalLight('#fff0d2', 2.4);
  sun.position.set(80, 140, 50);
  world.add(hemi, sun);

  const tagLayer = document.createElement('div');
  tagLayer.className = 'campus-host-tags';
  const miniMap = document.createElement('canvas');
  miniMap.className = 'campus-host-map';
  miniMap.width = 340; miniMap.height = 232;
  miniMap.setAttribute('role', 'img');
  const zoneLabel = document.createElement('span');
  zoneLabel.className = 'campus-host-zone';
  const controls = document.createElement('div');
  controls.className = 'campus-host-controls';
  controls.setAttribute('aria-label', 'Walk around campus');
  for (const [move, label] of [['up', 'Walk north'], ['left', 'Walk west'], ['down', 'Walk south'], ['right', 'Walk east']]) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'campus-host-control'; button.dataset.move = move;
    button.textContent = { up: '↑', left: '←', down: '↓', right: '→' }[move];
    button.setAttribute('aria-label', label); controls.appendChild(button);
  }
  container.append(tagLayer, miniMap, zoneLabel, controls);

  const walker = createWalker({ speed: 8, jogSpeed: 18 });
  walker.setGrid(campus.walk.grid);
  walker.place(ENTRANCE.x, ENTRANCE.z, ENTRANCE.ry);
  campus.walk.move(walker.x, 0, walker.z, walker.ry);
  const report = createPositionReporter((x, z) => onMove({ x, z, location: 'unilag' }), { perSecond: 3 });
  const keys = new Set();
  const tagNodes = new Map();
  const crowdKinds = new Map();
  let crowd = [], state = null, player = {}, playerKey = '', crowdKey = '[]';
  let insets = { top: 0, bottom: 0 }, size = { width: 0, height: 0 };
  let yaw = 0.55, tilt = 0.62, distance = 64, phase = 0, renderCount = 0;
  let locked = false, wasMoving = false, disposed = false, drag = null, walkTask = null;
  let shuttleActive = false, shuttleAt = null, shuttleClock = null;
  const projected = new THREE.Vector3();
  const canvas = renderer.domElement;

  const currentZone = () => campus.navigation.zoneAt(shuttleActive && shuttleAt ? shuttleAt.x : walker.x, shuttleActive && shuttleAt ? shuttleAt.z : walker.z);
  const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const canWalk = () => !locked && !container.hidden && !document.body.classList.contains('map-open') && !document.querySelector('dialog[open]');

  function finishTask(result, expected = walkTask) {
    const task = walkTask;
    if (!task || task !== expected) return;
    walkTask = null;
    task.resolve(result);
  }
  function cancelTask(code = 'cancelled') {
    if (!walkTask) return;
    const id = walkTask.id;
    finishTask({ ok: false, code, reason: code === 'busy' ? 'Finish or cancel your current action before moving.' : `Stopped before reaching ${ANCHORS[id]?.label || 'that place'}.` }, walkTask);
  }
  async function arrived(id, task) {
    if (walkTask !== task) return;
    campus.walk.goal();
    report.rest(walker.x, walker.z, now());
    task.committing = true;
    try {
      const result = await onSpot({ id, open: true });
      if (walkTask !== task) return;
      if (!result?.ok) placeAt(state?.spot, true);
      finishTask(result, task);
    } catch (error) {
      if (walkTask === task) placeAt(state?.spot, true);
      finishTask({ ok: false, code: 'network', reason: error?.message || 'That place could not be selected.' }, task);
    }
  }

  function updateCamera() {
    const target = shuttleActive && shuttleAt ? shuttleAt : walker;
    const available = Math.max(180, size.height - insets.top - insets.bottom);
    const phone = size.width <= 720;
    const viewDistance = distance * (phone ? 0.88 : 1) * clamp(560 / available, 0.9, 1.42);
    camera.position.set(
      target.x + Math.sin(yaw) * Math.cos(tilt) * viewDistance,
      Math.sin(tilt) * viewDistance + 2,
      target.z + Math.cos(yaw) * Math.cos(tilt) * viewDistance,
    );
    camera.lookAt(target.x, 2, target.z);
    const shift = Math.round((insets.bottom - insets.top) / 2);
    if (shift && size.width && size.height) camera.setViewOffset(size.width, size.height, 0, shift, size.width, size.height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  function drawMap() {
    const ctx = miniMap.getContext('2d');
    if (!ctx) return;
    const zone = currentZone();
    if (!zone) return;
    const [x0, z0, x1, z1] = zone.bounds;
    const width = miniMap.width, height = miniMap.height, pad = 18;
    const point = (x, z) => [pad + ((x - x0) / (x1 - x0)) * (width - pad * 2), pad + ((z - z0) / (z1 - z0)) * (height - pad * 2)];
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = zone.kind === 'waterfront' ? '#dbe8df' : '#e9ead8'; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#bdc8aa'; ctx.lineWidth = 2; ctx.strokeRect(pad, pad, width - pad * 2, height - pad * 2);
    for (const building of BUILDINGS.filter((item) => item.zone === zone.id)) {
      const [x, z] = point(building.x - building.w / 2, building.z - building.d / 2);
      ctx.fillStyle = '#819078';
      ctx.fillRect(x, z, Math.max(2, building.w / (x1 - x0) * (width - pad * 2)), Math.max(2, building.d / (z1 - z0) * (height - pad * 2)));
    }
    for (const peer of crowd.filter((person) => person.kind === 'player' && Number.isFinite(person.x) && campus.navigation.zoneAt(person.x, person.z)?.id === zone.id)) {
      const [x, z] = point(peer.x, peer.z); ctx.fillStyle = '#575da7'; ctx.beginPath(); ctx.arc(x, z, 5, 0, Math.PI * 2); ctx.fill();
    }
    const focus = shuttleActive && shuttleAt ? shuttleAt : walker;
    const [px, pz] = point(focus.x, focus.z); ctx.fillStyle = shuttleActive ? '#8f2434' : '#d45f36'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(px, pz, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    zoneLabel.textContent = zone.label;
    miniMap.setAttribute('aria-label', `${zone.label} mini-map. You and ${crowd.filter((person) => person.kind === 'player' && Number.isFinite(person.x) && campus.navigation.zoneAt(person.x, person.z)?.id === zone.id).length} other players are marked.`);
  }

  function syncTags() {
    const zone = campus.zone;
    const candidates = campus.tags().map((tag) => ({ ...tag, kind: crowdKinds.get(String(tag.id)) || tag.kind }))
      .filter((tag) => campus.navigation.zoneAt(tag.position.x, tag.position.z)?.id === zone)
      .sort((a, b) => Math.hypot(a.position.x - walker.x, a.position.z - walker.z) - Math.hypot(b.position.x - walker.x, b.position.z - walker.z))
      .slice(0, size.width <= 420 ? 6 : 12);
    const live = new Set(), placed = [];
    for (const tag of candidates) {
      const id = String(tag.id); live.add(id);
      let node = tagNodes.get(id);
      if (!node) {
        node = document.createElement('button'); node.type = 'button'; node.dataset.tag = id;
        node.addEventListener('click', () => {
          const kind = node.dataset.kind;
          if (kind === 'landmark') void walkTo(id);
          else onTag({ id, kind });
        });
        tagNodes.set(id, node); tagLayer.appendChild(node);
      }
      node.className = `campus-host-tag is-${tag.kind}`; node.dataset.kind = tag.kind;
      const label = String(tag.name || tag.text || id);
      if (node.textContent !== label) node.textContent = label;
      node.setAttribute('aria-label', tag.kind === 'landmark' ? `Walk to ${label}` : tag.kind === 'npc' ? `${label}, a campus local` : `${label}, a player`);
      projected.set(tag.position.x, tag.position.y, tag.position.z).project(camera);
      const sx=Math.round((projected.x+1)*size.width/2),sy=Math.round((1-projected.y)*size.height/2);
      const visible = !placed.some(p=>Math.abs(p.x-sx)<105&&Math.abs(p.y-sy)<28)&&sy>insets.top+30&&sy<size.height-insets.bottom-8&&projected.z > -1 && projected.z < 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1;
      node.hidden = !visible;if(visible)placed.push({x:sx,y:sy});
      if (visible) { node.style.left = `${Math.round((projected.x + 1) * size.width / 2)}px`; node.style.top = `${Math.round((1 - projected.y) * size.height / 2)}px`; }
    }
    for (const [id, node] of tagNodes) if (!live.has(id)) { node.remove(); tagNodes.delete(id); }
  }

  function draw() {
    if (disposed) return;
    updateCamera();
    world.background = new THREE.Color(campus.background);
    world.fog = new THREE.Fog(campus.background, 260, 1000);
    const night = campus.time === 'night'; hemi.intensity = night ? 0.9 : 2; sun.intensity = night ? 0.65 : 2.4;
    sun.color.set(night ? '#9ebadb' : '#fff0d2');
    renderer.render(world, camera); renderCount += 1;
    syncTags(); drawMap();
  }

  const elapsedNow = () => globalThis.performance?.now?.() ?? Date.now();
  const shuttleKey = (active) => `${active?.origin || ''}\u0001${active?.dest || ''}\u0001${active?.start ?? ''}`;
  function anchorShuttle(active) {
    const receivedAt = elapsedNow(), key = shuttleKey(active);
    let remaining = clamp(Number(active?.remaining) || 0, 0, Number(active?.duration) || 0);
    if (shuttleClock?.key === key) {
      const carried = Math.max(0, shuttleClock.remaining - (receivedAt - shuttleClock.receivedAt) / 1000);
      remaining = Math.min(remaining, carried);
    }
    shuttleClock = { key, remaining, receivedAt };
  }

  function showShuttle() {
    const active = state?.activeAction;
    if (active?.kind !== 'campus-shuttle') return false;
    if (shuttleClock?.key !== shuttleKey(active)) anchorShuttle(active);
    const elapsed = Math.max(0, (elapsedNow() - shuttleClock.receivedAt) / 1000);
    const remaining = Math.max(0, shuttleClock.remaining - elapsed);
    const progress = active.duration > 0 ? clamp(1 - remaining / active.duration, 0, 1) : 1;
    const at = shuttlePose(active, progress);
    if (!at) return false;
    shuttleAt = at; shuttleActive = true; shuttle.group.visible = true; campus.walk.avatar.visible = false;
    shuttle.group.position.set(at.x, 0.2, at.z); shuttle.group.rotation.y = at.ry;
    campus.setPosition(at.x, at.z);
    report.report(at.x, at.z, now());
    return at.progress < 1;
  }

  function tick(dt) {
    if (shuttleActive) { const more = showShuttle(); draw(); return more; }
    const right = Number(keys.has('right')) - Number(keys.has('left'));
    const forward = Number(keys.has('up')) - Number(keys.has('down'));
    if ((right || forward) && walkTask) { cancelTask(); walker.stop(); }
    walker.input(canWalk() ? right : 0, canWalk() ? forward : 0, keys.has('jog'));
    const moving = walker.step(dt, yaw, reduced());
    phase += dt * (walker.jogging ? 9 : 5);
    campus.walk.move(walker.x, 0, walker.z, walker.ry);
    if (walker.moving) { campus.walk.gait(true, phase); report.report(walker.x, walker.z, now()); }
    else campus.walk.rest();
    if (wasMoving && !walker.moving) report.rest(walker.x, walker.z, now());
    wasMoving = walker.moving;
    draw();
    return moving || walker.hasInput;
  }
  const loop = createMotionLoop(tick, {
    onHidden() { keys.clear(); walker.input(0, 0); },
    onVisible() { if (walker.mode === 'path' || shuttleActive) loop.wake(); },
  });

  function hold(move, pressed) {
    if (pressed) keys.add(move); else keys.delete(move);
    if (pressed && canWalk()) loop.wake();
  }
  function onKeyDown(event) {
    if (isField(event.target) || event.ctrlKey || event.metaKey || event.altKey || !canWalk()) return;
    const key = String(event.key).toLowerCase();
    if (key === 'shift') { keys.add('jog'); return; }
    const move = WALK_KEYS.get(key);
    if (!move) return;
    event.preventDefault(); event.stopImmediatePropagation(); hold(move, true);
  }
  function onKeyUp(event) {
    const key = String(event.key).toLowerCase();
    if (key === 'shift') { keys.delete('jog'); return; }
    const move = WALK_KEYS.get(key); if (move) hold(move, false);
  }
  function releaseInput() { keys.clear(); walker.input(0, 0); drag = null; }
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', releaseInput);

  const controlCleanups = [];
  for (const button of controls.querySelectorAll('[data-move]')) {
    const down = (event) => { event.preventDefault(); try { button.setPointerCapture(event.pointerId); } catch {} hold(button.dataset.move, true); };
    const up = () => hold(button.dataset.move, false);
    button.addEventListener('pointerdown', down); button.addEventListener('pointerup', up); button.addEventListener('pointercancel', up); button.addEventListener('lostpointercapture', up);
    controlCleanups.push(() => { button.removeEventListener('pointerdown', down); button.removeEventListener('pointerup', up); button.removeEventListener('pointercancel', up); button.removeEventListener('lostpointercapture', up); });
  }
  const pointerDown = (event) => { if (event.button !== 0) return; drag = { id: event.pointerId, x: event.clientX, y: event.clientY }; try { canvas.setPointerCapture(event.pointerId); } catch {} };
  const pointerMove = (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    yaw -= (event.clientX - drag.x) * 0.006; tilt = clamp(tilt + (event.clientY - drag.y) * 0.004, 0.25, 1.35);
    drag.x = event.clientX; drag.y = event.clientY; event.preventDefault(); draw();
  };
  const pointerUp = (event) => { if (drag?.id === event.pointerId) drag = null; };
  const wheel = (event) => { if (!Number.isFinite(event.deltaY)) return; event.preventDefault(); distance = clamp(distance + event.deltaY * 0.07, 14, 220); draw(); };
  canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointercancel', pointerUp);
  canvas.addEventListener('wheel', wheel, { passive: false });

  function placeAt(id, preserveTask = false) {
    const anchor = ANCHORS[id] || ENTRANCE;
    walker.stop(); if (!preserveTask) cancelTask(); walker.place(anchor.x, anchor.z, anchor.ry);
    campus.setPosition(anchor.x, anchor.z); campus.walk.move(anchor.x, 0, anchor.z, anchor.ry); campus.walk.rest();
    report.rest(anchor.x, anchor.z, now());
  }

  function setState(next) {
    const previous = state;
    state = next || {};
    const changed = campus.update(state);
    const active = state.activeAction;
    const wasShuttle = previous?.activeAction?.kind === 'campus-shuttle';
    locked = Boolean(active);
    for (const button of controls.querySelectorAll('button')) button.disabled = locked;
    if (active?.kind === 'campus-shuttle') {
      if (!shuttleActive) { walker.stop(); cancelTask('busy'); releaseInput(); }
      anchorShuttle(active);
      const moving = showShuttle();
      draw();
      if (moving && loop.available && !reduced()) loop.wake();
      return;
    }
    if (shuttleActive) { shuttleActive = false; shuttleAt = null; shuttle.group.visible = false; campus.walk.avatar.visible = true; }
    shuttleClock = null;
    const spotChanged = previous?.spot !== state.spot;
    const actionStarted = !previous?.activeAction && active;
    const committingHere = walkTask?.committing === true && walkTask.id === state.spot;
    if (!previous || wasShuttle || spotChanged || actionStarted) placeAt(state.spot, committingHere);
    if (active) { walker.stop(); cancelTask('busy'); releaseInput(); }
    if (changed || wasShuttle || spotChanged || actionStarted) draw();
  }

  function setPlayer(next = {}) {
    const key = JSON.stringify([next.look || null, next.seed || '', next.name || '']);
    player = { ...next };
    if (key === playerKey) return false;
    playerKey = key;
    campus.setPlayer(player);
    campus.walk.move(walker.x, 0, walker.z, walker.ry);
    if (shuttleActive) campus.walk.avatar.visible = false;
    draw(); return true;
  }

  function setCrowd(people) {
    const next = (Array.isArray(people) ? people : []).filter((person) => person && typeof person === 'object').slice(0, 12);
    const key = JSON.stringify(next);
    if (key === crowdKey) return false;
    crowdKey = key; crowd = next.map((person) => ({ ...person }));
    crowdKinds.clear();
    for (const person of crowd) crowdKinds.set(String(person.id), person.kind === 'npc' ? 'npc' : 'player');
    campus.setCrowd(crowd);
    walker.others = campus.walk.people();
    draw(); return true;
  }

  function walkTo(id) {
    const anchor = ANCHORS[id];
    if (!anchor) return Promise.resolve({ ok: false, code: 'invalid_spot', reason: 'That campus destination is unavailable.' });
    if (locked) return Promise.resolve({ ok: false, code: 'busy', reason: 'Finish or cancel your current action before moving.' });
    cancelTask();
    return new Promise((resolve) => {
      const task = { id, resolve }; walkTask = task;
      const arrive = () => void arrived(id, task);
      const alreadyThere = Math.hypot(walker.x - anchor.x, walker.z - anchor.z) <= 0.1;
      const started = walker.goTo(anchor.x, anchor.z, { exact: true, face: anchor.ry, arrive });
      campus.walk.goal(anchor.x, anchor.z);
      if (!started && alreadyThere) { walker.place(anchor.x, anchor.z, anchor.ry); campus.walk.move(anchor.x, 0, anchor.z, anchor.ry); draw(); arrive(); return; }
      if (!started) {
        campus.walk.goal();
        finishTask({ ok: false, code: 'no_route', reason: `${anchor.label} cannot be reached from here.` }, task);
        draw(); return;
      }
      if (!loop.available || reduced()) { walker.finishNow(); campus.walk.rest(); draw(); return; }
      loop.wake();
    });
  }

  function resize() {
    const box = container.getBoundingClientRect();
    size = { width: Math.max(1, Math.round(box.width)), height: Math.max(1, Math.round(box.height)) };
    renderer.setSize(size.width, size.height, false); camera.aspect = size.width / size.height;
    draw();
  }
  function setInsets(next = {}) {
    const top = Math.max(0, Math.round(Number(next.top) || 0)), bottom = Math.max(0, Math.round(Number(next.bottom) || 0));
    if (top === insets.top && bottom === insets.bottom) return false;
    insets = { top, bottom };
    container.style.setProperty('--campus-top', `${top + 8}px`); container.style.setProperty('--campus-bottom', `${bottom}px`);
    resize(); return true;
  }

  resize();
  report.rest(walker.x, walker.z, now());
  return {
    update: draw,
    resize,
    setInsets,
    setLocation(id) { return id === 'unilag'; },
    setState,
    setPlayer,
    setCrowd,
    walkTo,
    position() { return { x: rounded(walker.x), z: rounded(walker.z), location: 'unilag' }; },
    diagnostics() {
      return {
        location: 'unilag', renderCount, loop: { running: loop.running, frames: loop.frames },
        avatar: { x: rounded(walker.x), z: rounded(walker.z), facing: rounded(walker.ry, 3), moving: walker.moving, locked },
        camera: { yaw: rounded(yaw, 3), tilt: rounded(tilt, 3), distance: rounded(distance) },
        shuttle: shuttleActive && shuttleAt ? { x: rounded(shuttleAt.x), z: rounded(shuttleAt.z), progress: rounded(shuttleAt.progress, 3) } : null,
        zone: campus.zone, crowd: crowd.length, tags: tagNodes.size,
        drawCalls: renderer.info?.render.calls, triangles: renderer.info?.render.triangles,
      };
    },
    dispose() {
      if (disposed) return; disposed = true;
      loop.dispose(); cancelTask(); releaseInput();
      window.removeEventListener('keydown', onKeyDown, true); window.removeEventListener('keyup', onKeyUp, true); window.removeEventListener('blur', releaseInput);
      controlCleanups.forEach((remove) => remove());
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerUp); canvas.removeEventListener('wheel', wheel);
      campus.dispose(); shuttle.dispose(); kit.dispose(); renderer.dispose();
      canvas.remove(); tagLayer.remove(); miniMap.remove(); zoneLabel.remove(); controls.remove();
      container.classList.remove('campus-host'); container.style.removeProperty('--campus-top'); container.style.removeProperty('--campus-bottom');
    },
  };
}

export default createCampusHost;
