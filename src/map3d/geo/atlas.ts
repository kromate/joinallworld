import { stateOverviewHtml, stateOverviewToggleHtml } from './state-overview.ts';
import type { OverviewExtras } from './state-overview.ts';
import type { CityStateOverview } from '../../types/content.ts';
import { venueFor } from '../../game/cities/runtime.ts';
import { cachedCityContent, loadCityContent, loadCityRoutes, loadCityMap, loadStateOverviewCity, loadCityRules, cityName, cityRules, cityModule, isOpenCityId, catalogueCitiesInState } from '../../game/cities/registry.ts';
/**
 * OWNER: world
 * The atlas: ONE continuous map with three levels of detail — the world, Africa, Nigeria — and
 * the way into the open city. It replaces the old country screen (a tilted SVG of Nigeria).
 *
 *   createAtlas(container, { onOpenCity, onEnterCity, onTravel, routes, held, … })
 *     → { setCity(id), setState(state), refresh(), resize(), goLevel(index), select(ref), previewTrip(routeId),
 *         diagnostics(), ready, destroy() }
 *
 * HOW IT IS DRAWN. Real boundaries (Natural Earth, public domain — see ./data) are decoded,
 * projected once (Equal Earth, ./projection.js) and merged into a few meshes per level
 * (./build.js): regions as extruded plates coloured per vertex, borders/rivers/roads as
 * screen-width ribbons, capitals as dots. Names are DOM labels with a hard cap and no overlaps
 * (./labels.js). Picking is point-in-polygon on the data behind a grid (./pick.js).
 *
 * LEVELS. The camera's distance and where it is centred decide the level (./levels.js). Crossing
 * a threshold cross-fades and extrudes the next level's layers over FADE seconds; the level's
 * data module is fetched the first time it is wanted (a calm "Loading…" pill meanwhile, the map
 * already on screen stays). Nigeria is fetched first, then the world sheet behind it; Africa
 * when the camera first heads that way.
 *
 * OPEN / COMING SOON comes from the registry (../regions.js): only a region whose status is
 * 'open' is in colour and can be entered. Everything else is grey, still hoverable and tappable.
 *
 * INPUT. North-up at every level. One finger or any mouse button drags the ground (the grabbed point stays under the pointer, the
 * land's edge gives a little and springs back, a flick glides on unless motion is reduced); two fingers pinch about their middle and
 * travel; the wheel and a trackpad pinch zoom towards the pointer. A quick press that stayed put selects (a city dot or name first,
 * ./city-hit.ts); a drag or a press held 350 ms or more never does. The view is leashed to the middle of the world as it pulls
 * back (./levels.ts leashAt). The arithmetic is shared with the city map (src/scene/gesture.ts, ../camera.ts).
 *
 * BATTERY RULE — NO FRAME LOOP WHILE IDLE. A frame is drawn when something asks for one. Another
 * is scheduled only while something moves: a camera ease, a level cross-fade, the fly-in to the
 * city, or a trip (the server's timer, or the preview). diagnostics().renderCount is the proof
 * (./atlas.test.js). `prefers-reduced-motion`: levels and views cut instead of flying, and a trip
 * is a marker moved when the server reports progress.
 */
import * as THREE from 'three';
import { allCityLinks } from '../../game/cities/registry.ts';
import type { AfricaGroupId, Box4, RegionKind } from '../types.ts';
import { createRig } from '../camera.ts';
import { createFlick, isDrag, isTap } from '../../scene/gesture.ts';
import type { RigInsets, RigView } from '../camera.ts';
import { createTripClock } from '../trip.ts';
import { AFRICA_GROUPS, ATLAS_LEVELS, CONTINENTS, ZONES, cityEntry, plannedRoutes, regionEntry, stateOfCity } from '../regions.ts';
import type { AtlasLevel } from '../regions.ts';
import { EXTENT, project, relLon, unproject } from './projection.ts';
import { decodeTopology } from './topo.ts';
import type { AfricaFeature, Feature, FeatureData, NigeriaFeature, Topology, WorldFeature } from './topo.ts';
import { createPicker } from './pick.ts';
import type { Picker } from './pick.ts';
import { atlasNamesAt, countChips, densityFor, namedCities } from './density.ts';
import { focusLevel, leashAt, levelAt, pitchAt, thresholds } from './levels.ts';
import { LABEL_CAP, placeLabels } from './labels.ts';
import { cityHit } from './city-hit.ts';
import { badgeOf, byCountry, EMPTY_FRIENDS } from './friends.ts';
import type { FriendHere, FriendsModel } from './friends.ts';
import type { CityTarget } from './city-hit.ts';
import { nigeriaMarkerDetail } from './atlas-scale.ts';
import type { NigeriaMarkerDetail } from './atlas-scale.ts';
import type { LabelBox, LabelCandidate, PlacedLabel } from './labels.ts';
import { AIRPORTS, HIGHWAYS, TOWNS, flightPoint, interCityTripOf, liftOf, linkId, linkPath, measure, tripPoint } from './routes.ts';
import type { InterCitySource, LinkPath, MeasuredLine } from './routes.ts';
import { linkKey, listOrder, regionInfo } from './info.ts';
import { debtHtml, needsConfirm, travelWays } from './travel-card.ts';
import type { TravelWay } from './travel-card.ts';
import type { RegionContext, RegionInfo, RegionRef, RouteInfo } from './info.ts';
import { arcSegments, mesher, outerEdges } from './build.ts';
import type { RibbonLine } from './build.ts';
import type { CountryDetailService, CountryDetailOutline } from './country-detail-types.ts';
import { CountryDetailPanelModel, countryOutlineSvg } from './country-detail.ts';

/** What a level's data module exports (the type of ATLAS_LEVELS[i].data()'s result). */
export type LevelModule = Awaited<ReturnType<AtlasLevel['data']>>;
type WorldModule = typeof import('./data/world.ts');
type AfricaModule = typeof import('./data/africa.ts');
type NigeriaModule = typeof import('./data/nigeria.ts');

/** The routes the server would let this life take now (the Map panel hands them in). */
export type TripRoutes = NonNullable<RegionContext['routes']>;
/** The part of a THREE.WebGLRenderer the atlas uses; a test double needs only these. */
export interface AtlasRenderer {
  domElement: HTMLCanvasElement;
  outputColorSpace?: string;
  setClearColor(colour: number, alpha?: number): void;
  setPixelRatio?(ratio: number): void;
  getPixelRatio?(): number;
  setSize?(width: number, height: number, updateStyle?: boolean): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  info?: { render?: { triangles?: number; calls?: number } };
  dispose(): void;
}
export interface AtlasOptions {
  onOpenCity?: (cityId: string) => void;
  onEnterCity?: (cityId: string) => void;
  /** Inspect a local departure venue; never starts a trip or changes city. */
  onInspectVenue?: (cityId: string, venueId: string) => void;
  onTravel?: (to: string, mode: string, credit?: boolean) => void;
  /** The ride home on credit on offer to a visitor who cannot pay the cheapest fare to the main home: the travel card for that city adds it, clearly labelled. */
  credit?: () => { to: string; mode: string; fare: number } | null;
  routes?: () => TripRoutes | null;
  /** What is still owed for a ride home on credit (0 when nothing is): the travel card offers to pay it, since it blocks every trip. */
  debt?: () => number;
  /** "Pay now" on the travel card: settles the debt from cash; the card is drawn again when it has been answered. */
  onRepay?: () => Promise<unknown> | void;
  /** "What you can do now": where a player who cannot cover the debt is sent. */
  onHelp?: () => void;
  /** The cash the player has in hand, or null when it is not known: the travel card says what a fare leaves short. */
  wallet?: () => number | null;
  held?: () => string[];
  renderer?: AtlasRenderer;
  raf?: (callback: () => void) => number;
  caf?: (handle: number) => void;
  now?: () => number;
  reducedMotion?: boolean;
  tabHidden?: () => boolean;
  /** A friend's row in the friends list was used: Chat, Call or Ping. */
  onFriend?: (action: 'chat' | 'call' | 'ping', id: string, name: string) => void;
  /** Fetches a level's data module; the default imports it from the registry. */
  load?: (levelId: string) => Promise<LevelModule>;
  /** Optional lazy country-outline service. The default service module is imported only after Countries is opened. */
  countryDetail?: CountryDetailService;
}
/** A place the pointer or a reference names: what it is, which feature, and the sheet that holds it. */
export interface Hit { kind: RegionKind; id: string; feature: Feature; sheet: Sheet }

/** One thing on the map that fades with a level. */
type LayerObject = THREE.Mesh<THREE.BufferGeometry, THREE.Material> | THREE.Points<THREE.BufferGeometry, THREE.Material> | THREE.LineSegments<THREE.BufferGeometry, THREE.Material>;
interface Layer<O extends LayerObject = LayerObject> { object: O; levels: readonly number[]; alpha: number; extrude: boolean; opacity: number; materials: THREE.Material[]; detail: NigeriaMarkerDetail | null }
/** A level's decoded data, its picker and what it draws. `top` is the height of a feature's plate. */
interface Sheet<F extends FeatureData = FeatureData> {
  topology: Topology<F>; picker: Picker<F>; kind: RegionKind;
  top(feature: Feature): number;
  /** The feature never picked from this sheet (the country the level is about). */
  skip?: string | undefined;
}
/** A level's own sheet: it can repaint its plates (a tint layer was switched, a status changed). */
interface LevelSheet<F extends FeatureData = FeatureData> extends Sheet<F> { paint: (() => void)[] }
interface NigeriaSheet extends LevelSheet<NigeriaFeature> { stateDots: Layer<THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>>; cityDots: Layer<THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>>; around: Sheet }
/** What the country colours read of a world or Africa feature. */
type CountryData = FeatureData & { k?: string; sub?: AfricaGroupId };
type Sheets = [LevelSheet<WorldFeature> | null, LevelSheet<AfricaFeature> | null, NigeriaSheet | null];
interface Insets { left: number; top: number; right: number; bottom: number }
/** The trip being drawn: the line, who walks it from where, and how far (0…1). */
interface Run { path: LinkPath; line: MeasuredLine; from: string; progress: number }
interface Preview extends Run { start: number; seconds: number }
/**
 * A pointer gesture. One pointer pans: `grab` is the ground point under it when it went down, which stays under it. Two pointers
 * pinch: `span` and `mid` are their distance and middle, and the ground between them stays between them. `down` is when the press
 * began, for the tap-or-drag rule (src/scene/gesture.ts).
 */
interface Gesture { kind: 'pan' | 'pinch'; id: number; moved: boolean; from: Point; last: Point; down: number; type: string; grab: { x: number; z: number } | null; span: number; mid: Point }
/** What the shell's `jaw:key` event carries. */
interface KeyDetail { action?: string; mode?: string }
interface Point { x: number; y: number }
type UiName = 'labels' | 'friends' | 'fpanel' | 'reticle' | 'marker' | 'crumbs' | 'rail' | 'stage' | 'wait' | 'controls' | 'legend' | 'sheet' | 'country-panel';
/** What diagnostics() reports. */
export interface AtlasDiagnostics {
  kind: 'atlas'; renderCount: number; loop: boolean; level: number; levelId: string; wanted: number; loading: string; loaded: string[]; fading: boolean;
  triangles: number; calls: number; labels: number; reducedMotion: boolean; selected: RegionRef | null; hovered: RegionRef | null; routeShown: string | null; tint: boolean;
  cityLabels: { id: string; text: string; note: string | null }[]; markers: NigeriaMarkerDetail;
  trip: { progress: number; preview: boolean; mode: string } | null;
  view: { x: number; z: number; yaw: number; pitch: number; distance: number }; fits: number[] | null; cuts: number[]; layers: number[];
}
export interface AtlasApi {
  ready: Promise<boolean>;
  setCity(id: string): void;
  setState(state: InterCitySource | null | undefined): void;
  refresh(): void;
  resize(): void;
  goLevel(index: number): void;
  previewTrip(routeId: string): boolean;
  /** Fetch the wider levels now, so going out to Africa or the world later does not wait. */
  warm(): void;
  /** Open the card of a city: its state is selected and, where the state has several cities, that one is chosen. */
  selectCity(cityId: string): boolean;
  select(ref: RegionRef | null, options?: SelectOptions): boolean;
  zoomBy(factor: number): void;
  /** The friends to show as badges on the cities (or countries) they are in; null clears them. */
  setFriends(model: FriendsModel | null): void;
  /** Fly to a city and open the list of the friends there. False when no friend is shown there. */
  openFriends(cityId: string): boolean;
  /** Explicitly open the separate geographic-detail chooser; does not change map/game selection. */
  openCountries(atlasId?: string | null): void;
  closeCountries(): void;
  screenOf(lon: number, lat: number): { x: number; y: number };
  pick(lon: number, lat: number): { kind: RegionKind; id: string; name: string } | null;
  diagnostics(): AtlasDiagnostics;
  destroy(): void;
}
export interface SelectOptions { from?: 'map' | 'list' | 'key'; flyTo?: boolean }

