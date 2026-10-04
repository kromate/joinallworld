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
 * BATTERY RULE — NO FRAME LOOP WHILE IDLE. A frame is drawn when something asks for one. Another
 * is scheduled only while something moves: a camera ease, a level cross-fade, the fly-in to the
 * city, or a trip (the server's timer, or the preview). diagnostics().renderCount is the proof
 * (./atlas.test.js). `prefers-reduced-motion`: levels and views cut instead of flying, and a trip
 * is a marker moved when the server reports progress.
 */
import * as THREE from 'three';
import type { CityLink } from '../../types/index.ts';
import type { AfricaGroupId, Box4, RegionKind } from '../types.ts';
import { createRig } from '../camera.ts';
import type { RigInsets, RigView } from '../camera.ts';
import { createTripClock } from '../trip.ts';
import { AFRICA_GROUPS, ATLAS_LEVELS, CONTINENTS, ZONES, cityEntry, plannedRoutes, regionEntry, stateOfCity } from '../regions.ts';
import type { AtlasLevel } from '../regions.ts';
import { CITY_LINKS as RAW_CITY_LINKS } from '../../game/content/world.ts';
import { EXTENT, project, relLon, unproject } from './projection.ts';
import { decodeTopology } from './topo.ts';
import type { AfricaFeature, Feature, FeatureData, NigeriaFeature, Topology, WorldFeature } from './topo.ts';
import { createPicker } from './pick.ts';
import type { Picker } from './pick.ts';
import { focusLevel, levelAt, pitchAt, thresholds } from './levels.ts';
import { LABEL_CAP, placeLabels } from './labels.ts';
import type { LabelCandidate } from './labels.ts';
import { AIRPORTS, HIGHWAYS, TOWNS, flightPoint, interCityTripOf, liftOf, linkId, linkPath, measure, tripPoint } from './routes.ts';
import type { InterCitySource, LinkPath, MeasuredLine } from './routes.ts';
import { listOrder, regionInfo } from './info.ts';
import type { RegionContext, RegionInfo, RegionRef, RouteInfo } from './info.ts';
import { arcSegments, mesher, outerEdges } from './build.ts';
import type { RibbonLine } from './build.ts';

/** CITY_LINKS with the literal modes the data has ('road' | 'air'): the JavaScript module's inference widens them. */
const CITY_LINKS = RAW_CITY_LINKS as readonly CityLink[];

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
  onTravel?: (to: string, mode: string) => void;
  routes?: () => TripRoutes | null;
  held?: () => string[];
  renderer?: AtlasRenderer;
  raf?: (callback: () => void) => number;
  caf?: (handle: number) => void;
  now?: () => number;
  reducedMotion?: boolean;
  tabHidden?: () => boolean;
  /** Fetches a level's data module; the default imports it from the registry. */
  load?: (levelId: string) => Promise<LevelModule>;
}
/** A place the pointer or a reference names: what it is, which feature, and the sheet that holds it. */
export interface Hit { kind: RegionKind; id: string; feature: Feature; sheet: Sheet }

