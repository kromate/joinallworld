import type { WebGLRenderer } from 'three'
import type { HostPerson, HostPlayer, HostState } from '../campus/unilag/host.ts'
import type { StreetJourney } from './types.ts'
import { createKit } from '../scene/kit.ts'
import { buildAvatar, poseAvatar } from '../scene/characters.ts'
import { createWalker, gaitPhase, WALK_SPEED, JOG_SPEED } from '../scene/movement.ts'
import { createOrbit } from '../scene/camera-controls.ts'
import { createMotionLoop } from '../scene/motion-loop.ts'
import { createSceneControls } from '../scene/controls.ts'
import { venueLabel } from '../game/content/venues.ts'
import { avatarProportions } from '../types/avatar.ts'
import { bodyAllowed, drawsWebGL2 } from '../scene/body/gate.ts'
import type { StandIn } from '../scene/body/stand-in.ts'
import { tileKey, tileOf } from './frame.ts'
import { createTileWindow } from './window.ts'
import { createStreetRenderer } from './renderer.ts'
import { createStreetClient } from './client.ts'
import type { StreetRequest } from './client.ts'
import type { MetrePoint, StreetDoor } from './types.ts'

export interface StreetHostOptions {
  request?: StreetRequest; journey?: StreetJourney; renderer?: WebGLRenderer; now?: () => number
  onJourneyChanged?(journey: StreetJourney): void
  onError?(error: unknown): void
}
/** A separate, lazy host. Global metres are authoritative; only drawing uses a nearby local origin. */
export function createStreetHost(container: HTMLElement, options: StreetHostOptions = {}) {
  const kit = createKit({ matte: true }), { THREE } = kit, world = new THREE.Scene()
  world.background = new THREE.Color('#b7d0d1'); world.fog = new THREE.Fog('#b7d0d1', 85, 180)
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 220), renderer = options.renderer ?? new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = false
  container.appendChild(renderer.domElement)
  Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' })
  world.add(new THREE.HemisphereLight('#e9f1ec', '#797359', 2.5))
  const sun = new THREE.DirectionalLight('#fff0d0', 2); sun.position.set(20, 45, 15); world.add(sun)
  const scenery = createStreetRenderer(kit); world.add(scenery.group)
  const walker = createWalker({ speed: WALK_SPEED * 0.72, jogSpeed: JOG_SPEED * 0.72 }), orbit = createOrbit()
  orbit.setBase([8, 10, 13], [0, 1, 0]); orbit.setLimits({ near: 0.45, far: 2.5 })
  let closed = false, busy = false, location = 'city-street', initialized = false, centreKey = '', renderCount = 0, travelled = 0, lastSend = 0
  let player: HostPlayer = {}, avatar = buildAvatar(kit, undefined, { rig: true, scale: 0.72 }), playerKey = ''
  let standIn: StandIn | null = null, stride = 0
  world.add(avatar)
  let pending: Promise<void> | null = null, entering = false, doorTask: string | null = null
  const held = new Set<string>(), doorViews = new Map<string, HTMLButtonElement>(), label = document.createElement('div')
  label.setAttribute('aria-label', 'Street entrances'); Object.assign(label.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' }); container.appendChild(label)
  const status = document.createElement('span'); status.setAttribute('role', 'status'); status.textContent = 'Loading city street…'; Object.assign(status.style, { position: 'absolute', bottom: '12px', left: '12px', color: '#152a2b', background: '#fffbe8', padding: '5px 9px', borderRadius: '8px', pointerEvents: 'none', fontSize: '12px' }); container.appendChild(status)
  const client = createStreetClient({ request: options.request, journey: options.journey, now: options.now })
  const fail = (error: unknown) => { if (closed) return; status.textContent = error instanceof Error ? error.message : 'Street unavailable. Use the map to travel.'; options.onError?.(error) }
  function applyJourney(journey: StreetJourney, restore: boolean) {
    if (closed) return
    if (journey.kind !== 'walking') { walker.stop(); options.onJourneyChanged?.(journey); return }
    if (restore || !initialized) { walker.stop(); walker.place(journey.point.x, journey.point.z); initialized = true }
    const centre = tileOf(journey.point), key = tileKey(centre)
    if (key !== centreKey) { centreKey = key; scenery.rebase(centre); liveTiles?.setCentre(centre); rebuildGrid(); const at = scenery.local(walker); orbit.follow(at.x, 1.2, at.z); orbit.snap() }
    loop.wake(); draw()
  }
  function rebuildGrid() { if (client.journey) walker.setGrid(scenery.grid(tileOf(client.journey.point))) }
  // Identity becomes known only after the authenticated journey; construct its window then.
  let liveTiles: ReturnType<typeof createTileWindow> | null = null
  let initialTile: { key: string; resolve(): void; reject(error: unknown): void } | null = null
  function useJourney(journey: StreetJourney, restore: boolean) {
    if (closed) return
    if (!liveTiles && journey.kind === 'walking') {
      liveTiles = createTileWindow({ city: journey.city, version: journey.version, load: async (tile, signal) => { try { return await client.tile(tile, signal) } catch (error) { if (!signal.aborted && initialTile?.key === tileKey(tile)) initialTile.reject(error); else if (!signal.aborted && tileKey(tile) === centreKey) fail(error); throw error } }, onTile(tile) { scenery.add(tile); rebuildGrid(); if (initialTile?.key === tileKey(tile.tile)) { initialTile.resolve(); initialTile = null } status.textContent = 'Tap the road to walk. Choose a doorway to go inside.'; draw(); loop.wake() }, onEvict(tile) { scenery.remove(tile) } })
    }
    applyJourney(journey, restore); if (journey.kind === 'walking') liveTiles?.setCentre(tileOf(journey.point))
  }
  function send(force = false): Promise<void> {
    if (pending) return pending
    const journey = client.journey
    if (!initialized || !journey || journey.kind !== 'walking' || closed) return Promise.resolve()
    const point = { x: walker.x, z: walker.z }, distance = Math.hypot(point.x - journey.point.x, point.z - journey.point.z), now = performance.now()
    if (distance < 0.005 || (!force && (now - lastSend < 320 || distance < 0.3))) return Promise.resolve()
    lastSend = now
    pending = client.move(point).then(next => { useJourney(next, false) }).catch(async error => { walker.stop(); doorTask = null; try { const accepted = await client.refresh(); useJourney(accepted, true) } catch { const accepted = client.journey; if (accepted) useJourney(accepted, true) } fail(error) }).finally(() => { pending = null; if (!closed) loop.wake() })
    return pending
  }
  async function flush() { if (pending) await pending; await send(true); const accepted = client.journey; if (!accepted || Math.hypot(walker.x - accepted.point.x, walker.z - accepted.point.z) > 0.04) throw Error('Your final position has not been accepted. Try the entrance again.') }
  async function enter(door: StreetDoor) { if (closed || busy || entering || doorTask !== door.id) return; entering = true; walker.stop(); try { await flush(); if (closed || busy || doorTask !== door.id) return; const result = await client.enter(door.id); useJourney(result, false) } catch (error) { fail(error) } finally { entering = false; doorTask = null } }
  function walkDoor(id: string): boolean {
    if (closed || busy || entering || client.journey?.kind !== 'walking') return false
    const door = scenery.doors().find(item => item.id === id)
    if (!door || !walker.grid?.free(door.approach.x, door.approach.z)) return false
    const path = walker.grid.path(walker.x, walker.z, door.approach.x, door.approach.z), last = path?.at(-1)
    if (!last || Math.hypot(last.x - door.approach.x, last.z - door.approach.z) > 1.25) return false
    doorTask = id
    const accepted = walker.goTo(door.approach.x, door.approach.z, { jog: false, arrive: () => { void enter(door) } }); if (!accepted) doorTask = null; else loop.wake(); return accepted
  }
  function walkGround(point: MetrePoint): boolean { if (closed || busy || entering || !initialized || client.journey?.kind !== 'walking' || !walker.grid?.free(point.x, point.z)) return false; doorTask = null; const accepted = walker.goTo(point.x, point.z, { jog: false }); if (accepted) loop.wake(); return accepted }
  function renderDoors() {
    const journey = client.journey, visible = scenery.doors().filter(door => Math.hypot(door.approach.x - walker.x, door.approach.z - walker.z) < 65 && (door.target.kind === 'venue' || journey && door.target.lga === journey.anchor.lga && door.target.estate === journey.anchor.estate)).slice(0, 32), ids = new Set(visible.map(door => door.id))
    for (const [id, button] of doorViews) if (!ids.has(id)) { button.remove(); doorViews.delete(id) }
    for (const door of visible) {
      let button = doorViews.get(door.id)
      if (!button) { button = document.createElement('button'); button.type = 'button'; button.textContent = door.target.kind === 'estate' ? 'Return to your street' : venueLabel(door.target.venue, client.journey?.city ?? ''); button.title = 'Walk to this entrance and go inside'; Object.assign(button.style, { position: 'absolute', pointerEvents: 'auto', border: '1px solid #36594f', borderRadius: '7px', padding: '6px 9px', background: '#fffbe8', color: '#19392f', fontSize: '12px', cursor: 'pointer' }); button.onclick = () => { if (!walkDoor(door.id)) fail(Error('This entrance is not reachable yet. Walk closer along the road.')) }; label.appendChild(button); doorViews.set(door.id, button) }
      const at = scenery.local(door.at), point = new THREE.Vector3(at.x, 2.5, at.z).project(camera), w = container.clientWidth, h = container.clientHeight
      button.hidden = point.z > 1 || point.z < -1 || Math.abs(point.x) > 0.95 || Math.abs(point.y) > 0.95; button.disabled = busy || entering
      button.style.left = `${(point.x + 1) * w / 2}px`; button.style.top = `${(1 - point.y) * h / 2}px`; button.style.transform = 'translate(-50%,-100%)'
    }
  }
  function draw() { if (closed) return; const at = scenery.local(walker); avatar.position.set(at.x, 0, at.z); avatar.rotation.y = walker.ry; standIn?.move(at.x, 0, at.z, walker.ry); orbit.follow(at.x, 1.2, at.z); orbit.apply(camera); renderer.render(world, camera); renderCount++; renderDoors() }
  const loop = createMotionLoop(dt => {
    if (closed || !initialized) return false
    const accepted = client.journey, before = { x: walker.x, z: walker.z }, ahead = accepted ? Math.hypot(walker.x - accepted.point.x, walker.z - accepted.point.z) : 0
    const moving = !busy && !entering && ahead < 2.5 && walker.step(dt, orbit.azimuth), distance = Math.hypot(walker.x - before.x, walker.z - before.z); travelled += distance
    const proportions = avatarProportions(player.look?.appearance)
    stride += gaitPhase(distance, 0.72 * proportions.height * proportions.depth, walker.jogging, standIn?.shown === true)
    poseAvatar(avatar, { pose: distance > 0 ? walker.jogging ? 'jog' : 'walk' : 'stand', stride: (stride / (2 * Math.PI)) % 1 })
    const local = scenery.local(walker); standIn?.move(local.x, 0, local.z, walker.ry)
    if (distance > 0) standIn?.gait(stride, walker.jogging, 0); else standIn?.pose('stand', undefined, false)
    const bodyMoving = standIn?.step(dt) === true
    void send(!walker.moving); const cameraMoving = orbit.step(dt); draw(); return Boolean(moving || bodyMoving || cameraMoving || walker.hasInput && !busy && !pending)
  }, { onHidden() { held.clear(); walker.stop(); controls?.release(); void send(true) }, onVisible() { draw(); if (walker.moving) loop.wake() } })
  const controls = createSceneControls(container, { onZoom: d => { orbit.zoomBy(d > 0 ? 0.9 : 1.1); loop.wake() }, onRecentre: () => { orbit.reset(); loop.wake() }, onStick: (right, forward, jog) => { if (busy || entering) return; doorTask = null; walker.input(right, forward, jog); loop.wake() } })
  controls?.touch(true)
  const directions = new Map([['w', 'up'], ['arrowup', 'up'], ['s', 'down'], ['arrowdown', 'down'], ['a', 'left'], ['arrowleft', 'left'], ['d', 'right'], ['arrowright', 'right']])
  function key(event: KeyboardEvent) { const direction = directions.get(event.key.toLowerCase()); if (!direction) return; if (event.type === 'keydown' && (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable],button') || busy || entering)) return; event.preventDefault(); if (event.type === 'keydown') held.add(direction); else held.delete(direction); doorTask = null; walker.input(Number(held.has('right')) - Number(held.has('left')), Number(held.has('up')) - Number(held.has('down')), event.shiftKey); loop.wake() }
  globalThis.addEventListener('keydown', key); globalThis.addEventListener('keyup', key)
  let pointer: { id: number; x: number; y: number; lastX: number; lastY: number; dragged: boolean } | null = null
  function pointerDown(event: PointerEvent) { pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, dragged: false }; renderer.domElement.setPointerCapture(event.pointerId) }
  function pointerMove(event: PointerEvent) { if (!pointer || pointer.id !== event.pointerId) return; if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5) pointer.dragged = true; if (pointer.dragged) { orbit.drag(event.clientX - pointer.lastX, event.clientY - pointer.lastY); loop.wake() } pointer.lastX = event.clientX; pointer.lastY = event.clientY }
  function pointerUp(event: PointerEvent) { const start = pointer; pointer = null; if (!start || start.id !== event.pointerId || start.dragged || event.type === 'pointercancel') return; const bounds = renderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2), camera); const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()); if (hit) walkGround(scenery.global({ x: hit.x, z: hit.z })) }
  renderer.domElement.addEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('pointermove', pointerMove); renderer.domElement.addEventListener('pointerup', pointerUp); renderer.domElement.addEventListener('pointercancel', pointerUp)
  function resize() { if (closed) return; const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); draw() }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null; observer?.observe(container); resize()
  if (bodyAllowed() && drawsWebGL2(renderer)) void import('../scene/body/stand-in.ts').then(module => {
    if (closed) return
    standIn = module.createStandIn(kit, () => { if (!closed) { draw(); loop.wake() } })
    standIn.wear(player.look, player.seed); standIn.attach({ group: world, avatar, scale: 0.72 }); standIn.pose('stand', undefined, false); standIn.start(renderer)
  }).catch(() => undefined)
  const ready = (options.journey ? Promise.resolve(options.journey) : client.refresh()).then(async journey => {
    if (closed) throw Error('Street closed')
    if (journey.kind !== 'walking') throw Error('This street walk is not active. Use the map to travel.')
    const loaded = new Promise<void>((resolve, reject) => { initialTile = { key: tileKey(tileOf(journey.point)), resolve, reject } })
    useJourney(journey, true); await loaded
  }).catch(error => { fail(error); throw error })
  void ready.catch(() => undefined)
  return {
    ready, update: draw, resize,
    refresh: async () => { const journey = await client.refresh(); useJourney(journey, true) },
    setState(next: HostState | null) { busy = Boolean(next?.activeAction); if (busy) { held.clear(); walker.stop(); doorTask = null; controls?.release() } draw() },
    setPlayer(next: HostPlayer = {}) { const value = JSON.stringify(next); if (value === playerKey) return false; playerKey = value; player = next; standIn?.attach(null); world.remove(avatar); avatar.userData.dispose(); avatar = buildAvatar(kit, player.look, { rig: true, scale: 0.72, seed: player.seed }); world.add(avatar); standIn?.wear(player.look, player.seed); standIn?.attach({ group: world, avatar, scale: 0.72 }); draw(); return true },
    setCrowd(_people: HostPerson[]): boolean { return false },
    setInsets(insets: { top?: number; bottom?: number }): boolean { controls?.place(insets); status.style.bottom = `${(insets.bottom ?? 0) + 12}px`; return true },
    setLocation(id: string) { location = id; if (id !== 'city-street') { walker.stop(); doorTask = null; loop.stop() } return true },
    walkTo(a: number | string, z?: number) { return typeof a === 'string' ? walkDoor(a) : typeof z === 'number' && walkGround({ x: a, z }) },
    walkBy(dx: number, dz: number) { return walkGround({ x: walker.x + dx, z: walker.z + dz }) },
    zoom(direction: number) { orbit.zoomBy(direction > 0 ? 0.9 : 1.1); loop.wake() }, recentre() { orbit.reset(); loop.wake() },
    position() { return { x: walker.x, z: walker.z, location } }, captureCanvas() { return renderer.domElement },
    diagnostics() { const window = liveTiles?.snapshot(); return { location, initialized, busy, entering, renderCount, journey: client.journey, avatar: { x: walker.x, z: walker.z, moving: walker.moving, skinned: standIn?.shown === true, phase: stride }, tiles: window && { resident: window.resident, pending: window.pending, queued: window.queued, errors: window.errors }, scenery: scenery.diagnostics(), drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, loop: { frames: loop.frames, running: loop.running }, disposed: closed } },
    dispose() { if (closed) return; closed = true; initialTile?.reject(Error('Street closed')); initialTile = null; walker.stop(); loop.dispose(); client.dispose(); liveTiles?.dispose(); scenery.dispose(); controls?.dispose(); observer?.disconnect(); globalThis.removeEventListener('keydown', key); globalThis.removeEventListener('keyup', key); renderer.domElement.removeEventListener('pointerdown', pointerDown); renderer.domElement.removeEventListener('pointermove', pointerMove); renderer.domElement.removeEventListener('pointerup', pointerUp); renderer.domElement.removeEventListener('pointercancel', pointerUp); label.remove(); status.remove(); standIn?.dispose(); avatar.userData.dispose(); kit.dispose(); world.clear(); renderer.domElement.remove(); if (!options.renderer) renderer.dispose() },
  }
}
export type StreetHost = ReturnType<typeof createStreetHost>
