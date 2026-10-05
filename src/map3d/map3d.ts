/**
 * OWNER: world
 * The 3D city map: a tilted, orbitable miniature of the city (src/map3d/city-build.ts) with one
 * landmark per venue, the player's own avatar on it, and travel you can watch.
 *
 * Same contract as the 2D map (src/city-map.ts), so the host swaps one for the other:
 *   createMap3D(container, { pack, onSelectVenue, onSelectGov, onSelectNeighbour, onTripDue, onContextLost })
 *     → { ready, setState(state), setPlayer({ look, seed }), resize(), arrive(done), diagnostics(), destroy() }
 * It listens to the Map panel's 'jaw:map-ui' event (filter, selected place, layers and their data)
 * and to the shell's 'jaw:key' (arrows pan, + and − zoom, 0 shows the whole city).
 *
 * THE OPENING VIEW: a phone opens close on the player, where the places around them are named in
 * words; "Whole city" pulls back to all of it and "Find me" comes back (it lights up while the
 * player's piece is out of sight or far away). A wide screen has room for the whole city and opens on it.
 * A label never covers the player's piece: see src/map3d/labels.ts.
 *
 * BATTERY RULE — NO FRAME LOOP WHILE IDLE
 *   A frame is drawn when something asks for one (the map opens, a resize, camera input, the
 *   state or a layer changes). After drawing, another frame is scheduled ONLY while something is
 *   still moving: a camera ease or inertia, or a trip in progress. When that ends the loop ends;
 *   while the map is hidden, or the tab is, nothing is scheduled at all. diagnostics().renderCount
 *   is the proof and src/map3d/map3d.test.ts asserts it: flat when idle, climbing during a trip,
 *   flat again after arrival.
 *
 * THE TRIP IS THE SERVER'S TIMER (src/map3d/trip.ts): each state re-anchors the clock to the
 * server's `remaining`, and the avatar's place on the route is a function of the fraction done.
 * onTripDue() is called when that reaches 1, so the host can ask the server for the arrival at
 * once instead of waiting for its next poll.
 *
 * `prefers-reduced-motion`: no camera eases and no frame loop for the trip — it is a line with a
 * dot on it, moved each time the server reports progress.
 */
import type * as THREE from 'three';
import type { CityPack, PackLga, Point2 } from './types.ts';
import type { RigView } from './camera.ts';
import type { ScreenBox } from './labels.ts';
import type { PlotAddress } from '../types/life.ts';
import type { WorldData } from './world-data.ts';
import type { HouseCard, Map2DState, MapLayers, MapUiDetail } from './map2d.ts';
import type { City, CityPlace, TimeOfDay } from './city-build.ts';
import type { OpeningHours } from '../game/clock.ts';
import type { ActorPlayer, TravelVehicleBuilder } from './actor.ts';
import type { OverlayData, OverlayLayers, OverlayChip } from './overlays.ts';
import type { Trip, TripPose, TripSource } from './trip.ts';
import type { Route } from './roads.ts';
import { createKit } from '../scene/kit.ts';
import { VENUES, COMING_SOON, venueLabel, venueDistrict } from '../game/content/venues.ts';
import { openingInfo, lagosTime } from '../game/clock.ts';
import { buildNetwork } from './roads.ts';
import { buildCity, createRaw, LANDMARK_SCALE } from './city-build.ts';
import { createRig, DEFAULT_PITCH, MIN_DISTANCE } from './camera.ts';
import { createActor } from './actor.ts';
import { createOverlays } from './overlays.ts';
import { createHouses } from './houses.ts';
import { estateLayout, plotAt } from './estates.ts';
import { lgaAt } from './lga.ts';
import { tripOf, createTripClock, tripPose } from './trip.ts';
import { PLINTH as PLINTH_UNIT } from './landmarks.ts';
import { avatarBox, labelShift, nearPoints, plateFit, plateWidth, spanOf, WHOLE_FROM } from './labels.ts';
import { iconFor } from '../ui/icon-map.ts';
import { dockOf } from './insets.ts';

/** What the map reads of a venue (src/game/content/venues.ts): its icon, filter category and opening hours. */
interface VenueInfo { icon?: string; category?: string; hours?: OpeningHours }
const VENUE_TABLE: Readonly<Record<string, VenueInfo | undefined>> = VENUES;
const SOON_TABLE = COMING_SOON as Record<string, VenueInfo | undefined>;
/** How close the camera may come: near enough to tell the houses of a compact estate apart. */
const CLOSEST = 3;
const DRAG_START = 6, DOUBLE_TAP_MS = 340, PICK_RADIUS = 34, PLINTH = PLINTH_UNIT * LANDMARK_SCALE;
let hintSeen = false;             // the how-to line shows until the player first moves the map, picks a place or travels
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
export type { TimeOfDay };
export const timeOfDay = (ms: number): TimeOfDay => { const { minuteOfDay } = lagosTime(ms), hour = minuteOfDay / 60; return hour < 5.5 || hour >= 19 ? 'night' : hour < 7 || hour >= 17.5 ? 'dusk' : 'day'; };
const ICON = (path: string) => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