/** One thing on the map that fades with a level. */
type LayerObject = THREE.Mesh<THREE.BufferGeometry, THREE.Material> | THREE.Points<THREE.BufferGeometry, THREE.Material> | THREE.LineSegments<THREE.BufferGeometry, THREE.Material>;
interface Layer<O extends LayerObject = LayerObject> { object: O; levels: readonly number[]; alpha: number; extrude: boolean; opacity: number; materials: THREE.Material[] }
/** A level's decoded data, its picker and what it draws. `top` is the height of a feature's plate. */
interface Sheet<F extends FeatureData = FeatureData> {
  topology: Topology<F>; picker: Picker<F>; kind: RegionKind;
  top(feature: Feature): number;
  /** The feature never picked from this sheet (the country the level is about). */
  skip?: string | undefined;
}
/** A level's own sheet: it can repaint its plates (a tint layer was switched, a status changed). */
interface LevelSheet<F extends FeatureData = FeatureData> extends Sheet<F> { paint: (() => void)[] }
interface NigeriaSheet extends LevelSheet<NigeriaFeature> { dots: Layer<THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>>; around: Sheet }
/** What the country colours read of a world or Africa feature. */
type CountryData = FeatureData & { k?: string; sub?: AfricaGroupId };
type Sheets = [LevelSheet<WorldFeature> | null, LevelSheet<AfricaFeature> | null, NigeriaSheet | null];
interface Insets { left: number; top: number; right: number; bottom: number }
/** The trip being drawn: the line, who walks it from where, and how far (0…1). */
interface Run { path: LinkPath; line: MeasuredLine; from: string; progress: number }
interface Preview extends Run { start: number; seconds: number }
/** A pointer gesture: a pan or an orbit has `start` and `last`; a pinch has `span`, `mid` and `angle`. */
interface Gesture { kind: 'orbit' | 'pan' | 'pinch'; moved: boolean; start?: Point; last?: Point; span?: number; mid?: Point; angle?: number }
/** What the shell's `jaw:key` event carries. */
interface KeyDetail { action?: string; mode?: string }
interface Point { x: number; y: number }
type UiName = 'labels' | 'reticle' | 'marker' | 'crumbs' | 'rail' | 'stage' | 'wait' | 'controls' | 'legend' | 'sheet';
/** What diagnostics() reports. */
export interface AtlasDiagnostics {
  kind: 'atlas'; renderCount: number; loop: boolean; level: number; levelId: string; wanted: number; loading: string; loaded: string[]; fading: boolean;
  triangles: number; calls: number; labels: number; reducedMotion: boolean; selected: RegionRef | null; hovered: RegionRef | null; routeShown: string | null; tint: boolean;
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
  select(ref: RegionRef | null, options?: SelectOptions): boolean;
  zoomBy(factor: number): void;
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
const HEIGHT = { around: 0.03, state: 0.2, open: 0.42, country: 0.45, openCountry: 0.95 };
const INK = {
  base: ['#d9ddd6', '#d3d8d1', '#dee2dc'], none: '#e9ece7', around: '#d6dad3',
  soon: ['#c3c9c4', '#cbd0cb', '#bcc3be'], planned: '#d6ceb0', open: '#2fa866', openCountry: '#52b679',
  border: '#ffffff', edge: '#8c9a94', coast: '#86a9b8', shore: '#eefafd', water: '#62b3d4', road: '#8b7b66', air: '#4a6a9c', route: '#e8a643', glow: '#f3ffd0', select: '#20232c',
};
const MAJOR_CAPITALS = new Set(['Abuja', 'Cairo', 'Nairobi', 'Accra', 'Addis Ababa', 'Pretoria', 'Kinshasa', 'Dakar', 'Algiers', 'Rabat', 'Luanda', 'Khartoum', 'Dodoma', 'Kampala', 'Tunis', 'Tripoli', 'Antananarivo', 'Lusaka', 'Harare', 'Bamako', 'Niamey', "N'Djamena", 'Mogadishu', 'Windhoek', 'Maputo', 'Yaoundé', 'Abidjan', 'Yamoussoukro']);
const NEIGHBOUR_LABELS: [string, number, number][] = [['Benin', 2.15, 9.9], ['Niger', 8.6, 14.7], ['Chad', 15.9, 11.2], ['Cameroon', 12.5, 5.6]];
const WATER_LABELS: [string, number, number, 'sea' | 'river' | 'town'][] = [['Gulf of Guinea', 4.6, 3.55, 'sea'], ['Niger', 5.25, 9.72, 'river'], ['Benue', 9.7, 8.05, 'river'], ['Lake Chad', 14.2, 13.55, 'river'], ['Lokoja', 6.74, 7.8, 'town']];
const DRAG_START = 5, DOUBLE_MS = 340;
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }) as Record<string, string>)[c]!);
const naira = (value: unknown): string => `₦${Number(value).toLocaleString('en-NG')}`;
const ICON = (path: string): string => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const GLYPH = { bus: '<path d="M5 6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10H5zM5 11h14M8 16v2M16 16v2"/><circle cx="8.5" cy="14" r=".6"/><circle cx="15.5" cy="14" r=".6"/>', plane: '<path d="M21 15.5 13.5 11V5.2a1.5 1.5 0 0 0-3 0V11L3 15.5V17l7.5-2.2V19l-2 1.5V22l3.5-1 3.5 1v-1.5l-2-1.5v-4.2L21 17z"/>' };

