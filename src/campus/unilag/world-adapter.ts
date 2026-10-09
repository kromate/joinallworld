/**
 * ONE SCENE API, TWO HOSTS. Every venue is drawn by the venue host (src/venue-world.ts). The UNILAG
 * campus is a venue the size of a district — ten zones, position-driven level of detail, a shuttle on
 * its roads — so it has a host of its own (./host.js), built from the same movement, motion-loop and
 * avatar modules (src/scene/*). This adapter keeps the entry file talking to one object and swaps the
 * host when the player's location crosses the campus gate.
 *
 * The campus host is its own download: it is fetched when the player is at the campus (or a trip to
 * it has set off — prepare()), never with the first scene. Until it has arrived nothing is drawn in
 * its place; if it cannot be fetched the venue host draws its plain plaza for the campus instead, so
 * the game is never left without a scene.
 *
 * A CITY'S OWN SCENES are a download of their own too (src/scene/city-scenes.ts). The venue host is built only once the scenes
 * of the player's city are here: until then nothing is drawn in its place — never a plain stand-in for a city scene — and
 * onScenes says what is true (loading, the next attempt in N seconds, or not available until retryScenes()). Attempts follow
 * src/lazy-load.ts. A city whose scenes are already here, and the default city always, is built at once as before.
 *
 * What the entry file passes, besides the venue host's own options (onTag, onMove):
 *   commitSpot({ id })  → Promise<{ ok, code?, reason? }>   the campus host calls it when the avatar has
 *                        walked to a landmark; it sends the game's ordinary `spot` action
 *   now()               server time, for the shuttle's place on its route
 *   onHost(kind)        'venue' | 'campus' — a host was built (the entry file re-measures the HUD insets)
 *   onError(error)      the venue host could not be built after its city's scenes arrived
 *   onScenes(state)     the fetch of a city's scenes changed state: a LazyState with the city's id; 'ready' when the host is about to be built
 */
import type { WebGLRenderer } from 'three';
import type { WorldStreetResponse } from '../../types/world.ts';
import type { VisitHomeProjection } from '../../types/visit.ts';
import { createVenueHost as createVenueWorld } from '../../venue-world.ts';
import type { VenueWorldOptions } from '../../venue-world.ts';
import type { CampusHost, CampusHostOptions, HostPerson, HostPlayer, HostState, WalkResult } from './host.ts';
import { cityScenesReady, loadCityScenes } from '../../scene/city-scenes.ts';
import { createLazyLoader } from '../../lazy-load.ts';
import type { LazyLoader, LazyOptions, LazyState } from '../../lazy-load.ts';
import './world-adapter.css';
import { DEFAULT_CITY_ID } from '../../game/cities/registry.ts';

export const CAMPUS_VENUE = 'unilag';
const campus = (id: string): boolean => id === CAMPUS_VENUE;

export type HostKind = 'venue' | 'campus' | 'street';
export type AdapterState = HostState & { location?: string; estate?: { city: string } };
type Insets = { top?: number; bottom?: number };
/** Where the fetch of a city's own scenes stands. */
export type ScenesState = LazyState & { city: string };

/** What the adapter asks of either host (the venue host has more; the campus host has no setGoal/zoom/recentre/prepare). */
interface WorldHost {
  setStreet?(street: WorldStreetResponse | null): void;
  walkNeighbourDoor?(host: string): boolean;
  walkStreetGate?(): boolean;
  restorePosition?(at: { x: number; z: number }): void;
  update(): void;
  captureCanvas?(): HTMLCanvasElement | null;
  resize(): void;
  setState(state: AdapterState | null): void;
  setPlayer(player: HostPlayer): boolean | void;
  setCrowd(people: HostPerson[]): boolean | undefined;
  setInsets(insets: Insets): boolean | undefined;
  setGoal?(goal: unknown): boolean | undefined;
  setLocation(id: string): boolean | void;
  prepare?(id: string): boolean | undefined;
  zoom?(direction: number): unknown;
  recentre?(): unknown;
  walkTo(a: number | string, z?: number): boolean | Promise<WalkResult>;
  walkBy?(dx: number, dz: number): boolean;
  walkHomeDoor?(): boolean;
  position?(): unknown;
  diagnostics(): object;
  dispose(): void;
}