/** Can this device draw the 3D map at all? */
export function webglAvailable(doc: Document = globalThis.document): boolean {
  try { const canvas = doc.createElement('canvas'); return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl')); } catch { return false; }
}

/** The part of the game state the map reads: where the player is, the server clock, the trip, the home and the plot (the 2D map reads the same). */
export type MapState = Map2DState
/** A player's own plot or a house drawn on one: its address in the world. */
export interface PlotRef { lga: string; estate: number; plot: number }
/** A place's name label over the map. */
interface LabelEntry { node: HTMLButtonElement; name: HTMLElement; note: HTMLElement; width: number; height: number; priority: number; shift: number }
/** Pixels of the canvas the HUD covers. */
interface Insets { left: number; top: number; right: number; bottom: number }
type Pt = { x: number; y: number };
/** One pointer gesture in progress. */
type Gesture = { kind: 'pan' | 'orbit'; id: number; from: Pt; last: Pt; moved: boolean; spin?: number; at?: number; onLabel?: boolean } | { kind: 'pinch'; id?: undefined; distance: number; mid: Pt; moved: true }
/** The renderer the map draws with: a WebGLRenderer, or a stand-in under test. */
export type MapRenderer = THREE.WebGLRenderer
export interface Map3DOptions {
  pack: CityPack
  cityId?: string
  /** The model library's trip-vehicle builder (src/models/integration/scene-models.ts), or null for the batch-drawn ones. */
  travelVehicle?: TravelVehicleBuilder | null
  onSelectVenue?: (id: string) => void
  onSelectGov?: () => void
  onSelectNeighbour?: (neighbour: { id: string | undefined; name: string | undefined }) => void
  onTripDue?: () => void
  onContextLost?: () => void
  world?: WorldData | null
  onSelectLga?: (lga: string) => void
  onSelectHouse?: (house: HouseCard) => void
  renderer?: MapRenderer
  raf?: ((callback: FrameRequestCallback) => number) | undefined
  caf?: ((handle: number) => void) | undefined
  now?: () => number
  reducedMotion?: boolean
  deepLink?: string | null
  tabHidden?: () => boolean
}
/** The detail of a window CustomEvent, as an object (an empty one when it carries none). */
export const detailOf = (event: CustomEvent<unknown>): Record<string, unknown> => {
  const detail: unknown = event.detail;
  return detail && typeof detail === 'object' ? detail as Record<string, unknown> : {};
};

export function createMap3D(container: HTMLElement, { pack, cityId = pack?.id, travelVehicle = null, onSelectVenue = () => {}, onSelectGov = () => {}, onSelectNeighbour = () => {}, onTripDue = () => {}, onContextLost = () => {},
  world = null, onSelectLga = () => {}, onSelectHouse = () => {},
  renderer: providedRenderer, raf = globalThis.requestAnimationFrame?.bind(globalThis), caf = globalThis.cancelAnimationFrame?.bind(globalThis), now = () => globalThis.performance.now(),
  reducedMotion = Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches), deepLink = null, tabHidden }: Map3DOptions) {
  const doc: Document | null = Boolean(globalThis.document?.createElement) ? globalThis.document : null;
  const pageHidden = tabHidden || (() => Boolean(doc && doc.hidden));
  const kit = createKit(), { THREE } = kit;
  const renderer = providedRenderer || new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.shadowMap.enabled = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 1, 2000);
  const hemi = new THREE.HemisphereLight('#ffffff', '#9fb07f', 2), sun = new THREE.DirectionalLight('#fff0d2', 2.4);
  scene.add(hemi, sun);
  const network = buildNetwork(pack);
  const city = buildCity(kit, pack, network, { venues: VENUES, soon: SOON_TABLE });
  scene.add(city.group);
  const overlays = createOverlays(kit, city);
  scene.add(overlays.group);
  const houses = createHouses(kit, pack);
  scene.add(houses.group);
  const actor = createActor(kit, { travelVehicle });
  scene.add(actor.group);
  const rig = createRig(THREE, camera, { minDistance: CLOSEST, minX: pack.bounds.minX, maxX: pack.bounds.maxX, minZ: pack.bounds.minZ, maxZ: pack.bounds.maxZ, fit: pack.bounds.fit, core: pack.core, roamZ: pack.bounds.sea ? pack.bounds.sea.z1 - 16 : undefined });
  const ringOf = (colour: string, opacity: number) => { const mesh = new THREE.Mesh(new THREE.RingGeometry(PLINTH * 0.74, PLINTH * 0.84, 40), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity, depthWrite: false })); mesh.rotation.x = -Math.PI / 2; mesh.renderOrder = 3; mesh.visible = false; scene.add(mesh); return mesh; };
  const selectRing = ringOf('#14532d', 0.95), hoverRing = ringOf('#e8a643', 0.9);
  // The player's own plot: a ring that stays big enough to find from any distance.
  const ownRing = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.8, 32), new THREE.MeshBasicMaterial({ color: '#e8a643', transparent: true, opacity: 0.95, depthWrite: false }));
  ownRing.rotation.x = -Math.PI / 2; ownRing.renderOrder = 3; ownRing.visible = false; scene.add(ownRing);
  const routeMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
  let routeLine: THREE.Mesh | null = null;

  // ---- DOM: the canvas, the labels over it, the view buttons ---------------------------------
  let root: HTMLDivElement | null = null, labelLayer: HTMLElement | null = null, controls: Record<string, HTMLElement> = {}, hint: HTMLElement | null = null, you: HTMLDivElement | null = null;
  const labels = new Map<string, LabelEntry>(), chips = new Map<string, { node: HTMLDivElement; chip: OverlayChip }>();
  if (doc) {
    root = doc.createElement('div');
    root.className = 'm3';
    root.innerHTML = `<div class="m3-labels" role="group" aria-label="Places in ${pack.name}. Choose one to see it and travel there. The list of places in the Map panel is the same thing as a list."></div>
      <div class="m3-controls" role="group" aria-label="Map view"><div class="m3-zoom"><button type="button" data-m3="in" aria-label="Zoom in" title="Zoom in">${ICON('<path d="M12 5v14M5 12h14"/>')}</button><button type="button" data-m3="out" aria-label="Zoom out" title="Zoom out">${ICON('<path d="M5 12h14"/>')}</button></div><div class="m3-go"><button type="button" class="m3-pill m3-fit" data-m3="fit" aria-label="Show the whole city" title="Show the whole city">${ICON('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')}<span>Whole city</span></button><button type="button" class="m3-pill m3-me" data-m3="me" aria-label="Find me: show where you are" title="Show where you are">${ICON('<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>')}<span>Find me</span></button></div></div>
      <p class="m3-hint" data-m3-hint ${hintSeen ? 'hidden' : ''}>Drag to turn the city · pinch or scroll to zoom · two fingers to move. Tap a building to go there.</p>`;
    root.prepend(canvas);
    canvas.classList?.add('m3-canvas');
    canvas.setAttribute?.('aria-hidden', 'true');
    container.appendChild(root);
    labelLayer = root.querySelector('.m3-labels'); hint = root.querySelector('[data-m3-hint]');
    controls = Object.fromEntries([...root.querySelectorAll<HTMLElement>('[data-m3]')].map((node) => [node.dataset.m3!, node]));
  }

  // ---- state ----------------------------------------------------------------------------------
  let state: MapState | null = null, layer = 'city', filter = 'all', selected: string | null = null, hovered: string | null = null, destroyed = false, lost = false;
  let layers: MapLayers = { billboards: false, sea: false, neighbours: false, gov: false, moving: false, lgas: true, homes: true }, data: OverlayData = { ads: null, neighbours: null, gov: null };
  // The world: local governments and the houses on their estates (src/map3d/houses.ts, world-data.js).
  const plates = new Map<string, { node: HTMLButtonElement; note: HTMLElement; lga: PackLga; span: ReturnType<typeof spanOf>; scale: number }>(), tags: HTMLDivElement[] = [];
  let friends = new Set<string>(), summaryShown: ReturnType<WorldData['summary']> = null, hoverHouse: (PlotRef & { text: string }) | null = null, mine = null, pixels = 1;
  let wholeFrom = WHOLE_FROM;       // beyond this camera distance the view is of the whole state (see labels.ts), judged against the opening view of this screen
  let openedWhole = false;          // "Whole city" was pressed: a resize keeps that view, not the opening one
  let size = { width: 0, height: 0 }, insets: Insets = { left: 0, top: 0, right: 0, bottom: 0 }, opened = false, userMoved = false, time: TimeOfDay | null = null, labelKey = '', chipKey = '';
  let rafId = 0, renderCount = 0, frameCount = 0, lastTick = 0, seconds = 0, frameMs: number[] = [], gaps: number[] = [];
  let trip: Trip | null = null, route: Route | null = null, returning: { p: number; rate: number } | null = null, settling = false, pendingArrive: (() => void) | null = null, dueAt = -Infinity, tripCamera = true, pose: (TripPose & { progress?: number }) | null = null;
  let stood: { x: number; y: number; z: number } | null = null, nearDistance = 0;             // stood: where the piece stands when it is not travelling; nearDistance: how far out the close view is
  const clock = createTripClock();
  let heldTime: TimeOfDay | null = null, following = false;        // following: "find me" was pressed during a trip, so the view keeps the traveller in its middle
  const shown = () => !destroyed && !lost && !container.hidden && !pageHidden() && size.width > 0;
  const placeKey = (id: string) => (id === 'home' ? `home:${city.places.home!.house}` : id);

  // ---- drawing: on demand, and only as long as something moves ----------------------------------
  function request() { if (!rafId && shown() && raf) rafId = raf(tick); }
  function stop() { if (rafId) { caf?.(rafId); rafId = 0; } lastTick = 0; }
  function tick() {
    rafId = 0;
    if (!shown()) { lastTick = 0; return; }
    const t = now(), dt = lastTick ? clamp((t - lastTick) / 1000, 0, 0.1) : 0;
    if (lastTick) { gaps.push(t - lastTick); if (gaps.length > 120) gaps.shift(); }
    frameCount += 1;
    let moving = rig.step(dt);
    moving = stepTrip(t, dt) || moving;
    if (settling && !rig.moving) finishArrival();
    if (moving) { seconds += dt; city.animate(seconds); }
    draw(t);
    if (moving && !destroyed) { lastTick = t; request(); } else lastTick = 0;
  }
  function draw(t = now()) {
    // The player's piece grows as the view pulls back, so it can always be found — and a trip always followed.
    actor.setSize(clamp(rig.view.distance / 62, rig.view.distance < 34 ? Math.max(0.12, rig.view.distance / 62) : 1.2, Math.max(4, rig.view.distance / 110)));
    city.setDetail(rig.view.distance, wholeFrom * 1.35);
    if (route && routeStep() !== routeWidth) drawRoute();
    syncWorld();
    renderer.render(scene, camera);
    renderCount += 1;
    placeLabels();
    frameMs.push(now() - t); if (frameMs.length > 120) frameMs.shift();
  }

  // ---- the world: local governments and houses ---------------------------------------------------
  const hasWorld = Boolean(pack.lgas?.length);
  const ownPlot = () => { const plot = state?.estate?.plot; return plot && pack.lgas?.some((lga) => lga.id === plot.lga) ? plot : null; };
  const plotPoint = (plot: PlotRef) => estateLayout(pack, plot.lga)!.plot(plot.estate, plot.plot);
  /** Choose the level of detail for this view and say which estates are wanted. Cheap when nothing changed. */
  function syncWorld() {
    if (!hasWorld) return;
    pixels = size.height / (2 * Math.tan((camera.fov * Math.PI) / 360) * rig.view.distance || 1);
    const summary = world?.summary() ?? null;
    if (summary !== summaryShown) { summaryShown = summary; houses.setSummary(summary); updatePlates(); }
    houses.update({ x: rig.view.x, z: rig.view.z, distance: rig.view.distance, pixels }, world, { own: ownPlot(), serverNow: state?.t ?? 0, visible: layers.homes });
    const own = layers.homes ? ownPlot() : null;
    ownRing.visible = Boolean(own);
    if (own) { const at = plotPoint(own), pitch = estateLayout(pack, own.lga)!.pitch(own.estate); ownRing.position.set(at.x, 0.05, at.z); ownRing.scale.setScalar(Math.max(pitch * 0.85, 9 / pixels)); }
  }
  function updatePlates() {
    const own = state?.estate?.lga ?? null;
    for (const [id, plate] of plates) {
      const counts = summaryShown?.get(id);
      plate.note.textContent = counts ? `${counts.houses.toLocaleString('en-NG')} home${counts.houses === 1 ? '' : 's'}${counts.online ? ` · ${counts.online.toLocaleString('en-NG')} online` : ''}` : '';
      plate.node.classList.toggle('is-own', id === own);
      plate.node.setAttribute('aria-label', `${plate.lga.name} local government${id === own ? ', yours' : ''}${counts ? `, ${counts.houses} homes, ${counts.online} online` : ''}. Open its page.`);
    }
  }
  /** The house under a point of the ground, if its estate is drawn as houses: { lga, estate, plot, house }. */
  function houseAtGround(point: { x: number; z: number } | null) {
    if (!point || !layers.homes) return null;
    const lga = lgaAt(pack, point.x, point.z);
    if (!lga) return null;
    const layout = estateLayout(pack, lga)!, hit = plotAt(layout, point.x, point.z);
    if (!hit) return { lga, layout, estate: -1 };
    const drawn = houses.detailed().some((item) => item.lga === lga && item.estate === hit.estate);
    const house = drawn && hit.plot >= 0 ? world?.estate(lga, hit.estate)?.houses.get(hit.plot) ?? null : null;
    return { lga, layout, estate: hit.estate, plot: hit.plot, drawn, house };
  }
  const groundOf = (event: PointerEvent | MouseEvent) => { const n = toNdc(local(event)); return rig.groundAt(n.x, n.y); };
  /** A tap that hit no building: a house opens its owner's card, an estate is flown into, a local government opens its page. */
  function worldTap(event: PointerEvent | MouseEvent) {
    if (!hasWorld) return false;
    const point = groundOf(event), hit = houseAtGround(point);
    const lga = hit?.lga ?? (point ? lgaAt(pack, point.x, point.z) : null);
    if (!lga) return false;
    dismissHint();
    if (hit?.house) {
      const house = hit.house;
      onSelectHouse({ lga, estate: hit.estate, plot: hit.plot!, id: house.id ?? null, name: house.name ?? null, online: Boolean(house.online), you: Boolean(house.you), style: house.s, upgrading: house.u > (state?.t ?? 0) });
      return true;
    }
    const occupied = hit && hit.estate >= 0 && ((summaryShown?.get(lga)?.occ?.[hit.estate] ?? 0) > 0 || hit.estate === 0);
    if (occupied && !hit.drawn) { api.focusEstate(lga, hit.estate); return true; }
    if (layers.lgas) { onSelectLga(lga); return true; }
    return false;
  }
  function houseHover(event: PointerEvent) {
    const hit = hasWorld && !(event.target as HTMLElement).closest?.<HTMLElement>('[data-m3],.m3-chip,.m3-lga') ? houseAtGround(groundOf(event)) : null;
    const next = hit?.house ? { lga: hit.lga, estate: hit.estate, plot: hit.plot!, text: hit.house.you ? 'Your house' : hit.house.name ? `${hit.house.name}${hit.house.online ? ' · online' : ''}` : 'A neighbour (not listed)' } : null;
    if ((next && hoverHouse && next.lga === hoverHouse.lga && next.estate === hoverHouse.estate && next.plot === hoverHouse.plot) || (!next && !hoverHouse)) return;
    hoverHouse = next;
    if (root && !hovered) root.style.cursor = next ? 'pointer' : '';
    request();
  }

  // ---- the trip ----------------------------------------------------------------------------------
  function standHere() {
    const place = city.places[state?.location!] || city.places.home!, node = network.places[placeKey(place.id)];
    const door = node?.door || place;
    actor.stand(door.x, door.z, place.ry);
    stood = { x: door.x, y: 0, z: door.z };
  }
  function straight(from: string, to: string): Route {
    const a = network.places[placeKey(from)]?.door || city.places[from] || city.places.home!, b = network.places[placeKey(to)]?.door || city.places[to] || city.places.home!;
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { from, to, points: [{ x: a.x, y: 0, z: a.z, bridge: null }, { x: b.x, y: 0, z: b.z, bridge: null }], lengths: [0, length], length, lead: length * 0.1, tail: length * 0.1, bridges: [] };
  }
  /** The route line widens as the view pulls back, in steps (a halving of the zoom is two), so that it can be followed from a whole-state view. */
  const routeStep = () => Math.round(Math.log2(clamp(rig.view.distance / 120, 1, 24)) * 2);
  let routeWidth = 0;
  function drawRoute() {
    if (routeLine) { scene.remove(routeLine); routeLine.geometry.dispose(); routeLine = null; }
    if (!route) return;
    routeWidth = routeStep();
    const widen = Math.pow(2, routeWidth / 2), raw = createRaw(THREE);
    raw.ribbon(route.points, 1.25 * widen, 0.16 + widen * 0.02, '#14532d'); raw.ribbon(route.points, 0.7 * widen, 0.18 + widen * 0.02, '#ffd166');
    routeLine = raw.build(routeMaterial); routeLine.renderOrder = 2; routeLine.name = 'route';
    scene.add(routeLine);
  }
  function startTrip(next: Trip) {
    trip = next; returning = null; settling = false; dueAt = -Infinity; tripCamera = true;
    dismissHint(); following = false;
    route = network.route(placeKey(next.from), placeKey(next.to)) || straight(next.from, next.to);
    actor.dot(reducedMotion); actor.setMode(next.mode);
    drawRoute();
    if (shown() && !reducedMotion) rig.ease(rig.framing(route.points.filter((_, i) => i % 4 === 0 || i === route!.points.length - 1), { pad: 1.5, min: 70 }), 0.9);
  }
  function clearTrip() {
    trip = null; route = null; returning = null; settling = false; pose = null; following = false;
    clock.clear();
    drawRoute();
    if (state) standHere();
  }
  /** Place the traveller for this instant. Returns true while the trip still has ground to cover. */
  function stepTrip(t: number, dt: number) {
    if (returning) {                                  // a cancelled trip: walk it back to where it started
      returning.p = Math.max(0, returning.p - dt * returning.rate);
      pose = tripPose(route!, returning.p, trip!.mode); actor.place(pose);
      if (returning.p <= 0) { clearTrip(); return false; }
      return true;
    }
    if (!trip || !route || settling) return false;
    const p = clock.progress(t);
    pose = tripPose(route, p, trip.mode); pose.progress = p;
    actor.place(pose);
    if (following && !rig.goal && dt) { const k = Math.min(1, dt * 5); rig.view.x += (pose.x - rig.view.x) * k; rig.view.z += (pose.z - rig.view.z) * k; rig.apply(); }
    if (p >= 1) {
      // The door is reached: ask the server for the arrival now instead of waiting for the next poll.
      if (t - dueAt > 700) { dueAt = t; onTripDue(); }
      return false;
    }
    return !reducedMotion;
  }
  function finishArrival() {
    const done = pendingArrive;
    pendingArrive = null; opened = false; userMoved = false;
    clearTrip();
    done?.();
  }

  // ---- lighting ----------------------------------------------------------------------------------
  function applyTime(next: TimeOfDay) {
    if (next === time) return false;
    time = next;
    const preset = city.setTime(next);
    actor.setTime?.(next); // model-library trip vehicles have day and night lights; a no-op otherwise
    hemi.color.set(preset.hemi[0]); hemi.groundColor.set(preset.hemi[1]); hemi.intensity = preset.hemi[2];
    sun.color.set(preset.sun[0]); sun.intensity = preset.sun[1]; sun.position.set(...preset.sun[2]);
    if (root) { root.dataset.time = next; root.style.background = `linear-gradient(${preset.sky[0]}, ${preset.sky[1]})`; }
    return true;
  }
  applyTime('day');

  // ---- labels ------------------------------------------------------------------------------------
  const probe = new THREE.Vector3();
  const nameOf = (place: CityPlace) => (place.kind === 'home' ? 'Home' : venueLabel(place.id, cityId));
  function buildLabels() {
    if (!labelLayer) return;
    for (const place of Object.values(city.places).sort((a, b) => a.x - b.x || a.z - b.z)) {
      const source = VENUE_TABLE[place.id] || SOON_TABLE[place.id];
      const node = doc!.createElement('button');
      node.type = 'button'; node.className = `m3-label is-${place.kind}`; node.dataset.venue = place.id;
      const icon = doc!.createElement('span'); icon.className = 'm3-label-icon'; icon.setAttribute('aria-hidden', 'true'); icon.innerHTML = iconFor('venue', place.id, source?.icon);
      const text = doc!.createElement('span'); text.className = 'm3-label-text';
      const name = doc!.createElement('b'), note = doc!.createElement('small');
      text.append(name, note); node.append(icon, text);
      labelLayer.append(node);
      labels.set(place.id, { node, name, note, width: 80, height: 30, priority: 0, shift: 0 });
    }
    // The traveller's own tag: it rides above the avatar for the length of a trip.
    for (const lga of pack.lgas || []) {
      const node = doc!.createElement('button');
      node.type = 'button'; node.className = 'm3-lga'; node.dataset.lga = lga.id; node.hidden = true;
      const name = doc!.createElement('b'), note = doc!.createElement('small');
      name.textContent = lga.name;
      node.append(name, note);
      labelLayer.append(node);
      plates.set(lga.id, { node, note, lga, span: spanOf(lga.polygon), scale: 1 });
    }
    // House tags: the hovered house, your own, and friends' — a handful of nodes, however many houses there are.
    for (let i = 0; i < 14; i++) { const node = doc!.createElement('div'); node.className = 'm3-tag'; node.hidden = true; node.setAttribute('aria-hidden', 'true'); labelLayer.append(node); tags.push(node); }
    you = doc!.createElement('div');
    you.className = 'm3-you'; you.hidden = true; you.setAttribute('aria-hidden', 'true'); you.textContent = 'You';
    labelLayer.append(you);
  }
  function updateLabels() {
    if (!labelLayer) return;
    // Once the server has moved the player, the place is where they are — not where they are going, nor one they are leaving.
    const at = state?.t ?? 0, going = trip && state?.location !== trip.to ? trip.to : null, home = city.places.home!;
    const next = JSON.stringify([state?.location, going, home.house, filter, selected, hovered, layers.gov, Object.values<VenueInfo>(VENUE_TABLE as Record<string, VenueInfo>).map((venue) => openingInfo(venue.hours, at).status)]);
    if (next === labelKey) return;
    labelKey = next;
    for (const [id, label] of labels) {
      const place = city.places[id]!, venue = VENUE_TABLE[id], soon = place.kind === 'soon';
      const opening = venue ? openingInfo(venue.hours, at) : null, open = Boolean(opening?.open), here = state?.location === id;
      const status = soon ? 'Coming soon' : here ? (going ? 'Leaving from here' : 'You are here') : going === id ? 'On the way' : open ? '' : opening?.opensAt ? `opens ${opening.opensAt}` : 'Closed';
      const dimmed = soon ? filter !== 'all' : filter === 'open' ? !open : filter !== 'all' && venue!.category !== filter && id !== 'home';
      const district = place.kind === 'home' ? home.district : venueDistrict(id, cityId);
      label.name.textContent = nameOf(place); label.note.textContent = status;
      const node = label.node;
      node.className = `m3-label is-${place.kind}${here ? ' is-here' : ''}${going === id ? ' is-going' : ''}${!soon && !open ? ' is-closed' : ''}${dimmed && !here ? ' is-dimmed' : ''}${selected === id ? ' is-selected' : ''}${hovered === id ? ' is-hover' : ''}${layers.gov && (id === 'state-house' || id === 'polling-unit') ? ' is-gov' : ''}`;
      node.setAttribute('aria-label', `${nameOf(place)}, ${district}${status ? `, ${status.toLowerCase()}` : ', open now'}`);
      node.title = `${nameOf(place)}${status ? ` · ${status}` : ''}`;
      if (here) node.setAttribute('aria-current', 'location'); else node.removeAttribute('aria-current');
      label.priority = (here ? 100 : 0) + (selected === id ? 90 : 0) + (going === id ? 80 : 0) + (hovered === id ? 70 : 0) + (place.kind === 'home' ? 40 : 0) + (soon ? 5 : open ? 20 : 10) - (dimmed ? 30 : 0);
      label.width = node.offsetWidth || 90; label.height = node.offsetHeight || 30;
    }
  }
  function syncChips() {
    if (!labelLayer) return;
    const list = overlays.chips(), next = JSON.stringify(list.map((chip) => [chip.key, chip.text, chip.bg, chip.homes]));
    if (next === chipKey) return;
    chipKey = next;
    for (const { node } of chips.values()) node.remove();
    chips.clear();
    for (const chip of list) {
      const node = doc!.createElement('div');
      node.className = `m3-chip is-${chip.kind}`;
      if (chip.label) { node.setAttribute('role', 'img'); node.setAttribute('aria-label', chip.label); }
      if (chip.bg) { node.style.background = chip.bg; node.style.color = chip.ink!; }
      const icon = doc!.createElement('span'); icon.className = 'm3-chip-icon'; icon.innerHTML = chip.glyph || '';
      node.append(icon);
      // Player text goes in as text, never as markup, and is not a link or a button.
      if (chip.text) { const text = doc!.createElement('span'); text.className = 'm3-chip-text'; text.textContent = chip.text; node.append(text); }
      if (chip.homes?.length) {
        node.removeAttribute('role'); node.removeAttribute('aria-label');
        const row = doc!.createElement('span'); row.className = 'm3-chip-homes';
        for (const item of chip.homes) {
          const house = doc!.createElement(item.you ? 'span' : 'button');
          house.className = `m3-house${item.online ? ' is-online' : ''}${item.you ? ' is-you' : ''}`; house.innerHTML = chip.homeGlyph || iconFor('house', null, 'home');
          house.title = item.you ? `${item.name} (you)` : item.name;
          house.setAttribute('aria-label', `${item.name}${item.you ? ' (you)' : ''}, ${item.online ? 'online now' : 'not online'}`);
          if (!item.you) { (house as HTMLButtonElement).type = 'button'; house.dataset.neighbour = item.id; house.dataset.name = item.name; }
          row.append(house);
        }
        if (chip.more! > 0) { const more = doc!.createElement('span'); more.className = 'm3-chip-more'; more.textContent = `+${chip.more}`; row.append(more); }
        node.append(row);
      }
      labelLayer.append(node);
      chips.set(chip.key, { node, chip });
    }
  }
  const project = (x: number, y: number, z: number) => { probe.set(x, y, z).project(camera); return { x: (probe.x * 0.5 + 0.5) * size.width, y: (-probe.y * 0.5 + 0.5) * size.height, front: probe.z < 1 }; };
  function placeLabels() {
    if (!labelLayer) return;
    // Level of detail: a whole-state view names the local governments, and only the places that matter to the player (here, picked, on the way).
    const wholeView = rig.view.distance > wholeFrom;
    const entries: { label: LabelEntry; at: ReturnType<typeof project>; visible: boolean }[] = [];
    for (const [id, label] of labels) {
      const place = city.places[id]!, at = project(place.x, place.top + 0.5, place.z);
      entries.push({ label, at, visible: at.front && at.x > -60 && at.x < size.width + 60 && at.y > -20 && at.y < size.height + 80 && !(wholeView && label.priority < 70) });
    }
    entries.sort((a, b) => b.label.priority - a.label.priority || b.at.y - a.at.y);
    const taken: ScreenBox[] = [];
    const hits = (box: ScreenBox) => taken.some((other) => box.l < other.r && box.r > other.l && box.t < other.b && box.b > other.t);
    // The player's piece on screen (with its "You" tag during a trip): no label may cover it.
    const travelling = Boolean(pose && trip && shown()), spot = travelling ? pose : stood, riding = travelling && pose!.phase === 'ride';
    const feet = spot ? project(spot.x, spot.y, spot.z) : null, head = spot ? project(spot.x, spot.y + (riding ? 3.3 : 3.1) * actor.size, spot.z) : null;
    const piece = feet?.front ? avatarBox(feet, head!, { riding, tag: travelling }) : null;
    for (const { label, at, visible } of entries) {
      const node = label.node;
      if (!visible) { if (!node.hidden) node.hidden = true; continue; }
      if (node.hidden) node.hidden = false;
      const full = { l: at.x - label.width / 2 - 3, r: at.x + label.width / 2 + 3, t: at.y - label.height - 2, b: at.y + 2 };
      // A name that would sit on top of a more important one shrinks to its icon; it is still a button with its full name.
      const lift = labelShift(full, piece), moved = lift ? { l: full.l, r: full.r, t: full.t + lift, b: full.b + lift } : full;
      const compact = hits(moved), small = { l: at.x - 15, r: at.x + 15, t: at.y - 30, b: at.y };
      // It steps clear of the player's piece: up on a longer stalk, or down over its own roof (src/map3d/labels.ts).
      const shift = compact ? labelShift(small, piece) : lift;
      taken.push(compact ? { l: small.l, r: small.r, t: small.t + shift, b: small.b + shift } : moved);
      node.classList.toggle('is-compact', compact);
      if (shift !== label.shift) {
        label.shift = shift;
        node.classList.toggle('is-lowered', shift > 0);
        if (shift < 0) node.style.setProperty('--m3-stalk', `${(compact ? 6 : 9) - shift}px`); else node.style.removeProperty('--m3-stalk');
      }
      node.style.transform = `translate(${Math.round(at.x)}px,${Math.round(at.y + shift)}px) translate(-50%,-100%)`;
    }
    if (you) {
      if (you.hidden === travelling) you.hidden = !travelling;
      if (travelling) you.style.transform = `translate(${Math.round(head!.x)}px,${Math.round(head!.y)}px) translate(-50%,-100%)`;
    }
    const far = rig.view.distance > 230;
    if (root!.classList.contains('is-far') !== far) root!.classList.toggle('is-far', far);
    // Local-government name plates stand on the ground at their plate point; near the houses they step back.
    const drawn: ScreenBox[] = [];
    for (const plate of [...plates.values()].sort((p, q) => (q.span.maxX - q.span.minX) - (p.span.maxX - p.span.minX))) {
      const { node, lga } = plate, at = project(lga.plate[0], 0.1, lga.plate[1]);
      const fit = plateFit(lga.name, Math.abs(project(plate.span.maxX, 0.1, lga.plate[1]).x - project(plate.span.minX, 0.1, lga.plate[1]).x), rig.view.distance, wholeFrom * 1.25);
      const w = plateWidth(lga.name) * fit.scale * 0.6, h = 24 * fit.scale, box = { l: at.x - w, r: at.x + w, t: at.y - h / 2, b: at.y + h / 2 };
      const visible = layers.lgas && fit.show && at.front && at.x > -80 && at.x < size.width + 80 && at.y > insets.top - 10 && at.y < size.height + 30 && rig.view.distance > 26
        && !drawn.some((other) => box.l < other.r && box.r > other.l && box.t < other.b && box.b > other.t) && !(wholeView ? false : hits(box));
      if (node.hidden === visible) node.hidden = !visible;
      if (!visible) continue;
      drawn.push(box);
      if (fit.scale !== plate.scale) { plate.scale = fit.scale; node.style.fontSize = fit.scale > 1 ? `${(11 * fit.scale).toFixed(1)}px` : ''; node.classList.toggle('is-sized', fit.scale > 1); }
      node.style.transform = `translate(${Math.round(at.x)}px,${Math.round(at.y)}px) translate(-50%,-50%)`;
    }
    // House tags: yours, the one under the pointer, friends' in the estates drawn as houses.
    const wanted: (PlotRef & { text: string; kind: string })[] = [], own = layers.homes ? ownPlot() : null;
    if (own && !city.places.home!.own) wanted.push({ ...own, text: 'Your house', kind: 'own' });
    if (hoverHouse) wanted.push({ ...hoverHouse, kind: 'hover' });
    if (layers.homes && friends.size) for (const item of houses.detailed()) {
      for (const house of world?.estate(item.lga, item.estate)?.houses.values() ?? []) if (house.id && friends.has(house.id) && wanted.length < tags.length) wanted.push({ lga: item.lga, estate: item.estate, plot: house.p, text: house.name!, kind: house.online ? 'friend is-online' : 'friend' });
    }
    tags.forEach((node, i) => {
      const item = wanted[i], spot = item ? plotPoint(item) : null, at = spot ? project(spot.x, estateLayout(pack, item!.lga)!.pitch(item!.estate) * 0.9, spot.z) : null;
      const visible = Boolean(at?.front) && at!.x > 0 && at!.x < size.width && at!.y > insets.top && at!.y < size.height;
      if (node.hidden === visible) node.hidden = !visible;
      if (!visible) return;
      if (node.textContent !== item!.text) node.textContent = item!.text;
      node.className = `m3-tag is-${item!.kind}`;
      node.style.transform = `translate(${Math.round(at!.x)}px,${Math.round(at!.y)}px) translate(-50%,-100%)`;
    });
    // "Find me" lights up while the player's piece is out of sight, or (on a phone) the view has pulled well back from it.
    const away = !feet?.front || feet.x < insets.left || feet.x > size.width - insets.right || feet.y < insets.top || feet.y > size.height - insets.bottom + 40 || (size.width <= 720 && nearDistance > 0 && rig.view.distance > nearDistance * 1.7);
    if (root!.classList.contains('is-away') !== away) root!.classList.toggle('is-away', away);
    for (const { node, chip } of chips.values()) {
      const at = project(chip.x, chip.y, chip.z);
      const visible = at.front && at.x > -40 && at.x < size.width + 40 && at.y > 0 && at.y < size.height + 40 && !(far && (chip.kind === 'plot' || chip.kind === 'board-free'));
      if (node.hidden === visible) node.hidden = !visible;
      if (visible) node.style.transform = `translate(${Math.round(at.x)}px,${Math.round(at.y - (chip.lift || 0))}px) translate(-50%,-100%)`;
    }
  }

  // ---- the view --------------------------------------------------------------------------------
  function measureInsets(): Insets & { wide?: boolean } {
    if (!doc) return { left: 0, top: 0, right: 0, bottom: 0 };
    const page = container.getBoundingClientRect();
    const box = (selector: string) => { const rect = doc.querySelector(selector)?.getBoundingClientRect(); return rect && rect.height ? rect : null; };
    const bar = box('.life-status'), nav = box('.life-nav'), panel = box('.map-panel'), wide = page.width > 720;
    let left = 8, right = wide ? 64 : 8, top = (bar ? bar.bottom - page.top : 56) + 8, bottom = (nav ? page.bottom - nav.top : 70) + 10;
    const dock = panel ? dockOf(panel, page, wide) : null;
    if (dock?.side === 'left') left = Math.max(left, dock.amount); else if (dock?.side === 'bottom') bottom = Math.max(bottom, dock.amount);
    return { left, top, right, bottom, wide };
  }
  /** A camera kept before a reload, applied when the map first opens (or at once when it is open). */
  let pendingView: RigView | null = null;
  function openView() {
    opened = true; userMoved = false;
    if (pendingView) { rig.jump(pendingView); pendingView = null; userMoved = true; return; }
    rig.jump({ yaw: 0, pitch: DEFAULT_PITCH });
    openedWhole = false;
    if (size.width > 720) { rig.jump(rig.core()); return; }
    // A phone cannot name the places of the whole city at once: it opens close on where the player is.
    rig.jump(nearView(city.places[state?.location!] || city.places.home!));
  }
  /** The close view around a point (the player): near enough for the places around it to be named, on this screen. */
  function nearView(at: { x: number; z: number }) {
    const near = rig.framing(nearPoints(at, size.width <= 720), { pad: 1, min: MIN_DISTANCE });
    nearDistance = near.distance;
    return near;
  }
  function layout() {
    const rect = container.getBoundingClientRect();
    if (container.hidden || !rect.width || !rect.height) { stop(); return false; }
    const next = measureInsets();
    const changed = rect.width !== size.width || rect.height !== size.height || (['left', 'top', 'right', 'bottom'] as const).some((side) => Math.round(next[side]) !== Math.round(insets[side]));
    if (changed) {
      size = { width: rect.width, height: rect.height }; insets = next;
      renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, size.width <= 720 ? 1.75 : 2));
      renderer.setSize(size.width, size.height, false);
      rig.setViewport(size.width, size.height, insets);
      wholeFrom = Math.max(WHOLE_FROM, rig.core().distance * 1.5);
      container.style?.setProperty('--map-dock', `${Math.round(insets.bottom)}px`);
      if (root) { root.style.setProperty('--m3-dock', `${Math.round(insets.bottom)}px`); root.style.setProperty('--m3-left', `${Math.round(insets.left)}px`); root.style.setProperty('--m3-top', `${Math.round(insets.top)}px`); }
    }
    if (!opened) { openView(); if (trip && route && !reducedMotion) rig.jump(rig.framing(route.points.filter((_, i) => i % 4 === 0 || i === route!.points.length - 1), { pad: 1.5, min: 70 })); }
    else if (changed && !userMoved && size.width > 720 && !trip) rig.jump(openedWhole ? rig.whole() : rig.core());
    // The panels change as a trip starts (the list gives way to the trip bar): the route is framed again in the room that is left.
    else if (changed && trip && route && tripCamera && !reducedMotion) rig.ease(rig.framing(route.points.filter((_, i) => i % 4 === 0 || i === route!.points.length - 1), { pad: 1.5, min: 70 }), 0.4);
    return true;
  }
  const motion = (target: Partial<RigView>, time = 0.5) => { if (reducedMotion) rig.jump(target); else rig.ease(target, time); request(); };
  function setSelected(id: string | null) {
    selected = id;
    const place = id ? city.places[id] : null;
    selectRing.visible = Boolean(place);
    if (place) selectRing.position.set(place.x, 0.1, place.z);
    updateLabels();
  }
  function reveal(id: string) {
    const place = city.places[id];
    if (!place || !shown()) return;
    const at = project(place.x, place.top * 0.5, place.z);
    const inside = at.front && at.x > insets.left + 60 && at.x < size.width - insets.right - 60 && at.y > insets.top + 70 && at.y < size.height - insets.bottom - 40;
    if (!inside) motion({ x: place.x, z: place.z });
  }
  function dismissHint() { hintSeen = true; if (hint && !hint.hidden) hint.hidden = true; }
  function pick(clientX: number, clientY: number, radius = PICK_RADIUS): string | null {
    const page = container.getBoundingClientRect(), x = clientX - page.left, y = clientY - page.top;
    let best = null;
    for (const place of Object.values(city.places)) {
      const base = project(place.x, 0, place.z), top = project(place.x, place.top, place.z);
      if (!base.front) continue;
      // Anywhere over the building counts, from its plinth to its roof, with room to spare for a finger.
      const cy = clamp(y, Math.min(base.y, top.y), Math.max(base.y, top.y)), distance = Math.hypot(x - base.x, y - cy);
      const reach = Math.max(radius, Math.abs(project(place.x + PLINTH / 2, 0, place.z).x - base.x) * 1.2);
      if (distance <= reach && (!best || distance < best.distance)) best = { id: place.id, distance };
    }
    return best?.id ?? null;
  }
  function choose(id: string | null) {
    if (!id) return;
    dismissHint();
    setSelected(id);
    request();
    // With the Gov layer on, the State House opens the Governor sheet instead of the travel card.
    if (layers.gov && id === 'state-house') onSelectGov(); else onSelectVenue(id);
  }
  function focus(id: string) { const place = city.places[id]; if (place) { userMoved = true; tripCamera = false; motion({ x: place.x, z: place.z, distance: 52 }, 0.55); } }

  // ---- input -------------------------------------------------------------------------------------
  const pointers = new Map<number, { x: number; y: number }>();
  let gesture: Gesture | null = null, lastTap: { id: string | null; at: number } = { id: null, at: 0 }, suppressClick = false;
  const local = (event: MouseEvent) => { const page = container.getBoundingClientRect(); return { x: event.clientX - page.left, y: event.clientY - page.top }; };
  const toNdc = (point: { x: number; y: number }) => ({ x: (point.x / size.width) * 2 - 1, y: -(point.y / size.height) * 2 + 1 });
  function grab() { userMoved = true; tripCamera = false; following = false; dismissHint(); }
  function onPointerDown(event: PointerEvent) {
    if ((event.target as HTMLElement).closest?.<HTMLElement>('[data-m3],[data-neighbour]')) return;   // the view buttons and the estate's homes are not a place to start a drag
    if (event.isPrimary) pointers.clear();
    pointers.set(event.pointerId, local(event));
    rig.hold();
    // A fresh press starts clean: only the click that ends a drag is swallowed (see onClick).
    if (pointers.size === 1) { suppressClick = false; gesture = { kind: event.button === 2 || event.button === 1 || event.shiftKey ? 'pan' : 'orbit', id: event.pointerId, from: local(event), last: local(event), moved: false, spin: 0, at: now(), onLabel: Boolean((event.target as HTMLElement).closest?.<HTMLElement>('.m3-label')) }; }
    else if (pointers.size === 2) { const [a, b] = [...pointers.values()] as [Pt, Pt]; gesture = { kind: 'pinch', distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, moved: true }; suppressClick = true; grab(); }
  }
  function onPointerMove(event: PointerEvent) {
    const at = local(event);
    if (!pointers.has(event.pointerId)) {
      if (event.pointerType === 'mouse' && !event.buttons) { houseHover(event); hover((event.target as HTMLElement).closest?.<HTMLElement>('.m3-label')?.dataset.venue || ((event.target as HTMLElement).closest?.<HTMLElement>('[data-m3],.m3-chip') ? null : pick(event.clientX, event.clientY, 22))); }
      return;
    }
    pointers.set(event.pointerId, at);
    if (gesture?.kind === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()] as [Pt, Pt], distance = Math.hypot(a.x - b.x, a.y - b.y) || 1, mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      rig.panScreen(mid.x - gesture.mid.x, mid.y - gesture.mid.y);
      const n = toNdc(mid);
      rig.zoomAt(gesture.distance / distance, n.x, n.y);
      gesture.distance = distance; gesture.mid = mid;
      request();
      return;
    }
    if (!gesture || gesture.kind === 'pinch' || gesture.id !== event.pointerId) return;
    const dx = at.x - gesture.last.x, dy = at.y - gesture.last.y;
    if (!gesture.moved && Math.hypot(at.x - gesture.from.x, at.y - gesture.from.y) < DRAG_START) return;
    // A drag may start anywhere, a label included; the pointer is captured only now, so a plain tap on a label is still its click.
    if (!gesture.moved) { gesture.moved = true; grab(); root?.classList.add('is-dragging'); try { root!.setPointerCapture?.(event.pointerId); } catch { /* the pointer is already gone */ } }
    gesture.last = at;
    if (gesture.kind === 'pan') rig.panScreen(dx, dy);
    else {
      // The city follows the finger; dragging down tips the view over the top. The turn's speed is kept for the glide on release.
      const turn = -dx * 0.0052, t = now(), dt = Math.max(0.008, (t - gesture.at!) / 1000);
      gesture.spin = gesture.spin! * 0.5 + (turn / dt) * 0.5; gesture.at = t;
      rig.orbit(turn, dy * 0.0042);
    }
    request();
  }
  function onPointerUp(event: PointerEvent) {
    if (!pointers.delete(event.pointerId)) return;
    if (gesture?.kind === 'pinch') {
      const [rest] = [...pointers.entries()];
      gesture = rest ? { kind: 'pan', id: rest[0], from: rest[1], last: rest[1], moved: true } : null;
    } else if (gesture?.id === event.pointerId) {
      // A flick glides on; a drag that had stopped before the finger lifted does not.
      if (gesture.moved) { suppressClick = true; if (gesture.kind === 'orbit' && !reducedMotion && event.type !== 'pointercancel' && now() - gesture.at! < 90) { rig.release(gesture.spin!); request(); } }
      else if (event.type !== 'pointercancel' && !gesture.onLabel) tap(event);        // a tap on a label is the label's own click
      gesture = null;
    }
    if (!pointers.size) root?.classList.remove('is-dragging');
  }
  function tap(event: PointerEvent) {
    const id = pick(event.clientX, event.clientY), at = now();
    if (id && lastTap.id === id && at - lastTap.at < DOUBLE_TAP_MS) { focus(id); lastTap = { id: null, at: 0 }; return; }
    lastTap = { id, at };
    if (id) choose(id); else if (worldTap(event)) request();
  }
  function hover(id: string | null) {
    if (id === hovered) return;
    hovered = id;
    const place = id ? city.places[id] : null;
    hoverRing.visible = Boolean(place) && id !== selected;
    if (place) hoverRing.position.set(place.x, 0.12, place.z);
    if (root) root.style.cursor = place ? 'pointer' : '';
    updateLabels();
    request();
  }
  function onWheel(event: WheelEvent) {
    event.preventDefault();
    grab();
    const delta = event.deltaY * (event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? 320 : 1), n = toNdc(local(event));
    rig.zoomAt(Math.exp(clamp(delta, -240, 240) * (event.ctrlKey ? 0.01 : 0.0016)), n.x, n.y);
    request();
  }
  function onClick(event: MouseEvent) {
    const control = (event.target as HTMLElement).closest?.<HTMLElement>('[data-m3]');
    if (control) { onControl(control.dataset.m3); return; }
    const house = (event.target as HTMLElement).closest?.<HTMLElement>('[data-neighbour]');
    if (house) { onSelectNeighbour({ id: house.dataset.neighbour, name: house.dataset.name }); return; }
    const plate = (event.target as HTMLElement).closest?.<HTMLElement>('.m3-lga');
    if (plate && !suppressClick) { onSelectLga(plate.dataset.lga!); return; }
    const label = (event.target as HTMLElement).closest?.<HTMLElement>('.m3-label');
    // Only the pointer click that ends a drag or a pinch is swallowed; a keyboard click (detail 0) always goes through.
    if (suppressClick) { suppressClick = false; if (event.detail !== 0) return; }
    if (label) choose(label.dataset.venue!);
  }
  function onControl(name: string | undefined) {
    grab();
    if (name === 'in') motion({ distance: rig.view.distance * 0.68 }, 0.3);
    else if (name === 'out') motion({ distance: rig.view.distance / 0.68 }, 0.3);
    else if (name === 'fit') { motion(rig.whole(), 0.6); userMoved = false; openedWhole = true; }
    else if (name === 'me') {
      // During a trip "find me" also keeps up with the traveller, until the player moves the view themselves.
      // It comes back to the close view the map opens on — or stays closer, if the player already is.
      const place = city.places[state?.location!] || city.places.home!, at = pose || place;
      motion({ x: at.x, z: at.z, distance: Math.min(rig.view.distance, nearView(at).distance) }, 0.6);
      following = Boolean(trip && pose && !reducedMotion);
    }
  }
  function onKey(event: CustomEvent<unknown>) {
    const { action, mode } = detailOf(event);
    if (mode !== 'map' || layer !== 'city' || !shown()) return;
    if (action === 'move-left') rig.panScreen(90, 0); else if (action === 'move-right') rig.panScreen(-90, 0);
    else if (action === 'move-up') rig.panScreen(0, 90); else if (action === 'move-down') rig.panScreen(0, -90);
    else if (action === 'zoom-in') { onControl('in'); return; } else if (action === 'zoom-out') { onControl('out'); return; } else if (action === 'zoom-fit') { onControl('fit'); return; }
    else return;
    grab(); request();
  }
  function onUi(event: CustomEvent<unknown>) {
    const detail = detailOf(event);
    if (detail.layer === 'city' || detail.layer === 'world') layer = detail.layer;
    if (typeof detail.filter === 'string') { filter = detail.filter; labelKey = ''; }
    const picked = 'selected' in detail && detail.selected && detail.selected !== selected;
    if ('selected' in detail) setSelected(typeof detail.selected === 'string' && detail.selected && city.places[detail.selected] ? detail.selected : null);
    const seaWasOff = !layers.sea;
    if (detail.layers && typeof detail.layers === 'object') { const given = detail.layers as Record<string, unknown>; layers = { billboards: given.billboards === true, sea: given.sea === true, neighbours: given.neighbours === true, gov: given.gov === true, moving: given.moving === true, lgas: given.lgas !== false, homes: given.homes !== false }; }
    city.setLgas(layers.lgas, state?.estate?.lga ?? null);
    for (const key of ['ads', 'neighbours', 'gov'] as const) if (key in detail) (data as Record<string, unknown>)[key] = detail[key] && typeof detail[key] === 'object' ? detail[key] : null;
    city.setTraffic(layers.moving);
    if (overlays.set(layers, data)) syncChips();
    labelKey = ''; updateLabels();
    if (!shown() && !layout()) return;
    if (detail.layout) layout();
    if (selected && (picked || detail.layout)) reveal(selected);
    // Turning the Sea layer on brings the plots into view.
    if (layers.sea && seaWasOff && pack.bounds.sea) { const sea = pack.bounds.sea; userMoved = true; motion(rig.framing([{ x: sea.x0, z: sea.z0 - 14 }, { x: sea.x1, z: sea.z0 - 14 }, { x: sea.x0, z: sea.z1 }, { x: sea.x1, z: sea.z1 }], { pad: 1.1 }), 0.7); }
    request();
  }
  /** The tab was hidden or shown again: hidden, the loop stops at once (and a pending arrival is not left waiting for frames). */
  function onVisibility() { if (pageHidden()) { stop(); if (settling) finishArrival(); } else request(); }
  function onLost(event: Event) { event.preventDefault?.(); lost = true; stop(); if (settling) finishArrival(); onContextLost(); }
  const listeners: (() => void)[] = [];
  const listen = <E extends Event>(target: EventTarget | null | undefined, type: string, handler: (event: E) => void, options?: AddEventListenerOptions) => { if (!target?.addEventListener) return; target.addEventListener(type, handler as EventListener, options); listeners.push(() => target.removeEventListener(type, handler as EventListener, options)); };
  if (root) {
    listen(root, 'pointerdown', onPointerDown); listen(root, 'pointermove', onPointerMove);
    listen(globalThis, 'pointerup', onPointerUp); listen(globalThis, 'pointercancel', onPointerUp);
    listen(root, 'wheel', onWheel, { passive: false }); listen(root, 'click', onClick);
    listen(root, 'dblclick', (event) => { const id = (event.target as HTMLElement).closest?.<HTMLElement>('.m3-label')?.dataset.venue; if (id) focus(id); });
    listen(root, 'contextmenu', (event) => event.preventDefault());
    listen(root, 'pointerleave', () => hover(null));
    listen(doc, 'visibilitychange', onVisibility);
    listen(canvas, 'webglcontextlost', onLost);
  }
  listen(globalThis, 'jaw:map-ui', onUi); listen(globalThis, 'jaw:key', onKey);

  buildLabels();

  const api = {
    kind: '3d',
    get ready() { return layer === 'city'; },
    setState(next: MapState | null) {
      state = next;
      // Home is the rented home's lot — or, for a player living in their own house, the plot it stands on.
      const plot = ownPlot(), living = state?.estate?.living === 'own' && plot;
      let changed = living ? city.setHome(null, { ...plotPoint(plot!), label: pack.lgas.find((lga) => lga.id === plot!.lga)?.name ?? 'Your house', top: Math.max(0.6, estateLayout(pack, plot!.lga)!.pitch(plot!.estate) * 1.1) }) : city.setHome(state?.travel?.home!);
      if (hasWorld && city.setLgas(layers.lgas, state?.estate?.lga ?? null)) { changed = true; updatePlates(); }
      if (changed) { labelKey = ''; if (overlays.set(layers, data)) syncChips(); }
      changed = applyTime(heldTime || timeOfDay(state?.t ?? 0)) || changed;
      const nextTrip = tripOf(state);
      if (nextTrip && city.places[nextTrip.to]) {
        const fresh = clock.sync(nextTrip, now());
        if (fresh || !route || returning) startTrip(nextTrip); else trip = nextTrip;
        if (!shown() || reducedMotion) stepTrip(now(), 0);
      } else if (trip && !settling && !returning) {
        if (state!.location === trip.to && shown() && !reducedMotion) {
          // Arrived: a moment at the door while the camera pushes in, then the host shows the venue.
          pose = tripPose(route!, 1, trip.mode); actor.place(pose);
          settling = true;
          rig.ease({ x: pose.x, z: pose.z, distance: clamp(rig.view.distance * 0.6, MIN_DISTANCE, 80) }, 0.42);
        } else if (state!.location === trip.from && shown() && !reducedMotion && pose) {
          returning = { p: pose.progress ?? 0, rate: Math.max(0.35, (pose.progress ?? 0) / 0.9) };   // back where it started in under a second
        } else clearTrip();
      } else if (!trip) standHere();
      updateLabels();
      // A shared link opens its place once the life has loaded.
      if (deepLink) { const id = deepLink; deepLink = null; if (city.places[id]) choose(id); }
      request();
    },
    /** The world data changed (the city summary or an estate arrived): draw it. */
    worldChanged() { if (world?.summary() !== summaryShown) updatePlates(); request(); },
    /** Public ids of the player's friends, so their houses can be named on the map. */
    setFriends(ids: Iterable<string> | null | undefined) { friends = new Set(ids || []); request(); },
    /** Fly to an estate so that its houses can be told apart. */
    focusEstate(lga: string, estate: number) { const cell = estateLayout(pack, lga)?.cells[estate]; if (!cell) return; grab(); motion({ x: cell.x, z: cell.z, distance: clamp(cell.size * 3.4, CLOSEST, 90) }, 0.7); },
    focusPlot(plot: PlotRef | null | undefined) { if (!plot || !pack.lgas?.some((lga) => lga.id === plot.lga)) return; const at = plotPoint(plot), cell = estateLayout(pack, plot.lga)!.cells[plot.estate]!; grab(); motion({ x: at.x, z: at.z, distance: clamp(cell.size * 2.2, CLOSEST, 60) }, 0.7); },
    focusLga(id: string) { const lga = pack.lgas?.find((item) => item.id === id); if (!lga) return; grab(); motion(rig.framing(lga.polygon.map(([x, z]) => ({ x, z, y: 0 })).filter((point) => point.x >= pack.bounds.fit.minX - 4 && point.x <= pack.bounds.fit.maxX + 4), { pad: 1.05, min: 50 }), 0.7); },
    houses,
    setPlayer(player: ActorPlayer | null | undefined) { if (actor.setPlayer(player)) { if (!trip && state) standHere(); request(); } },
    /** The page's visibility changed (the host of a test calls this; in a browser the document's own event does). */
    visibility: onVisibility,
    /** The container was shown, hidden or resized. */
    resize() { if (layout()) { updateLabels(); request(); } },
    /** Run `done` once the arrival has been shown (at once when there is nothing to show). */
    arrive(done: () => void) { if (settling) pendingArrive = done; else done(); },
    select(id: string) { choose(id); },
    /** The camera as it is now, for keeping it across a reload. */
    cameraView(): RigView { return { ...rig.view }; },
    /** Put the camera back where it was (a reload): at once when the map is open, otherwise when it first opens. */
    restoreView(next: RigView) { if (opened) { rig.jump(next); userMoved = true; tripCamera = false; request(); } else pendingView = next; },
    /** For tests and screenshots: hold the lighting at 'day' | 'dusk' | 'night' (null follows Lagos time again). */
    holdTime(next: TimeOfDay | null) { heldTime = next; if (applyTime(next || timeOfDay(state?.t ?? 0))) request(); },
    /** What the Map panel says, for callers that do not go through the window event (tests, a host replaying it). */
    ui(detail: MapUiDetail) { onUi({ detail } as CustomEvent<unknown>); },
    /** For tests and the diagnostics panel. */
    diagnostics() {
      const info = renderer.info?.render || {}, sorted = [...frameMs].sort((a, b) => a - b), gap = [...gaps].sort((a, b) => a - b);
      const mid = (list: number[]) => (list.length ? list[Math.floor(list.length / 2)]! : 0);
      return { kind: '3d', renderCount, frames: frameCount, loop: Boolean(rafId), time, reducedMotion, lost,
        triangles: info.triangles ?? 0, calls: info.calls ?? 0, cityTriangles: city.triangles, overlayTriangles: overlays.triangles, counts: city.counts,
        houses: { level: houses.level, ...houses.counts(), cached: world?.size?.() ?? 0 }, pixels,
        view: { ...rig.view }, frameMs: { median: mid(sorted), max: sorted.at(-1) ?? 0 }, frameGapMs: { median: mid(gap), max: gap.at(-1) ?? 0 },
        trip: trip ? { ...trip, progress: clock.progress(now()), remaining: clock.remaining(now()), shown: pose?.progress ?? null, phase: pose?.phase ?? null, bridge: pose?.bridge ?? null, distance: pose?.distance ?? null, length: route?.length ?? null, bridges: route?.bridges ?? [], x: pose?.x, z: pose?.z, settling, returning: Boolean(returning) } : null,
        selected, layers: { ...layers }, labels: [...labels].map(([id, label]) => ({ id, text: label.name.textContent, note: label.note.textContent, hidden: label.node.hidden, compact: label.node.classList.contains('is-compact') })) };
    },
    /** Where a place is on screen, in CSS pixels of the page (for tests that click on buildings). */
    screenOf(id: string) { const place = city.places[id]; if (!place) return null; const page = container.getBoundingClientRect(), at = project(place.x, place.top * 0.45, place.z); return { x: at.x + page.left, y: at.y + page.top }; },
    rig, city,
    destroy() {
      destroyed = true; stop();
      for (const remove of listeners) remove();
      if (routeLine) routeLine.geometry.dispose();
      routeMaterial.dispose();
      for (const ring of [selectRing, hoverRing]) { ring.geometry.dispose(); ring.material.dispose(); }
      ownRing.geometry.dispose(); ownRing.material.dispose();
      actor.dispose(); overlays.dispose(); houses.dispose(); city.dispose(); kit.dispose();
      if (!providedRenderer) { renderer.dispose(); renderer.forceContextLoss?.(); }
      root?.remove();
      const done = pendingArrive; pendingArrive = null; done?.();
    },
  };
  return api;
}