export function createAtlas(container: HTMLElement, { onOpenCity = () => {}, onEnterCity = () => {}, onTravel = () => {}, routes = () => null, held = () => [],
  renderer: providedRenderer, raf = globalThis.requestAnimationFrame?.bind(globalThis), caf = globalThis.cancelAnimationFrame?.bind(globalThis), now = () => globalThis.performance.now(),
  reducedMotion = Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches), tabHidden, load = (levelId) => ATLAS_LEVELS.find((level) => level.id === levelId)!.data() }: AtlasOptions = {}): AtlasApi {
  const doc = typeof globalThis.document?.createElement === 'function' ? globalThis.document : null;
  const pageHidden = tabHidden || (() => Boolean(doc && doc.hidden));
  const renderer: AtlasRenderer = providedRenderer || new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, 0.1, 4000);
  const rig = createRig(THREE, camera, { minX: EXTENT.minX, maxX: EXTENT.maxX, minZ: -EXTENT.maxY, maxZ: -EXTENT.minY, minDistance: 0.4 });
  const mesh = mesher(THREE);
  const ribbonMaterials: THREE.ShaderMaterial[] = [], probe = new THREE.Vector3();
  const ribbonMaterial = (opacity = 1, lift = 0.0004) => { const material = mesh.ribbonMaterial(opacity); material.uniforms.lift!.value = lift; ribbonMaterials.push(material); return material; };
  const flatMaterial = () => new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });

  // ---- state ------------------------------------------------------------------------------------
  let current = 'lagos', destroyed = false, opened = false, wasShown = false, resetView = false;
  let level = NIGERIA, wanted = NIGERIA, tintOn = false, listOpen = false, sheetOpen = false, query = '';
  let selected: RegionRef | null = null, hovered: RegionRef | null = null;
  let routeShown: string | null = null, trip: Run | null = null, preview: Preview | null = null, entering: (() => void) | null = null, keyboard = false;
  let size = { width: 0, height: 0 }, insets: Insets = { left: 0, top: 0, right: 0, bottom: 0 }, fits: { x: number; z: number; distance: number }[] | null = null, cuts = [1, 1], lastLabels = 0, labelKey = '';
  let rafId = 0, renderCount = 0, lastTick = 0, loading = '', failed = '';
  const clock = createTripClock();
  /** One per level, filled when its data arrives: { topology, picker, layers… }. */
  const sheets: Sheets = [null, null, null], pending: (Promise<LevelSheet | null> | null)[] = [null, null, null];
  /** Everything that fades with a level: { object, levels, alpha, extrude, opacity, materials }. */
  const layers: Layer[] = [];
  const shown = () => !destroyed && !container.hidden && !pageHidden() && size.width > 0;

  // ---- DOM ----------------------------------------------------------------------------------------
  let root: HTMLElement | null = null;
  const ui: Partial<Record<UiName, HTMLElement | null>> = {};
  const labelNodes = new Map<string, HTMLElement>();
  if (doc) {
    root = doc.createElement('section');
    root.className = 'atlas'; root.setAttribute('aria-label', 'World map: the world, Africa and Nigeria. Lagos is open; everything else is coming soon.');
    root.innerHTML = `<div class="atlas-labels" aria-hidden="true"></div>
      <div class="atlas-marker" aria-hidden="true" hidden></div>
      <div class="atlas-frame">
        <nav class="atlas-crumbs" aria-label="Map level"></nav>
        <div class="atlas-rail" role="search" aria-label="Find a place on the map"></div>
        <div class="atlas-stage"><div class="atlas-reticle" aria-hidden="true"></div><p class="atlas-wait" role="status" aria-live="polite" hidden></p>
          <div class="atlas-controls" role="group" aria-label="Map view"></div><div class="atlas-legend" hidden></div></div>
        <aside class="atlas-sheet" tabindex="-1" aria-live="polite" hidden></aside>
      </div>`;
    root.prepend(canvas);
    canvas.classList?.add('atlas-canvas'); canvas.setAttribute?.('aria-hidden', 'true');
    container.appendChild(root);
    for (const name of ['labels', 'reticle', 'marker', 'crumbs', 'rail', 'stage', 'wait', 'controls', 'legend', 'sheet'] as const) ui[name] = root.querySelector(`.atlas-${name}`);
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
  const addLayer = <O extends LayerObject>(object: O, levels: readonly number[], { extrude = false, opacity = 1, materials = [object.material] }: { extrude?: boolean; opacity?: number; materials?: THREE.Material[] } = {}): Layer<O> => {
    const alpha = levels.includes(level) ? 1 : 0;
    object.visible = alpha > 0; scene.add(object);
    const entry: Layer<O> = { object, levels, alpha, extrude, opacity, materials };
    layers.push(entry); applyLayer(entry);
    return entry;
  };
  function applyLayer(entry: Layer) {
    entry.object.visible = entry.alpha > 0.004;
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
    const lakeMesh = mesh.plates(lakes, { height: () => y, colour: () => INK.water, walls: false });
    addLayer(new THREE.Mesh(lakeMesh.geometry, flatMaterial()), [NIGERIA], { extrude: true });
    // Roads and flights between cities, in one mesh.
    const seen = new Set(), roads = [];
    for (const road of HIGHWAYS) for (let i = 1; i < road.towns.length; i++) {
      const key = [road.towns[i - 1], road.towns[i]].sort().join('>');
      if (seen.has(key)) continue;
      seen.add(key); roads.push({ colour: INK.road, width: 1.8, points: [spot(...TOWNS[road.towns[i - 1]!]!, y + 0.004), spot(...TOWNS[road.towns[i]!]!, y + 0.004)] });
    }
    const flights = CITY_LINKS.filter((link) => link.mode === 'air').map((link) => ({ colour: INK.air, width: 1.3, points: pathPoints(linkPath(link, cityEntry), y + 0.01) }));
    addLayer(ribbonMesh([...rivers, ...roads, ...flights], 1, 3), [NIGERIA], { extrude: true });
    // The open state: a bright outline round its lifted plate.
    const open = topology.features.filter((feature) => statusOf('state', feature.id) === 'open');
    if (open.length) addLayer(ribbonMesh(open.flatMap((feature) => mesh.ringLines(feature, HEIGHT.open + 0.004, INK.glow, 1.8, { holes: false })), 1, 4), [NIGERIA], { extrude: true });
    // State capitals.
    const dots = new THREE.Points(mesh.dots(topology.features.map((feature) => { const at = spot(feature.cap[1], feature.cap[2], heightOf(feature) + 0.012); return { x: at[0], y: at[1], z: at[2], colour: '#39404b', size: 7 }; })), mesh.dotMaterial());
    dots.renderOrder = 6;
    const dotLayer = addLayer(dots, [NIGERIA], { extrude: true });
    return { topology, picker: createPicker(topology, { slack: 0.05 }), kind: 'state', top: heightOf, paint: [() => made.paint(stateColour)], dots: dotLayer,
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
      level = next; hovered = null;
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
  /** Zoom by a factor about a point of the screen (NDC), keeping the ground under it where it is. */
  function zoomBy(factor: number, nx: number | null = null, ny: number | null = null) {
    const distance = clamp(rig.view.distance * factor, minDistance(), maxDistance());
    const before = nx === null ? null : rig.groundAt(nx, ny!);
    // The turn a player gave the closest level unwinds on the way out: farther levels are always north-up.
    const near = fits![NIGERIA]!.distance, turn = distance <= near ? 1 : clamp((cuts[1]! - distance) / (cuts[1]! - near), 0, 1);
    rig.jump({ distance, pitch: pitchAt(distance, distances(), PITCHES), yaw: factor > 1 ? rig.view.yaw * turn : rig.view.yaw });
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
  const routePath = (id: string | null) => { const link = id ? CITY_LINKS.find((item) => linkId(item) === id) : null; return link ? linkPath(link, cityEntry) : null; };

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
    renderer.render(scene, camera);
    renderCount += 1;
    drawLabels(); drawMarker();
  }
  function syncResolution() {
    for (const material of ribbonMaterials) material.uniforms.resolution!.value.set(size.width, size.height);
    if (sheets[NIGERIA]?.dots) sheets[NIGERIA].dots.object.material.uniforms.ratio!.value = renderer.getPixelRatio?.() || 1;
  }

  // ---- labels ---------------------------------------------------------------------------------------
  function screenOf(x: number, y: number, z: number) { probe.set(x, y, z).project(camera); return { x: (probe.x * 0.5 + 0.5) * size.width, y: (0.5 - probe.y * 0.5) * size.height, behind: probe.z > 1 }; }
  const at = (lon: number, lat: number, y = 0) => { const [x, py] = project(lon, lat); return screenOf(x, y, -py); };
  /** How wide a feature's box is on screen. */
  function roomOf(feature: Feature, y: number) { const b = feature.bounds, a = at(b.minLon, (b.minLat + b.maxLat) / 2, y), c = at(b.maxLon, (b.minLat + b.maxLat) / 2, y); return Math.abs(c.x - a.x); }
  function candidates(): LabelCandidate[] {
    const out: LabelCandidate[] = [], here = stateOfCity(current);
    const push = (id: string, where: { x: number; y: number; behind: boolean }, text: string, more: Partial<LabelCandidate>) => { if (!where.behind) out.push({ id, x: where.x, y: where.y, text, priority: 10, size: 11, ...more }); };
    if (level === NIGERIA && sheets[NIGERIA]) {
      const sheet = sheets[NIGERIA], close = rig.view.distance < fits![NIGERIA]!.distance * 0.62;
      for (const feature of sheet.topology.features) {
        const entry = regionEntry('state', feature.id), top = sheet.top(feature), city = entry.city ? cityEntry(entry.city) : null;
        if (city) push(`city:${city.id}`, at(city.lon, city.lat, top + 0.02), city.name, { priority: entry.status === 'open' ? 1000 : 90, size: 13, anchor: 'above', fixed: entry.status === 'open', cls: `is-city is-${entry.status}`, note: feature.id === here ? 'You are here' : entry.status === 'open' ? 'Open' : 'Coming soon' });
        if (entry.status !== 'open') push(`state:${feature.id}`, at(feature.at[0], feature.at[1], top), feature.name === 'Federal Capital Territory' ? 'FCT' : feature.name, { short: feature.id === 'fct' ? 'FCT' : feature.ab, room: roomOf(feature, top) * 0.86, priority: city ? 44 : 50, cls: 'is-region' });
        if (close && !city) push(`cap:${feature.id}`, at(feature.cap[1], feature.cap[2], top), feature.cap[0], { priority: 22, size: 10, anchor: 'right', cls: 'is-town' });
      }
      for (const [name, lon, lat] of NEIGHBOUR_LABELS) push(`near:${name}`, at(lon, lat), name, { priority: 34, size: 12, cls: 'is-neighbour' });
      for (const [name, lon, lat, kind] of WATER_LABELS) push(`water:${name}`, at(lon, lat, HEIGHT.state), name, { priority: kind === 'sea' ? 40 : 26, size: kind === 'sea' ? 12 : 10, anchor: kind === 'town' ? 'right' : 'centre', cls: `is-${kind}` });
      if (close) for (const port of AIRPORTS) push(`air:${port.id}`, at(port.at[0], port.at[1], HEIGHT.state), '✈', { priority: 18, size: 12, cls: 'is-airport', title: port.name });
    } else if (level === AFRICA && sheets[AFRICA]) {
      const sheet = sheets[AFRICA];
      for (const feature of sheet.topology.features) {
        const top = sheet.top(feature), open = statusOf('country', feature.id) === 'open', b = feature.bounds;
        push(`country:${feature.id}`, at(feature.at[0], feature.at[1], top), feature.name, { room: open ? undefined : roomOf(feature, top) * 0.9, priority: open ? 1000 : 40 + Math.min(30, (b.maxLon - b.minLon) * (b.maxLat - b.minLat) * 0.1), fixed: open, size: open ? 13 : 11, cls: open ? 'is-city is-open' : 'is-region', note: open ? 'Open' : undefined, anchor: open ? 'above' : 'centre' });
        if (feature.cap && MAJOR_CAPITALS.has(feature.cap[0])) push(`cap:${feature.id}`, at(feature.cap[1], feature.cap[2], top), feature.cap[0], { priority: feature.cap[0] === 'Abuja' ? 60 : 30, size: 10, anchor: 'right', cls: 'is-capital' });
      }
    } else if (sheets[WORLD]) {
      for (const continent of Object.values(CONTINENTS)) push(`continent:${continent.id}`, at(relLon(continent.lon), continent.lat), continent.name, { priority: 100, size: 13, cls: 'is-continent' });
      const home = sheets[WORLD].topology.byId.get(ATLAS_LEVELS[NIGERIA]!.country!);
      if (home) push('country:home', at(home.at[0], home.at[1]), home.name, { priority: 1000, fixed: true, size: 12, anchor: 'above', cls: 'is-city is-open', note: 'Open' });
      for (const route of plannedRoutes(current)) push(`hub:${route.to.id}`, at(relLon(route.to.lon), route.to.lat), route.to.name, { priority: 60, size: 10, anchor: 'right', cls: 'is-capital' });
    }
    return out;
  }
  function drawLabels() {
    if (!ui.labels) { lastLabels = Math.min(LABEL_CAP, candidates().length); return; }
    const placed = placeLabels(candidates(), { width: size.width, height: size.height });
    lastLabels = placed.length;
    const keep = new Set<string>();
    for (const label of placed) {
      keep.add(label.id);
      let node = labelNodes.get(label.id);
      if (!node) { node = doc!.createElement('span'); labelNodes.set(label.id, node); ui.labels.appendChild(node); }
      const key = `${label.cls}|${label.shown}|${label.note || ''}|${label.anchor || ''}`;
      if (node.dataset.key !== key) { node.dataset.key = key; node.className = `atlas-label ${label.cls || ''} at-${label.anchor || 'centre'}`; node.innerHTML = `<b>${esc(label.shown)}</b>${label.note ? `<small>${esc(label.note)}</small>` : ''}`; if (label.title) node.title = label.title; }
      node.style.transform = `translate(${label.x.toFixed(1)}px,${label.y.toFixed(1)}px)`;
    }
    for (const [id, node] of labelNodes) if (!keep.has(id)) { node.remove(); labelNodes.delete(id); }
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
    if (ui.marker.dataset.mode !== place.mode) { ui.marker.dataset.mode = place.mode; ui.marker.innerHTML = ICON(place.mode === 'air' ? GLYPH.plane : GLYPH.bus); }
    ui.marker.style.transform = `translate(${where.x.toFixed(1)}px,${where.y.toFixed(1)}px)`;
  }
  function startRun(link: { a: string; b: string; mode: string }, from: string): Run | null {
    const path = linkPath(link, cityEntry);
    return path ? { path, line: measure(path.points), from, progress: 0 } : null;
  }
  /** Play a link's journey on the map without leaving: a preview, clearly not a real trip. */
  function previewTrip(routeId: string): boolean {
    const link = CITY_LINKS.find((item) => linkId(item) === routeId);
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
  const infoOf = (hit: Pick<Hit, 'kind' | 'id' | 'feature'>): RegionInfo => regionInfo({ kind: hit.kind, id: hit.id }, { ...context(), feature: hit.feature });
  function drawChrome() { drawCrumbs(); drawRail(); drawSheet(); drawHighlights(); }
  function drawCrumbs() {
    if (!ui.crumbs) return;
    const city = cityEntry(current);
    ui.crumbs.innerHTML = `<ol>${ATLAS_LEVELS.map((entry, i) => `<li><button type="button" data-atlas-level="${i}" ${i === level ? 'aria-current="true"' : ''}>${esc(entry.name)}</button></li>`).join('')}
      <li><button type="button" class="atlas-back" data-atlas-city="${esc(current)}" aria-label="Back to ${esc(city?.name)}: open the city map">${esc(city?.name)}<span aria-hidden="true">Back to the city</span></button></li></ol>
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
  function drawSheet() {
    if (!ui.sheet) return;
    const hit = find(selected);
    ui.sheet.hidden = !hit;
    root!.classList.toggle('has-sheet', Boolean(hit));
    if (!hit) { ui.sheet.innerHTML = ''; return; }
    const info = infoOf(hit);
    const routeRow = (route: RouteInfo) => {
      const on = routeShown === route.id, playing = preview && routeShown === route.id;
      return `<li class="${on ? 'is-on' : ''}"><button type="button" class="atlas-route" data-atlas-route="${esc(route.id)}" aria-pressed="${on}"><span class="atlas-route-mode" aria-hidden="true">${ICON(route.mode === 'air' ? GLYPH.plane : GLYPH.bus)}</span><span><b>${esc(route.label)}</b><small>${naira(route.fare)} · about ${route.minutes} min · ${route.km} km · from ${esc(route.hub)}</small></span></button>
        ${on ? `<div class="atlas-route-more">${route.live ? `<button type="button" class="atlas-go is-small" data-atlas-travel="${esc(route.to)}:${esc(route.mode)}">Travel · ${naira(route.fare)}</button>` : `<p>${esc(route.why || '')}</p>`}<button type="button" class="atlas-chip" data-atlas-preview="${esc(route.id)}" ${playing ? 'disabled' : ''}>${playing ? 'Showing the journey…' : 'Preview the journey'}</button></div>` : ''}</li>`;
    };
    const more = Boolean(info.preview || info.routes.length || info.planned || info.wait);
    ui.sheet.className = `atlas-sheet is-${info.tone}${sheetOpen ? ' is-expanded' : ''}`;
    ui.sheet.setAttribute('aria-label', `${info.name}: ${info.tag}`);
    ui.sheet.innerHTML = `<header><div><h2>${esc(info.name)}</h2><p>${esc(info.type)}${info.capital ? ` · capital ${esc(info.capital)}` : ''}</p></div><span class="atlas-tag">${esc(info.tag)}</span><button type="button" class="atlas-close" data-atlas-close aria-label="Close ${esc(info.name)}">${ICON('<path d="M6 6l12 12M18 6 6 18"/>')}</button></header>
      <p class="atlas-teaser">${esc(info.teaser)}</p>
      ${info.action ? `<button type="button" class="atlas-go" data-atlas-action>${esc(info.action.label)}<span aria-hidden="true"> →</span></button>` : ''}
      ${more ? `<button type="button" class="atlas-more" data-atlas-expand aria-expanded="${sheetOpen}">${sheetOpen ? 'Less' : info.routes.length ? 'Routes and details' : 'More'}</button>` : ''}
      ${info.preview ? `<div class="atlas-preview"><h3>${esc(info.city!.name)} will have</h3><ul>${info.preview.map((line) => `<li>${esc(line)}</li>`).join('')}</ul></div>` : ''}
      ${info.wait ? `<p class="atlas-waitline">${esc(info.wait)}</p>` : ''}
      ${info.planned ? `<p class="atlas-planned">${ICON(GLYPH.plane)}<span>${esc(info.planned)}</span></p>` : ''}
      ${info.routes.length ? `<div class="atlas-routes"><h3>${info.status === 'open' ? `Routes from ${esc(info.routesFrom)}` : `Getting there from ${esc(info.routesFrom)}`}</h3><ul>${info.routes.map(routeRow).join('')}</ul><p class="atlas-waitline">You stay one person: your money, skills, friends and look travel with you, and your house here stays yours.</p></div>` : ''}`;
  }

  /** Choose a region (or nothing). `from`: 'map' | 'list' | 'key' — the list and the keyboard move focus to the sheet. */
  function select(ref: RegionRef | null, { from = 'map', flyTo = false }: SelectOptions = {}): boolean {
    const hit = find(ref);
    if (!same(hit, selected)) sheetOpen = false;
    if (preview && reducedMotion) preview = null; // the still preview lasts until something else is chosen
    selected = hit ? { kind: hit.kind, id: hit.id } : null;
    if (!preview && !trip) routeShown = null;
    const inside = hit?.kind === 'country' ? ATLAS_LEVELS.findIndex((entry) => entry.id === regionEntry('country', hit.id).level) : -1;
    const back = !hit && doc && ui.sheet?.contains(doc.activeElement);
    if (hit && flyTo) { if (inside > 0) goLevel(inside); else fly(viewOf(hit.feature)); }
    if (hit && from === 'list') listOpen = false;
    drawCrumbs(); drawRail(); drawSheet(); drawHighlights(); request();
    // The list and the keyboard move focus to the sheet; closing it hands focus back to the breadcrumb.
    if (hit && from !== 'map') ui.sheet?.focus?.({ preventScroll: true });
    else if (back) ui.crumbs!.querySelector<HTMLElement>('[aria-current]')?.focus();
    return Boolean(hit);
  }
  function goLevel(index: number) { const next = clamp(index, WORLD, NIGERIA); void ensure(next); fly(levelView(next), 0.9); }
  /** Fly down into the open city, then hand over to the city map. */
  function enterCity(id: string) {
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
  }

  // ---- input -------------------------------------------------------------------------------------------
  const pointers = new Map<number, Point>();
  let gesture: Gesture | null = null, lastTap = { t: -1e9, x: 0, y: 0 };
  const local = (event: MouseEvent): Point => { const page = container.getBoundingClientRect(); return { x: event.clientX - page.left, y: event.clientY - page.top }; };
  const ndc = (point: Point): [number, number] => [(point.x / size.width) * 2 - 1, 1 - (point.y / size.height) * 2];
  function onDown(event: PointerEvent) {
    if (entering) return;
    keyboard = false; root!.classList.remove('is-keys');
    pointers.set(event.pointerId, local(event));
    canvas.setPointerCapture?.(event.pointerId);
    rig.hold();
    if (pointers.size === 1) gesture = { kind: event.button === 2 || event.shiftKey ? 'orbit' : 'pan', start: local(event), last: local(event), moved: false };
    else if (pointers.size === 2) { const [a, b] = [...pointers.values()] as [Point, Point]; gesture = { kind: 'pinch', span: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, angle: Math.atan2(b.y - a.y, b.x - a.x), moved: true }; }
  }
  function onMove(event: PointerEvent) {
    const point = local(event);
    if (!pointers.has(event.pointerId)) { if (event.pointerType === 'mouse') hover(point); return; }
    pointers.set(event.pointerId, point);
    if (!gesture) return;
    if (gesture.kind === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()] as [Point, Point], span = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, angle = Math.atan2(b.y - a.y, b.x - a.x);
      rig.panScreen(mid.x - gesture.mid!.x, mid.y - gesture.mid!.y);
      if (level === NIGERIA) rig.orbit(clamp(rig.view.yaw - (angle - gesture.angle!), -0.6, 0.6) - rig.view.yaw, 0);
      if (span > 0 && gesture.span! > 0) zoomBy(gesture.span! / span, ...ndc(mid));
      Object.assign(gesture, { span, mid, angle });
      moved();
      return;
    }
    const dx = point.x - gesture.last!.x, dy = point.y - gesture.last!.y;
    if (!gesture.moved && Math.hypot(point.x - gesture.start!.x, point.y - gesture.start!.y) < DRAG_START) return;
    if (!gesture.moved) { gesture.moved = true; root!.classList.add('is-dragging'); setHover(null); }
    gesture.last = point;
    // Turning and tilting is for the closest level; farther out the map stays flat-on.
    if (gesture.kind === 'orbit' && level === NIGERIA) rig.orbit(clamp(rig.view.yaw - dx * 0.005, -0.6, 0.6) - rig.view.yaw, clamp(rig.view.pitch + dy * 0.004, 0.7, 1.4) - rig.view.pitch);
    else rig.panScreen(dx, dy);
    moved();
  }
  function onUp(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return;
    const point = local(event), was = gesture;
    pointers.delete(event.pointerId);
    root!.classList.remove('is-dragging');
    if (pointers.size === 1 && was?.kind === 'pinch') { const rest = [...pointers.values()][0]!; gesture = { kind: 'pan', start: rest, last: rest, moved: true }; return; }
    gesture = null;
    if (!was || was.moved || event.type === 'pointercancel') return;
    const t = now(), double = t - lastTap.t < DOUBLE_MS && Math.hypot(point.x - lastTap.x, point.y - lastTap.y) < 28;
    lastTap = double ? { t: -1e9, x: 0, y: 0 } : { t, x: point.x, y: point.y };
    const hit = pickAt(point.x, point.y);
    if (double) {
      // Twice on a region: go to it. Twice on open water: just closer.
      if (hit) { selected = { kind: hit.kind, id: hit.id }; select(selected, { flyTo: true }); }
      else { const [nx, ny] = ndc(point), ground = rig.groundAt(nx, ny); if (ground) fly({ x: ground.x, z: ground.z, distance: rig.view.distance * 0.5, yaw: rig.view.yaw }, 0.45); }
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
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    rig.hold();
    zoomBy(Math.exp(clamp(delta, -240, 240) * 0.0016), ...ndc(local(event)));
  }
  function onClick(event: MouseEvent) {
    const hit = (name: string) => (event.target as Element).closest?.<HTMLElement>(`[data-atlas-${name}]`);
    const lvl = hit('level'), city = hit('city'), pick = hit('pick'), zoom = hit('zoom'), route = hit('route'), play = hit('preview'), go = hit('travel');
    if (lvl) goLevel(Number(lvl.dataset.atlasLevel));
    else if (city) enterCity(city.dataset.atlasCity!);
    else if (pick) { const [kind, id] = pick.dataset.atlasPick!.split(':'); select({ kind: kind as RegionKind, id: id! }, { from: 'list', flyTo: true }); }
    else if (zoom) { const how = zoom.dataset.atlasZoom; if (how === 'fit') fly(levelView(level)); else fly({ distance: rig.view.distance * (how === 'in' ? 0.6 : 1 / 0.6), x: rig.view.x, z: rig.view.z, yaw: rig.view.yaw }, 0.3); }
    else if (hit('layer')) setTint(!tintOn);
    else if (hit('action')) act();
    else if (hit('close')) select(null);
    else if (hit('expand')) { sheetOpen = !sheetOpen; drawSheet(); ui.sheet!.querySelector<HTMLElement>('[data-atlas-expand]')?.focus(); }
    else if (hit('list')) { listOpen = !listOpen; drawCrumbs(); drawRail(); if (listOpen) ui.rail!.querySelector<HTMLElement>('[data-atlas-search]')?.focus(); }
    else if (hit('retry')) { failed = ''; void ensure(wanted); showWait(); }
    else if (play) previewTrip(play.dataset.atlasPreview!);
    else if (go) { const [to, mode] = go.dataset.atlasTravel!.split(':'); onTravel(to!, mode!); }
    else if (route) { const id = route.dataset.atlasRoute!; if (!preview && !trip) { routeShown = routeShown === id ? null : id; drawSheet(); drawHighlights(); request(); ui.sheet!.querySelector<HTMLElement>(`[data-atlas-route="${CSS.escape(id)}"]`)?.focus(); } }
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
    if (listOpen) { listOpen = false; drawCrumbs(); drawRail(); }
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
    root!.addEventListener('click', onClick); root!.addEventListener('input', onInput);
    window.addEventListener('jaw:key', onKey); window.addEventListener('jaw:atlas-escape', onEscape);
    watcher?.observe(container, { attributes: true, attributeFilter: ['hidden'] });
  }

  const ready = ensure(NIGERIA).then(() => { void ensure(WORLD); return true; });
  drawCrumbs?.();

  return {
    ready,
    /** The city the player is in: its state is "You are here" and the default selection. */
    setCity(id) { if (!cityEntry(id)) return; current = id; selected = stateOfCity(id) ? { kind: 'state', id: stateOfCity(id)! } : null; routeShown = null; resetView = true; drawChrome(); request(); },
    /** The life's state: a trip between cities is shown where the server's timer says it is. */
    setState(state) {
      const next = interCityTripOf(state);
      if (!next) { if (trip) { trip = null; clock.clear(); routeShown = null; drawHighlights(); request(); } return; }
      const link = CITY_LINKS.find((item) => ((item.a === next.from && item.b === next.to) || (item.a === next.to && item.b === next.from)) && item.mode === next.mode);
      if (!link) return;
      const fresh = clock.sync(next, now());
      if (fresh || !trip) { trip = startRun(link, next.from); preview = null; routeShown = linkId(link); drawHighlights(); }
      if (trip) trip.progress = clock.progress(now());
      request();
    },
    /** The held cities or the links may have changed. */
    refresh() { drawRail(); drawSheet(); },
    resize, goLevel, previewTrip,
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
        trip: trip || preview ? { progress: (trip || preview)!.progress, preview: Boolean(preview && !trip), mode: (trip || preview)!.path.mode } : null,
        view: { ...rig.view }, fits: fits ? distances() : null, cuts: [...cuts], layers: layers.map((entry) => entry.alpha) };
    },
    destroy() {
      destroyed = true; stop(); watcher?.disconnect();
      if (doc) { window.removeEventListener('jaw:key', onKey); window.removeEventListener('jaw:atlas-escape', onEscape); root!.remove(); }
      for (const entry of layers) { entry.object.geometry.dispose(); for (const material of entry.materials) material.dispose(); }
      for (const object of [hoverMesh, selectMesh, selectLine, routeLine]) { object.geometry.dispose(); object.material.dispose(); }
      if (!providedRenderer) renderer.dispose();
    },
  };
}
