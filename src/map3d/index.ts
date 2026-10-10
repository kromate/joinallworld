/**
 * OWNER: world
 * The city view the host talks to (src/life-main.js). It shows the 3D city map where it can and
 * the 2D schematic (src/city-map.ts) where it cannot, behind one unchanged contract:
 *
 *   createCityView(container, { cityId, onSelectVenue, onSelectGov, onSelectNeighbour, onTripDue, onNotice })
 *     → { ready, kind, setCity(id), setState(state), setPlayer(player), setShown(shown), resize(), arrive(done), diagnostics(), destroy() }
 *
 * WHICH MAP
 *   3D   the city has a pack in the region registry (src/map3d/regions.ts), WebGL is available and
 *        the player has not asked for the simple map
 *   2D   otherwise — and at once if the WebGL context is lost. The 2D map is also the choice of
 *        the "Simple map" button, kept in localStorage; it is the plainest, lightest view. It is
 *        the SAME city pack seen from above (src/map3d/map2d.ts, flat.js), not a second drawing.
 *
 * ONE HEAVY CONTEXT AT A TIME: the venue scene has its own WebGL context and draws only on
 * demand; so does the map, and only while it is shown. When the map has been out of sight for
 * RELEASE_MS its GPU resources are freed altogether (the city is procedural and rebuilds in a
 * few tens of milliseconds the next time the map opens). A lost context frees them at once.
 */
import type { HouseCard } from './map2d.ts';
import type { MapPeople } from './people.ts';
import type { MapState } from './map3d.ts';
import type { TravelVehicleBuilder } from './actor.ts';
import type { FetchJson, WorldData } from './world-data.ts';
import '../city-map.css';
import './map3d.css';
import { hasCityPack, loadCityPack } from './regions.ts';
import { createMap3D, detailOf, webglAvailable } from './map3d.ts';
import { createMap2D } from './map2d.ts';
import { createWorldData } from './world-data.ts';

/** What the host passes in: the city to open and what to do when the player picks something on the map. */
export interface CityViewOptions {
  cityId?: string
  onSelectVenue?: (venueId: string) => void
  onSelectGov?: () => void
  onSelectNeighbour?: (neighbour: { id: string | undefined; name: string | undefined }) => void
  onSelectLga?: (lga: string) => void
  onSelectHouse?: (house: HouseCard) => void
  /** A pin of other players was tapped: the friends it stands for, and the venue it stands at (null on the road). */
  onSelectPeople?: (ids: string[], venue: string | null) => void
  fetchJson?: FetchJson | null
  onTripDue?: () => void
  onNotice?: (text: string) => void
}
/** The part of a map (3D, flat, or the legacy schematic) that this view drives: the rest is optional because the legacy one lacks it. */
export interface MapImpl {
  setCity?(id: string): void
  setState(state: MapState | null): void
  setPlayer?(player?: unknown): unknown
  setFriends?(ids?: Iterable<string> | null): void
  setPeople?(next: MapPeople | null | undefined, clock?: () => number): void
  resize(): void
  arrive?(done: () => void): void
  diagnostics?(): object
  view?(): object
  cameraView?(): { x: number; z: number; yaw: number; pitch: number; distance: number }
  restoreView?(next: never): void
  /** Back to the opening view (the city core). */
  recentre?(): void
  worldChanged?(): void
  focusPlot?(plot: { lga: string; estate: number; plot: number } | null | undefined): void
  focusEstate?(lga: string, estate: number): void
  focusLga?(id: string): void
  destroy(): void
}
/** The detail of 'jaw:map-focus': { plot } | { lga } | { lga, estate }. */
interface MapFocusDetail { plot?: { lga: string; estate: number; plot: number }; lga?: string; estate?: number }
/** The camera of the city map: the 3D rig, or the flat map's scale and offset. */
export type MapCamera = { kind: '3d'; x: number; z: number; yaw: number; pitch: number; distance: number } | { kind: '2d'; scale: number; x: number; y: number }
/** The mounted map, or its explicit download-recovery view. */
export type CityViewKind = '3d' | '2d' | 'unavailable'
/** The handle the host talks to. */
export interface CityView {
  readonly ready: boolean
  readonly kind: CityViewKind | null
  /** Resolves once the first map or recovery view is mounted. */
  started: Promise<void> | null
  setCity(id: string): void
  /** Public ids of the player's friends: their houses are named on the map. */
  setFriends(ids: unknown): void
  /** Other players to draw on the map (src/map3d/people.ts), and the server clock their trips are timed by. */
  setPeople(next: MapPeople | null, clock?: () => number): void
  world: WorldData | null
  setState(next: MapState | null): void
  setPlayer(next: unknown): void
  /** The host says whether the city map is the screen in front. Hidden, it draws nothing and soon lets go of the GPU. */
  setShown(next: boolean): void
  resize(): void
  /** Show the arrival, then call `done`. With nothing to show (2D, hidden, reduced motion) it is called at once. */
  arrive(done: () => void): void
  diagnostics(): object
  /** Where the camera is, for keeping it across a reload (null while no map is up). */
  camera(): MapCamera | null
  /** Put the camera back (a reload): applied when the map first opens if it is not up yet. A camera of the other kind of map is dropped. */
  restoreCamera(next: MapCamera | null): void
  /** Back to the opening view of the map in front (the city core). */
  recentre(): void
  readonly map: MapImpl | null
  destroy(): void
}