const WORLD = 0, AFRICA = 1, NIGERIA = 2;
/** Camera tilt per level, radians above the horizon: flat-on for the world, leaning in over Nigeria. */
const PITCHES: readonly number[] = [1.5, 1.44, 1.04];
const FADE = 0.36;
const HEIGHT = { around: 0.02, state: 0.08, open: 0.13, country: 0.45, openCountry: 0.95 };
const INK = {
  base: ['#d9ddd6', '#d3d8d1', '#dee2dc'], none: '#e9ece7', around: '#d6dad3',
  soon: ['#c3c9c4', '#cbd0cb', '#bcc3be'], planned: '#d6ceb0', open: '#2fa866', openCountry: '#52b679',
  border: '#ffffff', edge: '#8c9a94', coast: '#86a9b8', shore: '#eefafd', water: '#62b3d4', road: '#8b7b66', air: '#4a6a9c', route: '#e8a643', glow: '#f3ffd0', select: '#20232c',
};
const MAJOR_CAPITALS = new Set(['Abuja', 'Cairo', 'Nairobi', 'Accra', 'Addis Ababa', 'Pretoria', 'Kinshasa', 'Dakar', 'Algiers', 'Rabat', 'Luanda', 'Khartoum', 'Dodoma', 'Kampala', 'Tunis', 'Tripoli', 'Antananarivo', 'Lusaka', 'Harare', 'Bamako', 'Niamey', "N'Djamena", 'Mogadishu', 'Windhoek', 'Maputo', 'Yaoundé', 'Abidjan', 'Yamoussoukro']);
const NEIGHBOUR_LABELS: [string, number, number][] = [['Benin', 2.15, 9.9], ['Niger', 8.6, 14.7], ['Chad', 15.9, 11.2], ['Cameroon', 12.5, 5.6]];
const WATER_LABELS: [string, number, number, 'sea' | 'river' | 'town'][] = [['Gulf of Guinea', 4.6, 3.55, 'sea'], ['Niger', 5.25, 9.72, 'river'], ['Benue', 9.7, 8.05, 'river'], ['Lake Chad', 14.2, 13.55, 'river'], ['Lokoja', 6.74, 7.8, 'town']];
const DOUBLE_MS = 340;
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }) as Record<string, string>)[c]!);
const naira = (value: unknown): string => `₦${Number(value).toLocaleString('en-NG')}`;
const ICON = (path: string): string => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const GLYPH = { globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18"/>', rail: '<rect x="6" y="3" width="12" height="14" rx="3"/><path d="M6 10h12M8 17l-2 4m10-4 2 4M9 14h.1M15 14h.1"/>', bus: '<path d="M5 6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10H5zM5 11h14M8 16v2M16 16v2"/><circle cx="8.5" cy="14" r=".6"/><circle cx="15.5" cy="14" r=".6"/>', plane: '<path d="M21 15.5 13.5 11V5.2a1.5 1.5 0 0 0-3 0V11L3 15.5V17l7.5-2.2V19l-2 1.5V22l3.5-1 3.5 1v-1.5l-2-1.5v-4.2L21 17z"/>' };

export function createAtlas(container: HTMLElement, { onFriend = () => {}, onOpenCity = () => {}, onEnterCity = () => {}, onInspectVenue = () => {}, onTravel = () => {}, credit = () => null, routes = () => null, debt = () => 0, onRepay = () => {}, onHelp = () => {}, wallet = () => null, held = () => [], countryDetail: providedCountryDetail,
  renderer: providedRenderer, raf = globalThis.requestAnimationFrame?.bind(globalThis), caf = globalThis.cancelAnimationFrame?.bind(globalThis), now = () => globalThis.performance.now(),
  reducedMotion = Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches), tabHidden, load = (levelId) => ATLAS_LEVELS.find((level) => level.id === levelId)!.data() }: AtlasOptions = {}): AtlasApi {
  const doc = typeof globalThis.document?.createElement === 'function' ? globalThis.document : null;
  const pageHidden = tabHidden || (() => Boolean(doc && doc.hidden));
  const renderer: AtlasRenderer = providedRenderer || new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, 0.1, 4000);
  /** Each level's frame: where the camera stands, and how far, when that level fills the free part of the screen (null until measured). */
  let fits: { x: number; z: number; distance: number }[] | null = null;
  const rig = createRig(THREE, camera, { minX: EXTENT.minX, maxX: EXTENT.maxX, minZ: -EXTENT.maxY, maxZ: -EXTENT.minY, minDistance: 0.4, leash: (distance) => (fits ? leashAt(distance, fits[NIGERIA]!.distance, fits[WORLD]!.distance) : 1) });
  const mesh = mesher(THREE);
  const ribbonMaterials: THREE.ShaderMaterial[] = [], probe = new THREE.Vector3();
  const ribbonMaterial = (opacity = 1, lift = 0.0004) => { const material = mesh.ribbonMaterial(opacity); material.uniforms.lift!.value = lift; ribbonMaterials.push(material); return material; };
  const flatMaterial = () => new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });

  // ---- state ------------------------------------------------------------------------------------
  let current = 'lagos', destroyed = false, opened = false, wasShown = false, resetView = false;
  let level = NIGERIA, wanted = NIGERIA, tintOn = false, listOpen = false, sheetOpen = false, query = '';
  let selectedCity: string | null = null;
  /** The way of travelling the card is asking about once more (a link id): its fare is a large part of the player's cash. */
  let confirming: string | null = null;
  /** The ride on credit has asked once, because it is a debt. */
  let creditAsk = false;
  let stateOverviewShown: string | null = null;
  /** The travel link the state view has in focus (a link id), chosen by tapping a line or a row. */
  let overviewLink: string | null = null;
  type OverviewState = { kind: 'loading' } | { kind: 'ready'; data: CityStateOverview } | { kind: 'error' };
  const stateOverviews = new Map<string, OverviewState>();
  const overviewExpanded = new Set<string>();
  async function showStateOverview(id: string, expand = true): Promise<void> {
    stateOverviewShown = id;
    if (expand) sheetOpen = true;
    if (stateOverviews.has(id)) { drawSheet(); return; }
    stateOverviews.set(id, { kind: 'loading' }); drawSheet();
    try {
      await Promise.all(catalogueCitiesInState(id).filter(city => city.open).map(city => loadCityRules(city.id)));
      const cityId = await loadStateOverviewCity(id);
      if (!cityId) { stateOverviews.delete(id); drawSheet(); return; }
      const pack = await loadCityMap(cityId);
      if (!pack.loadStateOverview) throw new TypeError('Missing state overview');
      const data = await pack.loadStateOverview();
      if (data.stateId !== id) throw new TypeError('Wrong state overview');
      if (!destroyed) stateOverviews.set(id, { kind: 'ready', data });
    } catch { if (!destroyed) stateOverviews.set(id, { kind: 'error' }); }
    if (!destroyed) drawSheet();
  }
  let selected: RegionRef | null = null, hovered: RegionRef | null = null;
  let routeShown: string | null = null, trip: Run | null = null, preview: Preview | null = null, entering: (() => void) | null = null, keyboard = false;
  let size = { width: 0, height: 0 }, insets: Insets = { left: 0, top: 0, right: 0, bottom: 0 }, cuts = [1, 1], lastLabels = 0, labelKey = '';
  /** Where each shown name is on the screen, for taps. */
  const lastPlaced = new Map<string, LabelBox>();
  let rafId = 0, renderCount = 0, lastTick = 0, loading = '', failed = '';
  const clock = createTripClock();
  /** One per level, filled when its data arrives: { topology, picker, layers… }. */
  const sheets: Sheets = [null, null, null], pending: (Promise<LevelSheet | null> | null)[] = [null, null, null];
  /** Everything that fades with a level: { object, levels, alpha, extrude, opacity, materials }. */
  const layers: Layer[] = [];
  const shown = () => !destroyed && !container.hidden && !pageHidden() && size.width > 0;

  // ---- DOM ----------------------------------------------------------------------------------------
  let root: HTMLElement | null = null;
  /** The level list (World, Africa, Nigeria, back to the city) is open. */
  let levelsOpen = false;
  const ui: Partial<Record<UiName, HTMLElement | null>> = {};
  const labelNodes = new Map<string, HTMLElement>();
  if (doc) {
    root = doc.createElement('section');
    root.className = 'atlas'; root.setAttribute('aria-label', 'World map: explore the world, Africa, Nigerian cities and travel routes.');
    root.innerHTML = `<div class="atlas-labels" aria-hidden="true"></div>
      <div class="atlas-friends"></div>
      <div class="atlas-marker" aria-hidden="true" hidden></div>
      <aside class="atlas-country-panel" id="atlas-country-panel" aria-label="Geographic country detail" aria-labelledby="atlas-country-title" hidden></aside>
      <div class="atlas-frame">
        <nav class="atlas-crumbs" aria-label="Map level"></nav>
        <div class="atlas-rail" role="search" aria-label="Find a place on the map"></div>
        <div class="atlas-stage"><div class="atlas-reticle" aria-hidden="true"></div><p class="atlas-wait" role="status" aria-live="polite" hidden></p>
          <div class="atlas-controls" role="group" aria-label="Map view"></div><div class="atlas-legend" hidden></div></div>
        <aside class="atlas-sheet" tabindex="-1" aria-live="polite" hidden></aside>
      </div>
      <aside class="atlas-fpanel" role="dialog" aria-label="Friends" hidden></aside>`;
    root.prepend(canvas);
    canvas.classList?.add('atlas-canvas'); canvas.setAttribute?.('aria-hidden', 'true');
    container.appendChild(root);
    for (const name of ['labels', 'friends', 'fpanel', 'reticle', 'marker', 'crumbs', 'rail', 'stage', 'wait', 'controls', 'legend', 'sheet', 'country-panel'] as const) ui[name] = root.querySelector(`.atlas-${name}`);
    ui.controls!.innerHTML = `<div class="atlas-zoom"><button type="button" data-atlas-zoom="in" aria-label="Zoom in" title="Zoom in">${ICON('<path d="M12 5v14M5 12h14"/>')}</button><button type="button" data-atlas-zoom="out" aria-label="Zoom out" title="Zoom out">${ICON('<path d="M5 12h14"/>')}</button></div>
      <button type="button" class="atlas-pill" data-atlas-zoom="fit">${ICON('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')}<span data-atlas-fit></span></button>
      <button type="button" class="atlas-pill" data-atlas-layer aria-pressed="false">${ICON('<path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5"/>')}<span data-atlas-layer-name></span></button>`;
  }

  // ---- data: one module per level, fetched when first wanted ---------------------------------------
  const statusOf = (kind: RegionKind, id: string) => regionEntry(kind, id).status;
  const grey = (list: readonly string[], feature: Feature): string => list[feature.index % list.length]!;
  const mix = (a: string, b: string, k: number): string => `#${new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString()}`;
  function stateColour(feature: Feature): string {
    const entry = regionEntry('state', feature.id);
    if (entry.status === 'open') return INK.open;
    const base = entry.status === 'planned' ? INK.planned : grey(INK.soon, feature);
    return tintOn && ZONES[entry.zone!] ? mix(base, ZONES[entry.zone!].tint, 0.62) : base;
  }
  function countryColour(feature: Feature<CountryData>, flat = false): string {
    const status = statusOf('country', feature.id);
    if (status === 'open') return INK.openCountry;
    if (status === null || (feature.k && feature.k !== 'country')) return INK.none;
    const base = status === 'planned' ? INK.planned : grey(flat ? INK.base : INK.soon, feature);
    return !flat && tintOn && AFRICA_GROUPS[feature.sub!] ? mix(base, AFRICA_GROUPS[feature.sub!].tint, 0.62) : flat && status === 'planned' ? mix(INK.base[0]!, INK.planned, 0.8) : base;
  }
  const addLayer = <O extends LayerObject>(object: O, levels: readonly number[], { extrude = false, opacity = 1, materials = [object.material], detail = null }: { extrude?: boolean; opacity?: number; materials?: THREE.Material[]; detail?: NigeriaMarkerDetail | null } = {}): Layer<O> => {
    const alpha = levels.includes(level) ? 1 : 0;
    object.visible = alpha > 0; scene.add(object);
    const entry: Layer<O> = { object, levels, alpha, extrude, opacity, materials, detail };
    layers.push(entry); applyLayer(entry);
    return entry;
  };
  const markerDetail = (): NigeriaMarkerDetail => level === NIGERIA ? nigeriaMarkerDetail(fits?.[NIGERIA]?.distance ?? null, rig.view.distance) : 'states';
  function applyLayer(entry: Layer) {
    entry.object.visible = entry.alpha > 0.004 && (!entry.detail || entry.detail === markerDetail());
    if (entry.extrude) entry.object.scale.y = 0.04 + 0.96 * entry.alpha;
    for (const material of entry.materials) {
      const value = entry.alpha * entry.opacity;
      if (material instanceof THREE.ShaderMaterial && material.uniforms.opacity) material.uniforms.opacity.value = value;
      else { material.opacity = value; const see = value < 0.999; if (material.transparent !== see) { material.transparent = see; material.depthWrite = !see; material.needsUpdate = true; } }
    }
  }
  const ribbonMesh = (lines: readonly RibbonLine[], opacity = 1, order = 2, lift?: number) => { const made = mesh.ribbons(lines), object = new THREE.Mesh(made.geometry, ribbonMaterial(opacity, lift)); object.renderOrder = order; object.frustumCulled = true; return object; };
  const spot = (lon: number, lat: number, y = 0): [number, number, number] => { const [x, py] = project(lon, lat); return [x, y, -py]; };

  function buildWorld(module: LevelModule): LevelSheet<WorldFeature> {
    const topology = decodeTopology((module as WorldModule).WORLD), around = new Set(ATLAS_LEVELS[NIGERIA]!.around);
    const sheet: LevelSheet<WorldFeature> = { topology, picker: createPicker(topology, { cells: 72, slack: 0.8 }), kind: 'country', top: () => 0.002, paint: [] };
    // Land: one mesh per continent, so whatever is out of view is culled as a whole.
    for (const continent of Object.keys(CONTINENTS)) {
      const features = topology.features.filter((feature) => feature.c === continent);
      if (!features.length) continue;
      const made = mesh.plates(features, { height: () => 0, colour: (feature) => countryColour(feature, true), walls: false });
      // Under the Africa level's own plates the world's Africa is not needed; from Nigeria nothing but Africa is in sight.
      addLayer(new THREE.Mesh(made.geometry, flatMaterial()), continent === 'af' ? [WORLD, NIGERIA] : [WORLD, AFRICA]);
      sheet.paint.push(() => made.paint((feature) => countryColour(feature, true)));
    }
    // Borders in three sets, so a closer level can draw its own, finer ones over the same ground.
    const isAfrica = (users: number[]) => users.some((i) => topology.features[i]!.c === 'af'), isAround = (users: number[]) => users.some((i) => around.has(topology.features[i]!.id));
    const shared = (users: number[]) => users.length > 1;
    const isNear = (users: number[]) => users.some((i) => ['eu', 'as'].includes(topology.features[i]!.c));
    addLayer(ribbonMesh(arcSegments(topology, (users) => shared(users) && !isAfrica(users) && isNear(users), 0.004, INK.border, 1.1)), [WORLD, AFRICA]);
    addLayer(ribbonMesh(arcSegments(topology, (users) => shared(users) && !isAfrica(users) && !isNear(users), 0.004, INK.border, 1.1)), [WORLD]);
    addLayer(ribbonMesh(arcSegments(topology, (users) => shared(users) && isAfrica(users) && !isAround(users), 0.004, INK.border, 1.1)), [WORLD, NIGERIA]);
    addLayer(ribbonMesh(arcSegments(topology, (users) => shared(users) && isAround(users), 0.004, INK.border, 1.1)), [WORLD]);
    // The far-out coastline is a hairline: thousands of pieces, and not one triangle.
    const coast = new THREE.LineSegments(mesh.hairlines(arcSegments(topology, (users) => !shared(users), 0.003, INK.coast, 1)), new THREE.LineBasicMaterial({ color: INK.coast, transparent: true }));
    coast.renderOrder = 2;
    addLayer(coast, [WORLD], { opacity: 0.9 });
    // Planned routes between countries: faint arcs from the open city to each planned country's hub.
    const arcs = plannedRoutes(current).map((route) => {
      const a = project(route.from.lon, route.from.lat), b = project(relLon(route.to.lon), route.to.lat), lift = liftOf(Math.hypot(b[0] - a[0], b[1] - a[1]));
      return { colour: INK.air, width: 1.6, points: Array.from({ length: 33 }, (_, i) => { const at = flightPoint(a, b, i / 32, lift); return [at.x, 0.3 + at.height * 0.2, -at.y]; }) };
    });
    if (arcs.length) addLayer(ribbonMesh(arcs, 0.55, 5), [WORLD, AFRICA]);
    return sheet;
  }

  function buildAfrica(module: LevelModule): LevelSheet<AfricaFeature> {
    const topology = decodeTopology((module as AfricaModule).AFRICA);
    const heightOf = (feature: Feature) => (statusOf('country', feature.id) === 'open' ? HEIGHT.openCountry : HEIGHT.country);
    const made = mesh.plates(topology.features, { height: heightOf, colour: countryColour, edges: outerEdges(topology), raised: (feature) => heightOf(feature) > HEIGHT.country });
    addLayer(new THREE.Mesh(made.geometry, flatMaterial()), [AFRICA], { extrude: true });
    addLayer(ribbonMesh(arcSegments(topology, (users) => users.length > 1, HEIGHT.country + 0.004, INK.border, 1.3)), [AFRICA], { extrude: true });
    addLayer(ribbonMesh(arcSegments(topology, (users) => users.length === 1, -0.004, INK.shore, 7), 0.9, 1, 0), [AFRICA]);
    const open = topology.features.filter((feature) => statusOf('country', feature.id) === 'open');
    if (open.length) addLayer(ribbonMesh(open.flatMap((feature) => mesh.ringLines(feature, HEIGHT.openCountry + 0.004, INK.glow, 2.4)), 1, 4), [AFRICA], { extrude: true });
    return { topology, picker: createPicker(topology, { slack: 0.3 }), kind: 'country', top: heightOf, paint: [() => made.paint(countryColour)] };
  }

  function buildNigeria(module: LevelModule): NigeriaSheet {
    const data = module as NigeriaModule;
    const topology = decodeTopology(data.NIGERIA), around = decodeTopology(data.AROUND), country = ATLAS_LEVELS[NIGERIA]!.country;
    const heightOf = (feature: Feature) => (statusOf('state', feature.id) === 'open' ? HEIGHT.open : HEIGHT.state);
    const self = around.features.findIndex((feature) => feature.id === country);
    // The neighbours: flat grey land, so Nigeria sits in context (Nigeria's own ground too, under its states).
    const land = mesh.plates(around.features, { height: () => HEIGHT.around, colour: () => INK.around, walls: false });
    addLayer(new THREE.Mesh(land.geometry, flatMaterial()), [NIGERIA]);
    addLayer(ribbonMesh(arcSegments(around, (users) => users.length > 1 && !users.includes(self), HEIGHT.around + 0.004, INK.border, 1.2)), [NIGERIA]);
    const made = mesh.plates(topology.features, { height: heightOf, colour: stateColour, edges: outerEdges(topology), raised: (feature) => heightOf(feature) > HEIGHT.state });
    addLayer(new THREE.Mesh(made.geometry, flatMaterial()), [NIGERIA], { extrude: true });
    // State borders: each shared border once, and the national outline a little stronger.
    addLayer(ribbonMesh([...arcSegments(topology, (users) => users.length > 1, HEIGHT.state + 0.004, INK.border, 1.5), ...arcSegments(topology, (users) => users.length === 1, HEIGHT.state + 0.004, INK.edge, 1.4)]), [NIGERIA], { extrude: true });
    addLayer(ribbonMesh([...arcSegments(topology, (users) => users.length === 1, 0, INK.shore, 9), ...arcSegments(around, (users) => users.length === 1, 0, INK.shore, 7)], 0.9, 1, 0), [NIGERIA]);
    // Water: the Niger and the Benue to their confluence at Lokoja and on to the delta; Lake Chad and Kainji.
    const y = HEIGHT.state + 0.006;
    const rivers = data.WATER.rivers.flatMap((river) => river.lines.map((line) => ({ colour: INK.water, width: river.name === 'Niger' ? 3 : 2.4, points: Array.from({ length: line.length / 2 }, (_, i) => spot(line[i * 2]!, line[i * 2 + 1]!, y)) })));
    const lakes = data.WATER.lakes.map((lake, index) => ({ id: lake.name, index, rings: [[Float64Array.from(lake.ring)]] }));
    // A lagoon inside an open state sits on that state's lifted plate; the other lakes lie on the ordinary land.
    const lakeMesh = mesh.plates(lakes, { height: (lake) => (/lagoon/i.test(lake.id) ? HEIGHT.open + 0.006 : y), colour: () => INK.water, walls: false });
    addLayer(new THREE.Mesh(lakeMesh.geometry, flatMaterial()), [NIGERIA], { extrude: true });
    const routeCities = [...new Set(allCityLinks().flatMap(link => [link.a, link.b]))];
    void Promise.all(routeCities.map(loadCityRoutes)).then(groups => {
      if (destroyed) return;
      for (const route of groups.flat()) authoredRoutes.set(linkId(route), { id: linkId(route), mode: route.mode, towns: null, points: route.points });
      drawHighlights(); drawSheet(); request();
    }, () => {});
    // Roads and flights between cities, in one mesh.
    const seen = new Set(), roads = [];
    for (const road of HIGHWAYS) for (let i = 1; i < road.towns.length; i++) {
      const key = [road.towns[i - 1], road.towns[i]].sort().join('>');
      if (seen.has(key)) continue;
      seen.add(key); roads.push({ colour: INK.road, width: 1.8, points: [spot(...TOWNS[road.towns[i - 1]!]!, y + 0.004), spot(...TOWNS[road.towns[i]!]!, y + 0.004)] });
    }
    const flights = allCityLinks().filter((link) => link.mode === 'air').map((link) => ({ colour: INK.air, width: 1.3, points: pathPoints(linkPath(link, cityEntry), y + 0.01) }));
    addLayer(ribbonMesh([...rivers, ...roads, ...flights], 1, 3), [NIGERIA], { extrude: true });
    // The open state: a bright outline round its lifted plate.
    const open = topology.features.filter((feature) => statusOf('state', feature.id) === 'open');
    if (open.length) addLayer(ribbonMesh(open.flatMap((feature) => mesh.ringLines(feature, HEIGHT.open + 0.004, INK.glow, 1.8, { holes: false })), 1, 4), [NIGERIA], { extrude: true });
    // Whole-country scale has one state dot. Zone and state scales replace them with every open city.
    const stateDotsObject = new THREE.Points(mesh.dots(topology.features.map((feature) => { const at = spot(feature.cap[1], feature.cap[2], heightOf(feature) + 0.012); return { x: at[0], y: at[1], z: at[2], colour: '#39404b', size: 7 }; })), mesh.dotMaterial());
    stateDotsObject.renderOrder = 6;
    const stateDots = addLayer(stateDotsObject, [NIGERIA], { extrude: true, detail: 'states' });
    const cityPoints = topology.features.flatMap((feature) => catalogueCitiesInState(feature.id).flatMap((city) => {
      if (!city.open) return [];
      const point = spot(city.lon, city.lat, heightOf(feature) + 0.018);
      return [{ x: point[0], y: point[1], z: point[2], colour: INK.select, size: 8 }];
    }));
    const cityDotsObject = new THREE.Points(mesh.dots(cityPoints), mesh.dotMaterial());
    cityDotsObject.renderOrder = 7;
    const cityDots = addLayer(cityDotsObject, [NIGERIA], { extrude: true, detail: 'cities' });
    return { topology, picker: createPicker(topology, { slack: 0.05 }), kind: 'state', top: heightOf, paint: [() => made.paint(stateColour)], stateDots, cityDots,
      around: { topology: around, picker: createPicker(around, { cells: 24, slack: 0.12 }), kind: 'country', top: () => HEIGHT.around + 0.002, skip: country } };
  }
  /** A link's line in scene units: a road through its towns, or a flight that rises and comes down. */
  function pathPoints(path: LinkPath | null, y: number): number[][] {
    if (!path) return [];
    if (path.mode !== 'air') return path.points.map(([lon, lat]) => spot(lon, lat, y));
    const line = measure(path.points), a = line.points[0]!, b = line.points[1]!, lift = liftOf(line.total);
    return Array.from({ length: 25 }, (_, i) => { const at = flightPoint(a, b, i / 24, lift); return [at.x, y + at.height, -at.y]; });
  }

  const BUILD: ((module: LevelModule) => LevelSheet)[] = [buildWorld, buildAfrica, buildNigeria];
  /** Fetch and build a level once. Resolves when it is in the scene. */
  function ensure(index: number): Promise<LevelSheet | null> {
    if (sheets[index]) return Promise.resolve(sheets[index]);
    pending[index] ??= Promise.resolve().then(() => load(ATLAS_LEVELS[index]!.id)).then((module) => {
      if (destroyed) return null;
      const built = BUILD[index]!(module);
      (sheets as (LevelSheet | null)[])[index] = built;
      failed = '';
      syncResolution(); settleLevel(); drawChrome(); request();
      return built;
    }).catch((error: unknown) => { pending[index] = null; failed = ATLAS_LEVELS[index]!.name; console.error(`The map of ${ATLAS_LEVELS[index]!.name} could not be loaded:`, error); showWait(); return null; });
    return pending[index]!;
  }

  // ---- levels -------------------------------------------------------------------------------------
  const centre = () => unproject(rig.view.x, -rig.view.z);
  /** The level the camera is at; if its data is not here yet, the nearest loaded level is shown and the wanted one fetched. */
  function settleLevel() {
    if (!fits) return;
    const [lon, lat] = centre();
    wanted = focusLevel(levelAt(rig.view.distance, cuts, wanted), lon, lat, ATLAS_LEVELS);
    if (!sheets[wanted]) void ensure(wanted);
    // Heading out: have the next level ready before the threshold is reached.
    if (wanted > WORLD && !sheets[wanted - 1] && rig.view.distance > cuts[wanted - 1]! * 0.62) void ensure(wanted - 1);
    const next = sheets[wanted] ? wanted : level;
    if (next !== level) {
      level = next; hovered = null; settleFriends();
      // Arriving inside a country, the country itself is no longer the thing selected: its states are.
      if (selected?.kind === 'country' && selected.id === ATLAS_LEVELS[level]!.country) selected = null;
      drawChrome();
    }
    showWait();
    for (const entry of layers) if (reducedMotion || !raf) { entry.alpha = entry.levels.includes(level) ? 1 : 0; applyLayer(entry); }
  }
  function showWait() {
    const name = failed || (!sheets[wanted] ? ATLAS_LEVELS[wanted]!.name : '');
    loading = name;
    if (!ui.wait) return;
    ui.wait.hidden = !name;
    ui.wait.innerHTML = failed ? `The map of ${esc(failed)} could not be loaded. <button type="button" data-atlas-retry>Try again</button>` : name ? `Loading the map of ${esc(name)}…` : '';
  }
  /** Move every layer towards what its level wants. Returns true while a fade is still running. */
  function stepFade(dt: number): boolean {
    let moving = false;
    for (const entry of layers) {
      const target = entry.levels.includes(level) ? 1 : 0;
      if (entry.alpha === target) continue;
      const step = dt / FADE;
      entry.alpha = target > entry.alpha ? Math.min(1, entry.alpha + step) : Math.max(0, entry.alpha - step);
      applyLayer(entry);
      moving = moving || entry.alpha !== target;
    }
    return moving;
  }
  const fading = () => layers.some((entry) => entry.alpha !== (entry.levels.includes(level) ? 1 : 0));

  // ---- camera ---------------------------------------------------------------------------------------
  const framePoints = ([west, south, east, north]: Box4) => [west, (west + east) / 2, east].flatMap((lon) => [south, (south + north) / 2, north].map((lat) => { const [x, y] = project(lon, lat); return { x, y: 0, z: -y }; }));
  /** The rig measures fits with the camera's current depth range, which is set for the view it is in: open it up while measuring. */
  const measuring = () => { camera.near = 0.05; camera.far = 1e5; };
  function computeFits() {
    const saved = { ...rig.view };
    measuring();
    fits = ATLAS_LEVELS.map((entry, i) => {
      // The wide levels may run under the side panels (half of each): the world is not squeezed into the gap between them.
      if (i !== NIGERIA) rig.setViewport(size.width, size.height, { ...insets, left: insets.left * 0.5, right: insets.right * 0.5 });
      rig.jump({ yaw: 0, pitch: PITCHES[i]! }); measuring();
      const fit = rig.framing(framePoints(entry.frame), { pad: i === NIGERIA ? 0.99 : 1.02, min: 0 });
      if (i !== NIGERIA) { measuring(); rig.setViewport(size.width, size.height, insets); }
      return fit;
    });
    rig.jump(saved);
    cuts = thresholds(fits.map((fit) => fit.distance));
  }
  const distances = () => fits!.map((fit) => fit.distance);
  const minDistance = () => fits![NIGERIA]!.distance / 9, maxDistance = () => fits![WORLD]!.distance * 1.12;
  const levelView = (index: number) => ({ x: fits![index]!.x, z: fits![index]!.z, distance: fits![index]!.distance, pitch: PITCHES[index]!, yaw: 0 });
  function moved() { settleLevel(); request(); }
  /** Go to a view: flown, or cut when motion is reduced. */
  function fly(target: Partial<RigView>, seconds = 0.75) {
    const distance = clamp(target.distance ?? rig.view.distance, minDistance(), maxDistance());
    const view = { yaw: 0, ...target, distance, pitch: target.pitch ?? pitchAt(distance, distances(), PITCHES) };
    if (reducedMotion || !raf) rig.jump(view); else rig.ease(view, seconds);
    moved();
  }
  /** Zoom by a factor about a point of the screen (NDC), keeping the ground under it where it is. The map is always north-up. */
  function zoomBy(factor: number, nx: number | null = null, ny: number | null = null) {
    const distance = clamp(rig.view.distance * factor, minDistance(), maxDistance());
    const before = nx === null ? null : rig.groundAt(nx, ny!);
    rig.jump({ distance, pitch: pitchAt(distance, distances(), PITCHES), yaw: 0 });
    const after = before ? rig.groundAt(nx!, ny!) : null;
    if (before && after) rig.pan(before.x - after.x, before.z - after.z);
    moved();
  }
  /** A view that holds a feature, never closer than is useful. */
  function viewOf(feature: Feature) {
    const b = feature.bounds, saved = { ...rig.view };
    measuring();
    rig.jump({ yaw: 0, pitch: PITCHES[NIGERIA]! }); measuring();
    const frame = rig.framing(framePoints([b.minLon, b.minLat, b.maxLon, b.maxLat]), { pad: 1.9, min: 0 });
    rig.jump(saved);
    return { x: frame.x, z: frame.z, distance: clamp(frame.distance, minDistance(), maxDistance()) };
  }

  // ---- picking --------------------------------------------------------------------------------------
  /** What is at a point of the canvas (CSS pixels): { kind, id, feature, sheet } or null. */
  function pickAt(x: number, y: number): Hit | null {
    const ground = rig.groundAt((x / size.width) * 2 - 1, 1 - (y / size.height) * 2);
    if (!ground) return null;
    const [lon, lat] = unproject(ground.x, -ground.z);
    return pickLonLat(lon, lat);
  }
  function pickLonLat(lon: number, lat: number): Hit | null {
    const order: (Sheet | null | undefined)[] = level === NIGERIA ? [sheets[NIGERIA], sheets[NIGERIA]?.around, sheets[WORLD]] : level === AFRICA ? [sheets[AFRICA], sheets[WORLD]] : [sheets[WORLD]];
    // Exactly inside something first; failing that, just off a coast or on a small island.
    for (const how of ['pick', 'near'] as const) for (const sheet of order) {
      const feature = sheet?.picker[how](lon, lat);
      if (feature && feature.id !== sheet!.skip) return { kind: sheet!.kind, id: feature.id, feature, sheet: sheet! };
    }
    return null;
  }
  /** The feature a reference names, in the most detailed sheet that has it. */
  function find(ref: RegionRef | null): Hit | null {
    if (!ref) return null;
    const order: (Sheet | null | undefined)[] = ref.kind === 'state' ? [sheets[NIGERIA]] : level === NIGERIA ? [sheets[NIGERIA]?.around, sheets[AFRICA], sheets[WORLD]] : level === AFRICA ? [sheets[AFRICA], sheets[WORLD]] : [sheets[WORLD], sheets[AFRICA]];
    for (const sheet of order) { const feature = sheet?.topology.byId.get(ref.id); if (feature && feature.id !== sheet!.skip) return { kind: ref.kind, id: ref.id, feature, sheet: sheet! }; }
    return null;
  }
  const same = (a: RegionRef | null, b: RegionRef | null): boolean => (a && b ? a.kind === b.kind && a.id === b.id : a === b);

  // ---- highlight: hover, selection, the chosen route --------------------------------------------------
  const hoverMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
  const selectMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: INK.route, transparent: true, opacity: 0.36, depthWrite: false, side: THREE.DoubleSide }));
  const selectLine = new THREE.Mesh(new THREE.BufferGeometry(), ribbonMaterial(1, 0.0008)), routeLine = new THREE.Mesh(new THREE.BufferGeometry(), ribbonMaterial(1, 0.001));
  hoverMesh.renderOrder = 7; selectMesh.renderOrder = 7; selectLine.renderOrder = 8; routeLine.renderOrder = 9;
  for (const object of [hoverMesh, selectMesh, selectLine, routeLine]) { object.visible = false; object.frustumCulled = false; scene.add(object); }
  const swap = (object: THREE.Mesh, geometry: THREE.BufferGeometry | null) => { object.geometry.dispose(); object.geometry = geometry || new THREE.BufferGeometry(); object.visible = Boolean(geometry); };
  /** Is this sheet's ground what the current level shows? A state is not lit up from the Africa level. */
  const inView = (hit: Hit | null): Hit | null => (hit && ((level === NIGERIA ? [sheets[NIGERIA], sheets[NIGERIA]?.around, sheets[WORLD]] : level === AFRICA ? [sheets[AFRICA], sheets[WORLD]] : [sheets[WORLD]]) as (Sheet | null | undefined)[]).includes(hit.sheet) ? hit : null);
  function drawHighlights() {
    const hit = inView(hovered && !same(hovered, selected) ? find(hovered) : null), chosen = inView(find(selected));
    swap(hoverMesh, hit ? mesh.cap(hit.feature, hit.sheet.top(hit.feature) + 0.006) : null);
    const open = chosen && regionEntry(chosen.kind, chosen.id).status === 'open';
    swap(selectMesh, chosen && !open ? mesh.cap(chosen.feature, chosen.sheet.top(chosen.feature) + 0.007) : null);
    swap(selectLine, chosen && !open ? mesh.ribbons(mesh.ringLines(chosen.feature, chosen.sheet.top(chosen.feature) + 0.008, INK.select, 2.4)).geometry : null);
    const path = routePath(routeShown);
    swap(routeLine, path && level === NIGERIA ? mesh.ribbons([{ colour: '#ffffff', width: 7, points: pathPoints(path, HEIGHT.state + 0.03) }, { colour: INK.route, width: 4, points: pathPoints(path, HEIGHT.state + 0.032) }]).geometry : null);
  }
  const authoredRoutes = new Map<string, LinkPath>();
  const pathOf = (link: { a: string; b: string; mode: string }) => authoredRoutes.get(linkId(link)) ?? (link.mode === 'rail' ? null : linkPath(link, cityEntry));
  const routePath = (id: string | null) => { const link = id ? allCityLinks().find((item) => linkId(item) === id) : null; return link ? pathOf(link) : null; };

  // ---- drawing: on demand, and only as long as something moves ---------------------------------------
  function request() { if (!rafId && shown() && raf) rafId = raf(tick); }
  function stop() { if (rafId) { caf?.(rafId); rafId = 0; } lastTick = 0; }
  function tick() {
    rafId = 0;
    if (!shown()) { lastTick = 0; return; }
    const t = now(), dt = lastTick ? clamp((t - lastTick) / 1000, 0, 0.1) : 0;
    let moving = rig.step(dt);
    if (moving || entering) settleLevel();
    moving = stepFade(dt) || moving;
    moving = stepTrip(t) || moving;
    if (entering && !rig.moving) { const done = entering; entering = null; done(); }
    draw();
    if (moving || entering) { lastTick = t; request(); } else lastTick = 0;
  }
  function draw() {
    for (const entry of layers) if (entry.detail) applyLayer(entry);
    renderer.render(scene, camera);
    renderCount += 1;
    drawLabels(); drawMarker(); drawFriends();
  }
  function syncResolution() {
    for (const material of ribbonMaterials) material.uniforms.resolution!.value.set(size.width, size.height);
    if (sheets[NIGERIA]) for (const dots of [sheets[NIGERIA].stateDots, sheets[NIGERIA].cityDots]) dots.object.material.uniforms.ratio!.value = renderer.getPixelRatio?.() || 1;
  }


  // ---- friends: a badge on each city (or country, further out) they are in, and the list behind it ------------
  let friendsNow: FriendsModel = EMPTY_FRIENDS, friendsOpen: string | null = null;
  const friendNodes = new Map<string, HTMLElement>();
  const countryOf = (cityId: string): string | null => cityEntry(cityId)?.country ?? null;
  /** The groups drawn at this level, each with the place it stands at on the screen. */
  function friendBadges(): { key: string; title: string; friends: FriendHere[]; x: number; y: number }[] {
    if (!fits) return [];
    if (level === NIGERIA) {
      return friendsNow.cities.flatMap((group) => {
        const spot = cityEntry(group.cityId);
        if (!spot) return [];
        const where = at(relLon(spot.lon), spot.lat, HEIGHT.open + 0.02);
        return where.behind ? [] : [{ key: `city:${group.cityId}`, title: cityName(group.cityId) ?? group.cityId, friends: group.friends, x: where.x + 12, y: where.y + 8 }];
      });
    }
    const sheet = level === AFRICA ? sheets[AFRICA] : sheets[WORLD];
    return byCountry(friendsNow, countryOf).flatMap((group) => {
      const feature = (sheet ?? sheets[WORLD] ?? sheets[AFRICA])?.topology.byId.get(group.countryId) as Feature<CountryData & { at?: [number, number] }> | undefined;
      const point = feature && 'at' in feature ? (feature as unknown as { at: [number, number] }).at : null;
      if (!feature || !point) return [];
      const where = at(point[0], point[1], 0);
      return where.behind ? [] : [{ key: `country:${group.countryId}`, title: feature.name, friends: group.friends, x: where.x + 14, y: where.y + 10 }];
    });
  }
  function drawFriends() {
    if (!ui.friends) return;
    const badges = friendBadges(), keep = new Set<string>();
    for (const badge of badges) {
      keep.add(badge.key);
      const look = badgeOf(badge.friends);
      let node = friendNodes.get(badge.key);
      if (!node) { const made = doc!.createElement('button'); made.type = 'button'; node = made; friendNodes.set(badge.key, node); ui.friends.appendChild(node); }
      const key = `${look.initials.join('')}|${look.count}|${look.online}|${badge.title}`;
      if (node.dataset.key !== key) {
        node.dataset.key = key; node.dataset.atlasFb = badge.key;
        node.className = `atlas-fb${look.online ? ' is-online' : ''}`;
        node.setAttribute('aria-label', `${look.count} friend${look.count === 1 ? '' : 's'} in ${badge.title}${look.online ? ', some online' : ''}. Show who.`);
        node.innerHTML = `<span class="atlas-fb-av">${look.initials.map((initial, index) => `<i style="--i:${index}">${esc(initial)}</i>`).join('')}</span><b>${look.count}</b>`;
      }
      node.style.transform = `translate(${badge.x.toFixed(1)}px,${badge.y.toFixed(1)}px)`;
    }
    for (const [key, node] of friendNodes) if (!keep.has(key)) { node.remove(); friendNodes.delete(key); }
  }
  function friendRow(friend: FriendHere, cityId: string | null): string {
    const place = friend.venue === 'home' ? 'at home' : friend.venue && cityId ? (venueFor(cityId, friend.venue)?.label ?? '') : '';
    const where = friend.online ? `Online${cityId ? ` · in ${esc(cityName(cityId) ?? cityId)}` : ''}${place ? ` · ${esc(place)}` : ''}${friend.journey ? ` · travelling to ${esc(cityName(friend.journey) ?? friend.journey)}` : ''}` : 'Offline';
    return `<li><span class="atlas-fb-dot${friend.online ? ' is-online' : ''}" aria-hidden="true">${esc(friend.initial)}</span><span class="atlas-fp-text"><b>${esc(friend.name)}</b><small>${where}</small></span>`
      + `<button type="button" data-atlas-fact="chat" data-id="${esc(friend.id)}" data-name="${esc(friend.name)}">Chat</button>`
      + `<button type="button" data-atlas-fact="${friend.online ? 'call' : 'ping'}" data-id="${esc(friend.id)}" data-name="${esc(friend.name)}">${friend.online ? 'Call' : 'Ping'}</button></li>`;
  }
  function drawFriendsPanel() {
    const panel = ui.fpanel;
    if (!panel) return;
    const badge = friendsOpen ? friendBadges().find((item) => item.key === friendsOpen) ?? null : null;
    const group = friendsOpen?.startsWith('city:') ? friendsNow.cities.find((item) => `city:${item.cityId}` === friendsOpen) : null;
    const countryId = friendsOpen?.startsWith('country:') ? friendsOpen.slice(8) : null;
    const countryGroup = countryId ? byCountry(friendsNow, countryOf).find((item) => item.countryId === countryId) : null;
    const friends = group?.friends ?? countryGroup?.friends ?? [];
    if (!friendsOpen || !friends.length) { panel.hidden = true; panel.innerHTML = ''; if (friendsOpen && !friends.length && !badge) friendsOpen = null; return; }
    const cities = group ? [group.cityId] : countryGroup?.cityIds ?? [];
    const where = (friend: FriendHere): string | null => (group ? group.cityId : cities.find((cityId) => friendsNow.cities.find((item) => item.cityId === cityId)?.friends.some((item) => item.id === friend.id)) ?? null);
    const title = group ? cityName(group.cityId) ?? group.cityId : badge?.title ?? 'this country';
    const going = cities.filter((cityId) => cityId !== current && isOpenCityId(cityId)).map((cityId) => `<button type="button" class="atlas-fp-go" data-atlas-fgo="${esc(cityId)}">Go to ${esc(cityName(cityId) ?? cityId)}</button>`).join('');
    const away = friendsNow.offline.slice(0, 5);
    panel.hidden = false;
    panel.innerHTML = `<header><b>Friends in ${esc(title)}</b><button type="button" data-atlas-fclose aria-label="Close the list of friends">×</button></header>`
      + `<ul>${friends.map((friend) => friendRow(friend, where(friend))).join('')}</ul>`
      + (away.length ? `<p class="atlas-fp-note">Offline, no place shown</p><ul>${away.map((friend) => friendRow(friend, null)).join('')}</ul>` : '')
      + (going ? `<div class="atlas-fp-foot">${going}</div>` : '');
  }
  function setFriends(model: FriendsModel | null) {
    friendsNow = model ?? EMPTY_FRIENDS;
    drawFriendsPanel(); request();
  }
  function openFriends(cityId: string): boolean {
    if (!friendsNow.cities.some((group) => group.cityId === cityId)) return false;
    const spot = cityEntry(cityId);
    void ensure(NIGERIA);
    friendsOpen = `city:${cityId}`;
    if (fits && spot) { const [x, y] = project(relLon(spot.lon), spot.lat); fly({ x, z: -y, distance: Math.min(rig.view.distance, fits[NIGERIA]!.distance * 0.8), yaw: 0 }, 0.8); }
    drawFriendsPanel(); request();
    return true;
  }
  // The badge a level draws is a different one (a city further in, a country further out): the list follows the level it was opened at.
  function settleFriends() { if (friendsOpen && !friendBadges().some((item) => item.key === friendsOpen)) { friendsOpen = null; drawFriendsPanel(); } }

  // ---- labels ---------------------------------------------------------------------------------------
  function screenOf(x: number, y: number, z: number) { probe.set(x, y, z).project(camera); return { x: (probe.x * 0.5 + 0.5) * size.width, y: (0.5 - probe.y * 0.5) * size.height, behind: probe.z > 1 }; }
  const at = (lon: number, lat: number, y = 0) => { const [x, py] = project(lon, lat); return screenOf(x, y, -py); };
  /** How wide a feature's box is on screen. */
  function roomOf(feature: Feature, y: number) { const b = feature.bounds, a = at(b.minLon, (b.minLat + b.maxLat) / 2, y), c = at(b.maxLon, (b.minLat + b.maxLat) / 2, y); return Math.abs(c.x - a.x); }
  /** The reader's text scale: the root font size against the browser default of 16px. */
  const textScale = () => { const px = doc?.defaultView ? parseFloat(doc.defaultView.getComputedStyle(doc.documentElement).fontSize) : 16; return Number.isFinite(px) && px > 0 ? px / 16 : 1; };
  function candidates(): LabelCandidate[] {
    const out: LabelCandidate[] = [], dn = densityFor(size.width, textScale());
    const push = (id: string, where: { x: number; y: number; behind: boolean }, text: string, more: Partial<LabelCandidate>) => { if (!where.behind) out.push({ id, x: where.x, y: where.y, text, priority: 10, size: 11, ...more }); };
    if (level === NIGERIA && sheets[NIGERIA]) {
      const sheet = sheets[NIGERIA], close = markerDetail() === 'cities';
      for (const feature of sheet.topology.features) {
        const entry = regionEntry('state', feature.id), top = sheet.top(feature), city = entry.city ? cityEntry(entry.city) : null;
        // The whole-country view names states; close in, each open city is named, and the crowding rule below keeps only the most important names and counts the rest.
        if (close) for (const openCity of catalogueCitiesInState(feature.id)) {
          if (openCity.open) push(`city:${openCity.id}`, at(openCity.lon, openCity.lat, top + 0.02), openCity.name, { priority: openCity.id === current ? 2000 : selected?.kind === 'state' && selected.id === feature.id ? 1200 : 200, size: dn.city, compact: true, anchor: 'above', alts: ['right', 'left', 'below', 'far-above', 'far-below', 'far-right', 'far-left'], fixed: openCity.id === current, cls: `is-city is-open${openCity.id === current ? ' is-you' : ''}`, note: openCity.id === current ? 'You are here' : 'Open' });
        }
        if (!close || entry.status !== 'open') push(`state:${feature.id}`, at(feature.at[0], feature.at[1], top), feature.name === 'Federal Capital Territory' ? 'FCT' : feature.name, { short: feature.id === 'fct' ? 'FCT' : feature.ab, room: roomOf(feature, top) * 0.86, priority: entry.status === 'open' ? 80 : city ? 44 : 50, size: dn.other, cls: 'is-region' });
        if (close && !city) push(`cap:${feature.id}`, at(feature.cap[1], feature.cap[2], top), feature.cap[0], { priority: 22, size: 10, anchor: 'right', cls: 'is-town' });
      }
      // Crowding: only the most important city names are written (a table in density.ts; more as the view comes closer), the others stay dots,
      // and a state that lost three or more of its names to dots says how many ("Ogun · 4"). Zooming in or tapping the state brings the names back.
      const cities = out.filter((label) => label.id.startsWith('city:')), keep = namedCities(cities, atlasNamesAt(dn, fits![NIGERIA]!.distance / rig.view.distance));
      const dropped = cities.filter((label) => !keep.has(label.id));
      if (dropped.length) {
        const gone = new Set(dropped.map((label) => label.id));
        for (let i = out.length - 1; i >= 0; i--) if (gone.has(out[i]!.id)) out.splice(i, 1);
        for (const [stateId, count] of countChips(dropped.map((label) => stateOfCity(label.id.slice(5)) ?? ''))) {
          const feature = sheet.topology.features.find((item) => item.id === stateId);
          if (feature) push(`count:${stateId}`, at(feature.at[0], feature.at[1], sheet.top(feature) + 0.02), `${feature.name === 'Federal Capital Territory' ? 'FCT' : feature.name} · ${count}`, { priority: 300, size: dn.other, compact: true, cls: 'is-count', title: `${count} more cities here: zoom in to name them` });
        }
      }
      for (const [name, lon, lat] of NEIGHBOUR_LABELS) push(`near:${name}`, at(lon, lat), name, { priority: 34, size: 12, cls: 'is-neighbour' });
      for (const [name, lon, lat, kind] of WATER_LABELS) push(`water:${name}`, at(lon, lat, HEIGHT.state), name, { priority: kind === 'sea' ? 40 : 26, size: kind === 'sea' ? 12 : 10, anchor: kind === 'town' ? 'right' : 'centre', cls: `is-${kind}` });
      if (close) for (const port of AIRPORTS) push(`air:${port.id}`, at(port.at[0], port.at[1], HEIGHT.state), '✈', { priority: 18, size: 12, cls: 'is-airport', title: port.name });
    } else if (level === AFRICA && sheets[AFRICA]) {
      const sheet = sheets[AFRICA];
      for (const feature of sheet.topology.features) {
        const top = sheet.top(feature), open = statusOf('country', feature.id) === 'open', b = feature.bounds;
        push(`country:${feature.id}`, at(feature.at[0], feature.at[1], top), feature.name, { room: open ? undefined : roomOf(feature, top) * 0.9, priority: open ? 1000 : 40 + Math.min(30, (b.maxLon - b.minLon) * (b.maxLat - b.minLat) * 0.1), fixed: open, size: open ? dn.city : dn.other, compact: open, cls: open ? `is-city is-open${feature.id === ATLAS_LEVELS[NIGERIA]!.country ? ' is-you' : ''}` : 'is-region', note: open ? (feature.id === ATLAS_LEVELS[NIGERIA]!.country ? 'You are here' : 'Open') : undefined, anchor: open ? 'above' : 'centre' });
        if (feature.cap && MAJOR_CAPITALS.has(feature.cap[0])) push(`cap:${feature.id}`, at(feature.cap[1], feature.cap[2], top), feature.cap[0], { priority: feature.cap[0] === 'Abuja' ? 60 : 30, size: 10, anchor: 'right', cls: 'is-capital' });
      }
    } else if (sheets[WORLD]) {
      for (const continent of Object.values(CONTINENTS)) push(`continent:${continent.id}`, at(relLon(continent.lon), continent.lat), continent.name, { priority: 100, size: 13, cls: 'is-continent' });
      const home = sheets[WORLD].topology.byId.get(ATLAS_LEVELS[NIGERIA]!.country!);
      if (home) push('country:home', at(home.at[0], home.at[1]), home.name, { priority: 1000, fixed: true, size: dn.city, compact: true, anchor: 'above', cls: 'is-city is-open is-you', note: 'You are here' });
      for (const route of plannedRoutes(current)) push(`hub:${route.to.id}`, at(relLon(route.to.lon), route.to.lat), route.to.name, { priority: 60, size: 10, anchor: 'right', cls: 'is-capital' });
    }
    return out;
  }
  function drawLabels() {
    if (!ui.labels) { lastLabels = Math.min(LABEL_CAP, candidates().length); return; }
    const placed = placeLabels(candidates(), { width: size.width, height: size.height });
    lastLabels = placed.length;
    lastPlaced.clear(); for (const label of placed) lastPlaced.set(label.id, label.box);
    const keep = new Set<string>();
    for (const label of placed) {
      keep.add(label.id);
      let node = labelNodes.get(label.id);
      if (!node) { node = doc!.createElement('span'); labelNodes.set(label.id, node); ui.labels.appendChild(node); }
      const key = `${label.cls}|${label.shown}|${label.note || ''}|${label.anchor || ''}|${label.compact || ''}`;
      if (node.dataset.key !== key) { node.dataset.key = key; node.className = `atlas-label ${label.cls || ''} at-${label.anchor || 'centre'}`; node.innerHTML = `<b>${esc(label.shown)}</b>${label.note && !label.compact ? `<small>${esc(label.note)}</small>` : ''}`; const tip = label.title ?? (label.compact ? label.note : undefined); if (tip) node.title = tip; else node.removeAttribute('title'); }
      node.style.transform = `translate(${label.x.toFixed(1)}px,${label.y.toFixed(1)}px)`;
    }
    for (const [id, node] of labelNodes) if (!keep.has(id)) { node.remove(); labelNodes.delete(id); }
    drawLeaders(placed);
  }
  /** A thin line from each displaced label to the dot it names, drawn under the labels. */
  function drawLeaders(placed: readonly PlacedLabel[]) {
    const lines = placed.flatMap((label) => {
      if (!label.displaced) return [];
      const { box, home } = label, x = Math.min(Math.max(home.x, box.left), box.right), y = Math.min(Math.max(home.y, box.top), box.bottom);
      return Math.hypot(x - home.x, y - home.y) > 6 ? [`<line x1="${home.x.toFixed(1)}" y1="${home.y.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/><circle cx="${home.x.toFixed(1)}" cy="${home.y.toFixed(1)}" r="2.5"/>`] : [];
    });
    let layer = ui.labels!.querySelector<SVGSVGElement>('.atlas-leaders');
    if (!lines.length) { layer?.remove(); return; }
    if (!layer) { layer = doc!.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement; layer.setAttribute('class', 'atlas-leaders'); layer.setAttribute('aria-hidden', 'true'); ui.labels!.prepend(layer); }
    layer.innerHTML = lines.join('');
  }

  // ---- travel between cities: the server's timer, or the preview --------------------------------------
  /** Advance the trip. Returns true while the marker is still moving. */
  function stepTrip(t: number): boolean {
    const run = trip || preview;
    if (!run) return false;
    if (preview && !trip && reducedMotion) return false; // a still picture: the marker half-way along the route
    run.progress = trip ? clock.progress(t) : clamp((t - preview!.start) / (preview!.seconds * 1000), 0, 1);
    if (preview && run.progress >= 1) { if (t - preview.start > preview.seconds * 1000 + 900) { preview = null; drawSheet(); return false; } return true; }
    return !reducedMotion && run.progress < 1;
  }
  function drawMarker() {
    const run = trip || preview;
    if (!ui.marker) return;
    if (!run || level !== NIGERIA) { ui.marker.hidden = true; return; }
    const place = tripPoint(run.path, run.line, run.from, run.progress ?? 0), where = screenOf(place.x, HEIGHT.state + 0.05 + place.height, -place.y);
    ui.marker.hidden = false;
    ui.marker.className = `atlas-marker is-${place.mode === 'air' ? 'air' : 'road'}`;
    if (ui.marker.dataset.mode !== place.mode) { ui.marker.dataset.mode = place.mode; ui.marker.innerHTML = ICON(place.mode === 'air' ? GLYPH.plane : place.mode === 'rail' ? GLYPH.rail : GLYPH.bus); }
    ui.marker.style.transform = `translate(${where.x.toFixed(1)}px,${where.y.toFixed(1)}px)`;
  }
  function startRun(link: { a: string; b: string; mode: string }, from: string): Run | null {
    const path = pathOf(link);
    return path ? { path, line: measure(path.points), from, progress: 0 } : null;
  }
  /** Play a link's journey on the map without leaving: a preview, clearly not a real trip. */
  function previewTrip(routeId: string): boolean {
    const link = allCityLinks().find((item) => linkId(item) === routeId);
    if (!link || trip) return false;
    const run = startRun(link, link.a === current || link.b !== current ? link.a : link.b);
    if (!run) return false;
    routeShown = routeId;
    // With reduced motion there is no animation: the marker is shown half-way along the highlighted route.
    preview = { ...run, start: now(), seconds: link.mode === 'air' ? 4 : 6, progress: reducedMotion ? 0.5 : 0 };
    if (level !== NIGERIA || rig.view.distance > fits![NIGERIA]!.distance * 1.05) fly(levelView(NIGERIA));
    drawHighlights(); drawSheet(); request();
    return true;
  }

  // ---- the chrome: breadcrumb, list, sheet -------------------------------------------------------------
  const context = () => ({ current, held: held() || [], routes: routes() });
  const infoOf = (hit: Pick<Hit, 'kind' | 'id' | 'feature'>): RegionInfo => regionInfo({ kind: hit.kind, id: hit.id }, { ...context(), cityId: selectedCity, feature: hit.feature });
  let countryDetailModel: CountryDetailPanelModel | null = null;
  let countryPanelReturnFocus: HTMLElement | null = null;
  function drawCountryPanel(state: ReturnType<CountryDetailPanelModel['snapshot']>) {
    const panel = ui['country-panel'];
    if (!panel) return;
    const active = panel.ownerDocument.activeElement;
    const wasFocused = active instanceof HTMLElement && panel.contains(active);
    const focusChoice = wasFocused && active.matches('[data-country-choice]');
    const focusClose = wasFocused && active.matches('[data-country-close]');
    const focusStatus = wasFocused && (active.matches('[role="status"]') || active.matches('[data-country-show-outline], [data-country-retry]'));
    panel.hidden = !state.open;
    ui.crumbs?.querySelector('[data-atlas-countries]')?.setAttribute('aria-expanded', String(state.open));
    if (!state.open) { panel.innerHTML = ''; return; }
    const catalogue = state.catalogue;
    const choice = catalogue?.countries.find((country) => country.countryId === state.selectedCountryId);
    const safeSource = (() => { try { const url = new URL(catalogue?.sourceUrl ?? ''); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; } })();
    let outline = '';
    if (state.outline) {
      try {
        const svg = countryOutlineSvg(state.outline);
        if (typeof state.outline.attribution !== 'string' || state.outline.attribution.length > 2048 || !Array.isArray(state.outline.limitations) || state.outline.limitations.length > 16 || state.outline.limitations.some((item) => typeof item !== 'string' || item.length > 2048)) throw new TypeError('Outline attribution or limitations are malformed');
        outline = `<figure class="atlas-country-figure"><svg viewBox="${svg.viewBox}" role="img" aria-label="Geographic outline of ${esc(state.outline.country.name)}"><path d="${svg.path}" fill-rule="evenodd"/></svg><figcaption>${svg.sourcePositions.toLocaleString()} source positions${svg.simplified ? ' · simplified for display' : ''}</figcaption></figure><p class="atlas-country-source">${esc(state.outline.attribution)}</p>${state.outline.limitations.length ? `<ul class="atlas-country-limitations">${state.outline.limitations.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}`;
      } catch (error) {
        state = { ...state, state: 'outline-error', outline: null, message: error instanceof Error ? error.message : 'This outline cannot be displayed.' };
      }
    }
    const choiceBody = choice ? isDetailProtected(choice)
      ? `<p class="atlas-country-note">Nigeria uses its existing map.</p><button type="button" class="atlas-go is-small" data-country-view-nigeria>View Nigeria</button>`
      : choice.status === 'missing'
        ? `<p class="atlas-country-note">${esc(choice.continent)} · No outline is available for this country yet.</p>`
        : `<p class="atlas-country-note">${esc(choice.continent)} · View-only geographic reference.</p><button type="button" class="atlas-go is-small" data-country-show-outline ${state.state === 'loading-outline' ? 'disabled' : ''}>${state.state === 'loading-outline' ? 'Loading outline…' : state.state === 'outline-error' ? 'Try outline again' : state.outline ? 'Reload outline' : 'Show outline'}</button>`
      : catalogue ? '<p class="atlas-country-note">Choose a country to see whether a geographic outline is available.</p>' : '';
    const options = catalogue ? `<option value="" disabled ${state.selectedCountryId === null ? 'selected' : ''}>Choose a country</option>${[...catalogue.countries].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.countryId.localeCompare(b.countryId, 'en')).map((country) => `<option value="${esc(country.countryId)}" ${country.countryId === state.selectedCountryId ? 'selected' : ''}>${esc(country.name)}</option>`).join('')}` : '';
    const source = catalogue ? `<p class="atlas-country-source">${esc(catalogue.sourceLabel)}${safeSource ? ` · <a href="${esc(safeSource)}" target="_blank" rel="noopener noreferrer">Source</a>` : ''}</p><p class="atlas-country-note">${esc(catalogue.boundaryNote)}</p>` : '';
    const retry = state.state === 'catalogue-error' ? '<button type="button" class="atlas-chip" data-country-retry>Try again</button>' : '';
    panel.innerHTML = `<header><div><h2 id="atlas-country-title">Explore country outlines</h2><p>Geographic reference · gameplay access varies</p></div><button type="button" class="atlas-close" data-country-close aria-label="Close country outlines">×</button></header>
      ${catalogue ? `<label class="atlas-country-label" for="atlas-country-choice">Country</label><select id="atlas-country-choice" data-country-choice>${options}</select>` : ''}
      <p class="atlas-country-status" role="status" aria-live="polite" tabindex="-1">${esc(state.message || (state.state === 'loading-catalogue' ? 'Loading country list…' : ''))}</p>
      ${choiceBody}${retry}${outline}${source}`;
    if (wasFocused) {
      const next = focusChoice ? panel.querySelector<HTMLElement>('[data-country-choice]')
        : focusClose ? panel.querySelector<HTMLElement>('[data-country-close]')
          : focusStatus ? panel.querySelector<HTMLElement>('[role="status"]') : null;
      next?.focus({ preventScroll: true });
    }
  }
  function isDetailProtected(choice: { status: string; atlasId: string | null; countryId: string }): boolean {
    return choice.status === 'protected' || choice.atlasId === 'ng' || choice.countryId === 'legacy-ng';
  }
  countryDetailModel = new CountryDetailPanelModel(async () => {
    if (providedCountryDetail) return providedCountryDetail;
    const module = await import('./country-detail-data.ts');
    return module.createCountryDetailService();
  }, drawCountryPanel);
  function openCountries(atlasId: string | null = null) {
    countryPanelReturnFocus = ui.crumbs?.querySelector<HTMLElement>('[data-atlas-countries]') ?? null;
    void countryDetailModel?.open(atlasId).then(() => {
      if (countryDetailModel?.snapshot().open) ui['country-panel']?.querySelector<HTMLElement>('[data-country-close]')?.focus({ preventScroll: true });
    });
  }
  function closeCountries() {
    countryDetailModel?.close();
    (ui.crumbs?.querySelector<HTMLElement>('[data-atlas-countries]') ?? countryPanelReturnFocus)?.focus({ preventScroll: true });
    countryPanelReturnFocus = null;
  }
  function drawChrome() { drawCrumbs(); drawRail(); drawSheet(); drawHighlights(); }
  function drawCrumbs() {
    if (!ui.crumbs) return;
    const city = cityEntry(current);
    ui.crumbs.innerHTML = `<div class="level-menu" ${levelsOpen ? 'data-open' : ''}>
        <button type="button" class="level-menu-cur" data-atlas-levels data-tour="map-world" aria-expanded="${levelsOpen}" aria-controls="atlas-levels-list" aria-label="Map level: ${esc(ATLAS_LEVELS[level]!.name)}. Show World, Africa and Nigeria">${ICON(GLYPH.globe)}<span>${esc(ATLAS_LEVELS[level]!.name)}</span>${ICON('<path d="m6 9 6 6 6-6"/>')}</button>
        <ol id="atlas-levels-list">${ATLAS_LEVELS.map((entry, i) => `<li><button type="button" data-atlas-level="${i}" ${i === level ? 'aria-current="true"' : ''}>${i === WORLD ? ICON(GLYPH.globe) : ''}<span>${esc(entry.name)}</span></button></li>`).join('')}
          <li><button type="button" class="atlas-back-item" data-atlas-city="${esc(current)}">${esc(city?.name)} · back to the city</button></li></ol></div>
      <button type="button" class="atlas-back" data-atlas-city="${esc(current)}" aria-label="Back to ${esc(city?.name)}: open the city map">${esc(city?.name)}<span aria-hidden="true">Back to the city</span></button>
      <button type="button" class="atlas-countries" data-atlas-countries aria-expanded="${Boolean(countryDetailModel?.snapshot().open)}" aria-controls="atlas-country-panel">Countries</button>
      <button type="button" class="atlas-list-toggle" data-atlas-list aria-expanded="${listOpen}">${ICON('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>')}<span>Find a place</span></button>`;
    const fit = ui.controls!.querySelector<HTMLElement>('[data-atlas-fit]')!, layer = ui.controls!.querySelector<HTMLElement>('[data-atlas-layer]')!;
    fit.textContent = `Whole of ${level === WORLD ? 'the world' : ATLAS_LEVELS[level]!.name}`;
    layer.hidden = level === WORLD; layer.setAttribute('aria-pressed', String(tintOn));
    layer.querySelector('[data-atlas-layer-name]')!.textContent = level === NIGERIA ? 'Zones' : 'Regions';
    const groups = level === NIGERIA ? ZONES : level === AFRICA ? AFRICA_GROUPS : null;
    ui.legend!.hidden = !tintOn || !groups;
    ui.legend!.innerHTML = groups ? Object.values(groups).map((group) => `<span><i style="background:${group.tint}"></i>${esc(group.name)}</span>`).join('') : '';
    root!.dataset.level = ATLAS_LEVELS[level]!.id;
  }
  /** The rows of the list: every region of the level in view, open first. */
  function rows() {
    const sheet = sheets[level];
    if (!sheet) return [];
    return sheet.topology.features.map((feature) => infoOf({ kind: sheet.kind, id: feature.id, feature })).sort(listOrder);
  }
  function drawRail() {
    if (!ui.rail) return;
    const all = rows(), needle = query.trim().toLowerCase();
    const list = needle ? all.filter((item) => item.name.toLowerCase().includes(needle) || (item.capital || '').toLowerCase().includes(needle) || (item.city?.name || '').toLowerCase().includes(needle)) : all;
    const noun = level === NIGERIA ? 'states' : 'countries', openCount = all.filter((item) => item.status === 'open').length;
    const head = ui.rail.querySelector('.atlas-search');
    if (!head) {
      ui.rail.innerHTML = `<label class="atlas-search">${ICON('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>')}<span class="atlas-sr">Find a place</span><input type="search" autocomplete="off" spellcheck="false" data-atlas-search></label><p class="atlas-count" aria-live="polite"></p><ul class="atlas-list"></ul>`;
    }
    ui.rail.querySelector<HTMLInputElement>('[data-atlas-search]')!.placeholder = `Find in ${level === WORLD ? 'the world' : ATLAS_LEVELS[level]!.name}`;
    ui.rail.querySelector('.atlas-count')!.textContent = needle ? `${list.length} of ${all.length} ${noun}` : `${all.length} ${noun} · ${openCount} open · the rest coming soon`;
    ui.rail.querySelector('.atlas-list')!.innerHTML = list.length ? list.map((item) => `<li><button type="button" class="atlas-row is-${item.tone}${same(selected, item) ? ' is-selected' : ''}" data-atlas-pick="${esc(item.kind)}:${esc(item.id)}" aria-pressed="${same(selected, item)}"><i aria-hidden="true"></i><span><b>${esc(item.name)}</b><small>${esc(item.city && item.city.name !== item.name ? item.city.name : item.capital || item.type)}</small></span><em>${esc(item.tag)}</em></button></li>`).join('')
      : `<li class="atlas-none">Nothing called “${esc(query)}” at this level. Zoom out to look wider.</li>`;
    root!.classList.toggle('is-list', listOpen);
  }
  /** What the state view draws of the travel links: the links between open cities where one end is in this state, and the places outside it they leave for. */
  function stateLinks(inState: readonly { id: string }[]): OverviewExtras {
    const here = new Set(inState.map(city => city.id)), opens = (id: string) => cityEntry(id)?.status === 'playable';
    const links = allCityLinks().filter(link => (here.has(link.a) || here.has(link.b)) && opens(link.a) && opens(link.b) && link.mode !== 'air')
      .map(link => ({ id: linkId(link), a: link.a, b: link.b, mode: link.mode, label: link.label, fare: link.fare, minutes: Math.round((link.seconds / 60) * 10) / 10, km: link.km }));
    const outside = [...new Set(links.flatMap(link => [link.a, link.b]).filter(id => !here.has(id)))].flatMap(id => { const city = cityEntry(id); return city ? [{ id, name: city.name, lon: city.lon, lat: city.lat }] : []; });
    return { current, links, outside, link: overviewLink };
  }
  function drawSheet() {
    if (!ui.sheet) return;
    const hit = find(selected);
    ui.sheet.hidden = !hit;
    root!.classList.toggle('has-sheet', Boolean(hit));
    if (!hit) { ui.sheet.innerHTML = ''; root!.classList.remove('has-cities'); return; }
    const info = infoOf(hit);
    const stateCities = hit.kind === 'state' ? catalogueCitiesInState(hit.id).map(city => ({ id: city.id, name: city.name, status: city.open ? 'open' : 'soon', units: cityRules(city.id)?.units ?? [] })) : [];
    root!.classList.toggle('has-cities', stateCities.length > 1);
    const overviewCity = stateCities.find(city => cityModule(city.id)?.rules.hasStateOverview);
    const overview = stateOverviewShown === hit.id ? stateOverviews.get(hit.id) : undefined;
    const overviewBody = overview?.kind === 'ready' ? stateOverviewHtml(overview.data, stateCities.map(city => ({ ...city, ...(cityEntry(city.id) ? { at: { lon: cityEntry(city.id)!.lon, lat: cityEntry(city.id)!.lat } } : {}) })), info.city?.id ?? null, { units: overviewExpanded.has(`${hit.id}:units`), landmarks: overviewExpanded.has(`${hit.id}:landmarks`) }, stateLinks(stateCities)) : overview?.kind === 'loading' ? '<p role="status">Loading the state map…</p>' : overview?.kind === 'error' ? '<p role="alert">The state map could not be loaded. <button type="button" data-atlas-state-retry>Reload to try again</button></p>' : '';
    const guide = info.city ? cachedCityContent(info.city.id)?.thingsToDo.slice(0, 5) : undefined;
    const routeRow = (route: RouteInfo) => {
      const on = routeShown === route.id, playing = preview && routeShown === route.id;
      const link = allCityLinks().find(link => linkId(link) === route.id), previewable = link && Boolean(pathOf(link));
      return `<li class="${on ? 'is-on' : ''}"><button type="button" class="atlas-route" data-atlas-route="${esc(route.id)}" aria-pressed="${on}"><span class="atlas-route-mode" aria-hidden="true">${ICON(route.mode === 'air' ? GLYPH.plane : route.mode === 'rail' ? GLYPH.rail : GLYPH.bus)}</span><span><b>${esc(route.label)}</b><small>${route.status === 'coming' ? 'Coming soon · ' : ''}${naira(route.fare)} · about ${route.minutes} min · ${route.km} km · from ${esc(route.hub)}</small></span></button>
        ${on ? `<div class="atlas-route-more">${route.live ? `<button type="button" class="atlas-go is-small" data-atlas-travel="${esc(route.to)}:${esc(route.mode)}">Travel · ${naira(route.fare)}</button>${route.skip === undefined ? '' : `<small class="atlas-route-skip">${route.skip ? `or arrive at once for ${naira(route.skip)} more` : 'or arrive at once: your first skip is free'}</small>`}` : (debt() > 0 && /ride home/.test(route.why || '') ? debtHtml(debt(), wallet()) : `<p>${esc(route.why || '')}</p>`)}${previewable ? `<button type="button" class="atlas-chip" data-atlas-preview="${esc(route.id)}" ${playing ? 'disabled' : ''}>${playing ? 'Showing the journey…' : 'Preview the journey'}</button>` : '<p>Route preview unavailable.</p>'}</div>` : ''}</li>`;
    };
    // THE TRAVEL CARD: the ways to the chosen city as one button each, cheapest first. One tap leaves; a fare that is a
    // large part of the player's cash asks once, in place. A way that cannot leave says why under its button.
    const openHere = stateCities.filter(city => city.status === 'open'), cash = wallet();
    const choosing = openHere.length > 1 && !openHere.some(city => city.id === current) && !selectedCity;
    const offered = info.city && info.status === 'open' && info.tone !== 'here' && !choosing ? info.routes : [];
    const { shared, ways } = travelWays(offered, { cash, confirming });
    const wayRow = (way: TravelWay) => {
      const glyph = ICON(way.mode === 'air' ? GLYPH.plane : way.mode === 'rail' ? GLYPH.rail : GLYPH.bus);
      if (way.state === 'coming') return `<li><div class="atlas-way is-coming"><span class="atlas-way-mode" aria-hidden="true">${glyph}</span><b>${way.name}</b><span>Coming soon</span></div></li>`;
      if (way.state === 'ask') return `<li><div class="atlas-way-ask" role="group" aria-label="Confirm the fare"><p>${naira(way.fare)} is more than half of the ${naira(cash)} you have. Go by ${way.name.toLowerCase()}?</p><div><button type="button" class="atlas-go is-small" data-atlas-go="${esc(way.to)}:${esc(way.mode)}" data-atlas-sure>Pay ${naira(way.fare)} and go</button><button type="button" class="atlas-chip" data-atlas-cancel>Not now</button></div></div></li>`;
      return `<li><button type="button" class="atlas-way" data-atlas-go="${esc(way.to)}:${esc(way.mode)}" ${way.state === 'go' ? '' : 'disabled'} aria-label="${way.name} to ${esc(info.city!.name)}: ${naira(way.fare)}, ${way.seconds} seconds${way.why ? `. ${esc(way.why)}` : ''}"><span class="atlas-way-mode" aria-hidden="true">${glyph}</span><b>${way.name}</b><span>${naira(way.fare)}</span><span>${way.seconds} s</span></button>${way.why ? `<small class="atlas-way-why">${esc(way.why)}</small>` : ''}</li>`;
    };
    const owed = credit();
    const creditRow = owed && info.city && owed.to === info.city.id && ways.length
      ? `<li class="atlas-way-credit">${creditAsk
        ? `<div class="atlas-way-ask" role="group" aria-label="Confirm the ride on credit"><p>${naira(owed.fare)} is advanced for the ticket and you owe it: it comes out of what you earn. No skipping the trip.</p><div><button type="button" class="atlas-go is-small" data-atlas-credit="${esc(owed.to)}:${esc(owed.mode)}" data-atlas-sure>Ride home on credit</button><button type="button" class="atlas-chip" data-atlas-cancel>Not now</button></div></div>`
        : `<button type="button" class="atlas-way" data-atlas-credit="${esc(owed.to)}:${esc(owed.mode)}"><span class="atlas-way-mode" aria-hidden="true">${ICON(GLYPH.bus)}</span><b>Ride home on credit</b><span>${naira(owed.fare)} owed</span></button>`}</li>` : '';
    const owing = debt(), debtRow = debtHtml(owing, cash);
    const travelCard = ways.length ? `<section class="atlas-travel" aria-label="Travel to ${esc(info.city!.name)}"><h3>Go to ${esc(info.city!.name)}</h3>${debtRow}${shared && !owing ? `<p class="atlas-way-why" role="status">${esc(shared)}</p>` : ''}<ul>${ways.map(wayRow).join('')}${creditRow}</ul></section>`
      : choosing ? `<p class="atlas-travel atlas-way-why">${esc(info.name)} has ${openHere.length} open cities. Choose one to go there.</p>` : '';
    const more = Boolean(overviewCity || info.preview || info.routes.length || info.soon.length || info.planned || info.wait || guide?.length);
    ui.sheet.className = `atlas-sheet is-${info.tone}${sheetOpen ? ' is-expanded' : ''}`;
    ui.sheet.setAttribute('aria-label', `${info.name}: ${info.tag}`);
    // An open city is the thing chosen: the card is named after it, with its state beneath.
    const cityTitle = info.city && info.status === 'open' && !choosing && info.city.name !== info.name ? info.city.name : null;
    ui.sheet.innerHTML = `<header><div><h2>${esc(cityTitle ?? info.name)}</h2><p>${cityTitle ? `${esc(info.name)} · ${esc(info.type.replace(/^(State|Territory) · /, ''))}` : `${esc(info.type)}${info.capital ? ` · capital ${esc(info.capital)}` : ''}`}</p></div><span class="atlas-tag">${esc(info.tag)}</span><button type="button" class="atlas-close" data-atlas-close aria-label="Close ${esc(info.name)}">${ICON('<path d="M6 6l12 12M18 6 6 18"/>')}</button></header>
      ${stateCities.length > 1 ? `<nav aria-label="Cities in this state">${stateCities.map(city => `<button type="button" data-atlas-inspect-city="${esc(city.id)}" aria-pressed="${city.id === info.city?.id}">${esc(city.name)}</button>`).join('')}</nav>` : ''}
      ${overviewCity ? `${stateOverviewToggleHtml(hit.id, overviewCity.id, stateOverviewShown === hit.id)}${overviewBody}` : ''}
      <p class="atlas-teaser">${esc(choosing ? regionEntry('state', hit.id).teaser || info.teaser : info.teaser)}</p>
      ${hit.kind === 'country' && hit.id !== 'ng' ? '<button type="button" class="atlas-chip atlas-country-cta" data-country-open="' + esc(hit.id) + '">Geographic detail</button>' : ''}
      ${travelCard}
      ${info.action ? `<button type="button" class="atlas-go" data-atlas-action>${esc(info.action.label)}<span aria-hidden="true"> →</span></button>` : ''}
      ${more ? `<button type="button" class="atlas-more" data-atlas-expand aria-expanded="${sheetOpen}">${sheetOpen ? 'Less' : guide?.length && info.city ? `Things to do in ${esc(info.city.name)}` : info.routes.length ? 'Routes and details' : 'More'}</button>` : ''}
      ${guide?.length ? `<section class="atlas-guide"><h3>Things to do in ${esc(info.city!.name)}</h3><ul>${guide.map(place => `<li><b>${esc(place.name)}</b> · ${esc(place.line)}</li>`).join('')}</ul></section>` : ''}
      ${info.preview ? `<div class="atlas-preview"><h3>${esc(info.city!.name)} will have</h3><ul>${info.preview.map((line) => `<li>${esc(line)}</li>`).join('')}</ul></div>` : ''}
      ${info.wait ? `<p class="atlas-waitline">${esc(info.wait)}</p>` : ''}
      ${info.planned ? `<p class="atlas-planned">${ICON(GLYPH.plane)}<span>${esc(info.planned)}</span></p>` : ''}
      ${info.routes.length ? `<div class="atlas-routes"><h3>${info.status === 'open' ? `Routes from ${esc(info.routesFrom)}` : `Getting there from ${esc(info.routesFrom)}`}</h3><ul>${info.routes.map(routeRow).join('')}</ul><p class="atlas-waitline">You stay one person: your money, skills, friends and look travel with you, and your house here stays yours.</p></div>` : ''}
      ${info.soon.length ? `<div class="atlas-routes atlas-soon"><h3>Opening soon</h3><p class="atlas-waitline">${info.soon.map((name) => esc(name)).join(' · ')}. Fares and times are shown the day they open.</p></div>` : ''}`;
  }

  const chipNode = () => ui.crumbs?.querySelector<HTMLElement>('[data-atlas-levels]');
  const levelItems = () => [...(ui.crumbs?.querySelectorAll<HTMLElement>('.level-menu ol button') ?? [])];
  /** Close the level list; `refocus` hands focus back to the chip. */
  function closeLevels(refocus: boolean) {
    if (!levelsOpen) return;
    levelsOpen = false; drawCrumbs();
    if (refocus) chipNode()?.focus();
  }
  /** Focus the list item `step` away from the one in focus (the chip counts as before the first); Home and End use a step of ±Infinity. */
  function moveLevels(step: number) {
    const items = levelItems(), at = items.indexOf(doc!.activeElement as HTMLElement);
    items[clamp(step === 0 ? Math.max(0, items.findIndex((item) => item.hasAttribute('aria-current'))) : at + step, 0, items.length - 1)]?.focus();
  }
  function onMenuKey(event: KeyboardEvent) {
    if (!ui.crumbs?.contains(event.target as Node)) return;
    if (event.key === 'Escape' && levelsOpen) { event.preventDefault(); event.stopPropagation(); closeLevels(true); return; }
    const step = { ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity }[event.key];
    if (step === undefined || !(event.target as Element).closest('.level-menu')) return;
    event.preventDefault();
    if (!levelsOpen) { levelsOpen = true; drawCrumbs(); moveLevels(0); } else moveLevels(step);
  }
  const onAway = (event: Event) => { if (levelsOpen && !(event.target as Element).closest?.('.level-menu')) closeLevels(false); };
  /** Choose a region (or nothing). `from`: 'map' | 'list' | 'key' — the list and the keyboard move focus to the sheet. */
  function select(ref: RegionRef | null, { from = 'map', flyTo = false }: SelectOptions = {}): boolean {
    const hit = find(ref);
    if (!same(hit, selected)) { countryDetailModel?.mapSelectionChanged(); sheetOpen = false; selectedCity = null; overviewLink = null; confirming = null; creditAsk = false; }
    if (preview && reducedMotion) preview = null; // the still preview lasts until something else is chosen
    selected = hit ? { kind: hit.kind, id: hit.id } : null;
    const city = hit ? infoOf(hit).city : null;
    // A state with several open cities opens on its own map (the state view); the cities' text waits for the card.
    if (hit?.kind === 'state' && catalogueCitiesInState(hit.id).filter(item => item.open).length > 1 && stateOverviewShown !== hit.id) void showStateOverview(hit.id, false);
    if (city && isOpenCityId(city.id) && !cachedCityContent(city.id)) void loadCityContent(city.id).then(() => { if (selected?.id === hit?.id) drawSheet(); }, () => {});
    if (!preview && !trip) routeShown = null;
    const inside = hit?.kind === 'country' ? ATLAS_LEVELS.findIndex((entry) => entry.id === regionEntry('country', hit.id).level) : -1;
    const back = !hit && doc && ui.sheet?.contains(doc.activeElement);
    // A state with several open cities, picked on the map: go closer, so each of its cities can be tapped.
    const several = hit?.kind === 'state' && !flyTo && from === 'map' && fits && catalogueCitiesInState(hit.id).filter(item => item.open).length > 1 && rig.view.distance > viewOf(hit.feature).distance * 1.15;
    if (hit && (flyTo || several)) { if (inside > 0) goLevel(inside); else fly(viewOf(hit.feature)); }
    if (hit && from === 'list') listOpen = false;
    drawCrumbs(); drawRail(); drawSheet(); drawHighlights(); request();
    // The list and the keyboard move focus to the sheet; closing it hands focus back to the breadcrumb.
    if (hit && from !== 'map') ui.sheet?.focus?.({ preventScroll: true });
    else if (back) ui.crumbs!.querySelector<HTMLElement>('[data-atlas-levels]')?.focus();
    return Boolean(hit);
  }
  /** The open city whose dot is within a finger of a point of the canvas, at the level that shows cities; the nearest, or null. */
  function cityNear(point: Point): string | null {
    if (level !== NIGERIA || !sheets[NIGERIA] || markerDetail() !== 'cities') return null;
    const sheet = sheets[NIGERIA], targets: CityTarget[] = [];
    for (const feature of sheet.topology.features) for (const city of catalogueCitiesInState(feature.id)) {
      if (!city.open) continue;
      const where = at(city.lon, city.lat, sheet.top(feature) + 0.02);
      if (!where.behind) targets.push({ id: city.id, x: where.x, y: where.y, state: feature.id, label: lastPlaced.get(`city:${city.id}`) ?? null });
    }
    return cityHit(point, targets, { stateUnder: pickAt(point.x, point.y)?.id ?? null });
  }
  /** Open a city's card: select its state and, in a state with several cities, choose that one. */
  function selectCity(id: string): boolean {
    const state = stateOfCity(id);
    if (!state || !select({ kind: 'state', id: state }, { from: 'map' })) return false;
    selectedCity = id; confirming = null;
    if (isOpenCityId(id) && !cachedCityContent(id)) void loadCityContent(id).then(() => { if (selectedCity === id) drawSheet(); }, () => {});
    drawSheet();
    return true;
  }
  /** Asked for before the map has been measured (it is not on screen yet): gone to when it is. */
  let pendingLevel: number | null = null;
  function goLevel(index: number) {
    const next = clamp(index, WORLD, NIGERIA);
    void ensure(next);
    if (!fits) { pendingLevel = next; return; }
    pendingLevel = null;
    // Further out than the cities, the card of the player's own state would only cover the map it was asked to show.
    if (next !== NIGERIA && selected?.kind === 'state') select(null);
    fly(levelView(next), 0.9);
  }
  /** Fly down into the open city, then hand over to the city map. */
  function enterCity(id: string) {
    countryDetailModel?.close();
    const state = stateOfCity(id), hit = state ? find({ kind: 'state', id: state }) : null, city = cityEntry(id);
    const done = () => { root?.classList.remove('is-entering'); resetView = true; if (id === current) onOpenCity(id); else onEnterCity(id); };
    if (!hit || !city || reducedMotion || !raf || !shown()) { done(); return; }
    const [x, y] = project(city.lon, city.lat);
    root?.classList.add('is-entering');
    rig.ease({ x, z: -y, distance: minDistance() * 0.8, pitch: 0.95, yaw: 0 }, 0.85);
    entering = done; request();
  }
  function act() {
    const hit = find(selected), action = hit && infoOf(hit).action;
    if (!action) return;
    if (action.kind === 'zoom') goLevel(ATLAS_LEVELS.findIndex((entry) => entry.id === action.level));
    else enterCity(action.city!);
  }
  function setTint(on: boolean) { tintOn = on; for (const sheet of sheets) sheet?.paint.forEach((paint) => paint()); drawCrumbs(); request(); }

  // ---- size and layout ---------------------------------------------------------------------------------
  function layout() {
    if (!size.width) return;
    insets = { left: 0, top: 0, right: 0, bottom: 0 };
    if (ui.stage) { const page = root!.getBoundingClientRect(), box = ui.stage.getBoundingClientRect(); if (box.width > 40 && box.height > 40) insets = { left: box.left - page.left, top: box.top - page.top, right: page.right - box.right, bottom: page.bottom - box.bottom }; }
    measuring();
    rig.setViewport(size.width, size.height, insets);
    computeFits();
  }
  function resize() {
    if (destroyed) return;
    const rect = container.getBoundingClientRect(), visible = !container.hidden && rect.width > 0;
    size = visible ? { width: rect.width, height: rect.height } : { width: 0, height: 0 };
    if (!visible) { wasShown = false; stop(); return; }
    renderer.setPixelRatio?.(Math.min(globalThis.devicePixelRatio || 1, size.width <= 720 ? 1.75 : 2));
    renderer.setSize?.(size.width, size.height, false);
    layout(); syncResolution();
    if (!opened || (resetView && !wasShown)) { opened = true; resetView = false; rig.jump(levelView(NIGERIA)); selected = stateOfCity(current) ? { kind: 'state', id: stateOfCity(current)! } : null; routeShown = null; drawChrome(); layout(); rig.jump(levelView(NIGERIA)); }
    else if (!rig.moving) rig.jump({ distance: clamp(rig.view.distance, minDistance(), maxDistance()) });
    wasShown = true;
    settleLevel(); request();
    if (pendingLevel !== null) goLevel(pendingLevel);
  }

  // ---- input -------------------------------------------------------------------------------------------
  const pointers = new Map<number, Point>();
  let gesture: Gesture | null = null, lastTap = { t: -1e9, x: 0, y: 0 };
  const flick = createFlick();
  // A flick is timed by the moments the pointer reported, so a slow frame between them does not turn a fast flick into a stop.
  const stampOf = (event: Event) => (Number.isFinite(event.timeStamp) ? event.timeStamp : now());
  const local = (event: MouseEvent): Point => { const page = container.getBoundingClientRect(); return { x: event.clientX - page.left, y: event.clientY - page.top }; };
  const ndc = (point: Point): [number, number] => [(point.x / size.width) * 2 - 1, 1 - (point.y / size.height) * 2];
  const ground = (point: Point) => { const [nx, ny] = ndc(point); return rig.groundAt(nx, ny); };
  const middle = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  /**
   * The map is NORTH-UP at every level, so there is no rotation and no compass. A country, a continent and the world are each one
   * flat sheet drawn from above: turning it changes none of what is on it, would put every name at an angle to the page, and would
   * make the level frames (which are measured north-up) wrong. Every button, and one finger, drags the ground; two fingers pinch
   * and travel; a twist does nothing. The tilt follows the zoom (pitchAt), not the pointer.
   */
  function onDown(event: PointerEvent) {
    if (entering) return;
    if (event.pointerType === 'mouse' && event.button > 2) return;
    if (event.button === 1) event.preventDefault();
    keyboard = false; root!.classList.remove('is-keys');
    if (event.isPrimary) { pointers.clear(); rig.endDrag(); }
    const point = local(event);
    pointers.set(event.pointerId, point);
    canvas.setPointerCapture?.(event.pointerId);
    rig.hold();
    if (pointers.size === 1) {
      flick.clear();
      gesture = { kind: 'pan', id: event.pointerId, moved: false, from: point, last: point, down: now(), type: event.pointerType, grab: fits ? ground(point) : null, span: 1, mid: point };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [Point, Point];
      gesture = { kind: 'pinch', id: event.pointerId, moved: true, from: a, last: a, down: now(), type: event.pointerType, grab: null, span: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: middle(a, b) };
      rig.beginDrag(); root!.classList.add('is-dragging'); setHover(null);
    }
  }
  function onMove(event: PointerEvent) {
    const point = local(event);
    if (!pointers.has(event.pointerId)) { if (event.pointerType === 'mouse') hover(point); return; }
    pointers.set(event.pointerId, point);
    if (!gesture || !fits) return;
    if (gesture.kind === 'pinch' && pointers.size >= 2) {
      // Two fingers: the pinch zooms about the middle, and the ground between the fingers stays between them as they travel.
      const [a, b] = [...pointers.values()] as [Point, Point], span = Math.hypot(a.x - b.x, a.y - b.y) || 1, mid = middle(a, b);
      const held = ground(gesture.mid), to = ndc(mid);
      zoomBy(gesture.span / span, ...ndc(gesture.mid));
      if (!held || !rig.dragTo(held, to[0], to[1])) rig.panScreen(mid.x - gesture.mid.x, mid.y - gesture.mid.y);
      gesture.span = span; gesture.mid = mid;
      moved();
      return;
    }
    if (gesture.kind === 'pinch' || gesture.id !== event.pointerId) return;
    const dx = point.x - gesture.last.x, dy = point.y - gesture.last.y;
    if (!gesture.moved && !isDrag(Math.hypot(point.x - gesture.from.x, point.y - gesture.from.y), gesture.type)) return;
    if (!gesture.moved) { gesture.moved = true; rig.beginDrag(); root!.classList.add('is-dragging'); setHover(null); }
    gesture.last = point;
    // The ground under the pointer when it went down stays under it.
    const [nx, ny] = ndc(point);
    if (!gesture.grab || !rig.dragTo(gesture.grab, nx, ny)) rig.panScreen(dx, dy);
    flick.push(rig.view.x, rig.view.z, stampOf(event));
    moved();
  }
  function onUp(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return;
    const point = local(event), was = gesture, cancelled = event.type === 'pointercancel';
    pointers.delete(event.pointerId);
    if (was?.kind === 'pinch') {
      const rest = [...pointers.entries()][0];
      // One finger stays down: it carries on as a drag from where it is, and nothing glides from a pinch.
      if (rest) { gesture = { kind: 'pan', id: rest[0], moved: true, from: rest[1], last: rest[1], down: now(), type: 'touch', grab: ground(rest[1]), span: 1, mid: rest[1] }; flick.clear(); }
      else { gesture = null; rig.endDrag(); root!.classList.remove('is-dragging'); moved(); }
      return;
    }
    if (!was || was.id !== event.pointerId) return;
    gesture = null;
    root!.classList.remove('is-dragging');
    if (was.moved) {
      // A flick glides on; a drag that had stopped before the finger lifted does not, and nothing glides for a player who asked for less motion.
      rig.endDrag(!reducedMotion && !cancelled ? flick.velocity(stampOf(event)) : null);
      moved();
      return;
    }
    // Only a quick press that stayed put is a tap: one held for too long selects nothing.
    if (cancelled || !isTap(0, now() - was.down, was.type)) return;
    const t = now(), double = t - lastTap.t < DOUBLE_MS && Math.hypot(point.x - lastTap.x, point.y - lastTap.y) < 28;
    lastTap = double ? { t: -1e9, x: 0, y: 0 } : { t, x: point.x, y: point.y };
    const hit = pickAt(point.x, point.y);
    // A tap on (or beside) an open city's dot is a tap on that city, whichever state's ground is under the finger.
    const town = double ? null : cityNear(point);
    if (town) { selectCity(town); return; }
    // A tap on an open country from further out goes straight in to its cities: there is nothing else to do with it.
    const into = !double && hit?.kind === 'country' && regionEntry('country', hit.id).status === 'open' ? ATLAS_LEVELS.findIndex((entry) => entry.id === regionEntry('country', hit.id).level) : -1;
    if (into > level) { select(null); goLevel(into); return; }
    if (double) {
      // Twice on a region: go to it. Twice on open water: just closer.
      if (hit) { selected = { kind: hit.kind, id: hit.id }; select(selected, { flyTo: true }); }
      else { const spot = ground(point); if (spot) fly({ x: spot.x, z: spot.z, distance: rig.view.distance * 0.5, yaw: 0 }, 0.45); }
      return;
    }
    select(hit, { from: 'map' });
  }
  function setHover(hit: Hit | null) {
    const next = hit ? { kind: hit.kind, id: hit.id } : null;
    if (same(next, hovered)) return;
    hovered = next;
    if (root) { root.classList.toggle('is-over', Boolean(next)); canvas.title = hit ? `${hit.feature.name} · ${infoOf(hit).tag}` : ''; }
    drawHighlights(); request();
  }
  const hover = (point: Point) => { if (!gesture && fits) setHover(pickAt(point.x, point.y)); };
  function onWheel(event: WheelEvent) {
    event.preventDefault();
    if (entering || !fits) return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? 320 : 1);
    rig.hold();
    // A trackpad pinch arrives as a wheel with Ctrl held, in much smaller steps.
    zoomBy(Math.exp(clamp(delta, -240, 240) * (event.ctrlKey ? 0.01 : 0.0016)), ...ndc(local(event)));
  }
  function onClick(event: MouseEvent) {
    const hit = (name: string) => (event.target as Element).closest?.<HTMLElement>(`[data-atlas-${name}]`);
    const detailHit = (name: string) => (event.target as Element).closest?.<HTMLElement>(`[data-country-${name}]`);
    const countryOpen = detailHit('open'), countryClose = detailHit('close'), countryOutline = detailHit('show-outline'), countryRetry = detailHit('retry'), viewNigeria = detailHit('view-nigeria'), countries = hit('countries');
    if (countryOpen) { openCountries(countryOpen.dataset.countryOpen ?? null); return; }
    if (countryClose) { closeCountries(); return; }
    if (countries) { if (countryDetailModel?.snapshot().open) closeCountries(); else openCountries(); return; }
    if (countryOutline) { void countryDetailModel?.showOutline(); return; }
    if (countryRetry) { countryDetailModel?.retry(); return; }
    if (viewNigeria) { closeCountries(); goLevel(NIGERIA); return; }
    const friendOpen = hit('fb'), friendAct = hit('fact'), friendGo = hit('fgo');
    if (friendOpen || friendAct || friendGo || hit('fclose')) {
      if (friendAct) onFriend(friendAct.dataset.atlasFact as 'chat' | 'call' | 'ping', friendAct.dataset.id ?? '', friendAct.dataset.name ?? '');
      else if (friendGo) { friendsOpen = null; drawFriendsPanel(); selectCity(friendGo.dataset.atlasFgo ?? ''); }
      else if (friendOpen) { const key = friendOpen.dataset.atlasFb ?? null; friendsOpen = friendsOpen === key ? null : key; drawFriendsPanel(); }
      else { friendsOpen = null; drawFriendsPanel(); }
      return;
    }
    const levels = hit('levels'), lvl = hit('level'), city = hit('city'), pick = hit('pick'), zoom = hit('zoom'), route = hit('route'), play = hit('preview'), go = hit('travel'), leave = hit('go'), onCredit = hit('credit'), repay = hit('repay'), help = hit('help')
    const inspectCity = hit('inspect-city'), overviewButton = hit('state-overview'), overviewSection = hit('overview-section'), stateLink = hit('state-link'), departure = hit('departure');
    if (departure && stateOverviewShown) {
      const overview = stateOverviews.get(stateOverviewShown);
      const target = overview?.kind === 'ready' ? overview.data.landmarks?.find(item => item.id === departure.dataset.atlasDeparture)?.departure : undefined;
      if (target && target.cityId === current) onInspectVenue(target.cityId, target.venueId);
    }
    else if (stateLink) { const id = stateLink.dataset.atlasStateLink ?? null; overviewLink = overviewLink === id ? null : id; drawSheet(); }
    else if (inspectCity) { overviewLink = null; confirming = null; selectedCity = inspectCity.dataset.atlasInspectCity ?? null; if (selectedCity && isOpenCityId(selectedCity)) void loadCityContent(selectedCity).then(drawSheet, () => {}); drawSheet(); }
    else if (overviewSection && stateOverviewShown) { const key = `${stateOverviewShown}:${overviewSection.dataset.atlasOverviewSection}`; if (overviewExpanded.has(key)) overviewExpanded.delete(key); else overviewExpanded.add(key); }
    else if (overviewButton) { const id = overviewButton.dataset.atlasStateOverview; if (id) { if (stateOverviewShown === id) { stateOverviewShown = null; drawSheet(); } else void showStateOverview(id); } }
    else if (hit('state-retry')) doc?.defaultView?.location.reload();
    // Choosing a level from the bar is choosing the map: the list of places, if it was open, gets out of the way.
    else if (levels) { levelsOpen = !levelsOpen; drawCrumbs(); if (levelsOpen && event.detail === 0) moveLevels(0); else if (!levelsOpen) chipNode()?.focus(); }
    else if (lvl) { levelsOpen = false; listOpen = false; drawCrumbs(); drawRail(); goLevel(Number(lvl.dataset.atlasLevel)); if (event.detail === 0) chipNode()?.focus(); }
    else if (city) { levelsOpen = false; enterCity(city.dataset.atlasCity!); }
    else if (pick) { const [kind, id] = pick.dataset.atlasPick!.split(':'); select({ kind: kind as RegionKind, id: id! }, { from: 'list', flyTo: true }); }
    else if (zoom) { const how = zoom.dataset.atlasZoom; if (how === 'fit') fly(levelView(level)); else fly({ distance: rig.view.distance * (how === 'in' ? 0.6 : 1 / 0.6), x: rig.view.x, z: rig.view.z, yaw: rig.view.yaw }, 0.3); }
    else if (hit('layer')) setTint(!tintOn);
    else if (hit('action')) act();
    else if (hit('close')) select(null);
    else if (hit('expand')) { sheetOpen = !sheetOpen; drawSheet(); ui.sheet!.querySelector<HTMLElement>('[data-atlas-expand]')?.focus({ preventScroll: true }); }
    else if (hit('list')) { listOpen = !listOpen; drawCrumbs(); drawRail(); if (listOpen) ui.rail!.querySelector<HTMLElement>('[data-atlas-search]')?.focus(); }
    else if (hit('retry')) { failed = ''; void ensure(wanted); showWait(); }
    else if (play) previewTrip(play.dataset.atlasPreview!);
    else if (go) { const [to, mode] = go.dataset.atlasTravel!.split(':'); onTravel(to!, mode!); }
    else if (repay) { void Promise.resolve(onRepay()).then(drawSheet, drawSheet); }
    else if (help) onHelp();
    else if (onCredit) {
      const [to, mode] = onCredit.dataset.atlasCredit!.split(':');
      if (!('atlasSure' in onCredit.dataset)) { creditAsk = true; drawSheet(); ui.sheet!.querySelector<HTMLElement>('[data-atlas-sure]')?.focus({ preventScroll: true }); }
      else { creditAsk = false; onTravel(to!, mode!, true); }
    }
    else if (hit('cancel')) { confirming = null; creditAsk = false; drawSheet(); }
    else if (leave) {
      const [to, mode] = leave.dataset.atlasGo!.split(':'), link = allCityLinks().find(item => ((item.a === current && item.b === to) || (item.b === current && item.a === to)) && item.mode === mode), cash = wallet();
      // An ordinary fare leaves at once. One that takes more than TRAVEL_CONFIRM_SHARE of the cash in hand asks once, in place.
      if (link && needsConfirm(link.fare, cash) && !('atlasSure' in leave.dataset)) { confirming = linkKey(link); drawSheet(); ui.sheet!.querySelector<HTMLElement>('[data-atlas-sure]')?.focus({ preventScroll: true }); }
      else { confirming = null; onTravel(to!, mode!); }
    }
    else if (route) { const id = route.dataset.atlasRoute!; if (!preview && !trip) { routeShown = routeShown === id ? null : id; drawSheet(); drawHighlights(); request(); ui.sheet!.querySelector<HTMLElement>(`[data-atlas-route="${CSS.escape(id)}"]`)?.focus(); } }
  }
  function onCountryChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    if (target.matches('[data-country-choice]')) countryDetailModel?.choose(target.value);
  }
  const onInput = (event: Event) => { const target = event.target as HTMLInputElement; if (target.matches?.('[data-atlas-search]')) { query = target.value; drawRail(); } };
  /** The shell's keys: arrows pan, + and − zoom, 0 fits the level, Enter chooses what is under the crosshair. */
  function onKey(event: Event) {
    const { action, mode }: KeyDetail = (event as CustomEvent<KeyDetail | undefined>).detail || {};
    if (mode !== 'map' || !shown() || !fits || entering) return;
    const step = rig.view.distance * 0.14, pan = ({ 'move-left': [-step, 0], 'move-right': [step, 0], 'move-up': [0, -step], 'move-down': [0, step] } as Record<string, [number, number] | undefined>)[action!];
    if (pan || action === 'place') { keyboard = true; root?.classList.add('is-keys'); }
    if (pan) fly({ x: rig.view.x + pan[0], z: rig.view.z + pan[1], distance: rig.view.distance, yaw: rig.view.yaw }, 0.18);
    else if (action === 'zoom-in' || action === 'zoom-out') fly({ x: rig.view.x, z: rig.view.z, distance: rig.view.distance * (action === 'zoom-in' ? 0.7 : 1 / 0.7), yaw: rig.view.yaw }, 0.25);
    else if (action === 'zoom-fit') fly(levelView(level));
    else if (action === 'place') { const [lon, lat] = centre(); select(pickLonLat(lon, lat), { from: 'key' }); }
  }
  /** Esc, offered by the Map panel: close what is open, then go up one level. Says whether it did anything. */
  function onEscape(event: Event) {
    if (!shown() || !fits) return;
    if (countryDetailModel?.snapshot().open) closeCountries();
    else if (levelsOpen) closeLevels(true);
    else if (listOpen) { listOpen = false; drawCrumbs(); drawRail(); }
    else if (preview) { preview = null; routeShown = null; drawSheet(); drawHighlights(); request(); }
    else if (selected) select(null);
    else if (level > WORLD) goLevel(level - 1);
    else return;
    event.preventDefault();
  }
  const onContextMenu = (event: Event) => event.preventDefault();
  const watcher = doc && globalThis.MutationObserver ? new MutationObserver(() => resize()) : null;
  if (doc) {
    canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', () => setHover(null));
    canvas.addEventListener('wheel', onWheel, { passive: false }); canvas.addEventListener('contextmenu', onContextMenu);
    root!.addEventListener('click', onClick); root!.addEventListener('keydown', onMenuKey); doc.addEventListener('pointerdown', onAway); root!.addEventListener('input', onInput); root!.addEventListener('change', onCountryChange);
    window.addEventListener('jaw:key', onKey); window.addEventListener('jaw:atlas-escape', onEscape);
    watcher?.observe(container, { attributes: true, attributeFilter: ['hidden'] });
  }

  const ready = ensure(NIGERIA).then(() => { void ensure(WORLD); return true; });
  drawCrumbs?.();

  return {
    ready,
    /** The city the player is in: its state is "You are here" and the default selection. */
    setCity(id) { if (!cityEntry(id)) return; countryDetailModel?.close(); current = id; selected = stateOfCity(id) ? { kind: 'state', id: stateOfCity(id)! } : null; routeShown = null; resetView = true; drawChrome(); request(); },
    /** The life's state: a trip between cities is shown where the server's timer says it is. */
    setState(state) {
      const next = interCityTripOf(state);
      if (!next) { if (trip) { trip = null; clock.clear(); routeShown = null; drawHighlights(); request(); } return; }
      const link = allCityLinks().find((item) => ((item.a === next.from && item.b === next.to) || (item.a === next.to && item.b === next.from)) && item.mode === next.mode);
      if (!link) return;
      const fresh = clock.sync(next, now());
      if (fresh || !trip) { trip = startRun(link, next.from); preview = null; routeShown = linkId(link); confirming = null; if (selected) select(null); if (level !== NIGERIA && fits) goLevel(NIGERIA); drawHighlights(); }
      if (trip) trip.progress = clock.progress(now());
      request();
    },
    /** The held cities or the links may have changed. */
    refresh() { drawRail(); drawSheet(); },
    resize, goLevel, previewTrip, selectCity, setFriends, openFriends, openCountries, closeCountries,
    warm() { void ensure(WORLD).then(() => ensure(AFRICA)); },
    select: (ref, options) => select(ref, options),
    zoomBy: (factor) => { if (fits) zoomBy(factor); },
    /** Where a place is on screen (CSS pixels within the container), for tests and the screenshot harness. */
    screenOf(lon, lat) { const where = at(relLon(lon), lat, 0); return { x: where.x, y: where.y }; },
    pick: (lon, lat) => { const hit = pickLonLat(relLon(lon), lat); return hit ? { kind: hit.kind, id: hit.id, name: hit.feature.name } : null; },
    /** For tests and the report: what was drawn, and how much. */
    diagnostics() {
      const info: { triangles?: number; calls?: number } = renderer.info?.render || {};
      return { kind: 'atlas', renderCount, loop: Boolean(rafId), level, levelId: ATLAS_LEVELS[level]!.id, wanted, loading, loaded: ATLAS_LEVELS.filter((_, i) => sheets[i]).map((entry) => entry.id), fading: fading(),
        triangles: info.triangles ?? 0, calls: info.calls ?? 0, labels: lastLabels, reducedMotion, selected, hovered, routeShown, tint: tintOn,
        cityLabels: candidates().filter(label => label.id.startsWith('city:')).map(({ id, text, note }) => ({ id, text, note: note ?? null })), markers: markerDetail(),
        trip: trip || preview ? { progress: (trip || preview)!.progress, preview: Boolean(preview && !trip), mode: (trip || preview)!.path.mode } : null,
        view: { ...rig.view }, fits: fits ? distances() : null, cuts: [...cuts], layers: layers.map((entry) => entry.alpha) };
    },
    destroy() {
      destroyed = true; countryDetailModel?.destroy(); stop(); watcher?.disconnect();
      root?.removeEventListener('change', onCountryChange);
      if (doc) { window.removeEventListener('jaw:key', onKey); window.removeEventListener('jaw:atlas-escape', onEscape); doc.removeEventListener('pointerdown', onAway); root!.remove(); }
      for (const entry of layers) { entry.object.geometry.dispose(); for (const material of entry.materials) material.dispose(); }
      for (const object of [hoverMesh, selectMesh, selectLine, routeLine]) { object.geometry.dispose(); object.material.dispose(); }
      if (!providedRenderer) renderer.dispose();
    },
  };
}