export interface WorldAdapterOptions {
  onStreetJourney?: (journey: import('../../street/types.ts').StreetJourney) => void;
  loadStreet?: () => Promise<typeof import('../../street/host.ts')>;
  location?: string;
  commitSpot?: CampusHostOptions['onSpot'];
  now?: () => number;
  onHost?: (kind: HostKind | null) => void;
  loadCampus?: () => Promise<{ createCampusHost(container: HTMLElement, options?: CampusHostOptions): CampusHost }>;
  /** The city the page starts in, until a state says. */
  cityId?: string;
  onScenes?: (state: ScenesState) => void;
  /** The venue host could not be built once the awaited scenes had arrived (at any other time the error is thrown to the caller). */
  onError?: (error: unknown) => void;
  /** A city's own scenes: fetch them, and whether they are here (src/scene/city-scenes.ts). Injectable, with the retry timers, for the tests. */
  loadScenes?: (cityId: string) => Promise<void>;
  scenesReady?: (cityId: string) => boolean;
  lazy?: LazyOptions;
  onTag?: CampusHostOptions['onTag'];
  onMove?: VenueWorldOptions['onMove'];
  renderer?: WebGLRenderer;
  /** Further options belong to the venue host. */
  [venueOption: string]: unknown;
}

export function createWorldAdapter(container: HTMLElement, { location = 'park', commitSpot, now, onHost, onScenes, onError, onStreetJourney, loadStreet = () => import('../../street/host.ts'), loadCampus = () => import('./host.ts'), loadScenes = loadCityScenes, scenesReady = cityScenesReady, lazy, ...options }: WorldAdapterOptions = {}) {
  let currentLocation = location;
  // Where the regulars are (their daily routines): a chunk of its own, fetched with the scene and not with the first page. Until it lands every regular of a venue is listed, as before.
  void import('../../game/routines/pack.ts').then(undefined, () => undefined);
  let host: WorldHost | null = null, kind: HostKind | null = null, token = 0, disposed = false;
  let state: AdapterState | null = null, player: HostPlayer | null = null, crowd: HostPerson[] = [], insets: Insets | null = null, goal: unknown = null;
  let street: WorldStreetResponse | null = null, visitHome: VisitHomeProjection | null = null;
  const displayState = (next: AdapterState | null): AdapterState | null => next && visitHome ? { ...next, estate: { ...next.estate, city: visitHome.city }, location: 'home', spot: null, activeAction: null } : next;
  let neighbourhoodBuilder: VenueWorldOptions['buildNeighbourhood'];
  let homeBuilder: VenueWorldOptions['buildHome'];
  let homePending: Promise<void> | null = null;
  function loadHome(): Promise<void> {
    if (homeBuilder) return Promise.resolve();
    if (homePending) return homePending;
    homePending = import('../../scene/home-scene.ts').then((module) => { homeBuilder = module.buildHomeScene; }).finally(() => { homePending = null; });
    return homePending;
  }
  let neighbourhoodPending: Promise<void> | null = null;
  function loadNeighbourhood(): Promise<void> {
    if (neighbourhoodBuilder) return Promise.resolve();
    if (neighbourhoodPending) return neighbourhoodPending;
    neighbourhoodPending = import('../../scene/neighbourhood-scene.ts').then((module) => { neighbourhoodBuilder = module.buildNeighbourhoodScene; }).finally(() => { neighbourhoodPending = null; });
    return neighbourhoodPending;
  }

  let status: HTMLElement | null = null;

  function clearStatus(): void { status?.remove(); status = null; container.classList?.remove('campus-loading', 'campus-load-error'); }
  function showStatus(mode: 'loading' | 'error', retry?: () => void): void {
    clearStatus();
    container.classList?.add(mode === 'loading' ? 'campus-loading' : 'campus-load-error');
    const panel = document.createElement('div'); panel.className = 'campus-load-status'; panel.setAttribute('role', mode === 'error' ? 'alert' : 'status'); panel.setAttribute('aria-live', 'polite');
    const title = document.createElement('strong'); title.textContent = mode === 'loading' ? 'Opening UNILAG campus…' : 'UNILAG campus could not open'; panel.append(title);
    const detail = document.createElement('span'); detail.textContent = mode === 'loading' ? 'Loading the campus world.' : 'Check your connection, then try again.'; panel.append(detail);
    if (retry) { const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Try again'; button.addEventListener('click', retry, { once: true }); panel.append(button); }
    container.append(panel); status = panel;
  }

  function replay(): void {
    if (!host) return;
    if (state?.location === currentLocation) host.setState(displayState(state));
    if (!visitHome && street) host.setStreet?.(street);
    if (player) host.setPlayer(player);
    if (state?.location === currentLocation && crowd.length) host.setCrowd(crowd);
    if (insets) host.setInsets(insets);
    if (goal !== null) host.setGoal?.(goal);
    host.resize?.();
    onHost?.(kind);
  }
  // The city whose scenes the venue host was built with, and the one whose scenes are awaited (no host meanwhile).
  let hostCity: string | null = null, awaited: string | null = null;
  const scenes = new Map<string, LazyLoader<true>>();
  const cityNow = (): string => visitHome?.city ?? state?.estate?.city ?? options.cityId ?? DEFAULT_CITY_ID;
  function scenesOf(city: string): LazyLoader<true> {
    let loader = scenes.get(city);
    if (!loader) {
      loader = createLazyLoader<true>(async (): Promise<true> => { await loadScenes(city); return true; }, { ...lazy, onState(next) {
        if (disposed || awaited !== city) return;
        try { onScenes?.({ ...next, city }); } catch { /* a listener must not break loading */ }
        // Here now — at the first attempt or a later one: build what was waiting for it.
        if (next.status === 'ready') { try { build(currentLocation); } catch (error) { console.error('The scene could not be started:', error); onError?.(error); } }
      } });
      scenes.set(city, loader);
    }
    return loader;
  }
  function useVenueHost(id: string): void { kind = 'venue'; hostCity = cityNow(); host = createVenueWorld(container, { ...options, visitHome, buildHome: homeBuilder, buildNeighbourhood: neighbourhoodBuilder, cityId: hostCity, location: visitHome ? 'home' : id }); replay(); }
  function build(id: string): void {
    host?.dispose(); host = null; kind = null; hostCity = null; clearStatus();
    const mine = ++token;
    if (awaited) { container.classList?.remove('scenes-loading'); awaited = null; }
    if (id === 'city-street' && !visitHome) {
      awaited = cityNow(); container.classList?.add('scenes-loading');
      onScenes?.({ status: 'loading', city: cityNow(), attempt: 1, attempts: 1, retryInMs: null, error: null });
      void loadStreet().then(({ createStreetHost }) => {
        if (mine !== token || disposed) return;
        kind = 'street'; hostCity = cityNow();
        const next = createStreetHost(container, { renderer: options.renderer, now, onJourneyChanged: onStreetJourney });
        host = next; replay();
        return next.ready.then(() => {
          if (mine !== token || disposed) return;
          awaited = null; container.classList?.remove('scenes-loading');
          onScenes?.({ status: 'ready', city: cityNow(), attempt: 1, attempts: 1, retryInMs: null, error: null });
        });
      }).catch(error => {
        if (mine !== token || disposed) return;
        container.classList?.remove('scenes-loading');
        onScenes?.({ status: 'failed', city: cityNow(), attempt: 1, attempts: 1, retryInMs: null, error: String(error) });
        onError?.(error);
      });
      return;
    }
    const needsHome = (Boolean(visitHome) || id === 'home') && !homeBuilder;
    if (needsHome || (id === 'neighbourhood' && !visitHome && !neighbourhoodBuilder)) {
      awaited = cityNow();
      container.classList?.add('scenes-loading');
      onScenes?.({ status: 'loading', city: cityNow(), attempt: 1, attempts: 1, retryInMs: null, error: null });
      void (needsHome ? loadHome() : loadNeighbourhood()).then(() => { if (mine === token && !disposed) { container.classList?.remove('scenes-loading'); build(currentLocation); } }, (error) => {
        if (mine !== token || disposed) return;
        container.classList?.remove('scenes-loading');
        onScenes?.({ status: 'failed', city: cityNow(), attempt: 1, attempts: 1, retryInMs: null, error: String(error) });
      });
      return;
    }
    if (visitHome || !campus(id)) {
      const city = cityNow();
      if (scenesReady(city)) { useVenueHost(id); return; }
      awaited = city;
      container.classList?.add('scenes-loading');
      void scenesOf(city).load();
      return;
    }
    awaited = cityNow();
    showStatus('loading');
    onScenes?.({ status: 'loading', city: cityNow(), attempt: 1, attempts: 1, retryInMs: null, error: null });
    loadCampus().then(({ createCampusHost }) => {
      if (mine !== token || disposed) return;
      host = createCampusHost(container, { onTag: options.onTag, onMove: options.onMove, onSpot: commitSpot, now, renderer: options.renderer });
      kind = 'campus'; hostCity = cityNow(); awaited = null; clearStatus(); replay();
    }).catch((error) => {
      if (mine !== token || disposed) return;
      host?.dispose(); host = null; kind = null;
      showStatus('error', () => { if (!disposed && currentLocation === id) build(id); });
      onScenes?.({ status: 'failed', city: cityNow(), attempt: 1, attempts: 1, retryInMs: null, error: String(error) });
    });
  }
  build(currentLocation);

  return {
    update() { host?.update(); },
    resize() { host?.resize(); },
    get location() { return currentLocation; },
    /** Which host is drawing: 'venue', 'campus', or null while the campus is on its way. */
    get host() { return kind; },
    diagnostics() { return { adapter: kind, ...host?.diagnostics() }; },
    setInsets(next: Insets) { insets = { ...next }; return host?.setInsets(next); },
    setLocation(id: string) {
      if (id === currentLocation) return false;
      const rebuild = campus(id) !== campus(currentLocation) || id === 'home' || id === 'neighbourhood' || currentLocation === 'neighbourhood' || id === 'city-street' || currentLocation === 'city-street' || !host;
      currentLocation = id;
      crowd = [];
      if (rebuild) build(id); else host!.setLocation(id);
      return true;
    },
    /** A trip has set off: have the place it goes to ready (the campus: its code; any other venue: its scene). */
    prepare(id: string) {
      if (id === 'home') { void loadHome().catch(() => {}); return true; }
      if (id === 'neighbourhood') { void loadNeighbourhood().catch(() => {}); return true; }
      if (id === 'city-street') { void loadStreet().catch(() => {}); return true; }
      if (campus(id)) { void loadCampus().catch(() => {}); return true; }
      return kind === 'venue' ? host!.prepare?.(id) === true : false;
    },
    setState(next: AdapterState | null) {
      state = next;
      if (!disposed && next?.location === 'home' && currentLocation !== 'home') {
        currentLocation = 'home';
        crowd = [];
        build(currentLocation);
        return;
      }
      // The player is in another city now. With its scenes here the venue host changes city by itself; without them it is
      // put away until they are (the same while another city's scenes were being waited for).
      if (!disposed && kind !== 'campus' && currentLocation !== 'city-street' && !campus(currentLocation)) {
        const city = cityNow();
        if (host ? city !== hostCity && !scenesReady(city) : city !== awaited) { if (typeof next?.location === 'string') currentLocation = next.location; crowd = []; build(currentLocation); return; }
        if (host) hostCity = city;
      }
      host?.setState(displayState(next));
    },
    /** The scenes of the city being waited for: try again now (after 'failed' this also starts a new round of automatic attempts). */
    retryScenes() { if (campus(currentLocation) || currentLocation === 'city-street' || ((visitHome || currentLocation === 'home') && !homeBuilder) || (currentLocation === 'neighbourhood' && !neighbourhoodBuilder)) { build(currentLocation); return true; } if (!awaited) return false; void scenesOf(awaited).load(); return true; },
    /** The city whose scenes are being waited for, or null. */
    get awaiting() { return awaited; },
    setPlayer(next: HostPlayer) { player = { ...next }; return host?.setPlayer(next); },
    setGoal(next?: unknown) { goal = next ?? null; return host?.setGoal?.(next) ?? false; },
    setCrowd(next: HostPerson[]) { crowd = Array.isArray(next) ? next.map((person) => ({ ...person })) : []; return host?.setCrowd(crowd); },
    zoom(direction: number) { return host?.zoom?.(direction); },
    recentre() { return host?.recentre?.(); },
    /** Walk to a point of the floor (venue host only: the campus is walked with its own controls and by landmark). */
    walkTo(x: number, z: number) { return kind === 'venue' || kind === 'street' ? host!.walkTo(x, z) as boolean : false; },
    walkBy(dx: number, dz: number) { return (kind === 'venue' || kind === 'street') && host?.walkBy?.(dx, dz) === true; },
    walkHomeDoor() { if (currentLocation === 'home') void loadNeighbourhood().catch(() => {}); return kind === 'venue' ? host!.walkHomeDoor?.() === true : false; },
    captureCanvas() { return host?.captureCanvas?.() ?? null; },
    restorePosition(at: { x: number; z: number }) { host?.restorePosition?.(at); },
    setStreet(next: WorldStreetResponse | null) { street = next; if (!visitHome) host?.setStreet?.(next); },
    walkNeighbourDoor(id: string) { return !visitHome && host?.walkNeighbourDoor?.(id) === true; },
    walkStreetGate() { void loadStreet().catch(() => {}); return !visitHome && host?.walkStreetGate?.() === true; },
    setVisitHome(next: VisitHomeProjection | null) {
      if (visitHome === next) return;
      const at = next && next.host.id === visitHome?.host.id ? host?.position?.() : null;
      visitHome = next; build(currentLocation);
      if (at && typeof at === 'object' && 'x' in at && 'z' in at && typeof at.x === 'number' && typeof at.z === 'number') host?.restorePosition?.({ x: at.x, z: at.z });
    },
    /**
     * Walk to a landmark and then select it. Only the campus walks first: → Promise<{ ok, code?, reason? }>, the
     * result of the `spot` action sent on arrival. Anywhere else it answers { ok: false, code: 'not_walkable' }
     * at once and the caller sends the action itself.
     */
    walkToSpot(id: string): Promise<WalkResult> { return kind === 'campus' ? host!.walkTo(id) as Promise<WalkResult> : Promise.resolve({ ok: false, code: 'not_walkable' }); }, // the campus host answers a promise
    position() { return host?.position?.() || null; },
    dispose() { disposed = true; token += 1; for (const loader of scenes.values()) loader.stop(); host?.dispose(); host = null; kind = null; awaited = null; clearStatus(); },
  };
}

export default createWorldAdapter;