const PREFERENCE_KEY = 'joinallworld-map';
const RELEASE_MS = 120000;

export function createCityView(container: HTMLElement, { cityId: firstCity = 'lagos', onSelectVenue, onSelectGov, onSelectNeighbour, onSelectLga, onSelectHouse, onSelectPeople, fetchJson = null, onTripDue, onNotice = () => {} }: CityViewOptions = {}): CityView {
  let cityId = firstCity, state: MapState | null = null, player: unknown = null, impl: MapImpl | null = null, kind: CityViewKind | null = null, layer = 'city', shown = false, mounting = 0, releaseTimer: ReturnType<typeof setTimeout> | null = null, released = false, brokenGl = false;
  let simple = false;
  try { simple = globalThis.localStorage?.getItem(PREFERENCE_KEY) === '2d' || new URLSearchParams(globalThis.location.search).get('map') === '2d'; } catch { simple = false; }
  let deepLink: string | null = null;
  try { deepLink = new URLSearchParams(globalThis.location.search).get('venue'); } catch { deepLink = null; }
  const ui: Record<string, unknown> = {};                                   // everything the Map panel has said, replayed to a map mounted later
  const onUi = (event: Event) => { const detail = detailOf(event as CustomEvent<unknown>); if (detail.layer === 'city' || detail.layer === 'world') layer = detail.layer; const { layout, ...rest } = detail; Object.assign(ui, rest); };
  window.addEventListener('jaw:map-ui', onUi);
  // Houses and residents for the part of the city in view: one cache, shared by whichever map is mounted (src/map3d/world-data.ts).
  let friends: string[] = [], people: MapPeople | null = null, peopleClock: (() => number) | undefined;
  const world = fetchJson ? createWorldData({ fetchJson, cityId: firstCity, onChange: () => impl?.worldChanged?.() }) : null;
  // A panel says the player's own place in the world changed (their local government, their house): what is cached is stale.
  const onWorld = () => { world?.stale(); if (shown) void world?.loadCity(true); };
  // A panel asks the map to show something: { plot } | { lga } | { lga, estate }.
  const onFocus = (event: Event) => { const detail = detailOf(event as CustomEvent<unknown>) as MapFocusDetail; if (detail.plot) impl?.focusPlot?.(detail.plot); else if (detail.estate !== undefined) impl?.focusEstate?.(detail.lga!, detail.estate); else if (detail.lga) impl?.focusLga?.(detail.lga); };
  window.addEventListener('jaw:world-changed', onWorld);
  window.addEventListener('jaw:map-focus', onFocus);

  // The switch between the two maps: a real button, at the same place on both.
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'cmap-switch';
  toggle.addEventListener('click', () => {
    simple = kind === '3d';
    try { globalThis.localStorage?.setItem(PREFERENCE_KEY, simple ? '2d' : '3d'); } catch { /* the choice lasts for this visit */ }
    void mount();
  });
  container.appendChild(toggle);
  // The map's source credit (the licence asks for it): a plain text link in the bottom-left corner, over either map.
  const credit = document.createElement('a');
  credit.className = 'map-credit';
  credit.href = 'https://www.openstreetmap.org/copyright';
  credit.target = '_blank'; credit.rel = 'noopener noreferrer';
  credit.textContent = '© OpenStreetMap';
  credit.setAttribute('aria-label', 'Map data © OpenStreetMap contributors');
  container.appendChild(credit);
  function label() {
    const can3d = hasCityPack(cityId) && !brokenGl && kind !== 'unavailable';
    toggle.hidden = !can3d;
    toggle.textContent = kind === '3d' ? 'Simple map' : '3D map';
    toggle.setAttribute('aria-label', kind === '3d' ? 'Switch to the simple flat map' : 'Switch to the 3D map');
    container.dataset.map = kind || '';
  }

  const onSelectContext = (land: { id: string; name: string; planned: boolean }): void => { if (land.planned) onNotice(`${land.name}: opening soon.`); };
  const callbacks = { onSelectVenue, onSelectGov, onSelectNeighbour, onSelectLga, onSelectHouse, onSelectPeople, onSelectContext };
  async function mount() {
    const ticket = ++mounting;
    const want3d = !simple && !brokenGl && hasCityPack(cityId) && webglAvailable();
    let next: MapImpl | null = null, nextKind: CityViewKind = '2d';
    if (want3d) {
      try {
        // The trip vehicles come from the model library, fetched with the city pack (never in the first download). If they fail to load the map keeps its own batch-drawn vehicles.
        const [pack, models] = await Promise.all([loadCityPack(cityId), import('../models/integration/scene-models.ts').catch(() => null)]);
        const vehicleBuilder = models?.buildTravelVehicle ?? null;
        const travelVehicle = vehicleBuilder as unknown as TravelVehicleBuilder | null; // trust boundary: the model library is JavaScript
        if (ticket !== mounting) return;
        impl?.destroy(); impl = null;
        next = createMap3D(container, { pack: pack!, cityId, world, travelVehicle, ...callbacks, onTripDue, deepLink, onContextLost: () => { brokenGl = true; onNotice('The 3D map stopped on this device. Showing the simple map instead.'); void mount(); } });
        nextKind = '3d';
      } catch (error) {
        console.error('The 3D map could not start; using the simple map:', error);
        brokenGl = true; next = null;
      }
    }
    if (!next) {
      // The flat map is drawn from the same city pack as the 3D one (src/map3d/map2d.ts). Only a city that
      // has no pack at all (a legacy preview) falls back to the old hand-drawn schematic, which a pack never reaches.
      const pack = hasCityPack(cityId) ? await loadCityPack(cityId).catch(() => null) : null;
      if (ticket !== mounting) return;
      if (pack) { impl?.destroy(); impl = null; next = createMap2D(container, { pack, cityId, world, ...callbacks, deepLink }); }
      else if (hasCityPack(cityId)) {
        impl?.destroy(); impl = null;
        const message = document.createElement('section'); message.className = 'cmap-error';
        const title = document.createElement('h2'); title.textContent = 'City map unavailable';
        const detail = document.createElement('p'); detail.textContent = 'The map could not be downloaded. Your saved character is safe.';
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Reload map';
        retry.addEventListener('click', () => window.location.reload());
        message.append(title, detail, retry); container.appendChild(message);
        next = { setState() {}, resize() {}, destroy() { message.remove(); }, diagnostics: () => ({ unavailable: true }) };
        nextKind = 'unavailable';
      } else {
        const { createCityMap } = await import('../city-map.ts');
        if (ticket !== mounting) return;
        impl?.destroy(); impl = null;
        next = createCityMap(container, callbacks);
        next.setCity!(cityId);
      }
      if (nextKind !== 'unavailable') nextKind = '2d';
    }
    deepLink = null;
    impl = next; kind = nextKind; released = false;
    label();
    impl.setPlayer?.(player);
    impl.setFriends?.(friends);
    if (state) impl.setState(state);
    impl.setPeople?.(people, peopleClock);
    if (Object.keys(ui).length) window.dispatchEvent(new CustomEvent('jaw:map-ui', { detail: { ...ui, layout: true } }));
    if (wantedCamera) { const camera = wantedCamera; wantedCamera = null; applyCamera(camera); }
    impl.resize();
  }
  let wantedCamera: MapCamera | null = null;
  function applyCamera(camera: MapCamera): void {
    if (camera.kind !== kind || !impl) return;
    if (camera.kind === '3d') { const { kind: _kind, ...rig } = camera; impl.restoreView?.(rig as never); } else { const { kind: _kind, ...flat } = camera; impl.restoreView?.(flat as never); }
  }
  function release() {
    releaseTimer = null;
    if (shown || kind !== '3d' || !impl) return;
    mounting += 1; impl.destroy(); impl = null; kind = null; released = true;
  }

  const view: CityView = {
    get ready() { return layer === 'city'; },
    get kind() { return kind; },
    /** Resolves once the first map or recovery view is mounted. */
    started: null,
    setCity(id) { layer = 'city'; if (id === cityId && impl) { impl.setCity?.(id); return; } cityId = id; world?.drop(id); void mount(); },
    /** Public ids of the player's friends: their houses are named on the map. */
    setFriends(ids) { friends = Array.isArray(ids) ? ids : []; impl?.setFriends?.(friends); },
    setPeople(next, clock) { people = next; if (clock) peopleClock = clock; impl?.setPeople?.(people, peopleClock); },
    world,
    setState(next) { state = next; impl?.setState(next); },
    setPlayer(next) { player = next; impl?.setPlayer?.(next); },
    /** The host says whether the city map is the screen in front. Hidden, it draws nothing and soon lets go of the GPU. */
    setShown(next) {
      if (next === shown) return;
      shown = next;
      clearTimeout(releaseTimer ?? undefined); releaseTimer = null;
      if (shown) { void world?.loadCity(); if (released) void mount(); else impl?.resize(); }
      else { impl?.resize(); releaseTimer = setTimeout(release, RELEASE_MS); }
    },
    resize() { impl?.resize(); },
    /** Show the arrival, then call `done`. With nothing to show (2D, hidden, reduced motion) it is called at once. */
    arrive(done) { if (impl?.arrive && shown) impl.arrive(done); else done(); },
    diagnostics() { return impl?.diagnostics ? impl.diagnostics() : { kind: kind || 'none', renderCount: 0, released, view: impl?.view?.() }; },
    camera() {
      if (!impl) return null;
      if (kind === '3d' && impl.cameraView) return { kind: '3d', ...impl.cameraView() };
      const flat = kind === '2d' ? impl.view?.() as { scale?: number; x?: number; y?: number; opened?: boolean } | undefined : undefined;
      return flat && flat.opened && typeof flat.scale === 'number' && typeof flat.x === 'number' && typeof flat.y === 'number' ? { kind: '2d', scale: flat.scale, x: flat.x, y: flat.y } : null;
    },
    /** Back to the opening view of the map in front (the city core). */
    recentre() { impl?.recentre?.(); },
    restoreCamera(next) { if (!next) return; if (impl) applyCamera(next); else wantedCamera = next; },
    get map() { return impl; },
    destroy() { mounting += 1; clearTimeout(releaseTimer ?? undefined); window.removeEventListener('jaw:map-ui', onUi); window.removeEventListener('jaw:world-changed', onWorld); window.removeEventListener('jaw:map-focus', onFocus); impl?.destroy(); toggle.remove(); },
  };
  view.started = mount();
  return view;
}
